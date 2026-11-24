import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { reserve } from "@/server/reservations/reserve";
import { resetDb } from "../support/db";
import { makeHospitalWithStock, makeUser } from "../support/fixtures";

// Truly parallel calls against the real test DB: every reserve() is its own interactive
// transaction on its own pooled connection. Assertions are on DB rows, not only return values.

type Settled<T> = PromiseSettledResult<T>;
const codes = (rs: Settled<unknown>[]) =>
  rs.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => {
    expect(r.reason).toBeInstanceOf(AppError);
    return (r.reason as AppError).code;
  });
const fulfilled = <T>(rs: Settled<T>[]) => rs.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled").map((r) => r.value);

async function users(n: number): Promise<SessionUser[]> {
  const out: SessionUser[] = [];
  for (let i = 0; i < n; i++) out.push(await makeUser("CITIZEN"));
  return out;
}

const stockOf = (id: string) => prisma.hospitalResource.findUniqueOrThrow({ where: { id } });

describe("reserve() under concurrency", { timeout: 120_000 }, () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("20 users race for the last unit", async () => {
    const h = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 1 }] });
    const racers = await users(20);
    const rs = await Promise.allSettled(racers.map((u) =>
      reserve(u, { idempotencyKey: randomUUID(), body: { hospitalId: h.hospital.id, resourceCode: "ICU_BED" } })));
    expect(fulfilled(rs)).toHaveLength(1);
    const errs = codes(rs);
    expect(errs).toHaveLength(19);
    expect(errs.every((c) => c === "SOLD_OUT")).toBe(true);
    const s = await stockOf(h.resources.ICU_BED!.id);
    expect(s.available).toBe(0);
    expect(s.available).toBeGreaterThanOrEqual(0);
    expect(await prisma.reservation.count({ where: { status: "HELD" } })).toBe(1);
    expect(await prisma.reservation.count()).toBe(1);
    expect(await prisma.soldOutEvent.count()).toBe(19);
  });

  it("30 requests for 10 units", async () => {
    const h = await makeHospitalWithStock({ stock: [{ code: "ANTIVENOM", total: 10, available: 10 }] });
    const racers = await users(30);
    const rs = await Promise.allSettled(racers.map((u) =>
      reserve(u, { idempotencyKey: randomUUID(), body: { hospitalId: h.hospital.id, resourceCode: "ANTIVENOM" } })));
    expect(fulfilled(rs)).toHaveLength(10);
    const errs = codes(rs);
    expect(errs).toHaveLength(20);
    expect(errs.every((c) => c === "SOLD_OUT")).toBe(true);
    const s = await stockOf(h.resources.ANTIVENOM!.id);
    expect(s.available).toBe(0);
    expect(s.version).toBe(1 + 10);
    expect(await prisma.reservation.count({ where: { status: "HELD" } })).toBe(10);
    expect(new Set((await prisma.reservation.findMany({ select: { userId: true } })).map((r) => r.userId)).size).toBe(10);
    expect(await prisma.soldOutEvent.count()).toBe(20);
  });

  it("one user fires 5 parallel reserves for the same type", async () => {
    const h = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 10, available: 8 }] });
    const [u] = await users(1);
    const rs = await Promise.allSettled(Array.from({ length: 5 }, () =>
      reserve(u!, { idempotencyKey: randomUUID(), body: { hospitalId: h.hospital.id, resourceCode: "ICU_BED" } })));
    expect(fulfilled(rs)).toHaveLength(1);
    const errs = codes(rs);
    expect(errs).toEqual(["LIMIT_REACHED", "LIMIT_REACHED", "LIMIT_REACHED", "LIMIT_REACHED"]);
    expect(await prisma.reservation.count({ where: { userId: u!.id, status: "HELD" } })).toBe(1);
    expect((await stockOf(h.resources.ICU_BED!.id)).available).toBe(8 - 1);
  });

  it("one user, 5 parallel reserves for 5 different types", async () => {
    const h = await makeHospitalWithStock({
      stock: [
        { code: "ICU_BED", total: 5, available: 5 },
        { code: "GENERAL_BED", total: 5, available: 5 },
        { code: "ANTIVENOM", total: 5, available: 5 },
        { code: "RABIES_VACCINE", total: 5, available: 5 },
      ],
    });
    const h2 = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 5, available: 5 }] });
    const [u] = await users(1);
    const targets: [string, string][] = [
      [h.hospital.id, "ICU_BED"], [h.hospital.id, "GENERAL_BED"], [h.hospital.id, "ANTIVENOM"],
      [h.hospital.id, "RABIES_VACCINE"], [h2.hospital.id, "ICU_BED"],
    ];
    const rs = await Promise.allSettled(targets.map(([hospitalId, resourceCode]) =>
      reserve(u!, { idempotencyKey: randomUUID(), body: { hospitalId, resourceCode } })));
    expect(fulfilled(rs)).toHaveLength(2);
    const errs = codes(rs);
    expect(errs).toHaveLength(3);
    expect(errs.every((c) => c === "LIMIT_REACHED")).toBe(true);
    expect(await prisma.reservation.count({ where: { userId: u!.id, status: "HELD" } })).toBe(2);
    const all = await prisma.hospitalResource.findMany();
    const taken = all.reduce((sum, r) => sum + (r.total - r.available), 0);
    expect(taken).toBe(2);
    expect(all.every((r) => r.available >= 0)).toBe(true);
  });

  it("same idempotency key ×10 in parallel", async () => {
    const h = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 10, available: 6 }] });
    const [u] = await users(1);
    const key = randomUUID();
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () =>
      reserve(u!, { idempotencyKey: key, body: { hospitalId: h.hospital.id, resourceCode: "ICU_BED" } })));
    const ok = fulfilled(rs);
    expect(ok).toHaveLength(10);
    expect(new Set(ok.map((r) => r.reservation.id)).size).toBe(1);
    expect(ok.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await prisma.reservation.count()).toBe(1);
    expect((await stockOf(h.resources.ICU_BED!.id)).available).toBe(6 - 1);
  });

  it("same idempotency key from two users in parallel: one hold, one CONFLICT", async () => {
    const h = await makeHospitalWithStock({ stock: [{ code: "ICU_BED", total: 10, available: 6 }] });
    const [a, b] = await users(2);
    const key = randomUUID();
    const rs = await Promise.allSettled([a!, b!].map((u) =>
      reserve(u, { idempotencyKey: key, body: { hospitalId: h.hospital.id, resourceCode: "ICU_BED" } })));
    expect(fulfilled(rs)).toHaveLength(1);
    expect(codes(rs)).toEqual(["CONFLICT"]);
    expect(await prisma.reservation.count()).toBe(1);
    expect((await stockOf(h.resources.ICU_BED!.id)).available).toBe(6 - 1);
  });

  it("parallel reserves use distinct connections", async () => {
    const pid = () => prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$executeRaw`SELECT pg_sleep(0.2)`;
      return row!.pid;
    });
    const pids = await Promise.all([pid(), pid(), pid()]);
    expect(new Set(pids).size).toBeGreaterThanOrEqual(2);
  });
});
