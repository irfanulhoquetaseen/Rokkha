import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HospitalResource } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { expireOverdue, startExpirySweeper } from "@/server/reservations/sweeper";
import { cancelReservation } from "@/server/reservations/transition";
import { resetDb } from "../support/db";
import { makeHeld, makeHospitalWithStock, makeUser } from "../support/fixtures";

const stockOf = (id: string) => prisma.hospitalResource.findUniqueOrThrow({ where: { id } });
const statusOf = async (id: string) => (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;
const terminalEvents = (reservationId: string) =>
  prisma.reservationEvent.count({ where: { reservationId, toStatus: { in: ["CANCELLED", "REJECTED", "EXPIRED"] } } });
const past = () => new Date(Date.now() - 1000);

let icu: HospitalResource, antivenom: HospitalResource, otherIcu: HospitalResource;
let hospitalId: string, otherHospitalId: string;
let citizen: SessionUser, otherCitizen: SessionUser;

describe("expiry sweeper", () => {
  beforeEach(async () => {
    await resetDb();
    const h = await makeHospitalWithStock();
    const o = await makeHospitalWithStock();
    hospitalId = h.hospital.id;
    otherHospitalId = o.hospital.id;
    icu = h.resources.ICU_BED!;
    antivenom = h.resources.ANTIVENOM!;
    otherIcu = o.resources.ICU_BED!;
    citizen = await makeUser("CITIZEN");
    otherCitizen = await makeUser("CITIZEN");
  });

  it("expires overdue holds and returns stock", async () => {
    const a = await makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: past() });
    const b = await makeHeld({ user: otherCitizen, hospitalResourceId: antivenom.id, quantity: 2, expiresAt: past() });
    const icuBefore = await stockOf(icu.id);
    const avBefore = await stockOf(antivenom.id);

    expect(await expireOverdue()).toBe(2);

    expect(await statusOf(a.id)).toBe("EXPIRED");
    expect(await statusOf(b.id)).toBe("EXPIRED");
    const icuAfter = await stockOf(icu.id);
    expect(icuAfter.available).toBe(icuBefore.available + 1);
    expect(icuAfter.version).toBe(icuBefore.version + 1);
    expect((await stockOf(antivenom.id)).available).toBe(avBefore.available + 2);
    const ev = await prisma.reservationEvent.findMany({ where: { reservationId: a.id, toStatus: "EXPIRED" } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromStatus: "HELD", actorUserId: null });
    expect(await prisma.auditLog.count({ where: { action: "RESERVATION_TRANSITION", entityId: a.id } })).toBe(1);

    // Idempotent: nothing left to expire.
    expect(await expireOverdue()).toBe(0);
    expect((await stockOf(icu.id)).available).toBe(icuBefore.available + 1);
  });

  it("leaves live holds alone", async () => {
    const live = await makeHeld({ user: citizen, hospitalResourceId: icu.id });
    const before = await stockOf(icu.id);
    expect(await expireOverdue()).toBe(0);
    expect(await statusOf(live.id)).toBe("HELD");
    expect((await stockOf(icu.id)).available).toBe(before.available);
    expect(await terminalEvents(live.id)).toBe(0);
  });

  it("respects the limit", async () => {
    await makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: past() });
    await makeHeld({ user: otherCitizen, hospitalResourceId: icu.id, expiresAt: past() });
    expect(await expireOverdue(new Date(), { limit: 1 })).toBe(1);
    expect(await expireOverdue(new Date(), { limit: 1 })).toBe(1);
    expect(await expireOverdue(new Date(), { limit: 1 })).toBe(0);
  });

  it("scoped by hospitalId / userId", async () => {
    const mine = await makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: past() });
    const otherUser = await makeHeld({ user: otherCitizen, hospitalResourceId: antivenom.id, expiresAt: past() });
    const otherHosp = await makeHeld({ user: otherCitizen, hospitalResourceId: otherIcu.id, expiresAt: past() });

    expect(await expireOverdue(new Date(), { userId: citizen.id })).toBe(1);
    expect(await statusOf(mine.id)).toBe("EXPIRED");
    expect(await statusOf(otherUser.id)).toBe("HELD");
    expect(await statusOf(otherHosp.id)).toBe("HELD");

    expect(await expireOverdue(new Date(), { hospitalId: otherHospitalId })).toBe(1);
    expect(await statusOf(otherHosp.id)).toBe("EXPIRED");
    expect(await statusOf(otherUser.id)).toBe("HELD");

    expect(await expireOverdue(new Date(), { hospitalId })).toBe(1);
    expect(await statusOf(otherUser.id)).toBe("EXPIRED");
  });

  it("two sweeps in parallel return stock exactly once", async () => {
    for (let round = 0; round < 3; round++) {
      const holds = await Promise.all([
        makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: past() }),
        makeHeld({ user: otherCitizen, hospitalResourceId: antivenom.id, expiresAt: past() }),
      ]);
      const icuBefore = await stockOf(icu.id);
      const avBefore = await stockOf(antivenom.id);

      const counts = await Promise.all([expireOverdue(), expireOverdue(), expireOverdue()]);

      expect(counts.reduce((s, n) => s + n, 0)).toBe(2);
      expect((await stockOf(icu.id)).available).toBe(icuBefore.available + 1);
      expect((await stockOf(antivenom.id)).available).toBe(avBefore.available + 1);
      for (const h of holds) {
        expect(await statusOf(h.id)).toBe("EXPIRED");
        expect(await terminalEvents(h.id)).toBe(1);
        expect(await prisma.auditLog.count({ where: { action: "RESERVATION_TRANSITION", entityId: h.id } })).toBe(1);
      }
    }
  });

  it("sweeper and citizen cancel racing on an overdue hold → stock returned once, one terminal event", async () => {
    for (let round = 0; round < 3; round++) {
      const r = await makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: past() });
      const before = await stockOf(icu.id);
      const [sweep, cancel] = await Promise.allSettled([expireOverdue(), cancelReservation(citizen, r.id)]);

      expect(cancel.status).toBe("rejected");
      expect(((cancel as PromiseRejectedResult).reason as AppError).code).toBe("INVALID_TRANSITION");
      expect(sweep.status).toBe("fulfilled");
      expect([0, 1]).toContain((sweep as PromiseFulfilledResult<number>).value);
      expect(await statusOf(r.id)).toBe("EXPIRED");
      expect((await stockOf(icu.id)).available).toBe(before.available + 1);
      expect(await terminalEvents(r.id)).toBe(1);
    }
  });

  it("sweeper and citizen cancel racing on a live hold → CANCELLED, sweeper 0", async () => {
    for (let round = 0; round < 3; round++) {
      const r = await makeHeld({ user: citizen, hospitalResourceId: icu.id });
      const before = await stockOf(icu.id);
      const [sweep, view] = await Promise.all([expireOverdue(), cancelReservation(citizen, r.id)]);
      expect(sweep).toBe(0);
      expect(view.status).toBe("CANCELLED");
      expect((await stockOf(icu.id)).available).toBe(before.available + 1);
      expect(await terminalEvents(r.id)).toBe(1);
    }
  });

  it("startExpirySweeper runs on start and expires real overdue holds", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: past() });
    const log = { error: vi.fn(), log: vi.fn() };
    const sweeper = startExpirySweeper({ intervalMs: 60_000, log });
    try {
      await vi.waitFor(async () => expect(await statusOf(r.id)).toBe("EXPIRED"));
      expect(log.error).not.toHaveBeenCalled();
    } finally {
      sweeper.stop();
    }
  });

  it("startExpirySweeper survives a failing tick", async () => {
    const log = { error: vi.fn(), log: vi.fn() };
    let calls = 0;
    const run = vi.fn(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error("relation does not exist"), { name: "PrismaClientKnownRequestError", code: "P2021" });
      return 0;
    });
    const sweeper = startExpirySweeper({ intervalMs: 50, log, run });
    try {
      await vi.waitFor(() => expect(run.mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(log.error).toHaveBeenCalledTimes(1);
      expect(log.error).toHaveBeenCalledWith("[sweeper] PrismaClientKnownRequestError P2021");
    } finally {
      sweeper.stop();
    }
    const n = run.mock.calls.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(run.mock.calls.length).toBe(n); // stopped
  });

  it("startExpirySweeper never overlaps ticks", async () => {
    const log = { error: vi.fn(), log: vi.fn() };
    let running = 0, maxRunning = 0;
    const run = vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 120));
      running--;
      return 0;
    });
    const sweeper = startExpirySweeper({ intervalMs: 20, log, run });
    try {
      await vi.waitFor(() => expect(run.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
      expect(maxRunning).toBe(1);
    } finally {
      sweeper.stop();
    }
  });
});
