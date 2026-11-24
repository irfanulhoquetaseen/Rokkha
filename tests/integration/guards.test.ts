import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess, requireReservationOwner, requireRole, requireUser } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { resetDb } from "../support/db";

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).code;
  }
  throw new Error("expected rejection");
}

const hospitalData = (slug: string) => ({
  slug, nameBn: slug, nameEn: slug, type: "GOVT" as const, freeService: true, phone: "01700000000",
  division: "Dhaka", district: "Dhaka", area: "X", address: "Y", lat: 23.7, lng: 90.4,
});

let hA: string, hB: string;
let citizen: SessionUser, other: SessionUser, staffA: SessionUser, admin: SessionUser;

async function mkUser(
  phone: string, role: "CITIZEN" | "HOSPITAL_STAFF" | "ADMIN", hospitalId: string | null = null,
): Promise<SessionUser> {
  const u = await prisma.user.create({ data: { phone, name: phone, passwordHash: "x", role, hospitalId } });
  return { id: u.id, name: u.name, phone: u.phone, role: u.role, hospitalId: u.hospitalId };
}

describe("authorization guards", () => {
  beforeEach(async () => {
    await resetDb();
    hA = (await prisma.hospital.create({ data: hospitalData("a") })).id;
    hB = (await prisma.hospital.create({ data: hospitalData("b") })).id;
    citizen = await mkUser("01711111111", "CITIZEN");
    other = await mkUser("01722222222", "CITIZEN");
    staffA = await mkUser("01733333333", "HOSPITAL_STAFF", hA);
    admin = await mkUser("01744444444", "ADMIN");
  });

  it("requireUser: null → UNAUTHENTICATED, user passes", async () => {
    expect(await codeOf(() => requireUser(null))).toBe("UNAUTHENTICATED");
    expect(requireUser(citizen)).toBe(citizen);
  });

  it("requireRole: null → UNAUTHENTICATED, wrong role → NOT_FOUND + audit, right role passes", async () => {
    expect(await codeOf(requireRole(null, "ADMIN"))).toBe("UNAUTHENTICATED");
    expect(await codeOf(requireRole(citizen, "ADMIN"))).toBe("NOT_FOUND");
    await expect(requireRole(admin, "ADMIN")).resolves.toBe(admin);
    await expect(requireRole(staffA, "HOSPITAL_STAFF", "ADMIN")).resolves.toBe(staffA);
    const rows = await prisma.auditLog.findMany({ where: { action: "AUTHZ_DENIED" } });
    expect(rows.map((r) => r.actorUserId)).toContain(citizen.id);
  });

  it("requireHospitalAccess: own hospital ok, other hospital NOT_FOUND + AUTHZ_DENIED audit", async () => {
    await expect(requireHospitalAccess(staffA, hA)).resolves.toBe(staffA);
    expect(await codeOf(requireHospitalAccess(staffA, hB))).toBe("NOT_FOUND");
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "AUTHZ_DENIED" } });
    expect(row).toMatchObject({ actorUserId: staffA.id, entityType: "Hospital", entityId: hB });
  });

  it("requireHospitalAccess: admin passes any; citizen and null denied", async () => {
    await expect(requireHospitalAccess(admin, hA)).resolves.toBe(admin);
    await expect(requireHospitalAccess(admin, hB)).resolves.toBe(admin);
    expect(await codeOf(requireHospitalAccess(citizen, hA))).toBe("NOT_FOUND");
    expect(await codeOf(requireHospitalAccess(null, hA))).toBe("UNAUTHENTICATED");
  });

  it("requireReservationOwner: owner + admin pass, other citizen and missing id NOT_FOUND", async () => {
    const rt = await prisma.resourceType.create({
      data: { code: "icu_bed", kind: "COUNTABLE", consumable: false, nameBn: "আইসিইউ", nameEn: "ICU", sortOrder: 1 },
    });
    const hr = await prisma.hospitalResource.create({
      data: { hospitalId: hA, resourceTypeId: rt.id, total: 5, available: 4, updatedAt: new Date() },
    });
    const r = await prisma.reservation.create({
      data: {
        userId: citizen.id, hospitalId: hA, resourceTypeId: rt.id, hospitalResourceId: hr.id,
        expiresAt: new Date(Date.now() + 30 * 60_000), idempotencyKey: "k1", requestHash: "h",
      },
    });
    expect((await requireReservationOwner(citizen, r.id)).id).toBe(r.id);
    expect((await requireReservationOwner(admin, r.id)).id).toBe(r.id);
    expect(await codeOf(requireReservationOwner(other, r.id))).toBe("NOT_FOUND");
    expect(await codeOf(requireReservationOwner(citizen, "does-not-exist"))).toBe("NOT_FOUND");
    expect(await codeOf(requireReservationOwner(null, r.id))).toBe("UNAUTHENTICATED");
    const denied = await prisma.auditLog.findMany({ where: { action: "AUTHZ_DENIED", entityType: "Reservation" } });
    expect(denied.length).toBeGreaterThanOrEqual(2);
  });
});
