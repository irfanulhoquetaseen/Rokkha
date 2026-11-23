import { prisma } from "@/server/db";
import type { BloodGroup as DbBloodGroup, FirstAidGuide } from "@/generated/prisma/client";
import { haversineKm, rankHospitals } from "@/server/matching";
import type { BloodGroup, LatLng, MatchHospital, MatchRequirement, RankedHospital } from "@/server/matching";
import type { FinderParams } from "./params";

export const PAGE_SIZE = 10 as const;

type HospitalInfo = {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  type: "GOVT" | "PRIVATE";
  freeService: boolean;
  phone: string;
  area: string;
  district: string;
  address: string;
};

export type DirectoryEntry = Omit<HospitalInfo, "slug"> & { distanceKm: number | null };

export type FinderResult = {
  condition: { code: string; nameBn: string; nameEn: string } | null;
  results: (RankedHospital & { hospital: HospitalInfo })[];
  total: number;
  page: number;
  pageSize: typeof PAGE_SIZE;
  directory: DirectoryEntry[];
  radiusIgnored: boolean;
  /** A well-formed `resource` code that matches no ResourceType: the filter was not applied. */
  resourceIgnored: boolean;
  /** Options for the resource filter, in sortOrder. */
  resourceTypes: ResourceOption[];
};

export type ResourceOption = { code: string; nameBn: string; nameEn: string };

