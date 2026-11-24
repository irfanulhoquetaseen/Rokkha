import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getFirstAidGuide, listConditions, listDirectory, searchHospitals } from "@/server/finder/search";
import { parseFinderParams } from "@/server/finder/params";
import { runSeed } from "@/server/seed/run-seed";
import { resetDb } from "../support/db";

const passwords = { admin: "admin-pass-1234", staff: "staff-pass-1234", citizen: "citizen-pass-1234" };
const NOW = new Date();
const CODES = ["STROKE", "HEART_ATTACK", "TRAUMA", "DENGUE", "BREATHING", "PREGNANCY", "SNAKEBITE", "ANIMAL_BITE"];

const p = (sp: Record<string, string>) => parseFinderParams(sp).params;

describe("finder search (seeded real DB)", { timeout: 240_000 }, () => {
  let directoryIds: Set<string>;

  beforeAll(async () => {
    await resetDb();
    await runSeed(prisma, { passwords, resetStock: false, now: NOW });
    const dir = await prisma.hospital.findMany({ where: { liveDataEnabled: false }, select: { id: true } });
    directoryIds = new Set(dir.map((h) => h.id));
  }, 240_000);

  it("lists the 8 conditions by sortOrder", async () => {
    const list = await listConditions();
    expect(list.map((c) => c.code).sort()).toEqual([...CODES].sort());
    expect(list[0]).toHaveProperty("nameBn");
  });

  it.each(CODES)("returns ranked results for %s", async (code) => {
    const r = await searchHospitals(p({ condition: code, area: "dhanmondi" }), NOW);
    expect(r.condition?.code).toBe(code);
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(r.results.length).toBeGreaterThanOrEqual(1);
    expect(r.results.length).toBeLessThanOrEqual(10);
    expect(r.results.map((x) => x.rank)).toEqual(r.results.map((_, i) => i + 1));
    for (const x of r.results) expect(directoryIds.has(x.hospitalId)).toBe(false);
    expect(r.results[0].hospital.nameEn).toBeTruthy();
    expect(r.results[0].distanceKm).not.toBeNull();
  });

  it("filters by type and free", async () => {
    const g = await searchHospitals(p({ condition: "STROKE", type: "GOVT" }), NOW);
    expect(g.total).toBeGreaterThan(0);
    expect(g.results.every((x) => x.hospital.type === "GOVT")).toBe(true);
    const f = await searchHospitals(p({ condition: "STROKE", free: "1" }), NOW);
    expect(f.total).toBeGreaterThan(0);
    expect(f.results.every((x) => x.hospital.freeService)).toBe(true);
  });

  it("radius 5 km around Dhanmondi excludes Rajshahi", async () => {
    const all = await searchHospitals(p({ condition: "SNAKEBITE", area: "dhanmondi" }), NOW);
    const near = await searchHospitals(p({ condition: "SNAKEBITE", area: "dhanmondi", radius: "5", page: "1" }), NOW);
    expect(near.total).toBeGreaterThan(0);
    expect(near.total).toBeLessThan(all.total);
    expect(near.results.every((x) => (x.distanceKm ?? 999) <= 5)).toBe(true);
    expect(near.results.some((x) => x.hospital.district === "Rajshahi")).toBe(false);
    expect(near.radiusIgnored).toBe(false);
  });

  it("ignores radius without an origin and says so", async () => {
    const r = await searchHospitals(p({ condition: "STROKE", radius: "5" }), NOW);
    expect(r.radiusIgnored).toBe(true);
    expect(r.results.every((x) => x.distanceKm === null)).toBe(true);
    expect(r.total).toBeGreaterThan(5);
  });

  it("paginates with pageSize 10 and a correct total", async () => {
    const p1 = await searchHospitals(p({ condition: "STROKE" }), NOW);
    expect(p1.page).toBe(1);
    expect(p1.results).toHaveLength(10);
    expect(p1.total).toBe(20);
    const p2 = await searchHospitals(p({ condition: "STROKE", page: "2" }), NOW);
    expect(p2.results).toHaveLength(10);
    expect(p2.results[0].rank).toBe(11);
    const ids = new Set([...p1.results, ...p2.results].map((x) => x.hospitalId));
    expect(ids.size).toBe(20);
  });

  it("sorts by distance (ascending) and freshness (newest first)", async () => {
    const d = await searchHospitals(p({ condition: "STROKE", area: "uttara", sort: "distance" }), NOW);
    const dist = d.results.map((x) => x.distanceKm as number);
    expect([...dist].sort((a, b) => a - b)).toEqual(dist);
    const f = await searchHospitals(p({ condition: "STROKE", sort: "freshness" }), NOW);
    const t = f.results.map((x) => x.lastUpdatedAt?.getTime() ?? 0);
    expect([...t].sort((a, b) => b - a)).toEqual(t);
  });

  it("keeps ranks contiguous after radius filter and re-sort, and clamps a page past the end", async () => {
    const r = await searchHospitals(p({ condition: "STROKE", area: "dhanmondi", radius: "25", sort: "distance" }), NOW);
    expect(r.results.map((x) => x.rank)).toEqual(r.results.map((_, i) => i + 1));
    const f = await searchHospitals(p({ condition: "STROKE", sort: "freshness", page: "2" }), NOW);
    expect(f.results[0].rank).toBe(11);
    const far = await searchHospitals(p({ condition: "STROKE", page: "99" }), NOW);
    expect(far.page).toBe(2);
    expect(far.total).toBe(20);
    expect(far.results).toHaveLength(10);
  });

  it("uses blood compatibility donor groups for the recipient", async () => {
    const h = await prisma.hospital.findUniqueOrThrow({ where: { slug: "dhanmondi-care-general" } });
    const setBlood = async (code: string) => {
      await prisma.hospitalResource.updateMany({
        where: { hospitalId: h.id, resourceType: { code: { startsWith: "BLOOD_" } } },
        data: { available: 0, total: 10 },
      });
      await prisma.hospitalResource.updateMany({
        where: { hospitalId: h.id, resourceType: { code } },
        data: { available: 5, updatedAt: NOW },
      });
    };
    const suitable = async () => {
      const r = await searchHospitals(p({ condition: "TRAUMA", blood: "AB_NEG", area: "dhanmondi", radius: "5" }), NOW);
      return r.results.find((x) => x.hospitalId === h.id)?.suitable;
    };
    await setBlood("BLOOD_B_NEG"); // B- can donate to AB-
    expect(await suitable()).toBe(true);
    await setBlood("BLOOD_B_POS"); // B+ cannot donate to AB-
    expect(await suitable()).toBe(false);
  });

  it("lists the 5 directory hospitals, nearest first when an origin is given", async () => {
    const d = await listDirectory(p({ area: "dhanmondi" }));
    expect(d).toHaveLength(5);
    expect(d.every((x) => directoryIds.has(x.id))).toBe(true);
    const dist = d.map((x) => x.distanceKm as number);
    expect([...dist].sort((a, b) => a - b)).toEqual(dist);
    const noOrigin = await listDirectory(p({}));
    expect(noOrigin.every((x) => x.distanceKm === null)).toBe(true);
    const r = await searchHospitals(p({ condition: "STROKE" }), NOW);
    expect(r.directory).toHaveLength(5);
  });

  it("results and directory carry isDemo", async () => {
    const r = await searchHospitals(p({ condition: "STROKE" }), NOW);
    expect(r.results.length).toBeGreaterThan(0);
    for (const x of r.results) expect(x.hospital.isDemo).toBe(true);
    expect(r.directory.length).toBeGreaterThan(0);
    for (const d of r.directory) expect(d.isDemo).toBe(true);
    for (const d of await listDirectory(p({}))) expect(typeof d.isDemo).toBe("boolean");
  });

  it("filters by resource: COUNTABLE needs available > 0, STATUS needs isAvailable; unknown code is ignored", async () => {
    const all = await searchHospitals(p({ condition: "STROKE" }), NOW);
    // Make sure at least one live hospital lacks each resource, so the filter must remove something.
    const victim = all.results[0].hospitalId;
    await prisma.hospitalResource.updateMany({ where: { hospitalId: victim, resourceType: { code: "ICU_BED" } }, data: { available: 0 } });
    await prisma.hospitalResource.updateMany({ where: { hospitalId: victim, resourceType: { code: "CT_SCAN" } }, data: { isAvailable: false } });

    const has = async (code: string) => {
      const rows = await prisma.hospitalResource.findMany({
        where: { resourceType: { code }, OR: [{ available: { gt: 0 } }, { isAvailable: true }], hospital: { liveDataEnabled: true } },
        select: { hospitalId: true, available: true, isAvailable: true, resourceType: { select: { kind: true } } },
      });
      return new Set(rows.filter((r) => (r.resourceType.kind === "COUNTABLE" ? r.available > 0 : r.isAvailable)).map((r) => r.hospitalId));
    };

    for (const code of ["ICU_BED", "CT_SCAN"]) {
      const expected = await has(code);
      const r = await searchHospitals(p({ condition: "STROKE", resource: code }), NOW);
      expect(r.resourceIgnored).toBe(false);
      expect(r.total).toBe(expected.size);
      expect(r.total).toBeLessThan(all.total);
      expect(r.results.every((x) => expected.has(x.hospitalId))).toBe(true);
      expect(r.results.some((x) => x.hospitalId === victim)).toBe(false);
      expect(r.results.map((x) => x.rank)).toEqual(r.results.map((_, i) => i + 1));
    }

    const unknown = await searchHospitals(p({ condition: "STROKE", resource: "NOPE_RESOURCE" }), NOW);
    expect(unknown.resourceIgnored).toBe(true);
    expect(unknown.total).toBe(all.total);

    // Options for the filter <select>: every resource type, in sortOrder.
    const types = await prisma.resourceType.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true } });
    expect(all.resourceTypes.map((t) => t.code)).toEqual(types.map((t) => t.code));
    expect(all.resourceTypes[0]).toHaveProperty("nameBn");
  });

  it("returns condition null and no results for an unknown condition", async () => {
    const r = await searchHospitals(p({ condition: "FOO" }), NOW);
    expect(r.condition).toBeNull();
    expect(r.results).toEqual([]);
    expect(r.total).toBe(0);
  });

  it("looks up first aid guides", async () => {
    const g = await getFirstAidGuide("SNAKEBITE");
    expect(g?.sourceUrl).toMatch(/^https?:\/\//);
    expect(g?.condition.code).toBe("SNAKEBITE");
    expect(g?.dosEn.length).toBeGreaterThan(0);
    expect(await getFirstAidGuide("NOPE")).toBeNull();
  });
});
