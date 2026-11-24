import { z } from "zod";
import type { Prisma, Reservation, ReservationStatus } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { reservations as t } from "@/lib/i18n/reservations";
import { audit } from "@/server/audit/audit";
import { requireHospitalAccess, requireReservationOwner, requireUser } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { publishReservation, publishStock } from "@/server/realtime/publish";
import { ACTION_TARGET, TRANSITIONS, canTransition, returnsStock, type Actor } from "./state-machine";
import { readStock, returnStock, type StockSnapshot } from "./stock";
import { loadReservationView, type ReservationView } from "./view";

export type TransitionResult = {
  reservation: Reservation;
  from: ReservationStatus;
  /** Non-null when stock was returned to the hospital by this transition. */
  stock: StockSnapshot | null;
};

type TargetStatus = Exclude<ReservationStatus, "HELD">;
const TIMESTAMP_FIELD = {
  ARRIVED: "arrivedAt", CANCELLED: "cancelledAt", EXPIRED: "expiredAt", REJECTED: "rejectedAt", COMPLETED: "completedAt",
} as const satisfies Record<TargetStatus, keyof Reservation>;

/** The single allowed predecessor of `to` (ARRIVED for COMPLETED, HELD otherwise), derived from TRANSITIONS. */
function predecessorOf(to: ReservationStatus): ReservationStatus | null {
  const froms = (Object.keys(TRANSITIONS) as ReservationStatus[]).filter((f) => canTransition(f, to));
  return froms.length === 1 ? froms[0]! : null;
}

/**
 * Moves one reservation to `to` inside the caller's transaction.
 *
 * The write is a compare-and-set (`WHERE id AND status = <predecessor>` + an expiry guard for
 * EXPIRED/ARRIVED). Under READ COMMITTED a concurrent writer blocks on the row lock and then
 * re-checks the WHERE against the committed row, so of N racing transitions exactly one gets
 * count = 1; the rest get INVALID_TRANSITION. Stock is returned only by that winner, so a hold
 * can never be released twice.
 */
export async function transitionReservation(
  tx: Prisma.TransactionClient,
  input: { reservationId: string; to: ReservationStatus; actor: Actor; reason?: string; now: Date },
): Promise<TransitionResult> {
  const { reservationId, to, actor, reason, now } = input;
  const from = predecessorOf(to);
  if (from === null || to === "HELD") throw new AppError("INVALID_TRANSITION", t.invalidTransition, { to });

  const timeGuard: Prisma.ReservationWhereInput =
    to === "EXPIRED" ? { expiresAt: { lte: now } } : to === "ARRIVED" ? { expiresAt: { gt: now } } : {};
  const data: Prisma.ReservationUpdateManyMutationInput = { status: to, version: { increment: 1 } };
  data[TIMESTAMP_FIELD[to]] = now;
  if (to === "REJECTED") data.rejectedReason = reason ?? null;

  const { count } = await tx.reservation.updateMany({ where: { id: reservationId, status: from, ...timeGuard }, data });
  if (count === 0) {
    const current = await tx.reservation.findUnique({ where: { id: reservationId }, select: { status: true, expiresAt: true } });
    if (!current) throw new AppError("NOT_FOUND");
    const expired = current.status === "EXPIRED" || (current.status === "HELD" && current.expiresAt <= now);
    throw new AppError("INVALID_TRANSITION", expired ? t.holdExpired : t.invalidTransition, { status: current.status });
  }

  const { resourceType, ...reservation } = await tx.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    include: { resourceType: { select: { consumable: true } } },
  });

  await tx.reservationEvent.create({
    data: { reservationId, fromStatus: from, toStatus: to, actorUserId: actor.userId, note: to === "REJECTED" ? (reason ?? null) : null },
  });

  let stock: StockSnapshot | null = null;
  if (returnsStock(to, resourceType.consumable)) {
    await returnStock(tx, reservation.hospitalResourceId, reservation.quantity);
    stock = await readStock(tx, reservation.hospitalResourceId);
  }

  await audit({
    actorUserId: actor.userId, action: "RESERVATION_TRANSITION", entityType: "Reservation", entityId: reservationId,
    before: { status: from, version: reservation.version - 1 },
    after: {
      status: to, version: reservation.version, actorKind: actor.kind, quantity: reservation.quantity,
      hospitalResourceId: reservation.hospitalResourceId, stockReturned: stock !== null,
      ...(stock ? { available: stock.available } : {}), ...(to === "REJECTED" ? { reason } : {}),
    },
  }, tx);

  return { reservation, from, stock };
}