function originOf(params: FinderParams): LatLng | null {
  return params.lat !== undefined && params.lng !== undefined ? { lat: params.lat, lng: params.lng } : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export async function listConditions(): Promise<{ code: string; nameBn: string; nameEn: string }[]> {
  return prisma.condition.findMany({
    orderBy: { sortOrder: "asc" },
    select: { code: true, nameBn: true, nameEn: true },
  });
}

export async function getFirstAidGuide(
  conditionCode: string,
): Promise<(FirstAidGuide & { condition: { code: string; nameBn: string; nameEn: string } }) | null> {
  const condition = await prisma.condition.findUnique({
    where: { code: conditionCode },
    select: { code: true, nameBn: true, nameEn: true, firstAid: true },
  });
  if (!condition?.firstAid) return null;
  const { firstAid, ...c } = condition;
  return { ...firstAid, condition: c };
}

/** Cheap existence check (one indexed select) used by the proxy to answer unknown codes with a real 404. */
export async function firstAidGuideExists(conditionCode: string): Promise<boolean> {
  const g = await prisma.firstAidGuide.findFirst({ where: { condition: { code: conditionCode } }, select: { id: true } });
  return g !== null;
}

/** Directory-only hospitals (no live data), same type/free filters; nearest first when an origin is known. */
export async function listDirectory(params: FinderParams): Promise<DirectoryEntry[]> {
  const rows = await prisma.hospital.findMany({
    orderBy: [{ nameEn: "asc" }, { id: "asc" }],
    where: {
      liveDataEnabled: false,
      ...(params.type ? { type: params.type } : {}),
      ...(params.free ? { freeService: true } : {}),
    },
    select: {
      id: true, nameBn: true, nameEn: true, phone: true, area: true, district: true,
      address: true, type: true, freeService: true, lat: true, lng: true,
    },
  });
  const origin = originOf(params);
  const list = rows.map(({ lat, lng, ...h }) => ({
    ...h,
    distanceKm: origin ? round1(haversineKm(origin, { lat, lng })) : null,
  }));
  list.sort((a, b) =>
    a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm
      ? a.distanceKm - b.distanceKm
      : a.nameEn.localeCompare(b.nameEn),
  );
  return list;
}

export async function searchHospitals(params: FinderParams, now: Date = new Date()): Promise<FinderResult> {
  const origin = originOf(params);
  const radiusIgnored = params.radius !== undefined && origin === null;

  // Independent reads run concurrently; the live-hospital query only runs once a condition is known.
  const [conditionRow, directory, compat, resourceTypes] = await Promise.all([
    params.condition
      ? prisma.condition.findUnique({
          where: { code: params.condition },
          select: {
            code: true,
            nameBn: true,
            nameEn: true,
            requirements: {
              orderBy: { sortOrder: "asc" },
              select: {
                isBlood: true, level: true, minQuantity: true,
                resourceType: { select: { code: true, nameBn: true, nameEn: true } },
              },
            },
          },
        })
      : null,
    listDirectory(params),
    prisma.bloodCompatibility.findMany({ select: { donor: true, recipient: true } }),
    prisma.resourceType.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, nameBn: true, nameEn: true } }),
  ]);
  const resourceCode =
    params.resource !== undefined && resourceTypes.some((t) => t.code === params.resource) ? params.resource : undefined;
  const resourceIgnored = params.resource !== undefined && resourceCode === undefined;
  const empty: FinderResult = {
    condition: null, results: [], total: 0, page: params.page, pageSize: PAGE_SIZE, directory, radiusIgnored,
    resourceIgnored, resourceTypes,
  };
  if (!conditionRow) return empty;

  const allHospitals = await prisma.hospital.findMany({
    orderBy: { id: "asc" },
    where: {
      liveDataEnabled: true,
      ...(params.type ? { type: params.type } : {}),
      ...(params.free ? { freeService: true } : {}),
    },
    select: {
      id: true, slug: true, nameBn: true, nameEn: true, type: true, freeService: true,
      phone: true, area: true, district: true, address: true, lat: true, lng: true,
      resources: {
        select: {
          total: true, available: true, isAvailable: true, updatedAt: true,
          resourceType: { select: { code: true, kind: true, bloodGroup: true, nameBn: true, nameEn: true } },
        },
      },
    },
  });

  // Resource filter: keep hospitals that have that resource right now (stock > 0, or switched on).
  const hospitals = resourceCode
    ? allHospitals.filter((h) =>
        h.resources.some(
          (r) =>
            r.resourceType.code === resourceCode &&
            (r.resourceType.kind === "COUNTABLE" ? r.available > 0 : r.isAvailable),
        ),
      )
    : allHospitals;

  // Table is donor -> recipient; the matcher wants recipient -> donors.
  const compatibleDonors = {} as Record<BloodGroup, BloodGroup[]>;
  for (const g of ["A_POS", "A_NEG", "B_POS", "B_NEG", "O_POS", "O_NEG", "AB_POS", "AB_NEG"] as const) compatibleDonors[g] = [];
  for (const { donor, recipient } of compat) compatibleDonors[recipient as DbBloodGroup].push(donor as DbBloodGroup);

  const requirements: MatchRequirement[] = conditionRow.requirements.map((r) => ({
    resourceCode: r.isBlood ? null : (r.resourceType?.code ?? null),
    isBlood: r.isBlood,
    level: r.level,
    minQuantity: r.minQuantity,
    nameBn: r.resourceType?.nameBn ?? "রক্ত",
    nameEn: r.resourceType?.nameEn ?? "Blood",
  }));

  const matchHospitals: MatchHospital[] = hospitals.map((h) => ({
    id: h.id,
    lat: h.lat,
    lng: h.lng,
    resources: h.resources.map((r) => ({
      code: r.resourceType.code,
      kind: r.resourceType.kind,
      available: r.available,
      total: r.total,
      isAvailable: r.isAvailable,
      updatedAt: r.updatedAt,
      bloodGroup: r.resourceType.bloodGroup,
      nameBn: r.resourceType.nameBn,
      nameEn: r.resourceType.nameEn,
    })),
  }));

  let ranked = rankHospitals({
    requirements,
    bloodGroup: params.blood ?? null,
    origin,
    now,
    hospitals: matchHospitals,
    compatibleDonors,
  });

  if (params.radius !== undefined && origin) {
    const radius = params.radius;
    ranked = ranked.filter((r) => r.distanceKm !== null && r.distanceKm <= radius);
  }

  if (params.sort === "distance") {
    ranked = [...ranked].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.rank - b.rank);
  } else if (params.sort === "freshness") {
    ranked = [...ranked].sort(
      (a, b) => (b.lastUpdatedAt?.getTime() ?? -Infinity) - (a.lastUpdatedAt?.getTime() ?? -Infinity) || a.rank - b.rank,
    );
  }

  // Ranks are over the final filtered + sorted list, so they stay contiguous across pages.
  ranked = ranked.map((r, i) => ({ ...r, rank: i + 1 }));
  const lastPage = Math.max(1, Math.ceil(ranked.length / PAGE_SIZE));
  const page = Math.min(params.page, lastPage);

  const byId = new Map(hospitals.map((h) => [h.id, h]));
  const slice = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => {
    const h = byId.get(r.hospitalId)!;
    return {
      ...r,
      hospital: {
        id: h.id, slug: h.slug, nameBn: h.nameBn, nameEn: h.nameEn, type: h.type,
        freeService: h.freeService, phone: h.phone, area: h.area, district: h.district, address: h.address,
      },
    };
  });

  return {
    condition: { code: conditionRow.code, nameBn: conditionRow.nameBn, nameEn: conditionRow.nameEn },
    results: slice,
    total: ranked.length,
    page,
    pageSize: PAGE_SIZE,
    directory,
    radiusIgnored,
    resourceIgnored,
    resourceTypes,
  };
}
