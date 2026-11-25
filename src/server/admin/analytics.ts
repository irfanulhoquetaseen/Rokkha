import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

// All analytics use SQL aggregation only — never load all rows into JS.

export async function reservationsPerConditionPerDay(user: SessionUser | null) {
  await requireRole(user, "ADMIN");
  const rows = await prisma.$queryRaw<{ day: string; conditionCode: string | null; conditionBn: string | null; conditionEn: string | null; count: bigint }[]>`
    SELECT TO_CHAR(DATE_TRUNC('day', r."createdAt"), 'YYYY-MM-DD') AS day,
           c."code" AS "conditionCode",
           c."nameBn" AS "conditionBn",
           c."nameEn" AS "conditionEn",
           COUNT(*)::bigint AS count
    FROM "Reservation" r
    LEFT JOIN "Condition" c ON c.id = r."conditionId"
    WHERE r."createdAt" >= NOW() - INTERVAL '7 days'
    GROUP BY 1, c."code", c."nameBn", c."nameEn"
    ORDER BY day ASC, c."nameEn" ASC NULLS LAST`;
  return rows.map((r) => ({
    day: r.day,
    conditionCode: r.conditionCode,
    conditionBn: r.conditionBn,
    conditionEn: r.conditionEn,
    condition: r.conditionEn ?? "Unspecified",
    count: Number(r.count),
  }));
}

export async function soldOutEventsPerResourceAndDistrict(user: SessionUser | null) {
  await requireRole(user, "ADMIN");
  const rows = await prisma.$queryRaw<{ code: string; resourceBn: string; resourceEn: string; district: string; count: bigint }[]>`
    SELECT rt."code", rt."nameBn" AS "resourceBn", rt."nameEn" AS "resourceEn", h."district", COUNT(*)::bigint AS count
    FROM "SoldOutEvent" s
    JOIN "ResourceType" rt ON rt.id = s."resourceTypeId"
    JOIN "Hospital" h ON h.id = s."hospitalId"
    GROUP BY rt."code", rt."nameBn", rt."nameEn", h."district"
    ORDER BY count DESC, rt."nameEn" ASC, h."district" ASC`;
  return rows.map((r) => ({
    code: r.code,
    resourceBn: r.resourceBn,
    resourceEn: r.resourceEn,
    resourceType: r.resourceEn,
    district: r.district,
    count: Number(r.count),
  }));
}

export type HoldOutcomeRow = { status: "ARRIVED" | "EXPIRED" | "CANCELLED" | "REJECTED"; count: number; rate: number };

export async function holdOutcomeRates(user: SessionUser | null): Promise<{
  outcomes: HoldOutcomeRow[];
  byStatus: { status: string; count: number }[];
  totalResolved: number;
  totalReservations: number;
}> {
  await requireRole(user, "ADMIN");
  const rows = await prisma.$queryRaw<{ status: string; count: bigint }[]>`
    SELECT "status"::text AS status, COUNT(*)::bigint AS count
    FROM "Reservation"
    GROUP BY "status"
    ORDER BY count DESC, "status" ASC`;

  const byStatus = rows.map((r) => ({ status: r.status, count: Number(r.count) }));
  const countMap = new Map(byStatus.map((r) => [r.status, r.count]));
  // COMPLETED always arrived first (HELD -> ARRIVED -> COMPLETED), so its hold outcome is ARRIVED.
  const arrivedTotal = (countMap.get("ARRIVED") ?? 0) + (countMap.get("COMPLETED") ?? 0);
  const outcomeCounts: Record<HoldOutcomeRow["status"], number> = {
    ARRIVED: arrivedTotal,
    EXPIRED: countMap.get("EXPIRED") ?? 0,
    CANCELLED: countMap.get("CANCELLED") ?? 0,
    REJECTED: countMap.get("REJECTED") ?? 0,
  };
  const totalResolved = Object.values(outcomeCounts).reduce((a, b) => a + b, 0);
  const totalReservations = totalResolved + (countMap.get("HELD") ?? 0);

  const outcomes: HoldOutcomeRow[] = (["ARRIVED", "EXPIRED", "CANCELLED", "REJECTED"] as const).map((status) => ({
    status,
    count: outcomeCounts[status],
    rate: totalResolved > 0 ? outcomeCounts[status] / totalResolved : 0,
  }));

  return { outcomes, byStatus, totalResolved, totalReservations };
}

export async function avgHoldToArrival(user: SessionUser | null): Promise<number | null> {
  await requireRole(user, "ADMIN");
  const rows = await prisma.$queryRaw<{ avg_minutes: number | null }[]>`
    SELECT (EXTRACT(EPOCH FROM AVG("arrivedAt" - "createdAt")) / 60.0)::float8 AS avg_minutes
    FROM "Reservation"
    WHERE "status" IN ('ARRIVED', 'COMPLETED') AND "arrivedAt" IS NOT NULL`;
  const v = rows[0]?.avg_minutes ?? null;
  return v === null ? null : Number(v);
}

export async function staleHospitals(user: SessionUser | null) {
  await requireRole(user, "ADMIN");
  const rows = await prisma.$queryRaw<{ id: string; nameBn: string; nameEn: string; district: string; latestUpdate: Date }[]>`
    SELECT h.id, h."nameBn", h."nameEn", h."district",
           MAX(hr."updatedAt") AS "latestUpdate"
    FROM "Hospital" h
    JOIN "HospitalResource" hr ON hr."hospitalId" = h.id
    WHERE h."liveDataEnabled" = true AND h."archivedAt" IS NULL
    GROUP BY h.id, h."nameBn", h."nameEn", h."district"
    HAVING MAX(hr."updatedAt") < NOW() - INTERVAL '30 minutes'
    ORDER BY "latestUpdate" ASC, h."nameEn" ASC`;
  return rows.map((r) => ({
    id: r.id,
    nameBn: r.nameBn,
    nameEn: r.nameEn,
    district: r.district,
    latestUpdate: r.latestUpdate.toISOString(),
    minutesAgo: Math.max(0, Math.round((Date.now() - r.latestUpdate.getTime()) / 60_000)),
  }));
}
