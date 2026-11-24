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
  isDemo: boolean;
};

export type DirectoryEntry = Omit<HospitalInfo, "slug"> & { distanceKm: number | null };

/**
 * A countable resource this hospital offers for the chosen condition (one unit per hold). `soldOut`
 * rows (stock 0 of a capability it has) stay listed so a live refresh never unmounts a hold button
 * mid-action: the card shows them as a disabled "Sold out" button.
 */
export type Holdable = {
  code: string; nameBn: string; nameEn: string; available: number; quantity: 1; consumable: boolean; soldOut: boolean;
};

export type FinderResult = {
  condition: { code: string; nameBn: string; nameEn: string } | null;
  results: (RankedHospital & { hospital: HospitalInfo; holdable: Holdable[] })[];
  total: number;
  page: number;
  pageSize: typeof PAGE_SIZE;
  directory: DirectoryEntry[];
  radiusIgnored: boolean;
  /** A well-formed `resource` code that matches no ResourceType: the filter was not applied. */
  resourceIgnored: boolean;
  /** Options for the resource filter, in sortOrder. */
  resourceTypes: ResourceOption[];
  /** Resource codes whose stock can change this result (requirements, all blood rows if blood is required, the filter). */
  relevantCodes: string[];
  /** `{ hospitalResourceId: version }` of the relevant rows of the hospitals on this page (live version gate). */
  stockVersions: Record<string, number>;
  /**
   * Hospitals that can appear in this result on any page: pass the type/free/radius filters. The
   * resource filter is ignored on purpose (a restock can bring a hospital in). Stock events for any
   * other hospital cannot change the result, so the live island ignores them.
   */
  candidateHospitalIds: string[];
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
      address: true, type: true, freeService: true, lat: true, lng: true, isDemo: true,
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
    resourceIgnored, resourceTypes, relevantCodes: [], stockVersions: {}, candidateHospitalIds: [],
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
      phone: true, area: true, district: true, address: true, lat: true, lng: true, isDemo: true,
      resources: {
        select: {
          id: true, version: true, total: true, available: true, isAvailable: true, updatedAt: true,
          resourceType: { select: { code: true, kind: true, consumable: true, bloodGroup: true, nameBn: true, nameEn: true } },
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

  const relevant = new Set<string>();
  for (const r of requirements) if (r.resourceCode) relevant.add(r.resourceCode);
  if (requirements.some((r) => r.isBlood)) for (const t of resourceTypes) if (t.code.startsWith("BLOOD_")) relevant.add(t.code);
  if (resourceCode) relevant.add(resourceCode);
  const stockVersions: Record<string, number> = {};

  const byId = new Map(hospitals.map((h) => [h.id, h]));
  const slice = ranked.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => {
    const h = byId.get(r.hospitalId)!;
    for (const row of h.resources) if (relevant.has(row.resourceType.code)) stockVersions[row.id] = row.version;
    return {
      ...r,
      holdable: holdableFor(h.resources, requirements, params.blood ?? null, compatibleDonors),
      hospital: {
        id: h.id, slug: h.slug, nameBn: h.nameBn, nameEn: h.nameEn, type: h.type,
        freeService: h.freeService, phone: h.phone, area: h.area, district: h.district, address: h.address, isDemo: h.isDemo,
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
    relevantCodes: [...relevant],
    stockVersions,
    candidateHospitalIds: allHospitals
      .filter((h) => params.radius === undefined || !origin || haversineKm(origin, h) <= params.radius)
      .map((h) => h.id),
  };
}

type StockRow = {
  available: number;
  total: number;
  resourceType: { code: string; kind: "COUNTABLE" | "STATUS"; consumable: boolean; bloodGroup: DbBloodGroup | null; nameBn: string; nameEn: string };
};

/**
 * What a citizen can hold here for this condition: every COUNTABLE requirement resource with stock,
 * plus for a blood requirement ONE blood row — the patient's own group first, else the compatible
 * donor group with the most units; unknown group → O- (universal red-cell donor) only.
 * Requirement rows the hospital has (total > 0) but with no stock are listed as `soldOut`; for blood
 * with no compatible unit at all, that is the preferred row (own group, or O- when unknown).
 * Not-suitable hospitals keep their holdable stock (staff decide on arrival).
 */
function holdableFor(
  rows: StockRow[], requirements: MatchRequirement[], blood: BloodGroup | null, compatibleDonors: Record<BloodGroup, BloodGroup[]>,
): Holdable[] {
  const toHoldable = (r: StockRow): Holdable => ({
    code: r.resourceType.code, nameBn: r.resourceType.nameBn, nameEn: r.resourceType.nameEn,
    available: r.available, quantity: 1, consumable: r.resourceType.consumable, soldOut: r.available < 1,
  });
  const offered = rows.filter((r) => r.resourceType.kind === "COUNTABLE" && r.total > 0);
  const inStock = offered.filter((r) => r.available >= 1);
  const out: Holdable[] = [];
  const seen = new Set<string>();
  for (const req of requirements) {
    if (req.isBlood) {
      const bloodRows = inStock.filter((r) => r.resourceType.bloodGroup !== null);
      let pick: StockRow | undefined;
      const preferred = blood ?? "O_NEG";
      if (blood === null) {
        pick = bloodRows.find((r) => r.resourceType.bloodGroup === "O_NEG");
      } else {
        pick = bloodRows.find((r) => r.resourceType.bloodGroup === blood);
        if (!pick) {
          const donors = new Set(compatibleDonors[blood]);
          pick = bloodRows
            .filter((r) => donors.has(r.resourceType.bloodGroup as BloodGroup))
            .sort((a, b) => b.available - a.available || a.resourceType.code.localeCompare(b.resourceType.code))[0];
        }
      }
      pick ??= offered.find((r) => r.resourceType.bloodGroup === preferred); // none compatible left: sold out
      if (pick && !seen.has(pick.resourceType.code)) {
        seen.add(pick.resourceType.code);
        out.push(toHoldable(pick));
      }
      continue;
    }
    const row = req.resourceCode ? offered.find((r) => r.resourceType.code === req.resourceCode) : undefined;
    if (row && !seen.has(row.resourceType.code)) {
      seen.add(row.resourceType.code);
      out.push(toHoldable(row));
    }
  }
  return out;
}
