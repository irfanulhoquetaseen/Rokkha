import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { publishStock } from "@/server/realtime/publish";
import { expireOverdue } from "@/server/reservations/sweeper";

// --- Schemas ---

// Bangladesh geographic bounding box (with small margin)
export const BD_LAT_MIN = 20.5;
export const BD_LAT_MAX = 26.7;
export const BD_LNG_MIN = 88.0;
export const BD_LNG_MAX = 92.7;

const hospitalIdSchema = z.string().min(1).max(64);

const resourceInputSchema = z.object({
  resourceTypeId: z.string().trim().min(1).max(64),
  total: z.number().int().min(0).max(100_000).default(0),
  available: z.number().int().min(0).max(100_000).optional(),
  isAvailable: z.boolean().optional(),
}).refine((r) => (r.available ?? r.total) <= r.total, {
  message: "available must not exceed total",
  path: ["available"],
});

export const hospitalCreateSchema = z.object({
  nameBn: z.string().trim().min(2).max(200),
  nameEn: z.string().trim().min(2).max(200),
  slug: z.string().trim().min(2).max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens"),
  type: z.enum(["GOVT", "PRIVATE"]),
  freeService: z.boolean(),
  liveDataEnabled: z.boolean(),
  phone: z.string().trim().min(6).max(20),
  division: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  area: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(500),
  lat: z.number().finite().min(BD_LAT_MIN).max(BD_LAT_MAX),
  lng: z.number().finite().min(BD_LNG_MIN).max(BD_LNG_MAX),
  isDemo: z.boolean().default(false),
  resources: z.array(resourceInputSchema).refine(
    (arr) => new Set(arr.map((r) => r.resourceTypeId)).size === arr.length,
    { message: "Duplicate resourceTypeId entries are not allowed" },
  ).optional(),
});
export type HospitalCreateInput = z.infer<typeof hospitalCreateSchema>;

export const hospitalUpdateSchema = hospitalCreateSchema.omit({ slug: true, resources: true }).partial();
export type HospitalUpdateInput = z.infer<typeof hospitalUpdateSchema>;

export const hospitalListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  type: z.enum(["GOVT", "PRIVATE"]).optional(),
  liveDataEnabled: z.boolean().optional(),
  archived: z.boolean().optional(),
  sort: z.enum(["nameEn", "district", "updatedAt"]).default("nameEn"),
  order: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

function hospitalAuditSnapshot(h: {
  slug: string; nameBn: string; nameEn: string; type: string;
  freeService: boolean; liveDataEnabled: boolean; isDemo: boolean;
  phone: string; division: string; district: string; area: string; address: string;
  lat: number; lng: number; archivedAt: Date | null;
}) {
  return {
    slug: h.slug, nameBn: h.nameBn, nameEn: h.nameEn, type: h.type,
    freeService: h.freeService, liveDataEnabled: h.liveDataEnabled, isDemo: h.isDemo,
    phone: h.phone, division: h.division, district: h.district, area: h.area, address: h.address,
    lat: h.lat, lng: h.lng, archivedAt: h.archivedAt?.toISOString() ?? null,
  };
}

async function publishHospitalResources(hospitalId: string): Promise<void> {
  const hrs = await prisma.hospitalResource.findMany({
    where: { hospitalId },
    include: { resourceType: { select: { code: true } } },
  });
  for (const hr of hrs) {
    publishStock({
      id: hr.id, hospitalId: hr.hospitalId, resourceTypeId: hr.resourceTypeId,
      code: hr.resourceType.code, available: hr.available, total: hr.total,
      isAvailable: hr.isAvailable, version: hr.version, updatedAt: hr.updatedAt,
    });
  }
}

// --- List ---

