import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/server/auth/session";
import { updateHospitalResource } from "@/server/resources/update";
import { listHospitalResources } from "@/server/resources/queries";
import { resetDb } from "../support/db";

async function errOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

const hospitalData = (slug: string) => ({
  slug, nameBn: `${slug}-bn`, nameEn: `${slug}-en`, type: "GOVT" as const, freeService: true, phone: "01700000000",
  division: "Dhaka", district: "Dhaka", area: "X", address: "Y", lat: 23.7, lng: 90.4,
});

const toSession = (u: { id: string; name: string; phone: string; role: SessionUser["role"]; hospitalId: string | null }): SessionUser =>
  ({ id: u.id, name: u.name, phone: u.phone, role: u.role, hospitalId: u.hospitalId });

let hA: string, hB: string;
let staffA: SessionUser, staffB: SessionUser, admin: SessionUser, citizen: SessionUser;
let icuA: string, ctA: string, icuB: string;

async function seed() {
  const [a, b, icu, ct] = await Promise.all([
    prisma.hospital.create({ data: hospitalData("a") }),
    prisma.hospital.create({ data: hospitalData("b") }),
    prisma.resourceType.create({ data: { code: "ICU_BED", kind: "COUNTABLE", consumable: false, nameBn: "আইসিইউ", nameEn: "ICU bed", sortOrder: 2 } }),
    prisma.resourceType.create({ data: { code: "CT_SCAN", kind: "STATUS", consumable: false, nameBn: "সিটি স্ক্যান", nameEn: "CT scan", sortOrder: 1 } }),
  ]);
  hA = a.id; hB = b.id;
  const now = new Date();
  const [sA, sB, ad, ci, rIcuA, rCtA, rIcuB] = await Promise.all([
    prisma.user.create({ data: { phone: "01711111111", name: "staffA", passwordHash: "x", role: "HOSPITAL_STAFF", hospitalId: hA } }),
    prisma.user.create({ data: { phone: "01722222222", name: "staffB", passwordHash: "x", role: "HOSPITAL_STAFF", hospitalId: hB } }),
    prisma.user.create({ data: { phone: "01733333333", name: "admin", passwordHash: "x", role: "ADMIN" } }),
    prisma.user.create({ data: { phone: "01744444444", name: "citizen", passwordHash: "x", role: "CITIZEN" } }),
    prisma.hospitalResource.create({ data: { hospitalId: hA, resourceTypeId: icu.id, total: 5, available: 3, updatedAt: now } }),
    prisma.hospitalResource.create({ data: { hospitalId: hA, resourceTypeId: ct.id, isAvailable: false, updatedAt: new Date(Date.now() - 31 * 60_000) } }),
    prisma.hospitalResource.create({ data: { hospitalId: hB, resourceTypeId: icu.id, total: 2, available: 0, updatedAt: now } }),
  ]);
  staffA = toSession(sA); staffB = toSession(sB); admin = toSession(ad); citizen = toSession(ci);
  icuA = rIcuA.id; ctA = rCtA.id; icuB = rIcuB.id;
}

