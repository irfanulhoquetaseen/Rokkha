import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { reservations as t } from "@/lib/i18n/reservations";
import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { publishReservation, publishStock } from "@/server/realtime/publish";
import { findAlternatives, type Alternative } from "./alternatives";
import { ACTIVE_STATUSES, HOLD_MINUTES, MAX_ACTIVE_TOTAL } from "./constants";
import { idempotencyKeySchema, requestHash, reserveBodySchema, type ParsedReserveBody, type ReserveBody } from "./schemas";
import { readStock, takeStock, type StockSnapshot } from "./stock";
import { expireOverdue } from "./sweeper";
import { loadReservationView, type ReservationView } from "./view";

export type ReserveResult = { reservation: ReservationView; replayed: boolean };

/** Reserve transaction budget: up to 15 s to get a pooled connection under a burst, 10 s to run. */
export const RESERVE_TX_OPTIONS = { maxWait: 15_000, timeout: 10_000 } as const;

type Outcome =
  | { kind: "held"; view: ReservationView; stock: StockSnapshot }
  | { kind: "replay"; view: ReservationView }
  // Returned (not thrown) so the transaction commits the SoldOutEvent.
  | { kind: "soldOut" }
  // A same-type hold went overdue between the pre-expiry and this transaction: it no longer
  // counts, but it still occupies the per-type unique index — expire it and try once more.
  | { kind: "overdueSameType" };