export async function listHospitals(user: SessionUser | null, input: z.infer<typeof hospitalListSchema>) {
  await requireRole(user, "ADMIN");
  const where: Prisma.HospitalWhereInput = {};
  if (input.search) {
    where.OR = [
      { nameEn: { contains: input.search, mode: "insensitive" } },
      { nameBn: { contains: input.search, mode: "insensitive" } },
      { district: { contains: input.search, mode: "insensitive" } },
    ];
  }
  if (input.type) where.type = input.type;
  if (input.liveDataEnabled !== undefined) where.liveDataEnabled = input.liveDataEnabled;
  if (input.archived === true) where.archivedAt = { not: null };
  else if (input.archived === false) where.archivedAt = null;

  const [total, items] = await Promise.all([
    prisma.hospital.count({ where }),
    prisma.hospital.findMany({
      where,
      orderBy: [{ [input.sort]: input.order }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: {
        id: true, slug: true, nameBn: true, nameEn: true, type: true, freeService: true,
        liveDataEnabled: true, isDemo: true, phone: true, division: true, district: true,
        area: true, address: true, lat: true, lng: true, archivedAt: true,
        createdAt: true, updatedAt: true,
        _count: { select: { resources: true, reservations: true } },
      },
    }),
  ]);
  return { items, total, page: input.page, pageSize: input.pageSize };
}

export async function getHospitalDetail(user: SessionUser | null, hospitalId: string) {
  await requireRole(user, "ADMIN");
  const parsed = hospitalIdSchema.safeParse(hospitalId);
  if (!parsed.success) throw new AppError("NOT_FOUND");
  const hospital = await prisma.hospital.findUnique({
    where: { id: parsed.data },
    include: {
      resources: { include: { resourceType: true }, orderBy: { resourceType: { sortOrder: "asc" } } },
      _count: { select: { reservations: true } },
    },
  });
  if (!hospital) throw new AppError("NOT_FOUND");
  return hospital;
}

// --- Create ---

export async function createHospital(user: SessionUser | null, rawInput: HospitalCreateInput) {
  const actor = await requireRole(user, "ADMIN");
  const input = hospitalCreateSchema.parse(rawInput);
  const { resources, ...hospitalData } = input;

  const existing = await prisma.hospital.findUnique({ where: { slug: hospitalData.slug }, select: { id: true } });
  if (existing) {
    throw new AppError("CONFLICT", { bn: "এই স্লাগ আগে থেকেই ব্যবহৃত", en: "This slug is already in use" });
  }

  let typeMap = new Map<string, { id: string; kind: "COUNTABLE" | "STATUS" }>();
  if (input.liveDataEnabled && resources && resources.length > 0) {
    const typeIds = resources.map((r) => r.resourceTypeId);
    const foundTypes = await prisma.resourceType.findMany({
      where: { id: { in: typeIds } },
      select: { id: true, kind: true },
    });
    if (foundTypes.length !== typeIds.length) {
      throw new AppError("VALIDATION_ERROR", {
        bn: "নির্বাচিত এক বা একাধিক রিসোর্স সঠিক নয়",
        en: "One or more selected resource types are invalid",
      });
    }
    typeMap = new Map(foundTypes.map((t) => [t.id, t]));
  }

  const hospital = await prisma.$transaction(async (tx) => {
    const h = await tx.hospital.create({ data: hospitalData });
    const now = new Date();

    if (input.liveDataEnabled && resources && resources.length > 0) {
      await tx.hospitalResource.createMany({
        data: resources.map((r) => {
          const kind = typeMap.get(r.resourceTypeId)!.kind;
          if (kind === "STATUS") {
            return {
              hospitalId: h.id,
              resourceTypeId: r.resourceTypeId,
              total: 0,
              available: 0,
              isAvailable: r.isAvailable ?? true,
              updatedAt: now,
            };
          }
          const avail = r.available ?? r.total;
          return {
            hospitalId: h.id,
            resourceTypeId: r.resourceTypeId,
            total: r.total,
            available: avail,
            isAvailable: avail > 0,
            updatedAt: now,
          };
        }),
      });
    }

    await audit({
      actorUserId: actor.id, action: "ADMIN_CHANGE", entityType: "Hospital", entityId: h.id,
      before: null,
      after: { action: "CREATE", ...hospitalAuditSnapshot(h), resourcesCount: input.liveDataEnabled ? (resources?.length ?? 0) : 0 },
    }, tx);

    return h;
  });

  if (hospital.liveDataEnabled) {
    await publishHospitalResources(hospital.id);
  }

  return hospital;
}

// --- Update ---

export async function updateHospital(user: SessionUser | null, hospitalId: string, rawInput: HospitalUpdateInput) {
  const actor = await requireRole(user, "ADMIN");
  const parsedId = hospitalIdSchema.safeParse(hospitalId);
  if (!parsedId.success) throw new AppError("NOT_FOUND");
  const input = hospitalUpdateSchema.parse(rawInput);

  const hospital = await prisma.$transaction(async (tx) => {
    const before = await tx.hospital.findUnique({ where: { id: parsedId.data } });
    if (!before) throw new AppError("NOT_FOUND");
    if (before.archivedAt) {
      throw new AppError("CONFLICT", { bn: "আর্কাইভ করা হাসপাতাল সম্পাদনা করা যাবে না", en: "Cannot edit an archived hospital" });
    }

    const h = await tx.hospital.update({ where: { id: parsedId.data }, data: input });
    // Bump resource versions (without altering updatedAt freshness) so open Finder tabs drop/refresh via version gate.
    await tx.hospitalResource.updateMany({ where: { hospitalId: h.id }, data: { version: { increment: 1 } } });

    await audit({
      actorUserId: actor.id, action: "ADMIN_CHANGE", entityType: "Hospital", entityId: h.id,
      before: hospitalAuditSnapshot(before),
      after: { action: "UPDATE", ...hospitalAuditSnapshot(h) },
    }, tx);
    return h;
  });

  await publishHospitalResources(hospital.id);
  return hospital;
}

// --- Delete or Archive ---

export async function deleteOrArchiveHospital(user: SessionUser | null, hospitalId: string) {
  const actor = await requireRole(user, "ADMIN");
  const parsedId = hospitalIdSchema.safeParse(hospitalId);
  if (!parsedId.success) throw new AppError("NOT_FOUND");

  // Expire any overdue holds for this hospital first so expired holds do not falsely block archiving.
  await expireOverdue(new Date(), { hospitalId: parsedId.data });

  const result = await prisma.$transaction(async (tx) => {
    // Lock this hospital's HospitalResource rows BEFORE counting reservations/active holds so a
    // concurrent reserve() (which updates HospitalResource) cannot commit a HELD row behind our back.
    await tx.$queryRaw`SELECT "id" FROM "HospitalResource" WHERE "hospitalId" = ${parsedId.data} ORDER BY "id" FOR UPDATE`;

    const hospital = await tx.hospital.findUnique({ where: { id: parsedId.data } });
    if (!hospital) throw new AppError("NOT_FOUND");

    const reservationCount = await tx.reservation.count({ where: { hospitalId: hospital.id } });

    if (reservationCount === 0) {
      await tx.soldOutEvent.deleteMany({ where: { hospitalId: hospital.id } });
      await tx.hospitalResource.deleteMany({ where: { hospitalId: hospital.id } });
      await tx.hospital.delete({ where: { id: hospital.id } });
      await audit({
        actorUserId: actor.id, action: "ADMIN_CHANGE", entityType: "Hospital", entityId: hospital.id,
        before: hospitalAuditSnapshot(hospital),
        after: { action: "DELETE" },
      }, tx);
      return { action: "deleted" as const, hospitalId: hospital.id };
    }

    if (hospital.archivedAt !== null) {
      throw new AppError("CONFLICT", {
        bn: "এই হাসপাতাল আগেই আর্কাইভ করা হয়েছে",
        en: "This hospital is already archived",
      });
    }

    const activeHolds = await tx.reservation.count({
      where: { hospitalId: hospital.id, status: { in: ["HELD", "ARRIVED"] } },
    });
    if (activeHolds > 0) {
      throw new AppError("CONFLICT", {
        bn: "এই হাসপাতালে সক্রিয় রিজার্ভেশন আছে, আর্কাইভ করা যাবে না।",
        en: "This hospital has active reservations and cannot be archived.",
      });
    }

    const archivedAt = new Date();
    const updated = await tx.hospital.update({ where: { id: hospital.id }, data: { archivedAt } });
    // Bump resource versions (without altering updatedAt) so open Finder tabs refresh and remove this hospital.
    await tx.hospitalResource.updateMany({ where: { hospitalId: hospital.id }, data: { version: { increment: 1 } } });

    await audit({
      actorUserId: actor.id, action: "ADMIN_CHANGE", entityType: "Hospital", entityId: hospital.id,
      before: hospitalAuditSnapshot(hospital),
      after: { action: "ARCHIVE", ...hospitalAuditSnapshot(updated) },
    }, tx);
    return { action: "archived" as const, hospitalId: hospital.id };
  });

  if (result.action === "archived") {
    await publishHospitalResources(result.hospitalId);
  }

  return { action: result.action };
}
