import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HospitalResource } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { reserve } from "@/server/reservations/reserve";
import { requestHash, type ReserveBody } from "@/server/reservations/schemas";
import { cancelReservation } from "@/server/reservations/transition";
import { resetDb } from "../support/db";
import { makeHeld, makeHospitalWithStock, makeUser } from "../support/fixtures";

// Fault injection for one test only: findAlternatives can be made to fail (everything else is real).
const fault = vi.hoisted(() => ({ failAlternatives: false }));
vi.mock("@/server/reservations/alternatives", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/reservations/alternatives")>();
  return {
    ...mod,
    findAlternatives: (...args: Parameters<typeof mod.findAlternatives>) =>
      fault.failAlternatives
        ? Promise.reject(Object.assign(new Error("connection lost"), { code: "P1001" }))
        : mod.findAlternatives(...args),
  };
});

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
const body = (hospitalId: string, resourceCode = "ICU_BED", extra: Partial<ReserveBody> = {}): ReserveBody =>
  ({ hospitalId, resourceCode, quantity: 1, ...extra });
const call = (user: SessionUser | null, b: ReserveBody, key: string = randomUUID(), now?: Date) =>
  reserve(user, { idempotencyKey: key, body: b }, now);

let hospitalId: string;
let icu: HospitalResource, antivenom: HospitalResource;
let citizen: SessionUser;

