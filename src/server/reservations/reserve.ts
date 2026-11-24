import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { reservations as t } from "@/lib/i18n/reservations";
import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { publishReservation, publishStock } from "@/server/realtime/publish";
import { findAlternatives } from "./alternatives";
import { ACTIVE_STATUSES, HOLD_MINUTES, MAX_ACTIVE_TOTAL } from "./constants";
import { idempotencyKeySchema, requestHash, reserveBodySchema, type ParsedReserveBody, type ReserveBody } from "./schemas";
import { readStock, takeStock, type StockSnapshot } from "./stock";
import { transitionReservation, type TransitionResult } from "./transition";
import { loadReservationView, type ReservationView } from "./view";

export type ReserveResult = { reservation: ReservationView; replayed: boolean };

/** Reserve transaction budget: up to 15 s to get a pooled connection under a burst, 10 s to run. */
export const RESERVE_TX_OPTIONS = { maxWait: 15_000, timeout: 10_000 } as const;

type Outcome =
  | { kind: "held"; view: ReservationView; stock: StockSnapshot; expired: TransitionResult[] }
  | { kind: "replay"; view: ReservationView; expired: TransitionResult[] }
  | { kind: "soldOut"; expired: TransitionResult[] }
  // A business refusal (limit, not holdable, key reuse) is returned, not thrown, so the
  // transaction still commits the lazy expiries it did; it is thrown after commit.
  | { kind: "refused"; error: AppError; expired: TransitionResult[] };

