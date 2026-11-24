import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import { expireReservation } from "./transition";

export const SWEEP_INTERVAL_MS = 30_000;
export const SWEEP_BATCH_LIMIT = 200;

/**
 * Expires overdue HELD reservations (optionally only one hospital's or one user's), each in its
 * own short transaction via the compare-and-set transition, publishing after each commit.
 * A hold that another actor (citizen, staff, a parallel sweep) already moved loses the CAS with
 * INVALID_TRANSITION and is skipped — so stock is returned exactly once. Uses the
 * (status, expiresAt) index. Returns how many holds THIS call expired.
 */
export async function expireOverdue(
  now: Date = new Date(),
  opts: { hospitalId?: string; userId?: string; limit?: number } = {},
): Promise<number> {
  const overdue = await prisma.reservation.findMany({
    where: {
      status: "HELD", expiresAt: { lte: now },
      ...(opts.hospitalId ? { hospitalId: opts.hospitalId } : {}),
      ...(opts.userId ? { userId: opts.userId } : {}),
    },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: opts.limit ?? SWEEP_BATCH_LIMIT,
  });
  let expired = 0;
  for (const { id } of overdue) {
    try {
      await expireReservation(id, now);
      expired++;
    } catch (e) {
      // Someone else won the race for this hold — nothing to return.
      if (!(e instanceof AppError && e.code === "INVALID_TRANSITION")) throw e;
    }
  }
  return expired;
}

type SweeperLog = Pick<Console, "error" | "log">;

/** `name code` only — never the message (a connection error can carry host/user details). */
function describeError(e: unknown): string {
  const err = (e ?? {}) as { name?: unknown; code?: unknown };
  return `${String(err.name ?? "Error")} ${String(err.code ?? "-")}`;
}

/**
 * Runs `run` once immediately (boot recovery after a restart), then every `intervalMs`.
 * Ticks never overlap; a failing tick (e.g. P2021 table missing on an unmigrated DB, or
 * ECONNREFUSED) is logged as `[sweeper] <name> <code>` and retried on the next tick — it never
 * throws or leaves an unhandled rejection. The timer is unref()'d so it never keeps the process alive.
 */
export function startExpirySweeper({
  intervalMs = SWEEP_INTERVAL_MS,
  log = console,
  run = () => expireOverdue(),
}: { intervalMs?: number; log?: SweeperLog; run?: () => Promise<number> } = {}): { stop(): void } {
  let running = false;
  let stopped = false;

  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const n = await run();
      if (n > 0) log.log(`[sweeper] expired ${n} hold(s)`);
    } catch (e) {
      log.error(`[sweeper] ${describeError(e)}`);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
