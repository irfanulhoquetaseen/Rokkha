import { randomUUID } from "node:crypto";
import type { HospitalResource, Reservation, ResourceType, Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { HOLD_MINUTES } from "@/server/reservations/constants";
import { takeStock } from "@/server/reservations/stock";

// Shared integration-test fixtures (Tasks 3–6). Call after resetDb(). Not safe to call
// makeHospitalWithStock concurrently for the same new resource code (upsert on a unique code).

type TypeDef = { kind: "COUNTABLE" | "STATUS"; consumable: boolean; nameBn: string; nameEn: string; sortOrder: number };
const TYPE_DEFS: Record<string, TypeDef> = {
  ICU_BED: { kind: "COUNTABLE", consumable: false, nameBn: "আইসিইউ বেড", nameEn: "ICU bed", sortOrder: 2 },
  GENERAL_BED: { kind: "COUNTABLE", consumable: false, nameBn: "সাধারণ বেড", nameEn: "General bed", sortOrder: 1 },
  ANTIVENOM: { kind: "COUNTABLE", consumable: true, nameBn: "অ্যান্টিভেনম", nameEn: "Antivenom", sortOrder: 20 },
  RABIES_VACCINE: { kind: "COUNTABLE", consumable: true, nameBn: "জলাতঙ্ক টিকা", nameEn: "Rabies vaccine", sortOrder: 21 },
};

export type StockSpec = { code: string; total: number; available: number };
export const DEFAULT_STOCK: StockSpec[] = [
  { code: "ICU_BED", total: 5, available: 3 },
  { code: "ANTIVENOM", total: 10, available: 10 },
];

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

export async function ensureResourceType(code: string): Promise<ResourceType> {
  const def = TYPE_DEFS[code];
  if (!def) throw new Error(`fixtures: unknown resource code ${code}`);
  return prisma.resourceType.upsert({ where: { code }, update: {}, create: { code, ...def } });
}

export async function makeHospitalWithStock(opts: {
  slug?: string; isDemo?: boolean; stock?: StockSpec[]; updatedAt?: Date;
} = {}): Promise<{
  hospital: { id: string; slug: string };
  resources: Record<string, HospitalResource>;
  types: Record<string, ResourceType>;
}> {
  const slug = opts.slug ?? `h-${uniq()}`;
  const hospital = await prisma.hospital.create({
    data: {
      slug, nameBn: `${slug}-bn`, nameEn: `${slug}-en`, type: "GOVT", freeService: true, isDemo: opts.isDemo ?? true,
      phone: "01700000000", division: "Dhaka", district: "Dhaka", area: "X", address: "Y", lat: 23.7, lng: 90.4,
    },
  });
  const resources: Record<string, HospitalResource> = {};
  const types: Record<string, ResourceType> = {};
  for (const s of opts.stock ?? DEFAULT_STOCK) {
    const type = await ensureResourceType(s.code);
    types[s.code] = type;
    resources[s.code] = await prisma.hospitalResource.create({
      data: { hospitalId: hospital.id, resourceTypeId: type.id, total: s.total, available: s.available, updatedAt: opts.updatedAt ?? new Date() },
    });
  }
  return { hospital: { id: hospital.id, slug }, resources, types };
}

let phoneSeq = 0;
export async function makeUser(role: Role = "CITIZEN", opts: { hospitalId?: string | null; phone?: string } = {}): Promise<SessionUser> {
  const phone = opts.phone ?? `0179${String(++phoneSeq).padStart(7, "0")}`;
  const u = await prisma.user.create({
    data: { phone, name: `${role.toLowerCase()}-${phone}`, passwordHash: "x", role, hospitalId: opts.hospitalId ?? null },
  });
  return { id: u.id, name: u.name, phone: u.phone, role: u.role, hospitalId: u.hospitalId };
}

/** A HELD reservation whose stock was really taken (conditional decrement), plus its HELD event. */
export async function makeHeld(opts: {
  user: SessionUser; hospitalResourceId: string; quantity?: number; expiresAt?: Date;
}): Promise<Reservation> {
  const quantity = opts.quantity ?? 1;
  return prisma.$transaction(async (tx) => {
    const hr = await tx.hospitalResource.findUniqueOrThrow({ where: { id: opts.hospitalResourceId } });
    if (!(await takeStock(tx, hr.id, quantity))) throw new Error("fixtures: not enough stock for makeHeld");
    const r = await tx.reservation.create({
      data: {
        userId: opts.user.id, hospitalId: hr.hospitalId, resourceTypeId: hr.resourceTypeId, hospitalResourceId: hr.id,
        quantity, status: "HELD", expiresAt: opts.expiresAt ?? new Date(Date.now() + HOLD_MINUTES * 60_000),
        idempotencyKey: randomUUID(), requestHash: "fixture",
      },
    });
    await tx.reservationEvent.create({ data: { reservationId: r.id, fromStatus: null, toStatus: "HELD", actorUserId: opts.user.id } });
    return r;
  });
}
