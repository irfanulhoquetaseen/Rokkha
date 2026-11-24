import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetDb } from "../support/db";

async function seedBasics() {
  const hospital = await prisma.hospital.create({
    data: {
      slug: "h1", nameBn: "হাসপাতাল", nameEn: "Hospital 1", type: "GOVT", freeService: true,
      phone: "0200000000", division: "Dhaka", district: "Dhaka", area: "Mirpur",
      address: "1 Road", lat: 23.8, lng: 90.4,
    },
  });
  const icu = await prisma.resourceType.create({
    data: { code: "icu_bed", kind: "COUNTABLE", consumable: false, nameBn: "আইসিইউ", nameEn: "ICU bed", sortOrder: 1 },
  });
  const user = await prisma.user.create({
    data: { phone: "01711111111", name: "U", passwordHash: "x" },
  });
  const hr = await prisma.hospitalResource.create({
    data: { hospitalId: hospital.id, resourceTypeId: icu.id, total: 5, available: 5, updatedAt: new Date() },
  });
  return { hospital, icu, user, hr };
}

function resv(b: Awaited<ReturnType<typeof seedBasics>>, key: string, over: Record<string, unknown> = {}) {
  return {
    userId: b.user.id, hospitalId: b.hospital.id, resourceTypeId: b.icu.id,
    hospitalResourceId: b.hr.id, expiresAt: new Date(Date.now() + 1800000),
    idempotencyKey: key, requestHash: "h", ...over,
  };
}

describe("DB constraints", () => {
  beforeEach(resetDb);

  it("has the reservation queue / list sort indexes", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Reservation'`;
    const names = rows.map((r) => r.indexname);
    expect(names).toEqual(expect.arrayContaining([
      "Reservation_hospitalId_status_expiresAt_idx",
      "Reservation_hospitalId_createdAt_idx",
      "Reservation_userId_createdAt_idx",
    ]));
  });

  it("rejects available below zero", async () => {
    const b = await seedBasics();
    await expect(
      prisma.$executeRaw`UPDATE "HospitalResource" SET "available" = -1 WHERE id = ${b.hr.id}`,
    ).rejects.toThrow(/hospital_resource_stock_bounds/);
  });

  it("rejects available above total", async () => {
    const b = await seedBasics();
    await expect(
      prisma.$executeRaw`UPDATE "HospitalResource" SET "available" = "total" + 1 WHERE id = ${b.hr.id}`,
    ).rejects.toThrow(/hospital_resource_stock_bounds/);
  });

  it("rejects a second active hold for the same user and resource type", async () => {
    const b = await seedBasics();
    await prisma.reservation.create({ data: resv(b, "k1") });
    await expect(prisma.reservation.create({ data: resv(b, "k2") })).rejects.toThrow(
      /reservation_one_active_per_type/,
    );
  });

  it("allows a cancelled plus a held reservation", async () => {
    const b = await seedBasics();
    await prisma.reservation.create({ data: resv(b, "k1", { status: "CANCELLED" }) });
    await expect(prisma.reservation.create({ data: resv(b, "k2") })).resolves.toBeDefined();
  });

  it("rejects requirement with both or neither target", async () => {
    const b = await seedBasics();
    const c = await prisma.condition.create({
      data: { code: "stroke", nameBn: "স্ট্রোক", nameEn: "Stroke", sortOrder: 1 },
    });
    await expect(
      prisma.conditionRequirement.create({
        data: { conditionId: c.id, resourceTypeId: b.icu.id, isBlood: true, level: "CRITICAL", sortOrder: 1 },
      }),
    ).rejects.toThrow(/condition_requirement_target/);
    await expect(
      prisma.conditionRequirement.create({
        data: { conditionId: c.id, isBlood: false, level: "CRITICAL", sortOrder: 2 },
      }),
    ).rejects.toThrow(/condition_requirement_target/);
  });

  it("reservation userId must reference a user", async () => {
    const b = await seedBasics();
    await expect(prisma.reservation.create({ data: resv(b, "k1", { userId: "no-such-user" }) })).rejects.toMatchObject({
      code: "P2003", // Prisma's mapping of Postgres 23503 foreign_key_violation
    });
  });

  it("rejects quantity 0", async () => {
    const b = await seedBasics();
    await expect(prisma.reservation.create({ data: resv(b, "k1", { quantity: 0 }) })).rejects.toThrow(
      /reservation_quantity_positive/,
    );
  });

  it("rejects invalid hospital coordinates", async () => {
    const b = await seedBasics();
    await expect(
      prisma.$executeRaw`UPDATE "Hospital" SET "lat" = 91 WHERE id = ${b.hospital.id}`,
    ).rejects.toThrow(/hospital_coords_valid/);
  });
});
