import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { DEMO_ACCOUNTS, DEMO_RACER_PHONES, runSeed } from "@/server/seed/run-seed";
import { resetDb } from "../support/db";

const passwords = { admin: "admin-pass-1234", staff: "staff-pass-1234", citizen: "citizen-pass-1234" };
const NOW = new Date("2026-11-24T10:00:00.000Z");
const REAL_NAMES = ["Square", "Evercare", "United", "Labaid", "Popular", "Ibn Sina", "Dhaka Medical", "Apollo", "Bangabandhu", "Holy Family"];

async function counts() {
  return {
    hospitals: await prisma.hospital.count(),
    directoryOnly: await prisma.hospital.count({ where: { liveDataEnabled: false } }),
    resourceTypes: await prisma.resourceType.count(),
    conditions: await prisma.condition.count(),
    guides: await prisma.firstAidGuide.count(),
    compat: await prisma.bloodCompatibility.count(),
    users: await prisma.user.count(),
    requirements: await prisma.conditionRequirement.count(),
    resources: await prisma.hospitalResource.count(),
  };
}

describe("runSeed", { timeout: 180_000 }, () => {
  beforeEach(resetDb);

  it("is idempotent and produces the expected dataset", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const first = await counts();
    const summary = await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    expect(await counts()).toEqual(first);
    expect(summary.hospitals).toBe(25);
    expect(first).toMatchObject({ hospitals: 25, directoryOnly: 5, resourceTypes: 26, conditions: 8, guides: 8, compat: 27, users: 26 });
    expect(first.resources).toBe(20 * 26);
    expect(await prisma.firstAidGuide.count({ where: { reviewStatus: "SOURCE_CHECKED" } })).toBe(8);
    const dirOnly = await prisma.hospitalResource.count({ where: { hospital: { liveDataEnabled: false } } });
    expect(dirOnly).toBe(0);
  });

  it("binds staff to the named hospitals and has the demo accounts", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const staff1 = await prisma.user.findUnique({ where: { phone: DEMO_ACCOUNTS.staff1.phone }, include: { hospital: true } });
    const staff2 = await prisma.user.findUnique({ where: { phone: DEMO_ACCOUNTS.staff2.phone }, include: { hospital: true } });
    expect(staff1?.role).toBe("HOSPITAL_STAFF");
    expect(staff1?.hospital?.slug).toBe("dhanmondi-care-general");
    expect(staff2?.hospital?.slug).toBe("mirpur-shastho-medical");
    expect((await prisma.user.findUnique({ where: { phone: "01700000001" } }))?.role).toBe("ADMIN");
    expect(await prisma.user.count({ where: { role: "CITIZEN" } })).toBe(23);
  });

  it("keeps stock edits unless resetStock", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const h = await prisma.hospital.findUniqueOrThrow({ where: { slug: "mirpur-shastho-medical" } });
    const rt = await prisma.resourceType.findUniqueOrThrow({ where: { code: "GENERAL_BED" } });
    const key = { hospitalId_resourceTypeId: { hospitalId: h.id, resourceTypeId: rt.id } };
    const original = await prisma.hospitalResource.findUniqueOrThrow({ where: key });
    await prisma.hospitalResource.update({ where: key, data: { available: 7, total: 9 } });
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    expect(await prisma.hospitalResource.findUniqueOrThrow({ where: key })).toMatchObject({ available: 7, total: 9 });
    await runSeed(prisma, { passwords, resetStock: true, now: NOW });
    expect(await prisma.hospitalResource.findUniqueOrThrow({ where: key })).toMatchObject({ available: original.available, total: original.total });
  });

  it("has stock variety: last-one, sold out, stale, specialist off", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    expect(await prisma.hospitalResource.count({ where: { available: 1, resourceType: { kind: "COUNTABLE" } } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.hospitalResource.count({ where: { available: 0, total: { gt: 0 } } })).toBeGreaterThanOrEqual(4);
    const dh = await prisma.hospitalResource.findFirst({ where: { available: 1, resourceType: { code: "ICU_BED" }, hospital: { area: "Dhanmondi" } } });
    expect(dh).not.toBeNull();
    const av = await prisma.hospitalResource.findFirst({ where: { available: 1, resourceType: { code: "ANTIVENOM" }, hospital: { division: "Rajshahi" } } });
    expect(av).not.toBeNull();
    const stale = await prisma.hospitalResource.findMany({ where: { updatedAt: { lte: new Date(NOW.getTime() - 40 * 60_000) } }, distinct: ["hospitalId"], select: { hospitalId: true } });
    expect(stale.length).toBeGreaterThanOrEqual(3);
    const off = await prisma.hospitalResource.findMany({ where: { isAvailable: false, resourceType: { code: { in: ["NEUROLOGIST_ON_DUTY", "CARDIOLOGIST_ON_DUTY", "SURGEON_ON_DUTY", "GYNECOLOGIST_ON_DUTY"] } } }, distinct: ["hospitalId"], select: { hospitalId: true } });
    expect(off.length).toBeGreaterThanOrEqual(3);
  });

  it("covers regions, conditions requirements and blood types; uses fictional names", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const hs = await prisma.hospital.findMany();
    for (const h of hs) {
      for (const real of REAL_NAMES) expect(h.nameEn.toLowerCase()).not.toContain(real.toLowerCase());
    }
    expect(hs.filter((h) => h.district === "Dhaka").length).toBeGreaterThanOrEqual(17);
    for (const a of ["Mirpur", "Dhanmondi", "Uttara", "Mohakhali", "Motijheel", "Badda", "Jatrabari", "Mohammadpur"]) {
      expect(hs.some((h) => h.area === a)).toBe(true);
    }
    expect(hs.filter((h) => h.division === "Chattogram").length).toBeGreaterThanOrEqual(3);
    expect(hs.filter((h) => h.division === "Rajshahi").length).toBeGreaterThanOrEqual(3);
    expect(hs.some((h) => h.type === "GOVT")).toBe(true);
    expect(hs.some((h) => h.type === "PRIVATE")).toBe(true);
    expect(hs.some((h) => h.freeService)).toBe(true);
    expect(hs.some((h) => !h.freeService)).toBe(true);
    const trauma = await prisma.condition.findUniqueOrThrow({ where: { code: "TRAUMA" }, include: { requirements: true } });
    expect(trauma.requirements).toHaveLength(6);
    expect(trauma.requirements.filter((r) => r.isBlood && r.resourceTypeId === null)).toHaveLength(1);
    expect(await prisma.resourceType.count({ where: { bloodGroup: { not: null } } })).toBe(8);
  });

  it("every seeded hospital is a demo hospital", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    expect(await prisma.hospital.count({ where: { isDemo: false } })).toBe(0);
  });

  it("seed creates the 20 demo racer citizens", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    expect(DEMO_RACER_PHONES).toHaveLength(20);
    expect(DEMO_RACER_PHONES[0]).toBe("01700000101");
    expect(DEMO_RACER_PHONES[19]).toBe("01700000120");
    expect(await prisma.user.count({ where: { phone: { in: DEMO_RACER_PHONES }, role: "CITIZEN" } })).toBe(20);
    expect(await prisma.user.count()).toBe(26);
  });

  async function dhanmondiGeneralBed() {
    const h = await prisma.hospital.findUniqueOrThrow({ where: { slug: "dhanmondi-care-general" } });
    const rt = await prisma.resourceType.findUniqueOrThrow({ where: { code: "GENERAL_BED" } });
    const hr = await prisma.hospitalResource.findUniqueOrThrow({ where: { hospitalId_resourceTypeId: { hospitalId: h.id, resourceTypeId: rt.id } } });
    return { h, rt, hr };
  }
  function hold(b: Awaited<ReturnType<typeof dhanmondiGeneralBed>>, userId: string, key: string, status: "HELD" | "ARRIVED" | "CANCELLED", quantity: number) {
    return prisma.reservation.create({
      data: {
        userId, hospitalId: b.h.id, resourceTypeId: b.rt.id, hospitalResourceId: b.hr.id, quantity, status,
        expiresAt: new Date(NOW.getTime() + 1_800_000), idempotencyKey: key, requestHash: "h",
      },
    });
  }

  it("reset stock subtracts active holds", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const b = await dhanmondiGeneralBed();
    expect(b.hr.available).toBe(74);
    const users = await prisma.user.findMany({ where: { role: "CITIZEN" }, take: 3 });
    await hold(b, users[0].id, "k1", "HELD", 2);
    await hold(b, users[1].id, "k2", "ARRIVED", 1);
    await hold(b, users[2].id, "k3", "CANCELLED", 5);
    await prisma.hospitalResource.update({ where: { id: b.hr.id }, data: { available: { decrement: 3 } } });
    await runSeed(prisma, { passwords, resetStock: true, now: NOW });
    expect(await prisma.hospitalResource.findUniqueOrThrow({ where: { id: b.hr.id } })).toMatchObject({ available: 71, total: 120 });
  });

  it("reset stock never goes negative", async () => {
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const h = await prisma.hospital.findUniqueOrThrow({ where: { slug: "dhanmondi-care-general" } });
    const rt = await prisma.resourceType.findUniqueOrThrow({ where: { code: "ICU_BED" } });
    const hr = await prisma.hospitalResource.findUniqueOrThrow({ where: { hospitalId_resourceTypeId: { hospitalId: h.id, resourceTypeId: rt.id } } });
    expect(hr.available).toBe(1);
    const user = await prisma.user.findFirstOrThrow({ where: { role: "CITIZEN" } });
    await prisma.hospitalResource.update({ where: { id: hr.id }, data: { total: 10, available: 8 } });
    await prisma.reservation.create({
      data: { userId: user.id, hospitalId: h.id, resourceTypeId: rt.id, hospitalResourceId: hr.id, quantity: 2, status: "HELD", expiresAt: new Date(NOW.getTime() + 1_800_000), idempotencyKey: "k9", requestHash: "h" },
    });
    await runSeed(prisma, { passwords, resetStock: true, now: NOW });
    const after = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: hr.id } });
    expect(after.available).toBe(0);
    expect(after.total).toBeGreaterThanOrEqual(2);
  });
});
