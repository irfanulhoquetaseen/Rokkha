import { prisma } from "@/server/db";
import { searchHospitals } from "@/server/finder/search";
import { haversineKm, type BloodGroup, type LatLng } from "@/server/matching";

export type Alternative = {
  hospitalId: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  distanceKm: number | null;
  available: number;
  score: number | null;
  isDemo: boolean;
};

export const MAX_ALTERNATIVES = 3;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Next-best hospitals that can hold `quantity` of `resourceCode` right now (read after the
 * sold-out transaction committed, so it is advice, not a promise).
 * With a condition: the finder's ranking (suitable only). Without: nearest first when an
 * origin is known, else most available.
 */
export async function findAlternatives(input: {
  resourceCode: string;
  quantity: number;
  conditionCode?: string;
  bloodGroup?: BloodGroup;
  origin?: LatLng;
  excludeHospitalId: string;
}): Promise<Alternative[]> {
  const { resourceCode, quantity, conditionCode, bloodGroup, origin, excludeHospitalId } = input;

  if (conditionCode) {
    const found = await searchHospitals({
      condition: conditionCode, blood: bloodGroup, lat: origin?.lat, lng: origin?.lng,
      resource: resourceCode, sort: "score", page: 1,
    });
    const candidates = found.results.filter((r) => r.suitable && r.hospitalId !== excludeHospitalId);
    if (candidates.length === 0) return [];
    // One query for the exact counts (the finder only says "available > 0").
    const rows = await prisma.hospitalResource.findMany({
      where: { hospitalId: { in: candidates.map((c) => c.hospitalId) }, resourceType: { code: resourceCode }, available: { gte: quantity } },
      select: { hospitalId: true, available: true },
    });
    const availableBy = new Map(rows.map((r) => [r.hospitalId, r.available]));
    return candidates
      .filter((c) => availableBy.has(c.hospitalId))
      .slice(0, MAX_ALTERNATIVES)
      .map((c) => ({
        hospitalId: c.hospitalId, slug: c.hospital.slug, nameBn: c.hospital.nameBn, nameEn: c.hospital.nameEn,
        distanceKm: c.distanceKm, available: availableBy.get(c.hospitalId)!, score: c.score, isDemo: c.hospital.isDemo,
      }));
  }

  const rows = await prisma.hospitalResource.findMany({
    where: {
      resourceType: { code: resourceCode, kind: "COUNTABLE" },
      available: { gte: quantity },
      hospitalId: { not: excludeHospitalId },
      hospital: { liveDataEnabled: true, archivedAt: null },
    },
    orderBy: [{ available: "desc" }, { hospitalId: "asc" }],
    // Without an origin the DB can do the top-N; with one we sort by distance in JS.
    ...(origin ? {} : { take: MAX_ALTERNATIVES }),
    select: {
      available: true,
      hospital: { select: { id: true, slug: true, nameBn: true, nameEn: true, isDemo: true, lat: true, lng: true } },
    },
  });
  const list = rows.map(({ available, hospital: h }) => ({
    hospitalId: h.id, slug: h.slug, nameBn: h.nameBn, nameEn: h.nameEn, isDemo: h.isDemo, available, score: null,
    distanceKm: origin ? round1(haversineKm(origin, { lat: h.lat, lng: h.lng })) : null,
  }));
  if (origin) list.sort((a, b) => a.distanceKm! - b.distanceKm! || b.available - a.available);
  return list.slice(0, MAX_ALTERNATIVES);
}