function validationError(issues: z.core.$ZodIssue[]): AppError {
  return new AppError("VALIDATION_ERROR", undefined, issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

const keyReused = () => new AppError("CONFLICT", t.keyReused);
const sameType = (reservationId: string) =>
  new AppError("LIMIT_REACHED", t.limitSameType, { reason: "SAME_TYPE", reservationId });

/**
 * Holds `quantity` of a countable resource for 30 minutes.
 * First the user's overdue holds are expired (own short transactions). Then ONE transaction:
 *  1. per-user advisory lock (a user can't race themselves; idempotency + limits become serial per user),
 *  2. idempotency replay / key-reuse check, 3. resolve the holdable resource, 4. per-user limits,
 *  5. atomic conditional decrement (never read-then-write) — 0 rows → SOLD_OUT (+ SoldOutEvent, committed),
 *  6. reservation + event + audit. It locks exactly one stock row. Socket events only after commit.
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

  let outcome: Outcome = { kind: "overdueSameType" };
  for (let attempt = 0; attempt < 2 && outcome.kind === "overdueSameType"; attempt++) {
    // Expire this user's overdue holds first, each in its own short transaction (published after
    // each commit). Returning stock locks that stock row; doing it inside the reserve transaction
    // (which then locks a second stock row) could deadlock two users whose overdue holds sit on
    // each other's target rows.
    await expireOverdue(now, { userId: u.id });
    try {
      outcome = await prisma.$transaction((tx) => reserveTx(tx, u, key.data, hash, body, now), RESERVE_TX_OPTIONS);
    } catch (e) {
      // Defence in depth: the advisory lock serialises one user's requests, so these unique
      // violations are only reachable when two *different* users send the same key.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return afterUniqueViolation(u, key.data, hash, body);
      throw e;
    }
  }

  switch (outcome.kind) {
    case "held":
      publishStock(outcome.stock);
      publishReservation({ ...outcome.view, hospitalId: outcome.view.hospital.id });
      return { reservation: outcome.view, replayed: false };
    case "replay":
      return { reservation: outcome.view, replayed: true };
    case "overdueSameType":
      // Both attempts raced a just-expiring hold; the client retries with the same key.
      throw new AppError("CONFLICT");
    case "soldOut":
      throw new AppError("SOLD_OUT", t.soldOut, { alternatives: await safeAlternatives(body) });
  }
}

/** Alternatives are advice: if computing them fails, SOLD_OUT is still the answer (with none). */
async function safeAlternatives(body: ParsedReserveBody): Promise<Alternative[]> {
  try {
    return await findAlternatives({
      resourceCode: body.resourceCode, quantity: body.quantity, conditionCode: body.conditionCode,
      bloodGroup: body.bloodGroup, excludeHospitalId: body.hospitalId,
      origin: body.lat !== undefined && body.lng !== undefined ? { lat: body.lat, lng: body.lng } : undefined,
    });
  } catch (e) {
    const err = (e ?? {}) as { name?: unknown; code?: unknown };
    console.error("[reserve] alternatives failed", String(err.name ?? "Error"), String(err.code ?? "-"));
    return [];
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
    if (existing.userId !== u.id || existing.requestHash !== hash) throw keyReused();
    return { kind: "replay", view: await loadReservationView(tx, existing.id) };
  }

  // 3. The resource must exist, be countable, and belong to a hospital with live data.
  const hr = await tx.hospitalResource.findFirst({
    where: { hospitalId: body.hospitalId, resourceType: { code: body.resourceCode } },
    select: { id: true, hospitalId: true, resourceTypeId: true, resourceType: { select: { kind: true } }, hospital: { select: { liveDataEnabled: true, archivedAt: true } } },
  });
  if (!hr) throw new AppError("NOT_FOUND");
  if (hr.hospital.archivedAt !== null) {
    throw new AppError("CONFLICT", {
      bn: "এই হাসপাতাল আর্কাইভ করা হয়েছে, রিজার্ভ করা যাবে না",
      en: "This hospital is archived and cannot be reserved",
    });
  }
  if (hr.resourceType.kind !== "COUNTABLE" || !hr.hospital.liveDataEnabled) throw new AppError("VALIDATION_ERROR", t.cannotHold);

  let conditionId: string | null = null;
  if (body.conditionCode) {
    const c = await tx.condition.findUnique({ where: { code: body.conditionCode }, select: { id: true } });
    if (!c) throw new AppError("VALIDATION_ERROR", t.unknownCondition);
    conditionId = c.id;
  }

  // 4. Per-user limits. A HELD row past expiresAt does not count (it went overdue after the
  // pre-expiry). No stock is returned here, so this transaction never locks a second stock row.
  const active = await tx.reservation.findMany({
    where: { userId: u.id, status: { in: [...ACTIVE_STATUSES] } },
    select: { id: true, resourceTypeId: true, status: true, expiresAt: true },
  });
  const live = active.filter((r) => r.status === "ARRIVED" || r.expiresAt > now);
  const same = active.find((r) => r.resourceTypeId === hr.resourceTypeId);
  if (same && live.includes(same)) throw sameType(same.id);
  if (live.length >= MAX_ACTIVE_TOTAL) {
    throw new AppError("LIMIT_REACHED", t.limitMaxActive, { reason: "MAX_ACTIVE", max: MAX_ACTIVE_TOTAL });
  }
  if (same) return { kind: "overdueSameType" };

  // 5. Atomic conditional decrement; the row lock it takes is what serialises racing users.
  if (!(await takeStock(tx, hr.id, body.quantity))) {
    // If a concurrent hard-delete removed the hospital/resource row, fail cleanly instead of FK P2003 on SoldOutEvent.
    if (!(await tx.hospitalResource.findUnique({ where: { id: hr.id }, select: { id: true } }))) {
      throw new AppError("NOT_FOUND");
    }
    // Keyed by the Idempotency-Key (ON CONFLICT DO NOTHING): a retried sold-out request records unmet demand once.
    await tx.soldOutEvent.createMany({
      data: [{ hospitalId: hr.hospitalId, resourceTypeId: hr.resourceTypeId, conditionId, userId: u.id, idempotencyKey }],
      skipDuplicates: true,
    });
    return { kind: "soldOut" };
  }

  // Re-check archivedAt WHILE holding the HospitalResource row lock: deleteOrArchiveHospital locks
  // HospitalResource FOR UPDATE before setting archivedAt, so one side always sees the other's commit.
  const currentHospital = await tx.hospital.findUnique({
    where: { id: hr.hospitalId },
    select: { archivedAt: true },
  });
  if (!currentHospital || currentHospital.archivedAt !== null) {
    throw new AppError("CONFLICT", {
      bn: "এই হাসপাতাল আর্কাইভ করা হয়েছে, রিজার্ভ করা যাবে না",
      en: "This hospital is archived and cannot be reserved",
    });
  }

  // 6. The hold itself, its first event and the audit entry — same transaction.
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
  return { kind: "held", view: await loadReservationView(tx, r.id), stock };
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
