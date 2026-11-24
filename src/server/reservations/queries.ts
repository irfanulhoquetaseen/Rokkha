import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess, requireReservationOwner, requireUser } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { ACTIVE_STATUSES } from "./constants";
import type { StockSnapshot } from "./stock";
import { expireOverdue } from "./sweeper";
import { reservationViewInclude, toReservationView, type ReservationView } from "./view";

export const PAGE_SIZE = 10;

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };
export type StaffReservationRow = ReservationView & { citizen: { name: string; phone: string } };

const STATUSES = ["HELD", "ARRIVED", "CANCELLED", "EXPIRED", "REJECTED", "COMPLETED"] as const;
const idSchema = z.string().min(1).max(64);

/** `?page=` from a query string: absent → 1; anything but a positive integer → VALIDATION_ERROR. */
export const pageSchema = z
  .string()
  .regex(/^\d{1,6}$/)
  .transform(Number)
  .pipe(z.number().int().min(1))
  .optional()
  .transform((p) => p ?? 1);

export const queueFiltersSchema = z.object({
  status: z.enum(["ACTIVE", "ALL", ...STATUSES]).default("ACTIVE"),
  q: z.string().trim().max(64).optional().transform((q) => (q ? q : undefined)),
  sort: z.enum(["expiresAt", "newest", "oldest"]).default("expiresAt"),
  page: pageSchema,
});
/** Raw query-string values; Zod validates and applies defaults. */
export type QueueFilters = { status?: string; q?: string; sort?: string; page?: string };

function validationError(issues: z.core.$ZodIssue[]): AppError {
  return new AppError("VALIDATION_ERROR", undefined, issues.map((i) => ({ path: i.path.join("."), message: i.message })));
}

function parse<T>(schema: z.ZodType<T, unknown>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw validationError(r.error.issues);
  return r.data;
}

/** The signed-in user's reservations, newest first. Their overdue holds are expired first (lazy expiry). */
export async function listMyReservations(user: SessionUser | null, page: string | null | undefined): Promise<Page<ReservationView>> {
  const u = requireUser(user);
  const p = parse(pageSchema, page ?? undefined);
  await expireOverdue(new Date(), { userId: u.id });
  const where: Prisma.ReservationWhereInput = { userId: u.id };
  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where, include: reservationViewInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.reservation.count({ where }),
  ]);
  return { items: rows.map(toReservationView), page: p, pageSize: PAGE_SIZE, total };
}

/** One reservation for its owner (or an admin); anything else is NOT_FOUND (audited). Lazily expired if overdue. */
export async function getMyReservation(user: SessionUser | null, reservationId: string): Promise<ReservationView> {
  const u = requireUser(user);
  const id = idSchema.safeParse(reservationId);
  if (!id.success) throw new AppError("NOT_FOUND");
  const r = await requireReservationOwner(u, id.data);
  const now = new Date();
  if (r.status === "HELD" && r.expiresAt <= now) await expireOverdue(now, { userId: r.userId });
  const row = await prisma.reservation.findUnique({ where: { id: r.id }, include: reservationViewInclude });
  if (!row) throw new AppError("NOT_FOUND");
  return toReservationView(row);
}

const QUEUE_ORDER: Record<z.output<typeof queueFiltersSchema>["sort"], Prisma.ReservationOrderByWithRelationInput[]> = {
  expiresAt: [{ expiresAt: "asc" }, { id: "asc" }],
  newest: [{ createdAt: "desc" }, { id: "desc" }],
  oldest: [{ createdAt: "asc" }, { id: "asc" }],
};

/** A hospital's reservation queue for its staff (or an admin). That hospital's overdue holds are expired first. */
export async function listHospitalQueue(
  user: SessionUser | null, hospitalId: string, filters: QueueFilters,
): Promise<Page<StaffReservationRow>> {
  // Guard first: a foreign hospital must look exactly like a missing one.
  await requireHospitalAccess(user, hospitalId);
  const hid = idSchema.safeParse(hospitalId);
  if (!hid.success) throw new AppError("NOT_FOUND");
  const f = parse(queueFiltersSchema, filters);

  await expireOverdue(new Date(), { hospitalId: hid.data });

  const where: Prisma.ReservationWhereInput = {
    hospitalId: hid.data,
    ...(f.status === "ALL" ? {} : { status: f.status === "ACTIVE" ? { in: [...ACTIVE_STATUSES] } : f.status }),
    ...(f.q
      ? {
          OR: [
            { user: { name: { contains: f.q, mode: "insensitive" } } },
            { user: { phone: { contains: f.q } } },
            { id: { startsWith: f.q } },
          ],
        }
      : {}),
  };
  const [rows, total] = await prisma.$transaction([
    prisma.reservation.findMany({
      where,
      include: { ...reservationViewInclude, user: { select: { name: true, phone: true } } },
      orderBy: QUEUE_ORDER[f.sort],
      skip: (f.page - 1) * PAGE_SIZE, take: PAGE_SIZE,
    }),
    prisma.reservation.count({ where }),
  ]);
  return {
    items: rows.map(({ user: citizen, ...row }) => ({ ...toReservationView(row), citizen: { name: citizen.name, phone: citizen.phone } })),
    page: f.page, pageSize: PAGE_SIZE, total,
  };
}

const hospitalKeySchema = z.string().min(1).max(64).regex(/^[\w-]+$/);

export type HospitalStock = {
  hospital: { id: string; slug: string; nameBn: string; nameEn: string; isDemo: boolean; liveDataEnabled: boolean };
  resources: StockSnapshot[];
};

/** Public live stock of one hospital, looked up by id or slug; unknown/malformed → NOT_FOUND. */
export async function getHospitalStock(idOrSlug: string): Promise<HospitalStock> {
  const key = hospitalKeySchema.safeParse(idOrSlug);
  if (!key.success) throw new AppError("NOT_FOUND");
  const h = await prisma.hospital.findFirst({
    where: { OR: [{ id: key.data }, { slug: key.data }] },
    select: {
      id: true, slug: true, nameBn: true, nameEn: true, isDemo: true, liveDataEnabled: true,
      resources: {
        include: { resourceType: { select: { code: true } } },
        orderBy: [{ resourceType: { sortOrder: "asc" } }, { id: "asc" }],
      },
    },
  });
  if (!h) throw new AppError("NOT_FOUND");
  const { resources, ...hospital } = h;
  return {
    hospital,
    resources: resources.map((r) => ({
      id: r.id, hospitalId: r.hospitalId, resourceTypeId: r.resourceTypeId, code: r.resourceType.code,
      available: r.available, total: r.total, isAvailable: r.isAvailable, version: r.version, updatedAt: r.updatedAt,
    })),
  };
}