describe("hospital resource updates", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  it("staff adjusts own countable stock and version increments", async () => {
    const view = await updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "adjust", delta: 1 } });
    expect(view).toMatchObject({ id: icuA, hospitalId: hA, code: "ICU_BED", kind: "COUNTABLE", available: 4, total: 5, version: 2, stale: false });
    const row = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: icuA } });
    expect(row).toMatchObject({ available: 4, version: 2, updatedById: staffA.id });
    const logs = await prisma.auditLog.findMany({ where: { action: "STOCK_CHANGE", entityId: icuA } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorUserId).toBe(staffA.id);
    expect(logs[0]!.before).toEqual({ available: 3, total: 5, isAvailable: false, version: 1 });
    expect(logs[0]!.after).toEqual({ available: 4, total: 5, isAvailable: false, version: 2 });
  });

  it("set validates bounds", async () => {
    expect((await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "set", available: 6, total: 5 } }))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "set", available: -1, total: 5 } }))).code).toBe("VALIDATION_ERROR");
    const ok = await updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "set", available: 7, total: 10 } });
    expect(ok).toMatchObject({ available: 7, total: 10, version: 2 });
  });

  it("adjust below zero is rejected", async () => {
    const e = await errOf(updateHospitalResource(staffB, { resourceId: icuB, expectedVersion: 1, change: { op: "adjust", delta: -1 } }));
    expect(e.code).toBe("VALIDATION_ERROR");
    // adjust above total is rejected too
    expect((await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "adjust", delta: 3 } }))).code).toBe("VALIDATION_ERROR");
    const row = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: icuB } });
    expect(row).toMatchObject({ available: 0, version: 1 });
    expect(await prisma.auditLog.count({ where: { action: "STOCK_CHANGE" } })).toBe(0);
  });

  it("stale version returns CONFLICT with current values", async () => {
    await updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "adjust", delta: 1 } });
    const e = await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "adjust", delta: -1 } }));
    expect(e.code).toBe("CONFLICT");
    const current = (e.details as { current: Record<string, unknown> }).current;
    expect(current).toMatchObject({ id: icuA, available: 4, total: 5, isAvailable: false, version: 2 });
    expect(current.updatedAt).toBeInstanceOf(Date);
  });

  it("concurrent adjusts with the same version: exactly one succeeds", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "adjust", delta: 1 } })),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) expect((r.reason as AppError).code).toBe("CONFLICT");
    const row = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: icuA } });
    expect(row).toMatchObject({ available: 4, version: 2 });
    expect(await prisma.auditLog.count({ where: { action: "STOCK_CHANGE" } })).toBe(1);
  });

  it("isolation: other hospital staff and citizens get NOT_FOUND, anonymous UNAUTHENTICATED, admin can update any", async () => {
    const change = { op: "adjust" as const, delta: 1 };
    expect((await errOf(updateHospitalResource(staffB, { resourceId: icuA, expectedVersion: 1, change }))).code).toBe("NOT_FOUND");
    expect((await errOf(listHospitalResources(staffB, hA))).code).toBe("NOT_FOUND");
    const denied = await prisma.auditLog.findMany({ where: { action: "AUTHZ_DENIED", actorUserId: staffB.id } });
    expect(denied.length).toBeGreaterThanOrEqual(2);
    expect((await errOf(updateHospitalResource(citizen, { resourceId: icuA, expectedVersion: 1, change }))).code).toBe("NOT_FOUND");
    expect((await errOf(listHospitalResources(citizen, hA))).code).toBe("NOT_FOUND");
    expect((await errOf(updateHospitalResource(null, { resourceId: icuA, expectedVersion: 1, change }))).code).toBe("UNAUTHENTICATED");
    expect((await errOf(listHospitalResources(null, hA))).code).toBe("UNAUTHENTICATED");
    const row = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: icuA } });
    expect(row).toMatchObject({ available: 3, version: 1 });

    const v = await updateHospitalResource(admin, { resourceId: icuB, expectedVersion: 1, change: { op: "adjust", delta: 2 } });
    expect(v).toMatchObject({ available: 2, version: 2, hospitalId: hB });
  });

  it("status toggle on STATUS kind; adjust on STATUS kind → VALIDATION_ERROR", async () => {
    const v = await updateHospitalResource(staffA, { resourceId: ctA, expectedVersion: 1, change: { op: "status", isAvailable: true } });
    expect(v).toMatchObject({ kind: "STATUS", isAvailable: true, version: 2, stale: false });
    expect((await errOf(updateHospitalResource(staffA, { resourceId: ctA, expectedVersion: 2, change: { op: "adjust", delta: 1 } }))).code).toBe("VALIDATION_ERROR");
    expect((await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: { op: "status", isAvailable: true } }))).code).toBe("VALIDATION_ERROR");
  });

  it("rejects malformed changes", async () => {
    for (const change of [{ op: "adjust", delta: 0 }, { op: "adjust", delta: 1001 }, { op: "adjust", delta: 1.5 }, { op: "nope" }]) {
      const e = await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 1, change: change as never }));
      expect(e.code).toBe("VALIDATION_ERROR");
    }
    expect((await errOf(updateHospitalResource(staffA, { resourceId: icuA, expectedVersion: 0, change: { op: "adjust", delta: 1 } }))).code).toBe("VALIDATION_ERROR");
  });

  it("unknown resource id → NOT_FOUND", async () => {
    expect((await errOf(updateHospitalResource(admin, { resourceId: "does-not-exist", expectedVersion: 1, change: { op: "adjust", delta: 1 } }))).code).toBe("NOT_FOUND");
    expect((await errOf(updateHospitalResource(staffA, { resourceId: "does-not-exist", expectedVersion: 1, change: { op: "adjust", delta: 1 } }))).code).toBe("NOT_FOUND");
    expect((await errOf(listHospitalResources(admin, "does-not-exist"))).code).toBe("NOT_FOUND");
  });

  it("lists own hospital resources sorted by sortOrder with staleness", async () => {
    const { hospital, resources } = await listHospitalResources(staffA, hA);
    expect(hospital).toEqual({ id: hA, nameBn: "a-bn", nameEn: "a-en" });
    expect(resources.map((r) => r.code)).toEqual(["CT_SCAN", "ICU_BED"]);
    expect(resources[0]!.stale).toBe(true);
    expect(resources[1]!.stale).toBe(false);
    const adminView = await listHospitalResources(admin, hB);
    expect(adminView.resources.map((r) => r.id)).toEqual([icuB]);
  });
});