describe("reserve()", () => {
  beforeEach(async () => {
    fault.failAlternatives = false;
    await resetDb();
    const h = await makeHospitalWithStock({ updatedAt: new Date(Date.now() - 5 * 60_000) });
    hospitalId = h.hospital.id;
    icu = h.resources.ICU_BED!;
    antivenom = h.resources.ANTIVENOM!;
    citizen = await makeUser("CITIZEN");
  });

  it("holds one unit for 30 minutes", async () => {
    const now = new Date();
    const key = randomUUID();
    const { reservation, replayed } = await call(citizen, body(hospitalId), key, now);
    expect(replayed).toBe(false);
    expect(reservation).toMatchObject({ status: "HELD", quantity: 1, version: 1 });
    expect(reservation.hospital).toMatchObject({ id: hospitalId, isDemo: true });
    expect(reservation.resource).toMatchObject({ code: "ICU_BED" });
    expect(Math.abs(reservation.expiresAt.getTime() - (now.getTime() + 30 * 60_000))).toBeLessThanOrEqual(1000);
    expect(reservation.events.map((e) => e.toStatus)).toEqual(["HELD"]);

    const after = await stockOf(icu.id);
    expect(after.available).toBe(icu.available - 1);
    expect(after.version).toBe(icu.version + 1);
    expect(after.updatedAt.getTime()).toBe(icu.updatedAt.getTime());

    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(row).toMatchObject({ userId: citizen.id, idempotencyKey: key, requestHash: requestHash(body(hospitalId)), conditionId: null });
    const ev = await prisma.reservationEvent.findMany({ where: { reservationId: reservation.id } });
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ fromStatus: null, toStatus: "HELD", actorUserId: citizen.id });
    const audits = await prisma.auditLog.findMany({ where: { action: "RESERVATION_TRANSITION", entityId: reservation.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: citizen.id, entityType: "Reservation" });
    expect(audits[0]!.after).toMatchObject({ status: "HELD", quantity: 1 });
  });

  it("stores the condition when a known condition code is given", async () => {
    const cond = await prisma.condition.create({ data: { code: "SNAKEBITE", nameBn: "সাপ", nameEn: "Snakebite", sortOrder: 1 } });
    const { reservation } = await call(citizen, body(hospitalId, "ANTIVENOM", { conditionCode: "SNAKEBITE", quantity: 2 }));
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
    expect(row).toMatchObject({ conditionId: cond.id, quantity: 2 });
    expect((await stockOf(antivenom.id)).available).toBe(antivenom.available - 2);
    expect((await errOf(call(citizen, body(hospitalId, "ICU_BED", { conditionCode: "NOPE" })))).code).toBe("VALIDATION_ERROR");
  });

  it("staff and admin cannot reserve", async () => {
    const staff = await makeUser("HOSPITAL_STAFF", { hospitalId });
    const admin = await makeUser("ADMIN");
    expect((await errOf(call(staff, body(hospitalId)))).code).toBe("NOT_FOUND");
    expect((await errOf(call(admin, body(hospitalId)))).code).toBe("NOT_FOUND");
    expect(await prisma.auditLog.count({ where: { action: "AUTHZ_DENIED" } })).toBe(2);
    expect(await prisma.reservation.count()).toBe(0);
    expect((await stockOf(icu.id)).available).toBe(icu.available);
  });

  it("anonymous → UNAUTHENTICATED", async () => {
    expect((await errOf(call(null, body(hospitalId)))).code).toBe("UNAUTHENTICATED");
  });

  it("same type twice → LIMIT_REACHED SAME_TYPE", async () => {
    const first = await call(citizen, body(hospitalId));
    const other = await makeHospitalWithStock();
    const e = await errOf(call(citizen, body(other.hospital.id)));
    expect(e.code).toBe("LIMIT_REACHED");
    expect(e.details).toEqual({ reason: "SAME_TYPE", reservationId: first.reservation.id });
    expect((await stockOf(other.resources.ICU_BED!.id)).available).toBe(other.resources.ICU_BED!.available);
  });

  it("third active hold → LIMIT_REACHED MAX_ACTIVE", async () => {
    const h2 = await makeHospitalWithStock({ stock: [{ code: "GENERAL_BED", total: 5, available: 5 }] });
    await call(citizen, body(hospitalId, "ICU_BED"));
    await call(citizen, body(hospitalId, "ANTIVENOM"));
    const e = await errOf(call(citizen, body(h2.hospital.id, "GENERAL_BED")));
    expect(e.code).toBe("LIMIT_REACHED");
    expect(e.details).toEqual({ reason: "MAX_ACTIVE", max: 2 });
    expect((await stockOf(h2.resources.GENERAL_BED!.id)).available).toBe(5);
  });

  it("limit frees after cancel", async () => {
    const first = await call(citizen, body(hospitalId));
    await cancelReservation(citizen, first.reservation.id);
    const second = await call(citizen, body(hospitalId));
    expect(second.reservation.status).toBe("HELD");
    expect((await stockOf(icu.id)).available).toBe(icu.available - 1);
  });

  it("overdue own hold is expired lazily and does not count", async () => {
    const old = await makeHeld({ user: citizen, hospitalResourceId: icu.id, expiresAt: new Date(Date.now() - 60_000) });
    expect((await stockOf(icu.id)).available).toBe(icu.available - 1);
    const { reservation } = await call(citizen, body(hospitalId));
    expect(reservation.status).toBe("HELD");
    const oldRow = await prisma.reservation.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.status).toBe("EXPIRED");
    // Old hold returned its unit, the new one took one.
    expect((await stockOf(icu.id)).available).toBe(icu.available - 1);
    expect(await prisma.reservationEvent.count({ where: { reservationId: old.id, toStatus: "EXPIRED" } })).toBe(1);
  });

  it("sold out writes SoldOutEvent and returns ≤3 alternatives that have the resource", async () => {
    await prisma.hospitalResource.update({ where: { id: icu.id }, data: { available: 0 } });
    const a = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 1 }] });
    const b = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 4 }] });
    const zero = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 0 }] });
    const dir = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 5 }] });
    await prisma.hospital.update({ where: { id: dir.hospital.id }, data: { liveDataEnabled: false } });

    const e = await errOf(call(citizen, body(hospitalId)));
    expect(e.code).toBe("SOLD_OUT");
    const alts = (e.details as { alternatives: { hospitalId: string; available: number; isDemo: boolean; slug: string }[] }).alternatives;
    expect(alts.length).toBeLessThanOrEqual(3);
    const ids = alts.map((x) => x.hospitalId);
    expect(ids).toEqual([b.hospital.id, a.hospital.id]); // most available first without an origin
    expect(ids).not.toContain(hospitalId);
    expect(ids).not.toContain(zero.hospital.id);
    expect(ids).not.toContain(dir.hospital.id);
    expect(alts[0]).toMatchObject({ available: 4, isDemo: true, slug: b.hospital.slug, score: null, distanceKm: null });

    const events = await prisma.soldOutEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ hospitalId, resourceTypeId: icu.resourceTypeId, userId: citizen.id, conditionId: null });
    expect(await prisma.reservation.count()).toBe(0);
    expect((await stockOf(icu.id)).available).toBe(0);
  });

  it("sold out with an origin lists the nearest alternatives first", async () => {
    await prisma.hospitalResource.update({ where: { id: icu.id }, data: { available: 0 } });
    const far = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 9, available: 9 }] });
    const near = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 1 }] });
    await prisma.hospital.update({ where: { id: far.hospital.id }, data: { lat: 24.4, lng: 88.6 } });
    await prisma.hospital.update({ where: { id: near.hospital.id }, data: { lat: 23.75, lng: 90.39 } });
    const e = await errOf(call(citizen, body(hospitalId, "ICU_BED", { lat: 23.75, lng: 90.38 })));
    const alts = (e.details as { alternatives: { hospitalId: string; distanceKm: number | null }[] }).alternatives;
    expect(alts.map((x) => x.hospitalId)).toEqual([near.hospital.id, far.hospital.id]);
    expect(alts[0]!.distanceKm).not.toBeNull();
  });

  it("sold out with a condition returns suitable alternatives ranked by the finder", async () => {
    const cond = await prisma.condition.create({ data: { code: "STROKE", nameBn: "স্ট্রোক", nameEn: "Stroke", sortOrder: 1 } });
    await prisma.conditionRequirement.create({
      data: { conditionId: cond.id, resourceTypeId: icu.resourceTypeId, level: "CRITICAL", minQuantity: 1, sortOrder: 1 },
    });
    await prisma.hospitalResource.update({ where: { id: icu.id }, data: { available: 0 } });
    const ok = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 2 }] });
    const e = await errOf(call(citizen, body(hospitalId, "ICU_BED", { conditionCode: "STROKE", quantity: 2 })));
    const alts = (e.details as { alternatives: { hospitalId: string; score: number | null; available: number }[] }).alternatives;
    expect(alts.map((x) => x.hospitalId)).toEqual([ok.hospital.id]);
    expect(alts[0]!.score).toEqual(expect.any(Number));
    expect(alts[0]!.available).toBe(2);
    expect(await prisma.soldOutEvent.count({ where: { conditionId: cond.id } })).toBe(1);
  });

  it("a retried sold-out request records one SoldOutEvent per idempotency key", async () => {
    await prisma.hospitalResource.update({ where: { id: icu.id }, data: { available: 0 } });
    const key = randomUUID();
    for (let i = 0; i < 3; i++) expect((await errOf(call(citizen, body(hospitalId), key))).code).toBe("SOLD_OUT");
    expect(await prisma.soldOutEvent.count()).toBe(1);
    expect((await prisma.soldOutEvent.findFirstOrThrow()).idempotencyKey).toBe(key);
    await errOf(call(citizen, body(hospitalId)));
    await errOf(call(citizen, body(hospitalId)));
    expect(await prisma.soldOutEvent.count()).toBe(3);
  });

  it("alternatives failing still answers SOLD_OUT with no alternatives", async () => {
    await prisma.hospitalResource.update({ where: { id: icu.id }, data: { available: 0 } });
    await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 5 }] });
    fault.failAlternatives = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const e = await errOf(call(citizen, body(hospitalId)));
      expect(e.code).toBe("SOLD_OUT");
      expect(e.details).toEqual({ alternatives: [] });
      expect(log).toHaveBeenCalledWith("[reserve] alternatives failed", "Error", "P1001");
    } finally {
      log.mockRestore();
    }
    expect(await prisma.soldOutEvent.count()).toBe(1);
  });

  it("an overdue hold does not count toward MAX_ACTIVE", async () => {
    const h2 = await makeHospitalWithStock({ stock: [{ code: "GENERAL_BED", total: 5, available: 5 }] });
    await makeHeld({ user: citizen, hospitalResourceId: antivenom.id, expiresAt: new Date(Date.now() - 1000) });
    await call(citizen, body(hospitalId, "ICU_BED"));
    const third = await call(citizen, body(h2.hospital.id, "GENERAL_BED"));
    expect(third.reservation.status).toBe("HELD");
    expect((await stockOf(antivenom.id)).available).toBe(antivenom.available);
  });

  it("status resource cannot be held", async () => {
    const ct = await prisma.resourceType.create({ data: { code: "CT_SCAN", kind: "STATUS", consumable: false, nameBn: "সিটি", nameEn: "CT scan", sortOrder: 30 } });
    await prisma.hospitalResource.create({ data: { hospitalId, resourceTypeId: ct.id, isAvailable: true, updatedAt: new Date() } });
    const e = await errOf(call(citizen, body(hospitalId, "CT_SCAN")));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.bilingual.en).toBe("This resource cannot be held");
    expect((await errOf(call(citizen, body(hospitalId, "GENERAL_BED")))).code).toBe("NOT_FOUND");
    expect((await errOf(call(citizen, body("no-such-hospital")))).code).toBe("NOT_FOUND");
    expect(await prisma.reservation.count()).toBe(0);
  });

  it("directory-only hospital cannot be held", async () => {
    await prisma.hospital.update({ where: { id: hospitalId }, data: { liveDataEnabled: false } });
    const e = await errOf(call(citizen, body(hospitalId)));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.bilingual.en).toBe("This resource cannot be held");
    expect((await stockOf(icu.id)).available).toBe(icu.available);
  });

  it("replay same key + same body returns the original with replayed=true and no second decrement", async () => {
    const key = randomUUID();
    const first = await call(citizen, body(hospitalId), key);
    const again = await call(citizen, body(hospitalId, "ICU_BED", { lat: 23.8, lng: 90.4, bloodGroup: "O_NEG" }), key);
    expect(again.replayed).toBe(true);
    expect(again.reservation.id).toBe(first.reservation.id);
    expect(await prisma.reservation.count()).toBe(1);
    expect((await stockOf(icu.id)).available).toBe(icu.available - 1);
    expect(await prisma.auditLog.count({ where: { action: "RESERVATION_TRANSITION" } })).toBe(1);
  });

  it("same key with a different body → CONFLICT", async () => {
    const key = randomUUID();
    await call(citizen, body(hospitalId), key);
    const e = await errOf(call(citizen, body(hospitalId, "ANTIVENOM"), key));
    expect(e.code).toBe("CONFLICT");
    expect(e.bilingual.en).toBe("This request key was already used for a different request");
    expect((await stockOf(antivenom.id)).available).toBe(antivenom.available);
  });

  it("same key from another user → CONFLICT", async () => {
    const key = randomUUID();
    await call(citizen, body(hospitalId), key);
    const other = await makeUser("CITIZEN");
    const e = await errOf(call(other, body(hospitalId), key));
    expect(e.code).toBe("CONFLICT");
    expect(await prisma.reservation.count()).toBe(1);
    expect((await stockOf(icu.id)).available).toBe(icu.available - 1);
  });

  it("non-uuid key → VALIDATION_ERROR", async () => {
    expect((await errOf(call(citizen, body(hospitalId), "not-a-uuid"))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(call(citizen, { ...body(hospitalId), quantity: 5 }))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(call(citizen, { ...body(hospitalId), resourceCode: "icu bed" }))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(call(citizen, { ...body(hospitalId), lat: 91 }))).code).toBe("VALIDATION_ERROR");
    expect(await prisma.reservation.count()).toBe(0);
  });
});