/** Emit only after the transaction committed. */
function publishAfterCommit(result: TransitionResult): void {
  publishReservation(result.reservation);
  if (result.stock) publishStock(result.stock);
}

/**
 * Runs a citizen/staff action in its own transaction. An overdue HELD row is expired first
 * (and that expiry is committed, returning the stock), then the action fails with "expired".
 */
async function runAction(reservationId: string, to: ReservationStatus, actor: Actor, reason?: string): Promise<ReservationView> {
  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    const row = await tx.reservation.findUnique({ where: { id: reservationId }, select: { status: true, expiresAt: true } });
    if (!row) throw new AppError("NOT_FOUND");
    if (row.status === "HELD" && row.expiresAt <= now) {
      const result = await transitionReservation(tx, { reservationId, to: "EXPIRED", actor: { kind: "system", userId: null }, now });
      return { result, expired: true as const };
    }
    const result = await transitionReservation(tx, { reservationId, to, actor, reason, now });
    return { result, expired: false as const, view: await loadReservationView(tx, reservationId) };
  });
  publishAfterCommit(outcome.result);
  if (outcome.expired) throw new AppError("INVALID_TRANSITION", t.holdExpired, { status: "EXPIRED" });
  return outcome.view;
}

const idSchema = z.string().min(1).max(64);
const reasonSchema = z.string().trim().min(3).max(300);
const staffActionSchema = z.enum(["checkIn", "reject", "complete"]);
export type StaffAction = z.infer<typeof staffActionSchema>;

function validationError(issues: z.core.$ZodIssue[], message = { bn: "প্রদত্ত তথ্য সঠিক নয়", en: "The submitted data is invalid" }): AppError {
  return new AppError("VALIDATION_ERROR", message, issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

/** Citizen (owner, or admin) cancels a HELD reservation. Foreign/missing → NOT_FOUND (audited). */
export async function cancelReservation(user: SessionUser | null, reservationId: string): Promise<ReservationView> {
  const u = requireUser(user);
  const id = idSchema.safeParse(reservationId);
  if (!id.success) throw validationError(id.error.issues);
  await requireReservationOwner(u, id.data);
  return runAction(id.data, ACTION_TARGET.cancel, { kind: "citizen", userId: u.id });
}

/** Staff of the reservation's hospital (or admin): check-in, reject (reason 3–300 chars) or complete. */
export async function staffTransition(
  user: SessionUser | null, reservationId: string, action: StaffAction, reason?: string,
): Promise<ReservationView> {
  const u = requireUser(user);
  const id = idSchema.safeParse(reservationId);
  if (!id.success) throw validationError(id.error.issues);
  const act = staffActionSchema.safeParse(action);
  if (!act.success) throw validationError(act.error.issues);
  let note: string | undefined;
  if (act.data === "reject") {
    const r = reasonSchema.safeParse(reason ?? "");
    if (!r.success) throw validationError(r.error.issues, t.rejectReasonRequired);
    note = r.data;
  }

  // Look up only the hospital; a missing row is NOT_FOUND before any access check.
  const row = await prisma.reservation.findUnique({ where: { id: id.data }, select: { hospitalId: true } });
  if (!row) throw new AppError("NOT_FOUND");
  await requireHospitalAccess(u, row.hospitalId);
  return runAction(id.data, ACTION_TARGET[act.data], { kind: "staff", userId: u.id }, note);
}

/**
 * System expiry of one overdue HELD reservation (the sweeper builds on this). Throws
 * INVALID_TRANSITION when the hold is not overdue or another transition already won.
 */
export async function expireReservation(reservationId: string, now: Date): Promise<TransitionResult> {
  const result = await prisma.$transaction((tx) =>
    transitionReservation(tx, { reservationId, to: "EXPIRED", actor: { kind: "system", userId: null }, now }));
  publishAfterCommit(result);
  return result;
}
