import type { PrismaClient } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { BLOOD_COMPATIBILITY, type BloodCode } from "../../../prisma/data/blood";
import { CONDITIONS } from "../../../prisma/data/conditions";
import { FIRST_AID } from "../../../prisma/data/first-aid";
import { HOSPITALS, profileCounts, profileStatusOn } from "../../../prisma/data/hospitals";
import { RESOURCE_TYPES } from "../../../prisma/data/resource-types";

export const DEMO_ACCOUNTS = {
  admin: { phone: "01700000001", name: "JibonSetu Admin", role: "ADMIN" as const },
  staff1: { phone: "01700000011", name: "Rahim Uddin (Dhanmondi Care staff)", role: "HOSPITAL_STAFF" as const, hospitalSlug: "dhanmondi-care-general" },
  staff2: { phone: "01700000012", name: "Nasrin Akter (Mirpur Shastho staff)", role: "HOSPITAL_STAFF" as const, hospitalSlug: "mirpur-shastho-medical" },
  citizen1: { phone: "01700000021", name: "Karim Hossain", role: "CITIZEN" as const },
  citizen2: { phone: "01700000022", name: "Sumaiya Khatun", role: "CITIZEN" as const },
  citizen3: { phone: "01700000023", name: "Tanvir Ahmed", role: "CITIZEN" as const },
};

export type SeedSummary = Record<string, number>;
export type SeedOptions = {
  passwords: { admin: string; staff: string; citizen: string };
  resetStock: boolean;
  now?: Date;
};

const STALE_MS = 45 * 60_000;

