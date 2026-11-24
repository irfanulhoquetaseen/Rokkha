import { beforeEach, describe, expect, it } from "vitest";
import type { HospitalResource, Reservation } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { updateHospitalResource } from "@/server/resources/update";
import { cancelReservation, expireReservation, staffTransition, transitionReservation } from "@/server/reservations/transition";
import { resetDb } from "../support/db";
import { makeHeld, makeHospitalWithStock, makeUser } from "../support/fixtures";

async function errOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

const stockOf = (id: string) => prisma.hospitalResource.findUniqueOrThrow({ where: { id } });
const statusOf = async (id: string) => (await prisma.reservation.findUniqueOrThrow({ where: { id } })).status;
const terminalEvents = (reservationId: string) =>
  prisma.reservationEvent.count({ where: { reservationId, toStatus: { in: ["CANCELLED", "REJECTED", "EXPIRED"] } } });

let hospitalId: string;
let icu: HospitalResource, antivenom: HospitalResource;
let citizen: SessionUser, otherCitizen: SessionUser, staff: SessionUser, otherStaff: SessionUser;

describe("reservation transitions", () => {
  beforeEach(async () => {
    await resetDb();
    const h = await makeHospitalWithStock({ updatedAt: new Date(Date.now() - 10 * 60_000) });
    const other = await makeHospitalWithStock();
    hospitalId = h.hospital.id;
    icu = h.resources.ICU_BED!;
    antivenom = h.resources.ANTIVENOM!;
    citizen = await makeUser("CITIZEN");
    otherCitizen = await makeUser("CITIZEN");
    staff = await makeUser("HOSPITAL_STAFF", { hospitalId });
    otherStaff = await makeUser("HOSPITAL_STAFF", { hospitalId: other.hospital.id });
  });

  async function held(resource: HospitalResource = icu, extra: { expiresAt?: Date; quantity?: number } = {}): Promise<{ r: Reservation; before: HospitalResource }> {
    const r = await makeHeld({ user: citizen, hospitalResourceId: resource.id, ...extra });
    return { r, before: await stockOf(resource.id) };
  }

  it("cancel returns stock and writes event + audit", async () => {
    const { r, before } = await held();
    expect(before.available).toBe(2);
    const view = await cancelReservation(citizen, r.id);
    expect(view).toMatchObject({ id: r.id, status: "CANCELLED", version: 2, quantity: 1 });
    expect(view.cancelledAt).toBeInstanceOf(Date);
    expect(view.hospital).toMatchObject({ id: hospitalId, isDemo: true });
    expect(view.resource).toMatchObject({ code: "ICU_BED", consumable: false });
    expect(view.events.map((e) => e.toStatus)).toEqual(["HELD", "CANCELLED"]);

    const after = await stockOf(icu.id);
    expect(after.available).toBe(before.available + 1);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());

    const events = await prisma.reservationEvent.findMany({ where: { reservationId: r.id, toStatus: "CANCELLED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: "HELD", actorUserId: citizen.id });
    const audits = await prisma.auditLog.findMany({ where: { action: "RESERVATION_TRANSITION", entityId: r.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: citizen.id, entityType: "Reservation" });
    expect(audits[0]!.before).toMatchObject({ status: "HELD" });
    expect(audits[0]!.after).toMatchObject({ status: "CANCELLED", stockReturned: true });
  });

  it("another citizen cancelling gets NOT_FOUND", async () => {
    const { r, before } = await held();
    expect((await errOf(cancelReservation(otherCitizen, r.id))).code).toBe("NOT_FOUND");
    expect(await prisma.auditLog.count({ where: { action: "AUTHZ_DENIED", actorUserId: otherCitizen.id } })).toBe(1);
    expect(await statusOf(r.id)).toBe("HELD");
    expect((await stockOf(icu.id)).available).toBe(before.available);
    expect((await errOf(cancelReservation(null, r.id))).code).toBe("UNAUTHENTICATED");
  });

  it("staff check-in then complete returns a bed", async () => {
    const { r, before } = await held();
    const arrived = await staffTransition(staff, r.id, "checkIn");
    expect(arrived).toMatchObject({ status: "ARRIVED", version: 2 });
    expect(arrived.arrivedAt).toBeInstanceOf(Date);
    expect((await stockOf(icu.id)).available).toBe(before.available);
    const done = await staffTransition(staff, r.id, "complete");
    expect(done).toMatchObject({ status: "COMPLETED", version: 3 });
    expect(done.completedAt).toBeInstanceOf(Date);
    const after = await stockOf(icu.id);
    expect(after.available).toBe(before.available + 1);
    expect(after.version).toBe(before.version + 1);
    expect(await prisma.auditLog.count({ where: { action: "RESERVATION_TRANSITION", entityId: r.id } })).toBe(2);
  });

  it("complete does not return a consumable", async () => {
    const { r, before } = await held(antivenom);
    await staffTransition(staff, r.id, "checkIn");
    await staffTransition(staff, r.id, "complete");
    const after = await stockOf(antivenom.id);
    expect(after.available).toBe(before.available);
    expect(after.version).toBe(before.version);
    expect(await statusOf(r.id)).toBe("COMPLETED");
  });

  it("complete before check-in is an invalid transition", async () => {
    const { r } = await held();
    const e = await errOf(staffTransition(staff, r.id, "complete"));
    expect(e.code).toBe("INVALID_TRANSITION");
    expect(e.details).toEqual({ status: "HELD" });
  });

  it("reject requires a reason", async () => {
    const { r, before } = await held();
    expect((await errOf(staffTransition(staff, r.id, "reject"))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(staffTransition(staff, r.id, "reject", "  x "))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(staffTransition(staff, r.id, "reject", "y".repeat(301)))).code).toBe("VALIDATION_ERROR");
    expect(await statusOf(r.id)).toBe("HELD");
    expect(await stockOf(icu.id)).toEqual(before);
    expect(await prisma.auditLog.count({ where: { action: "RESERVATION_TRANSITION" } })).toBe(0);
  });

  it("reject returns stock", async () => {
    const { r, before } = await held(antivenom, { quantity: 2 });
    const view = await staffTransition(staff, r.id, "reject", "No ICU staff tonight");
    expect(view).toMatchObject({ status: "REJECTED", rejectedReason: "No ICU staff tonight" });
    expect(view.rejectedAt).toBeInstanceOf(Date);
    expect((await stockOf(antivenom.id)).available).toBe(before.available + 2);
    const ev = await prisma.reservationEvent.findFirstOrThrow({ where: { reservationId: r.id, toStatus: "REJECTED" } });
    expect(ev).toMatchObject({ fromStatus: "HELD", actorUserId: staff.id, note: "No ICU staff tonight" });
  });

  it("staff of another hospital gets NOT_FOUND", async () => {
    const { r } = await held();
    expect((await errOf(staffTransition(otherStaff, r.id, "checkIn"))).code).toBe("NOT_FOUND");
    expect((await errOf(staffTransition(citizen, r.id, "checkIn"))).code).toBe("NOT_FOUND");
    expect((await errOf(staffTransition(staff, "does-not-exist", "checkIn"))).code).toBe("NOT_FOUND");
    expect(await prisma.auditLog.count({ where: { action: "AUTHZ_DENIED", actorUserId: otherStaff.id } })).toBe(1);
    expect(await statusOf(r.id)).toBe("HELD");
  });

  it("return clamps to total", async () => {
    const { r, before } = await held();
    await updateHospitalResource(staff, { resourceId: icu.id, expectedVersion: before.version, change: { op: "set", available: 0, total: 0 } });
    await cancelReservation(citizen, r.id);
    const after = await stockOf(icu.id);
    expect(after).toMatchObject({ available: 0, total: 0, version: before.version + 2 });
    expect(await statusOf(r.id)).toBe("CANCELLED");
  });

  it("actions on an overdue hold expire it first", async () => {
    const { r, before } = await held(icu, { expiresAt: new Date(Date.now() - 60_000) });
    const e = await errOf(cancelReservation(citizen, r.id));
    expect(e.code).toBe("INVALID_TRANSITION");
    expect(e.bilingual.en).toBe("This hold has expired");
    expect(e.details).toEqual({ status: "EXPIRED" });
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.expiredAt).toBeInstanceOf(Date);
    expect((await stockOf(icu.id)).available).toBe(before.available + 1);
    // A second action (staff check-in) must not return stock again.
    expect((await errOf(staffTransition(staff, r.id, "checkIn"))).code).toBe("INVALID_TRANSITION");
    expect((await stockOf(icu.id)).available).toBe(before.available + 1);
    expect(await terminalEvents(r.id)).toBe(1);
  });

  it("check-in of an overdue hold expires it", async () => {
    const { r } = await held(icu, { expiresAt: new Date(Date.now() - 1000) });
    const e = await errOf(staffTransition(staff, r.id, "checkIn"));
    expect(e.code).toBe("INVALID_TRANSITION");
    expect(e.bilingual.en).toBe("This hold has expired");
    expect(await statusOf(r.id)).toBe("EXPIRED");
  });

  it("CAS on EXPIRED refuses a live hold", async () => {
    const { r } = await held();
    const e = await errOf(prisma.$transaction((tx) =>
      transitionReservation(tx, { reservationId: r.id, to: "EXPIRED", actor: { kind: "system", userId: null }, now: new Date() })));
    expect(e.code).toBe("INVALID_TRANSITION");
    expect(e.details).toEqual({ status: "HELD" });
  });

  it("double check-in: exactly one ARRIVED", async () => {
    const { r, before } = await held();
    const results = await Promise.allSettled([staffTransition(staff, r.id, "checkIn"), staffTransition(staff, r.id, "checkIn")]);
    const ok = results.filter((x) => x.status === "fulfilled");
    const bad = results.filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0]!.reason as AppError).code).toBe("INVALID_TRANSITION");
    expect(await statusOf(r.id)).toBe("ARRIVED");
    expect(await prisma.reservationEvent.count({ where: { reservationId: r.id, toStatus: "ARRIVED" } })).toBe(1);
    expect((await stockOf(icu.id)).available).toBe(before.available);
  });

  it("cancel, reject and expire race on a live hold: one wins, stock returned once", async () => {
    for (let round = 0; round < 3; round++) {
      const { r, before } = await held();
      const results = await Promise.allSettled([
        cancelReservation(citizen, r.id),
        staffTransition(staff, r.id, "reject", "Race test reason"),
        expireReservation(r.id, new Date()),
      ]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      for (const x of results) if (x.status === "rejected") expect((x.reason as AppError).code).toBe("INVALID_TRANSITION");
      expect(["CANCELLED", "REJECTED"]).toContain(await statusOf(r.id));
      expect((await stockOf(icu.id)).available).toBe(before.available + 1);
      expect(await terminalEvents(r.id)).toBe(1);
    }
  });

  it("cancel, reject and expire race on an overdue hold: one EXPIRED, stock returned once", async () => {
    for (let round = 0; round < 3; round++) {
      const { r, before } = await held(icu, { expiresAt: new Date(Date.now() - 1000) });
      const results = await Promise.allSettled([
        cancelReservation(citizen, r.id),
        staffTransition(staff, r.id, "reject", "Race test reason"),
        expireReservation(r.id, new Date()),
      ]);
      for (const x of results) if (x.status === "rejected") expect((x.reason as AppError).code).toBe("INVALID_TRANSITION");
      expect(await statusOf(r.id)).toBe("EXPIRED");
      expect((await stockOf(icu.id)).available).toBe(before.available + 1);
      expect(await terminalEvents(r.id)).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: "RESERVATION_TRANSITION", entityId: r.id } })).toBe(1);
    }
  });

  it("transactions run on separate connections", async () => {
    const pid = () => prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$executeRaw`SELECT pg_sleep(0.2)`;
      return row!.pid;
    });
    const pids = await Promise.all([pid(), pid()]);
    expect(new Set(pids).size).toBeGreaterThanOrEqual(2);
  });
});
