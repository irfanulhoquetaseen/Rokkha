import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next request scope; route handlers are called directly here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import { DELETE as deleteHospitalApi, GET as getHospitalApi, PATCH as patchHospitalApi } from "@/app/api/admin/hospitals/[hospitalId]/route";
import { POST as importHospitalsApi } from "@/app/api/admin/hospitals/import/route";
import { GET as listHospitalsApi, POST as createHospitalApi } from "@/app/api/admin/hospitals/route";
import { GET as listUsersApi, PATCH as patchUserApi } from "@/app/api/admin/users/route";
import { GET as listAuditApi } from "@/app/api/admin/audit/route";
import { GET as getAnalyticsApi } from "@/app/api/admin/analytics/route";
import { POST as demoRefreshApi } from "@/app/api/admin/demo-refresh/route";
import { AppError } from "@/lib/errors";
import {
  avgHoldToArrival,
  holdOutcomeRates,
  reservationsPerConditionPerDay,
  soldOutEventsPerResourceAndDistrict,
  staleHospitals,
} from "@/server/admin/analytics";
import { listAuditLogs } from "@/server/admin/audit-viewer";
import { refreshDemoStock } from "@/server/admin/demo-refresh";
import { createHospital, deleteOrArchiveHospital, listHospitals, updateHospital } from "@/server/admin/hospitals";
import { changeUserRole, listUsers } from "@/server/admin/users";
import { proxy } from "@/proxy";
import { createSession, SESSION_COOKIE, validateSessionToken, type SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { parseFinderParams } from "@/server/finder/params";
import { listDirectory, searchHospitals } from "@/server/finder/search";
import { getHospitalStock, hospitalExists } from "@/server/reservations/queries";
import { reserve } from "@/server/reservations/reserve";
import * as stockMod from "@/server/reservations/stock";
import { resetDb } from "../support/db";
import { ensureResourceType, makeHeld, makeHospitalWithStock, makeUser } from "../support/fixtures";

async function errorCodeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).code;
  }
  throw new Error("expected AppError");
}

function hdrs(token?: string, mutation = false): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h.cookie = `${SESSION_COOKIE}=${token}`;
  if (mutation) {
    h.origin = "http://localhost";
    h.host = "localhost";
    h["content-type"] = "application/json";
  }
  return h;
}

const getReq = (path: string, token?: string) => new Request(`http://localhost${path}`, { headers: hdrs(token) });
const mutReq = (method: "POST" | "PATCH" | "DELETE", path: string, body: unknown, token?: string) =>
  new Request(`http://localhost${path}`, { method, headers: hdrs(token, true), body: body === undefined ? undefined : JSON.stringify(body) });

let admin: SessionUser;
let citizen: SessionUser;
let staff: SessionUser;
let adminToken: string;
let citizenToken: string;
let staffToken: string;
let baseHospitalId: string;

beforeEach(async () => {
  await resetDb();
  const base = await makeHospitalWithStock({ slug: "base-hospital", isDemo: true });
  baseHospitalId = base.hospital.id;
  admin = await makeUser("ADMIN");
  citizen = await makeUser("CITIZEN");
  staff = await makeUser("HOSPITAL_STAFF", { hospitalId: baseHospitalId });
  adminToken = (await createSession(admin.id)).token;
  citizenToken = (await createSession(citizen.id)).token;
  staffToken = (await createSession(staff.id)).token;
});

afterAll(async () => {
  await resetDb();
});