export async function runSeed(db: PrismaClient, opts: SeedOptions): Promise<SeedSummary> {
  const now = opts.now ?? new Date();

  // Resource types
  for (const [i, rt] of RESOURCE_TYPES.entries()) {
    const data = { kind: rt.kind, consumable: rt.consumable, nameBn: rt.nameBn, nameEn: rt.nameEn, bloodGroup: rt.bloodGroup ?? null, sortOrder: i };
    await db.resourceType.upsert({ where: { code: rt.code }, create: { code: rt.code, ...data }, update: data });
  }
  const types = await db.resourceType.findMany();
  const typeByCode = new Map(types.map((t) => [t.code, t]));

  // Blood compatibility
  await db.bloodCompatibility.createMany({
    data: (Object.entries(BLOOD_COMPATIBILITY) as [BloodCode, BloodCode[]][]).flatMap(([donor, recips]) =>
      recips.map((recipient) => ({ donor, recipient }))),
    skipDuplicates: true,
  });

  // Conditions, requirements (delete + recreate per condition), first aid
  const guideByCode = new Map(FIRST_AID.map((g) => [g.conditionCode, g]));
  for (const [i, c] of CONDITIONS.entries()) {
    const cond = await db.condition.upsert({
      where: { code: c.code },
      create: { code: c.code, nameBn: c.nameBn, nameEn: c.nameEn, sortOrder: i },
      update: { nameBn: c.nameBn, nameEn: c.nameEn, sortOrder: i },
    });
    await db.$transaction([
      db.conditionRequirement.deleteMany({ where: { conditionId: cond.id } }),
      db.conditionRequirement.createMany({
        data: c.requirements.map((r, idx) => {
          const isBlood = r.resource === "BLOOD";
          const rt = isBlood ? null : typeByCode.get(r.resource);
          if (!isBlood && !rt) throw new Error(`Unknown resource type ${r.resource}`);
          return { conditionId: cond.id, resourceTypeId: rt?.id ?? null, isBlood, level: r.level, minQuantity: r.minQuantity ?? 1, sortOrder: idx };
        }),
      }),
    ]);
    const g = guideByCode.get(c.code);
    if (!g) throw new Error(`Missing first-aid guide for ${c.code}`);
    const guide = { dosBn: g.dosBn, dosEn: g.dosEn, dontsBn: g.dontsBn, dontsEn: g.dontsEn, sourceName: g.sourceName, sourceUrl: g.sourceUrl, reviewStatus: "SOURCE_CHECKED" as const };
    await db.firstAidGuide.upsert({ where: { conditionId: cond.id }, create: { conditionId: cond.id, ...guide }, update: guide });
  }

  // Hospitals + resources
  const hospitalIds = new Map<string, string>();
  for (const h of HOSPITALS) {
    const data = {
      nameBn: h.nameBn, nameEn: h.nameEn, type: h.type, freeService: h.freeService, liveDataEnabled: h.live,
      phone: h.phone, division: h.division, district: h.district, area: h.area, address: h.address, lat: h.lat, lng: h.lng,
    };
    const row = await db.hospital.upsert({ where: { slug: h.slug }, create: { slug: h.slug, ...data }, update: data });
    hospitalIds.set(h.slug, row.id);
    if (!h.live) continue;

    const counts = profileCounts(h.profile);
    const statusOn = new Set(profileStatusOn(h.profile));
    for (const code of h.statusOff ?? []) statusOn.delete(code);
    const updatedAt = new Date(now.getTime() - (h.stale ? STALE_MS : 0));

    const rows = types.map((t) => {
      if (t.kind === "STATUS") {
        return { resourceTypeId: t.id, total: 0, available: 0, isAvailable: statusOn.has(t.code) };
      }
      const override = h.stock?.[t.code];
      const total = override ? override[0] : (counts[t.code] ?? 0);
      const available = override ? override[1] : Math.ceil(total * 0.6);
      return { resourceTypeId: t.id, total, available, isAvailable: available > 0 };
    });
    await db.hospitalResource.createMany({
      data: rows.map((r) => ({ hospitalId: row.id, ...r, updatedAt })),
      skipDuplicates: true,
    });
    if (opts.resetStock) {
      // One round trip per hospital (a remote DB makes per-row updates slow).
      const ids = rows.map((r) => r.resourceTypeId);
      await db.$executeRaw`
        UPDATE "HospitalResource" hr
        SET "total" = v.total, "available" = v.available, "isAvailable" = v.is_available,
            "updatedAt" = ${updatedAt}, "version" = hr."version" + 1
        FROM unnest(${ids}::text[], ${rows.map((r) => r.total)}::int[], ${rows.map((r) => r.available)}::int[], ${rows.map((r) => r.isAvailable)}::boolean[])
          AS v(rt_id, total, available, is_available)
        WHERE hr."hospitalId" = ${row.id} AND hr."resourceTypeId" = v.rt_id`;
    }
  }

  // Users (always refresh passwordHash/role/hospitalId)
  const hashes = {
    admin: await hashPassword(opts.passwords.admin),
    staff: await hashPassword(opts.passwords.staff),
    citizen: await hashPassword(opts.passwords.citizen),
  };
  const users = [
    { ...DEMO_ACCOUNTS.admin, hash: hashes.admin, hospitalId: null as string | null },
    { ...DEMO_ACCOUNTS.staff1, hash: hashes.staff, hospitalId: hospitalIds.get(DEMO_ACCOUNTS.staff1.hospitalSlug) ?? null },
    { ...DEMO_ACCOUNTS.staff2, hash: hashes.staff, hospitalId: hospitalIds.get(DEMO_ACCOUNTS.staff2.hospitalSlug) ?? null },
    { ...DEMO_ACCOUNTS.citizen1, hash: hashes.citizen, hospitalId: null },
    { ...DEMO_ACCOUNTS.citizen2, hash: hashes.citizen, hospitalId: null },
    { ...DEMO_ACCOUNTS.citizen3, hash: hashes.citizen, hospitalId: null },
  ];
  for (const u of users) {
    const data = { name: u.name, passwordHash: u.hash, role: u.role, hospitalId: u.hospitalId };
    await db.user.upsert({ where: { phone: u.phone }, create: { phone: u.phone, ...data }, update: data });
  }

  const [hospitals, directoryOnly, resourceTypes, hospitalResources, conditions, requirements, bloodCompatibility, firstAidGuides, userCount] =
    await Promise.all([
      db.hospital.count(), db.hospital.count({ where: { liveDataEnabled: false } }), db.resourceType.count(),
      db.hospitalResource.count(), db.condition.count(), db.conditionRequirement.count(),
      db.bloodCompatibility.count(), db.firstAidGuide.count(), db.user.count(),
    ]);
  return { hospitals, directoryOnly, resourceTypes, hospitalResources, conditions, requirements, bloodCompatibility, firstAidGuides, users: userCount };
}