function validationError(issues: z.core.$ZodIssue[]): AppError {
  return new AppError("VALIDATION_ERROR", undefined, issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

const keyReused = () => new AppError("CONFLICT", t.keyReused);
const sameType = (reservationId: string) =>
  new AppError("LIMIT_REACHED", t.limitSameType, { reason: "SAME_TYPE", reservationId });

/**
 * Holds `quantity` of a countable resource for 30 minutes — one database transaction:
 *  1. per-user advisory lock (a user can't race themselves; idempotency + limits become serial per user),
 *  2. idempotency replay / key-reuse check, 3. lazy expiry of the user's overdue holds,
 *  4. resolve the holdable resource, 5. per-user limits,
 *  6. atomic conditional decrement (never read-then-write) — 0 rows → SOLD_OUT (+ SoldOutEvent, committed),
 *  7. reservation + event + audit. Socket events are emitted only after commit.
 */
export async function reserve(
  user: SessionUser | null,
  input: { idempotencyKey: string; body: ReserveBody },
  now: Date = new Date(),
): Promise<ReserveResult> {
  const u = await requireRole(user, "CITIZEN");
  const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) throw validationError(key.error.issues);
  const parsed = reserveBodySchema.safeParse(input.body);
  if (!parsed.success) throw validationError(parsed.error.issues);
  const body = parsed.data;
  const hash = requestHash(body);

  let outcome: Outcome;
  try {
    outcome = await prisma.$transaction((tx) => reserveTx(tx, u, key.data, hash, body, now), RESERVE_TX_OPTIONS);
  } catch (e) {
    // Defence in depth: the advisory lock serialises one user's requests, so these unique
    // violations are only reachable when two *different* users send the same key.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return afterUniqueViolation(u, key.data, hash, body);
    throw e;
  }

  for (const x of outcome.expired) {
    publishReservation(x.reservation);
    if (x.stock) publishStock(x.stock);
  }
  switch (outcome.kind) {
    case "held":
      publishStock(outcome.stock);
      publishReservation({ ...outcome.view, hospitalId: outcome.view.hospital.id, userId: u.id });
      return { reservation: outcome.view, replayed: false };
    case "replay":
      return { reservation: outcome.view, replayed: true };
    case "refused":
      throw outcome.error;
    case "soldOut": {
      const alternatives = await findAlternatives({
        resourceCode: body.resourceCode, quantity: body.quantity, conditionCode: body.conditionCode,
        bloodGroup: body.bloodGroup, excludeHospitalId: body.hospitalId,
        origin: body.lat !== undefined && body.lng !== undefined ? { lat: body.lat, lng: body.lng } : undefined,
      });
      throw new AppError("SOLD_OUT", t.soldOut, { alternatives });
    }
  }
}

async function reserveTx(
  tx: Prisma.TransactionClient, u: SessionUser, idempotencyKey: string, hash: string, body: ParsedReserveBody, now: Date,
): Promise<Outcome> {
  // 1. Serialise this user's reserve calls until commit/rollback (released automatically).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${u.id}, 0))`;

  // 2. Idempotency: a retry returns the original hold, never a second one.
  const existing = await tx.reservation.findUnique({
    where: { idempotencyKey }, select: { id: true, userId: true, requestHash: true },
  });
  if (existing) {
    if (existing.userId !== u.id || existing.requestHash !== hash) return { kind: "refused", error: keyReused(), expired: [] };
    return { kind: "replay", view: await loadReservationView(tx, existing.id), expired: [] };
  }

  // 3. Lazily expire this user's overdue holds so they neither count nor keep stock.
  const expired: TransitionResult[] = [];
  const overdue = await tx.reservation.findMany({
    where: { userId: u.id, status: "HELD", expiresAt: { lte: now } }, select: { id: true },
  });
  for (const { id } of overdue) {
    try {
      expired.push(await transitionReservation(tx, { reservationId: id, to: "EXPIRED", actor: { kind: "system", userId: null }, now }));
    } catch (e) {
      // The sweeper (or another transition) already moved it — nothing to return.
      if (!(e instanceof AppError && e.code === "INVALID_TRANSITION")) throw e;
    }
  }
  const refuse = (error: AppError): Outcome => ({ kind: "refused", error, expired });

  // 4. The resource must exist, be countable, and belong to a hospital with live data.
  const hr = await tx.hospitalResource.findFirst({
    where: { hospitalId: body.hospitalId, resourceType: { code: body.resourceCode } },
    select: { id: true, hospitalId: true, resourceTypeId: true, resourceType: { select: { kind: true } }, hospital: { select: { liveDataEnabled: true } } },
  });
  if (!hr) return refuse(new AppError("NOT_FOUND"));
  if (hr.resourceType.kind !== "COUNTABLE" || !hr.hospital.liveDataEnabled) return refuse(new AppError("VALIDATION_ERROR", t.cannotHold));

  let conditionId: string | null = null;
  if (body.conditionCode) {
    const c = await tx.condition.findUnique({ where: { code: body.conditionCode }, select: { id: true } });
    if (!c) return refuse(new AppError("VALIDATION_ERROR", t.unknownCondition));
    conditionId = c.id;
  }

  // 5. Per-user limits (overdue rows were expired above, so they no longer count).
  const active = await tx.reservation.findMany({
    where: { userId: u.id, status: { in: [...ACTIVE_STATUSES] } }, select: { id: true, resourceTypeId: true },
  });
  const same = active.find((r) => r.resourceTypeId === hr.resourceTypeId);
  if (same) return refuse(sameType(same.id));
  if (active.length >= MAX_ACTIVE_TOTAL) {
    return refuse(new AppError("LIMIT_REACHED", t.limitMaxActive, { reason: "MAX_ACTIVE", max: MAX_ACTIVE_TOTAL }));
  }

  // 6. Atomic conditional decrement; the row lock it takes is what serialises racing users.
  if (!(await takeStock(tx, hr.id, body.quantity))) {
    await tx.soldOutEvent.create({ data: { hospitalId: hr.hospitalId, resourceTypeId: hr.resourceTypeId, conditionId, userId: u.id } });
    return { kind: "soldOut", expired };
  }

  // 7. The hold itself, its first event and the audit entry — same transaction.
  const r = await tx.reservation.create({
    data: {
      userId: u.id, hospitalId: hr.hospitalId, resourceTypeId: hr.resourceTypeId, hospitalResourceId: hr.id, conditionId,
      quantity: body.quantity, status: "HELD", expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
      idempotencyKey, requestHash: hash,
    },
  });
  await tx.reservationEvent.create({ data: { reservationId: r.id, fromStatus: null, toStatus: "HELD", actorUserId: u.id } });
  const stock = await readStock(tx, hr.id);
  await audit({
    actorUserId: u.id, action: "RESERVATION_TRANSITION", entityType: "Reservation", entityId: r.id,
    before: null,
    after: { status: "HELD", version: r.version, quantity: r.quantity, hospitalResourceId: hr.id, available: stock.available },
  }, tx);
  return { kind: "held", view: await loadReservationView(tx, r.id), stock, expired };
}

/** P2002 after rollback: the key was taken by a committed request, or the per-type index fired. */
async function afterUniqueViolation(u: SessionUser, idempotencyKey: string, hash: string, body: ParsedReserveBody): Promise<ReserveResult> {
  const existing = await prisma.reservation.findUnique({
    where: { idempotencyKey }, select: { id: true, userId: true, requestHash: true },
  });
  if (existing) {
    if (existing.userId !== u.id || existing.requestHash !== hash) throw keyReused();
    return { reservation: await loadReservationView(prisma, existing.id), replayed: true };
  }
  const same = await prisma.reservation.findFirst({
    where: { userId: u.id, status: { in: [...ACTIVE_STATUSES] }, resourceType: { code: body.resourceCode } },
    select: { id: true },
  });
  if (same) throw sameType(same.id);
  throw new AppError("INTERNAL");
}