describe("admin authorization guards", () => {
  it("signed-out -> 401 UNAUTHENTICATED, citizen/staff -> 404 NOT_FOUND + AUTHZ_DENIED audit", async () => {
    // API endpoints: signed-out
    expect((await listHospitalsApi(getReq("/api/admin/hospitals"), {})).status).toBe(401);
    expect((await listUsersApi(getReq("/api/admin/users"), {})).status).toBe(401);
    expect((await listAuditApi(getReq("/api/admin/audit"), {})).status).toBe(401);
    expect((await getAnalyticsApi(getReq("/api/admin/analytics"), {})).status).toBe(401);
    expect((await demoRefreshApi(mutReq("POST", "/api/admin/demo-refresh", {}), {})).status).toBe(401);

    // Citizen -> 404 + audited
    const cRes = await listHospitalsApi(getReq("/api/admin/hospitals", citizenToken), {});
    expect(cRes.status).toBe(404);
    expect((await cRes.json()).error.code).toBe("NOT_FOUND");
    expect((await listUsersApi(getReq("/api/admin/users", citizenToken), {})).status).toBe(404);
    expect((await getAnalyticsApi(getReq("/api/admin/analytics", citizenToken), {})).status).toBe(404);
    expect((await demoRefreshApi(mutReq("POST", "/api/admin/demo-refresh", {}, citizenToken), {})).status).toBe(404);

    // Staff -> 404 + audited
    const sRes = await listHospitalsApi(getReq("/api/admin/hospitals", staffToken), {});
    expect(sRes.status).toBe(404);
    expect((await sRes.json()).error.code).toBe("NOT_FOUND");
    expect((await listAuditApi(getReq("/api/admin/audit", staffToken), {})).status).toBe(404);

    // Mutation without Origin -> 400
    const noOrigin = new Request("http://localhost/api/admin/demo-refresh", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${adminToken}` },
    });
    expect((await demoRefreshApi(noOrigin, {})).status).toBe(400);

    // AUTHZ_DENIED recorded for citizen + staff
    const denied = await prisma.auditLog.findMany({ where: { action: "AUTHZ_DENIED" } });
    expect(denied.some((d) => d.actorUserId === citizen.id)).toBe(true);
    expect(denied.some((d) => d.actorUserId === staff.id)).toBe(true);
  });
});

describe("admin hospitals CRUD, transactional resources, and delete vs archive", () => {
  const validInput = (slug: string, overrides: Record<string, unknown> = {}) => ({
    nameBn: `${slug} বাংলা`,
    nameEn: `${slug} English`,
    slug,
    type: "GOVT" as const,
    freeService: true,
    liveDataEnabled: true,
    phone: "01711112222",
    division: "Dhaka",
    district: "Dhaka",
    area: "Dhanmondi",
    address: "Road 10, Dhanmondi, Dhaka",
    lat: 23.75,
    lng: 90.38,
    isDemo: false,
    ...overrides,
  });

  it("creates hospital + initial HospitalResource rows + AuditLog in one transaction; invalid resource rolls back hospital", async () => {
    const icu = await ensureResourceType("ICU_BED");
    const anti = await ensureResourceType("ANTIVENOM");

    // Invalid resourceTypeId must roll back hospital creation
    await expect(
      createHospital(admin, validInput("tx-rollback", {
        resources: [{ resourceTypeId: "non-existent-rt", total: 5, available: 5 }],
      })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await prisma.hospital.findUnique({ where: { slug: "tx-rollback" } })).toBeNull();

    // Valid creation via API route
    const res = await createHospitalApi(
      mutReq("POST", "/api/admin/hospitals", validInput("new-live-hospital", {
        resources: [
          { resourceTypeId: icu.id, total: 10, available: 4 },
          { resourceTypeId: anti.id, total: 8, available: 8 },
        ],
      }), adminToken),
      {},
    );
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.slug).toBe("new-live-hospital");

    const hrs = await prisma.hospitalResource.findMany({ where: { hospitalId: created.id } });
    expect(hrs).toHaveLength(2);
    expect(hrs.find((r) => r.resourceTypeId === icu.id)).toMatchObject({ total: 10, available: 4, isAvailable: true });

    const log = await prisma.auditLog.findFirst({ where: { entityType: "Hospital", entityId: created.id, action: "ADMIN_CHANGE" } });
    expect(log).not.toBeNull();
    expect((log!.after as { action: string }).action).toBe("CREATE");
  });

  it("validates Bangladesh coordinate bounds and duplicate slug", async () => {
    const badLat = await createHospitalApi(mutReq("POST", "/api/admin/hospitals", validInput("bad-lat", { lat: 10 }), adminToken), {});
    expect(badLat.status).toBe(400);
    expect((await badLat.json()).error.code).toBe("VALIDATION_ERROR");

    const badLng = await createHospitalApi(mutReq("POST", "/api/admin/hospitals", validInput("bad-lng", { lng: 95 }), adminToken), {});
    expect(badLng.status).toBe(400);

    const dup = await createHospitalApi(mutReq("POST", "/api/admin/hospitals", validInput("base-hospital"), adminToken), {});
    expect(dup.status).toBe(409);
    expect((await dup.json()).error.code).toBe("CONFLICT");
  });

  it("lists with search, filters, sort, pagination and updates with old->new audit", async () => {
    await createHospital(admin, validInput("alpha-rajshahi", { nameEn: "Alpha Medical", district: "Rajshahi", type: "PRIVATE", freeService: false, liveDataEnabled: false }));
    await createHospital(admin, validInput("beta-dhaka", { nameEn: "Beta Medical", district: "Dhaka", type: "GOVT" }));

    const searched = await listHospitals(admin, { search: "Rajshahi", sort: "nameEn", order: "asc", page: 1, pageSize: 20 });
    expect(searched.items.map((h) => h.slug)).toEqual(["alpha-rajshahi"]);

    const dirOnly = await listHospitals(admin, { liveDataEnabled: false, sort: "nameEn", order: "asc", page: 1, pageSize: 20 });
    expect(dirOnly.items.map((h) => h.slug)).toEqual(["alpha-rajshahi"]);

    const paged = await listHospitals(admin, { sort: "nameEn", order: "asc", page: 2, pageSize: 1 });
    expect(paged.total).toBe(3);
    expect(paged.items).toHaveLength(1);

    const beta = searched.items[0];
    const patchRes = await patchHospitalApi(
      mutReq("PATCH", `/api/admin/hospitals/${beta.id}`, { nameEn: "Alpha Updated", phone: "01800001111" }, adminToken),
      { params: Promise.resolve({ hospitalId: beta.id }) },
    );
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.nameEn).toBe("Alpha Updated");

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Hospital", entityId: beta.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow.before).toMatchObject({ nameEn: "Alpha Medical", phone: "01711112222" });
    expect(auditRow.after).toMatchObject({ action: "UPDATE", nameEn: "Alpha Updated", phone: "01800001111" });
  });

  it("hard-deletes hospital with 0 reservations (even with SoldOutEvent), blocks archive on active HELD, archives after terminal status, and hides from Finder/directory/reserve", async () => {
    // 1. Hospital with 0 reservations + 1 SoldOutEvent -> hard deleted
    const noResH = await makeHospitalWithStock({ slug: "never-reserved" });
    await prisma.soldOutEvent.create({
      data: { hospitalId: noResH.hospital.id, resourceTypeId: noResH.types.ICU_BED.id, userId: citizen.id },
    });
    const delRes = await deleteHospitalApi(
      mutReq("DELETE", `/api/admin/hospitals/${noResH.hospital.id}`, undefined, adminToken),
      { params: Promise.resolve({ hospitalId: noResH.hospital.id }) },
    );
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ action: "deleted" });
    expect(await prisma.hospital.findUnique({ where: { id: noResH.hospital.id } })).toBeNull();

    // 2. Hospital with active HELD reservation -> 409 CONFLICT blocking archive
    const withHold = await makeHospitalWithStock({ slug: "has-active-hold" });
    const held = await makeHeld({ user: citizen, hospitalResourceId: withHold.resources.ICU_BED.id });

    const blockedRes = await deleteHospitalApi(
      mutReq("DELETE", `/api/admin/hospitals/${withHold.hospital.id}`, undefined, adminToken),
      { params: Promise.resolve({ hospitalId: withHold.hospital.id }) },
    );
    expect(blockedRes.status).toBe(409);
    const blockedJson = await blockedRes.json();
    expect(blockedJson.error.code).toBe("CONFLICT");
    expect(blockedJson.error.message.en).toContain("active reservations");
    expect((await prisma.hospital.findUniqueOrThrow({ where: { id: withHold.hospital.id } })).archivedAt).toBeNull();

    // 3. Cancel the hold -> archive now succeeds
    await prisma.reservation.update({ where: { id: held.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    const archRes = await deleteHospitalApi(
      mutReq("DELETE", `/api/admin/hospitals/${withHold.hospital.id}`, undefined, adminToken),
      { params: Promise.resolve({ hospitalId: withHold.hospital.id }) },
    );
    expect(archRes.status).toBe(200);
    expect(await archRes.json()).toEqual({ action: "archived" });
    const archivedRow = await prisma.hospital.findUniqueOrThrow({ where: { id: withHold.hospital.id } });
    expect(archivedRow.archivedAt).not.toBeNull();

    // 4. Also create an archived directory hospital and verify directory & Finder exclude archived hospitals
    const archDir = await createHospital(admin, validInput("archived-dir", { liveDataEnabled: false }));
    await deleteOrArchiveHospital(admin, archDir.id); // 0 reservations? Make sure directory with reservation is archived:
    const dirWithRes = await createHospital(admin, validInput("archived-dir-2", { liveDataEnabled: false }));
    const rt = await ensureResourceType("ICU_BED");
    const hrDir = await prisma.hospitalResource.create({
      data: { hospitalId: dirWithRes.id, resourceTypeId: rt.id, total: 1, available: 1, updatedAt: new Date() },
    });
    await prisma.reservation.create({
      data: {
        userId: citizen.id, hospitalId: dirWithRes.id, resourceTypeId: rt.id, hospitalResourceId: hrDir.id,
        status: "EXPIRED", expiredAt: new Date(), expiresAt: new Date(), idempotencyKey: randomUUID(), requestHash: "h",
      },
    });
    await deleteOrArchiveHospital(admin, dirWithRes.id);

    // Seed condition so searchHospitals works
    await prisma.condition.create({ data: { code: "STROKE", nameBn: "স্ট্রোক", nameEn: "Stroke", sortOrder: 1 } });
    const finder = await searchHospitals(parseFinderParams({ condition: "STROKE" }).params);
    expect(finder.results.some((r) => r.hospitalId === withHold.hospital.id)).toBe(false);
    expect(finder.results.some((r) => r.hospitalId === baseHospitalId)).toBe(true);
    const dir = await listDirectory(parseFinderParams({}).params);
    expect(dir.some((d) => d.id === dirWithRes.id)).toBe(false);

    // 5. Archived hospital cannot be reserved and cannot be edited
    expect(await errorCodeOf(() =>
      reserve(citizen, {
        idempotencyKey: randomUUID(),
        body: { hospitalId: withHold.hospital.id, resourceCode: "ICU_BED", quantity: 1 },
      }),
    )).toBe("CONFLICT");
    expect(await errorCodeOf(() => updateHospital(admin, withHold.hospital.id, { nameEn: "Nope" }))).toBe("CONFLICT");
    expect((await getHospitalApi(getReq(`/api/admin/hospitals/${withHold.hospital.id}`, adminToken), { params: Promise.resolve({ hospitalId: withHold.hospital.id }) })).status).toBe(200);

    // 6. Public hospital page & proxy return real 404 for archived hospitals
    expect(await hospitalExists("has-active-hold")).toBe(false);
    expect(await errorCodeOf(() => getHospitalStock("has-active-hold"))).toBe("NOT_FOUND");
    const proxyRes = await proxy(new NextRequest("http://localhost/hospitals/has-active-hold"));
    expect(proxyRes.status).toBe(404);
    const activeProxyRes = await proxy(new NextRequest("http://localhost/hospitals/base-hospital"));
    expect(activeProxyRes.status).toBe(200);
  });

  it("archive vs reserve race never leaves a hospital both archived and holding a HELD reservation", async () => {
    const raceH = await makeHospitalWithStock({
      slug: "archive-reserve-race",
      stock: [{ code: "ICU_BED", total: 30, available: 30 }],
    });
    // Seed one past terminal reservation so deleteOrArchiveHospital always takes the archive path.
    await prisma.reservation.create({
      data: {
        userId: citizen.id,
        hospitalId: raceH.hospital.id,
        resourceTypeId: raceH.types.ICU_BED.id,
        hospitalResourceId: raceH.resources.ICU_BED.id,
        status: "CANCELLED",
        cancelledAt: new Date(),
        expiresAt: new Date(),
        idempotencyKey: randomUUID(),
        requestHash: "seed-terminal",
      },
    });

    let archiveWon = 0;
    let reserveWon = 0;
    const iterations = 15;
    for (let i = 0; i < iterations; i++) {
      // Reset hospital to unarchived and cancel any prior HELD row before each concurrent race
      await prisma.reservation.updateMany({
        where: { hospitalId: raceH.hospital.id, status: "HELD" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await prisma.hospital.update({ where: { id: raceH.hospital.id }, data: { archivedAt: null } });

      const doArchive = () => deleteOrArchiveHospital(admin, raceH.hospital.id);
      const doReserve = () =>
        reserve(citizen, {
          idempotencyKey: randomUUID(),
          body: { hospitalId: raceH.hospital.id, resourceCode: "ICU_BED", quantity: 1 },
        });

      const results = i % 2 === 0
        ? await Promise.allSettled([doArchive(), doReserve()])
        : await Promise.allSettled([doReserve(), doArchive()]);

      const archRes = i % 2 === 0 ? results[0] : results[1];
      const resvRes = i % 2 === 0 ? results[1] : results[0];
      if (archRes.status === "fulfilled") archiveWon++;
      if (resvRes.status === "fulfilled") reserveWon++;

      // Invariant: NEVER archived AND holding an active HELD reservation, and never both succeed
      expect(archRes.status === "fulfilled" && resvRes.status === "fulfilled").toBe(false);
      const row = await prisma.hospital.findUniqueOrThrow({ where: { id: raceH.hospital.id } });
      const heldCount = await prisma.reservation.count({ where: { hospitalId: raceH.hospital.id, status: "HELD" } });
      if (row.archivedAt !== null) expect(heldCount).toBe(0);
      if (heldCount > 0) expect(row.archivedAt).toBeNull();
    }
    expect(archiveWon + reserveWon).toBe(iterations);
  }, 60_000);

  it("deterministic race: archive commits between reserve's initial archivedAt check and takeStock -> reserve rolls back with CONFLICT", async () => {
    const raceH = await makeHospitalWithStock({
      slug: "det-archive-first",
      stock: [{ code: "ICU_BED", total: 10, available: 10 }],
    });
    // Past terminal reservation so deleteOrArchiveHospital takes the archive branch
    await prisma.reservation.create({
      data: {
        userId: citizen.id, hospitalId: raceH.hospital.id, resourceTypeId: raceH.types.ICU_BED.id,
        hospitalResourceId: raceH.resources.ICU_BED.id, status: "CANCELLED", cancelledAt: new Date(),
        expiresAt: new Date(), idempotencyKey: randomUUID(), requestHash: "det-1",
      },
    });

    const origTakeStock = stockMod.takeStock;
    const spy = vi.spyOn(stockMod, "takeStock").mockImplementationOnce(async (tx, hrId, qty) => {
      // At this exact point, reserveTx has ALREADY passed its initial hr.hospital.archivedAt === null check.
      // Run deleteOrArchiveHospital in a separate transaction to completion before takeStock acquires the row lock.
      const archived = await deleteOrArchiveHospital(admin, raceH.hospital.id);
      expect(archived).toEqual({ action: "archived" });
      return origTakeStock(tx, hrId, qty);
    });

    try {
      const code = await errorCodeOf(() =>
        reserve(citizen, {
          idempotencyKey: randomUUID(),
          body: { hospitalId: raceH.hospital.id, resourceCode: "ICU_BED", quantity: 1 },
        }),
      );
      expect(code).toBe("CONFLICT");
      expect(spy).toHaveBeenCalledTimes(1);

      // Invariant: hospital is archived, 0 HELD reservations, and stock decrement rolled back cleanly
      const h = await prisma.hospital.findUniqueOrThrow({ where: { id: raceH.hospital.id } });
      expect(h.archivedAt).not.toBeNull();
      expect(await prisma.reservation.count({ where: { hospitalId: raceH.hospital.id, status: "HELD" } })).toBe(0);
      expect((await prisma.hospitalResource.findUniqueOrThrow({ where: { id: raceH.resources.ICU_BED.id } })).available).toBe(10);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);

  it("deterministic race: reserve holds HospitalResource lock while archive starts -> archive blocks on FOR UPDATE then fails with CONFLICT", async () => {
    const raceH = await makeHospitalWithStock({
      slug: "det-reserve-first",
      stock: [{ code: "ICU_BED", total: 10, available: 10 }],
    });
    await prisma.reservation.create({
      data: {
        userId: citizen.id, hospitalId: raceH.hospital.id, resourceTypeId: raceH.types.ICU_BED.id,
        hospitalResourceId: raceH.resources.ICU_BED.id, status: "CANCELLED", cancelledAt: new Date(),
        expiresAt: new Date(), idempotencyKey: randomUUID(), requestHash: "det-2",
      },
    });

    const origReadStock = stockMod.readStock;
    let archivePromise: Promise<unknown> | null = null;
    const spy = vi.spyOn(stockMod, "readStock").mockImplementationOnce(async (tx, id) => {
      // reserveTx has already executed takeStock (holds HospitalResource lock) and inserted HELD reservation.
      // Start archive concurrently so it blocks on SELECT ... FOR UPDATE until reserveTx commits.
      archivePromise = deleteOrArchiveHospital(admin, raceH.hospital.id);
      await new Promise((r) => setTimeout(r, 80));
      return origReadStock(tx, id);
    });

    try {
      const res = await reserve(citizen, {
        idempotencyKey: randomUUID(),
        body: { hospitalId: raceH.hospital.id, resourceCode: "ICU_BED", quantity: 1 },
      });
      expect(res.reservation.status).toBe("HELD");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(archivePromise).not.toBeNull();
      expect(await errorCodeOf(() => archivePromise!)).toBe("CONFLICT");

      const h = await prisma.hospital.findUniqueOrThrow({ where: { id: raceH.hospital.id } });
      expect(h.archivedAt).toBeNull();
      expect(await prisma.reservation.count({ where: { hospitalId: raceH.hospital.id, status: "HELD" } })).toBe(1);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);
});

describe("admin users, role changes, and session revocation", () => {
  it("lists/filters users, changes CITIZEN <-> HOSPITAL_STAFF, blocks self-change, revokes sessions, and audits without leaking passwordHash", async () => {
    const listed = await listUsers(admin, { search: citizen.phone, page: 1, pageSize: 20 });
    expect(listed.items.map((u) => u.id)).toEqual([citizen.id]);

    // Self-change blocked
    const selfRes = await patchUserApi(
      mutReq("PATCH", "/api/admin/users", { userId: admin.id, newRole: "CITIZEN" }, adminToken),
      {},
    );
    expect(selfRes.status).toBe(409);
    expect((await selfRes.json()).error.code).toBe("CONFLICT");
    expect(await validateSessionToken(adminToken)).not.toBeNull();

    // Missing hospitalId for staff -> 400
    const missingHosp = await patchUserApi(
      mutReq("PATCH", "/api/admin/users", { userId: citizen.id, newRole: "HOSPITAL_STAFF" }, adminToken),
      {},
    );
    expect(missingHosp.status).toBe(400);

    // Promote citizen -> staff: sessions revoked + audited + no passwordHash leaked
    expect(await validateSessionToken(citizenToken)).not.toBeNull();
    const promoteRes = await patchUserApi(
      mutReq("PATCH", "/api/admin/users", { userId: citizen.id, newRole: "HOSPITAL_STAFF", hospitalId: baseHospitalId }, adminToken),
      {},
    );
    expect(promoteRes.status).toBe(200);
    const promoted = await promoteRes.json();
    expect(promoted).toMatchObject({ id: citizen.id, role: "HOSPITAL_STAFF", hospitalId: baseHospitalId });
    expect(promoted).not.toHaveProperty("passwordHash");
    expect(await validateSessionToken(citizenToken)).toBeNull();

    // Demote staff -> citizen: hospitalId cleared + sessions revoked
    expect(await validateSessionToken(staffToken)).not.toBeNull();
    const demoted = await changeUserRole(admin, { userId: staff.id, newRole: "CITIZEN" });
    expect(demoted).toMatchObject({ id: staff.id, role: "CITIZEN", hospitalId: null });
    expect(await validateSessionToken(staffToken)).toBeNull();

    const logs = await listAuditLogs(admin, { action: "ADMIN_CHANGE", page: 1, pageSize: 20 });
    expect(logs.items.some((l) => l.entityType === "User" && l.entityId === citizen.id)).toBe(true);
    expect(logs.items.some((l) => l.entityType === "User" && l.entityId === staff.id)).toBe(true);
  });
});

describe("admin SQL analytics on a known dataset", () => {
  it("computes exact counts, rates, avg hold-to-arrival minutes, and stale hospitals", async () => {
    const now = new Date();
    const min = 60_000;
    const day = 24 * 3600_000;

    // 1. Fresh live hospital vs stale live hospital (45m ago) vs archived stale vs directory stale
    const freshH = await makeHospitalWithStock({ slug: "an-fresh", updatedAt: now });
    const staleH = await makeHospitalWithStock({ slug: "an-stale", updatedAt: new Date(now.getTime() - 45 * min) });
    const archH = await makeHospitalWithStock({ slug: "an-arch", updatedAt: new Date(now.getTime() - 45 * min) });
    await prisma.hospital.update({ where: { id: archH.hospital.id }, data: { archivedAt: now } });
    const dirStale = await prisma.hospital.create({
      data: {
        slug: "an-dir-stale", nameBn: "d", nameEn: "Dir Stale", type: "PRIVATE", freeService: false,
        liveDataEnabled: false, phone: "01711111111", division: "Chattogram", district: "Chattogram",
        area: "X", address: "Y", lat: 22.3, lng: 91.8,
      },
    });
    await prisma.hospitalResource.create({
      data: { hospitalId: dirStale.id, resourceTypeId: freshH.types.ANTIVENOM.id, total: 5, available: 5, updatedAt: new Date(now.getTime() - 45 * min) },
    });

    // Conditions
    const stroke = await prisma.condition.create({ data: { code: "STROKE", nameBn: "স্ট্রোক", nameEn: "Stroke", sortOrder: 1 } });
    const dengue = await prisma.condition.create({ data: { code: "DENGUE", nameBn: "ডেঙ্গু", nameEn: "Dengue", sortOrder: 2 } });

    const c2 = await makeUser("CITIZEN");
    const c3 = await makeUser("CITIZEN");
    const c4 = await makeUser("CITIZEN");
    const c5 = await makeUser("CITIZEN");

    const mkRes = (opts: {
      userId: string; hId: string; rtId: string; hrId: string; condId: string;
      status: "ARRIVED" | "COMPLETED" | "EXPIRED" | "CANCELLED" | "REJECTED";
      createdAt: Date; arrivedAt?: Date;
    }) => prisma.reservation.create({
      data: {
        userId: opts.userId, hospitalId: opts.hId, resourceTypeId: opts.rtId, hospitalResourceId: opts.hrId,
        conditionId: opts.condId, status: opts.status, quantity: 1,
        createdAt: opts.createdAt, arrivedAt: opts.arrivedAt ?? null,
        expiresAt: new Date(opts.createdAt.getTime() + 30 * min),
        idempotencyKey: randomUUID(), requestHash: "h",
      },
    });

    // 2 ARRIVED/COMPLETED for STROKE today: 12 min + 18 min => avg 15.0 min
    await mkRes({
      userId: citizen.id, hId: freshH.hospital.id, rtId: freshH.types.ICU_BED.id, hrId: freshH.resources.ICU_BED.id,
      condId: stroke.id, status: "ARRIVED", createdAt: new Date(now.getTime() - 12 * min), arrivedAt: now,
    });
    await mkRes({
      userId: c2.id, hId: freshH.hospital.id, rtId: freshH.types.ANTIVENOM.id, hrId: freshH.resources.ANTIVENOM.id,
      condId: stroke.id, status: "COMPLETED", createdAt: new Date(now.getTime() - 18 * min), arrivedAt: now,
    });
    // 1 EXPIRED for DENGUE today
    await mkRes({
      userId: c3.id, hId: staleH.hospital.id, rtId: staleH.types.ICU_BED.id, hrId: staleH.resources.ICU_BED.id,
      condId: dengue.id, status: "EXPIRED", createdAt: now,
    });
    // 1 CANCELLED for DENGUE 2 days ago
    await mkRes({
      userId: c4.id, hId: staleH.hospital.id, rtId: staleH.types.ANTIVENOM.id, hrId: staleH.resources.ANTIVENOM.id,
      condId: dengue.id, status: "CANCELLED", createdAt: new Date(now.getTime() - 2 * day),
    });
    // 1 REJECTED for STROKE 10 days ago (outside 7-day window, inside outcomes)
    await mkRes({
      userId: c5.id, hId: freshH.hospital.id, rtId: freshH.types.ICU_BED.id, hrId: freshH.resources.ICU_BED.id,
      condId: stroke.id, status: "REJECTED", createdAt: new Date(now.getTime() - 10 * day),
    });

    // Sold-out events: 2 at Dhaka (freshH ICU_BED), 1 at Chattogram (dirStale ANTIVENOM)
    await prisma.soldOutEvent.createMany({
      data: [
        { hospitalId: freshH.hospital.id, resourceTypeId: freshH.types.ICU_BED.id, userId: citizen.id },
        { hospitalId: freshH.hospital.id, resourceTypeId: freshH.types.ICU_BED.id, userId: c2.id },
        { hospitalId: dirStale.id, resourceTypeId: freshH.types.ANTIVENOM.id, userId: c3.id },
      ],
    });

    const [perDay, soldOut, outcomeStats, avgMin, stale] = await Promise.all([
      reservationsPerConditionPerDay(admin),
      soldOutEventsPerResourceAndDistrict(admin),
      holdOutcomeRates(admin),
      avgHoldToArrival(admin),
      staleHospitals(admin),
    ]);

    const todayStr = now.toISOString().slice(0, 10);
    const twoDaysAgoStr = new Date(now.getTime() - 2 * day).toISOString().slice(0, 10);
    expect(perDay).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: twoDaysAgoStr, conditionCode: "DENGUE", count: 1 }),
      expect.objectContaining({ day: todayStr, conditionCode: "DENGUE", count: 1 }),
      expect.objectContaining({ day: todayStr, conditionCode: "STROKE", count: 2 }),
    ]));
    // 10-day-old reservation must NOT be in perDay
    expect(perDay.reduce((s, r) => s + r.count, 0)).toBe(4);

    expect(soldOut).toEqual([
      expect.objectContaining({ code: "ICU_BED", district: "Dhaka", count: 2 }),
      expect.objectContaining({ code: "ANTIVENOM", district: "Chattogram", count: 1 }),
    ]);

    expect(outcomeStats.totalResolved).toBe(5);
    expect(outcomeStats.outcomes).toEqual([
      { status: "ARRIVED", count: 2, rate: 0.4 },
      { status: "EXPIRED", count: 1, rate: 0.2 },
      { status: "CANCELLED", count: 1, rate: 0.2 },
      { status: "REJECTED", count: 1, rate: 0.2 },
    ]);

    expect(avgMin).not.toBeNull();
    expect(avgMin!).toBeCloseTo(15.0, 1);

    expect(stale.map((s) => s.id)).toEqual([staleH.hospital.id]);
  });
});

describe("admin demo stock refresh", () => {
  it("resets only active demo hospitals hold-aware and writes an audit log", async () => {
    const demoH = await makeHospitalWithStock({ slug: "demo-test", isDemo: true, stock: [{ code: "ICU_BED", total: 5, available: 1 }] });
    const nonDemoH = await makeHospitalWithStock({ slug: "real-test", isDemo: false, stock: [{ code: "ICU_BED", total: 5, available: 1 }] });
    await makeHeld({ user: citizen, hospitalResourceId: demoH.resources.ICU_BED.id, quantity: 1 }); // available now 0

    const res = await refreshDemoStock(admin);
    expect(res.refreshed).toBeGreaterThanOrEqual(1);

    // Demo hospital: 5 total - 1 active held = 4 available
    const afterDemo = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: demoH.resources.ICU_BED.id } });
    expect(afterDemo.available).toBe(4);
    // Non-demo hospital untouched
    const afterReal = await prisma.hospitalResource.findUniqueOrThrow({ where: { id: nonDemoH.resources.ICU_BED.id } });
    expect(afterReal.available).toBe(1);

    const log = await prisma.auditLog.findFirst({ where: { action: "ADMIN_CHANGE", entityType: "DemoStock" } });
    expect(log).not.toBeNull();
    expect(log!.actorUserId).toBe(admin.id);
  });
});

describe("admin CSV hospital import", () => {
  it("validates per row, detects duplicate slugs, supports idempotent re-import and updates, and reports errors per row", async () => {
    const header = "slug,nameBn,nameEn,type,freeService,liveDataEnabled,phone,division,district,area,address,lat,lng,isDemo";
    const row1 = 'csv-dhaka-1,সিএসভি ১,CSV Hospital 1,GOVT,true,true,01711110001,Dhaka,Dhaka,Dhanmondi,"Road 1, Dhaka",23.75,90.38,true';
    const row2 = 'csv-raj-2,সিএসভি ২,CSV Hospital 2,PRIVATE,false,false,01711110002,Rajshahi,Rajshahi,Puthia,"Main Rd",24.36,88.84,false';
    const dupRow1 = 'csv-dhaka-1,সিএসভি ডুপ,Dup CSV,GOVT,true,true,01711110001,Dhaka,Dhaka,Dhanmondi,"Road 1, Dhaka",23.75,90.38,true';
    const badRow = 'bad-coord,সিএসভি ৩,Bad Lat,GOVT,true,true,01711110003,Dhaka,Dhaka,Mirpur,"Sec 10",55.0,90.38,false';

    const r1 = await importHospitalsApi(
      mutReq("POST", "/api/admin/hospitals/import", { csv: [header, row1, row2, dupRow1, badRow].join("\n") }, adminToken),
      {},
    );
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.summary).toEqual({ total: 4, created: 2, updated: 0, unchanged: 0, errors: 2 });
    expect(j1.rows.find((r: { rowNumber: number }) => r.rowNumber === 4).errors[0]).toContain("Duplicate slug");
    expect(j1.rows.find((r: { rowNumber: number }) => r.rowNumber === 5).errors[0]).toContain("lat");

    // Re-importing valid rows is idempotent (unchanged: 2)
    const r2 = await importHospitalsApi(
      mutReq("POST", "/api/admin/hospitals/import", { csv: [header, row1, row2].join("\n") }, adminToken),
      {},
    );
    expect((await r2.json()).summary).toEqual({ total: 2, created: 0, updated: 0, unchanged: 2, errors: 0 });

    // Modifying row1 updates it and leaves row2 unchanged
    const row1Updated = 'csv-dhaka-1,সিএসভি ১,CSV Hospital 1 Updated,GOVT,true,true,01711110001,Dhaka,Dhaka,Dhanmondi,"Road 1, Dhaka",23.75,90.38,true';
    const r3 = await importHospitalsApi(
      mutReq("POST", "/api/admin/hospitals/import", { csv: [header, row1Updated, row2].join("\n") }, adminToken),
      {},
    );
    expect((await r3.json()).summary).toEqual({ total: 2, created: 0, updated: 1, unchanged: 1, errors: 0 });
    expect((await prisma.hospital.findUniqueOrThrow({ where: { slug: "csv-dhaka-1" } })).nameEn).toBe("CSV Hospital 1 Updated");
  });
});
