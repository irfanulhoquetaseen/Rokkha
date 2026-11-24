import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next request scope; route handlers are called directly here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import type { ReservationStatus } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { createSession, SESSION_COOKIE, type SessionUser } from "@/server/auth/session";
import { GET as listMine, POST as reservePost } from "@/app/api/reservations/route";
import { GET as getOne } from "@/app/api/reservations/[reservationId]/route";
import { POST as cancelPost } from "@/app/api/reservations/[reservationId]/cancel/route";
import { GET as queueGet } from "@/app/api/staff/hospitals/[hospitalId]/reservations/route";
import { POST as staffPost } from "@/app/api/staff/reservations/[reservationId]/route";
import { GET as stockGet } from "@/app/api/hospitals/[hospital]/stock/route";
import { resetDb } from "../support/db";
import { makeHeld, makeHospitalWithStock, makeUser } from "../support/fixtures";

type H = Awaited<ReturnType<typeof makeHospitalWithStock>>;
let hA: H, hB: H;
let citizen: SessionUser, other: SessionUser, staffA: SessionUser, admin: SessionUser;
const tokens = new Map<string, string>();

async function login(u: SessionUser): Promise<SessionUser> {
  tokens.set(u.id, (await createSession(u.id)).token);
  return u;
}

beforeEach(async () => {
  await resetDb();
  tokens.clear();
  hA = await makeHospitalWithStock({ slug: "alpha" });
  hB = await makeHospitalWithStock({ slug: "beta", stock: [{ code: "ICU_BED", total: 2, available: 0 }] });
  citizen = await login(await makeUser("CITIZEN", { phone: "01711000001" }));
  other = await login(await makeUser("CITIZEN", { phone: "01722000002" }));
  staffA = await login(await makeUser("HOSPITAL_STAFF", { hospitalId: hA.hospital.id }));
  admin = await login(await makeUser("ADMIN"));
});

const base = "http://localhost/api/x";
const auth = (u?: SessionUser): Record<string, string> => (u ? { cookie: `${SESSION_COOKIE}=${tokens.get(u.id)}` } : {});
const sameOrigin = { origin: "http://localhost", host: "localhost" };
const get = (u?: SessionUser, query = "") => new Request(`${base}${query}`, { headers: auth(u) });
const post = (u: SessionUser | undefined, body?: unknown, extra: Record<string, string> = {}, origin = true) =>
  new Request(base, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth(u), ...(origin ? sameOrigin : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ctx = <K extends string>(key: K, value: string) => ({ params: Promise.resolve({ [key]: value } as Record<K, string>) });
const icuBody = (h: H = hA) => ({ hospitalId: h.hospital.id, resourceCode: "ICU_BED" });
const keyHeader = (k: string = randomUUID()) => ({ "idempotency-key": k });

/** A reservation row in any status (no stock movement) for list/filter tests. */
async function makeRow(user: SessionUser, status: ReservationStatus, createdAt: Date, h: H = hA) {
  const res = h.resources.ICU_BED!;
  return prisma.reservation.create({
    data: {
      userId: user.id, hospitalId: h.hospital.id, resourceTypeId: res.resourceTypeId, hospitalResourceId: res.id,
      status, expiresAt: new Date(createdAt.getTime() + 30 * 60_000), createdAt,
      idempotencyKey: randomUUID(), requestHash: "row",
    },
  });
}

describe("POST /api/reservations", () => {
  it("anonymous → 401 (before the key or body are looked at)", async () => {
    const res = await reservePost(post(undefined, icuBody(), keyHeader()), {});
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });

  it("missing Idempotency-Key → 400; non-uuid key → 400", async () => {
    const r1 = await reservePost(post(citizen, icuBody()), {});
    expect(r1.status).toBe(400);
    expect((await r1.json()).error.code).toBe("VALIDATION_ERROR");
    const r2 = await reservePost(post(citizen, icuBody(), keyHeader("not-a-uuid")), {});
    expect(r2.status).toBe(400);
    expect((await r2.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("missing Origin → 400 and nothing is held", async () => {
    const res = await reservePost(post(citizen, icuBody(), keyHeader(), false), {});
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count()).toBe(0);
  });

  it("invalid body → 400", async () => {
    const res = await reservePost(post(citizen, { hospitalId: hA.hospital.id, resourceCode: "icu bed" }, keyHeader()), {});
    expect(res.status).toBe(400);
  });

  it("happy path 201, then the same key → 200 with an identical body and one hold", async () => {
    const key = randomUUID();
    const r1 = await reservePost(post(citizen, icuBody(), keyHeader(key)), {});
    expect(r1.status).toBe(201);
    expect(r1.headers.get("cache-control")).toBe("no-store");
    const b1 = await r1.json();
    expect(b1.reservation).toMatchObject({ status: "HELD", quantity: 1, hospital: { id: hA.hospital.id }, resource: { code: "ICU_BED" } });

    const r2 = await reservePost(post(citizen, icuBody(), keyHeader(key)), {});
    expect(r2.status).toBe(200);
    expect(await r2.json()).toEqual(b1);
    expect(await prisma.reservation.count()).toBe(1);
    expect((await prisma.hospitalResource.findUniqueOrThrow({ where: { id: hA.resources.ICU_BED!.id } })).available).toBe(2);
  });

  it("staff cannot reserve → 404", async () => {
    const res = await reservePost(post(staffA, icuBody(), keyHeader()), {});
    expect(res.status).toBe(404);
  });

  it("SOLD_OUT → 409 with details.alternatives", async () => {
    const res = await reservePost(post(citizen, icuBody(hB), keyHeader()), {});
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("SOLD_OUT");
    expect(json.error.message).toHaveProperty("bn");
    expect(json.error.details.alternatives).toEqual([expect.objectContaining({ hospitalId: hA.hospital.id, slug: "alpha", available: 3 })]);
  });

  it("21st request in a minute → 429 RATE_LIMITED with Retry-After", async () => {
    const racer = await login(await makeUser("CITIZEN"));
    for (let i = 0; i < 20; i++) {
      // Requests without a key are cheap 400s but still count against the limit.
      expect((await reservePost(post(racer, icuBody()), {})).status).toBe(400);
    }
    const res = await reservePost(post(racer, icuBody(), keyHeader()), {});
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another user is unaffected.
    expect((await reservePost(post(citizen, icuBody(), keyHeader()), {})).status).toBe(201);
  });
});

describe("GET /api/reservations (mine)", () => {
  it("anonymous → 401", async () => {
    expect((await listMine(get(), {})).status).toBe(401);
  });

  it("shows only my reservations, newest first, with total and pageSize", async () => {
    const t0 = Date.now() - 60 * 60_000;
    const older = await makeRow(citizen, "COMPLETED", new Date(t0));
    const newer = await makeRow(citizen, "CANCELLED", new Date(t0 + 60_000));
    await makeRow(other, "CANCELLED", new Date(t0 + 120_000));
    const res = await listMine(get(citizen), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    expect(json.items.map((i: { id: string }) => i.id)).toEqual([newer.id, older.id]);
  });

  it("paginates (page=2) and rejects an invalid page", async () => {
    const t0 = Date.now() - 2 * 60 * 60_000;
    for (let i = 0; i < 12; i++) await makeRow(citizen, "CANCELLED", new Date(t0 + i * 1000));
    const json = await (await listMine(get(citizen, "?page=2"), {})).json();
    expect(json).toMatchObject({ page: 2, pageSize: 10, total: 12 });
    expect(json.items).toHaveLength(2);
    expect((await listMine(get(citizen, "?page=0"), {})).status).toBe(400);
    expect((await listMine(get(citizen, "?page=abc"), {})).status).toBe(400);
  });

  it("lazily expires my overdue hold and returns its stock", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id, expiresAt: new Date(Date.now() - 1000) });
    const json = await (await listMine(get(citizen), {})).json();
    expect(json.items[0]).toMatchObject({ id: r.id, status: "EXPIRED" });
    expect((await prisma.hospitalResource.findUniqueOrThrow({ where: { id: hA.resources.ICU_BED!.id } })).available).toBe(3);
  });
});

describe("GET /api/reservations/:id", () => {
  it("owner → 200; admin → 200; another citizen → 404 (audited); anonymous → 401", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    const own = await getOne(get(citizen), ctx("reservationId", r.id));
    expect(own.status).toBe(200);
    expect((await own.json()).reservation).toMatchObject({ id: r.id, status: "HELD" });
    expect((await getOne(get(admin), ctx("reservationId", r.id))).status).toBe(200);

    const foreign = await getOne(get(other), ctx("reservationId", r.id));
    expect(foreign.status).toBe(404);
    expect((await foreign.json()).error.code).toBe("NOT_FOUND");
    expect(await prisma.auditLog.count({ where: { action: "AUTHZ_DENIED", actorUserId: other.id } })).toBe(1);

    expect((await getOne(get(), ctx("reservationId", r.id))).status).toBe(401);
  });

  it("unknown or malformed id → 404", async () => {
    expect((await getOne(get(citizen), ctx("reservationId", "nope"))).status).toBe(404);
    expect((await getOne(get(citizen), ctx("reservationId", "x".repeat(200)))).status).toBe(404);
  });

  it("lazily expires an overdue hold on read", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id, expiresAt: new Date(Date.now() - 1000) });
    const json = await (await getOne(get(citizen), ctx("reservationId", r.id))).json();
    expect(json.reservation.status).toBe("EXPIRED");
    expect((await prisma.hospitalResource.findUniqueOrThrow({ where: { id: hA.resources.ICU_BED!.id } })).available).toBe(3);
  });
});

describe("POST /api/reservations/:id/cancel", () => {
  it("cancel → 200, then again → 409 INVALID_TRANSITION", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    const r1 = await cancelPost(post(citizen), ctx("reservationId", r.id));
    expect(r1.status).toBe(200);
    expect((await r1.json()).reservation.status).toBe("CANCELLED");
    const r2 = await cancelPost(post(citizen), ctx("reservationId", r.id));
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toMatchObject({ code: "INVALID_TRANSITION", details: { status: "CANCELLED" } });
  });

  it("another citizen → 404, missing Origin → 400, anonymous → 401; still HELD", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    expect((await cancelPost(post(other), ctx("reservationId", r.id))).status).toBe(404);
    expect((await cancelPost(post(citizen, undefined, {}, false), ctx("reservationId", r.id))).status).toBe(400);
    expect((await cancelPost(post(undefined), ctx("reservationId", r.id))).status).toBe(401);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("HELD");
  });
});

describe("GET /api/staff/hospitals/:hospitalId/reservations (queue)", () => {
  it("own hospital → 200 with citizen name/phone; default ACTIVE sorted by expiresAt", async () => {
    const later = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id, expiresAt: new Date(Date.now() + 20 * 60_000) });
    const sooner = await makeHeld({ user: other, hospitalResourceId: hA.resources.ICU_BED!.id, expiresAt: new Date(Date.now() + 5 * 60_000) });
    await makeRow(citizen, "CANCELLED", new Date());
    const res = await queueGet(get(staffA), ctx("hospitalId", hA.hospital.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const json = await res.json();
    expect(json).toMatchObject({ page: 1, pageSize: 10, total: 2 });
    expect(json.items.map((i: { id: string }) => i.id)).toEqual([sooner.id, later.id]);
    expect(json.items[0].citizen).toEqual({ name: other.name, phone: "01722000002" });
  });

  it("filters by status=ARRIVED and by q (phone, name, id prefix)", async () => {
    const held = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    const arrived = await makeRow(other, "ARRIVED", new Date());
    const a = await (await queueGet(get(staffA, "?status=ARRIVED"), ctx("hospitalId", hA.hospital.id))).json();
    expect(a.items.map((i: { id: string }) => i.id)).toEqual([arrived.id]);

    const byPhone = await (await queueGet(get(staffA, "?q=1100000"), ctx("hospitalId", hA.hospital.id))).json();
    expect(byPhone.items.map((i: { id: string }) => i.id)).toEqual([held.id]);
    const byName = await (await queueGet(get(staffA, `?q=${encodeURIComponent(other.name.toUpperCase())}`), ctx("hospitalId", hA.hospital.id))).json();
    expect(byName.items.map((i: { id: string }) => i.id)).toEqual([arrived.id]);
    const byId = await (await queueGet(get(staffA, `?q=${held.id}`), ctx("hospitalId", hA.hospital.id))).json();
    expect(byId.items.map((i: { id: string }) => i.id)).toEqual([held.id]);
  });

  it("status=ALL paginates with total; sort=newest / oldest", async () => {
    const t0 = Date.now() - 60 * 60_000;
    const rows = [];
    for (let i = 0; i < 12; i++) rows.push(await makeRow(i % 2 ? citizen : other, "COMPLETED", new Date(t0 + i * 1000)));
    const p2 = await (await queueGet(get(staffA, "?status=ALL&page=2&sort=newest"), ctx("hospitalId", hA.hospital.id))).json();
    expect(p2).toMatchObject({ page: 2, pageSize: 10, total: 12 });
    expect(p2.items.map((i: { id: string }) => i.id)).toEqual([rows[1]!.id, rows[0]!.id]);
    const oldest = await (await queueGet(get(staffA, "?status=ALL&sort=oldest"), ctx("hospitalId", hA.hospital.id))).json();
    expect(oldest.items[0].id).toBe(rows[0]!.id);
  });

  it("invalid filters → 400", async () => {
    for (const q of ["?status=NOPE", "?sort=random", "?page=-1", `?q=${"x".repeat(65)}`]) {
      expect((await queueGet(get(staffA, q), ctx("hospitalId", hA.hospital.id))).status).toBe(400);
    }
  });

  it("other hospital → 404 for staff; citizen → 404; anonymous → 401; admin → 200", async () => {
    expect((await queueGet(get(staffA), ctx("hospitalId", hB.hospital.id))).status).toBe(404);
    expect((await queueGet(get(citizen), ctx("hospitalId", hA.hospital.id))).status).toBe(404);
    expect((await queueGet(get(), ctx("hospitalId", hA.hospital.id))).status).toBe(401);
    expect((await queueGet(get(admin), ctx("hospitalId", hB.hospital.id))).status).toBe(200);
  });

  it("lazily expires the hospital's overdue holds before listing", async () => {
    await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id, expiresAt: new Date(Date.now() - 1000) });
    const json = await (await queueGet(get(staffA), ctx("hospitalId", hA.hospital.id))).json();
    expect(json.total).toBe(0);
    expect((await prisma.hospitalResource.findUniqueOrThrow({ where: { id: hA.resources.ICU_BED!.id } })).available).toBe(3);
  });
});

describe("POST /api/staff/reservations/:id", () => {
  it("checkIn → 200 ARRIVED, complete → 200 COMPLETED", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    const c = await staffPost(post(staffA, { action: "checkIn" }), ctx("reservationId", r.id));
    expect(c.status).toBe(200);
    expect((await c.json()).reservation.status).toBe("ARRIVED");
    const d = await staffPost(post(staffA, { action: "complete" }), ctx("reservationId", r.id));
    expect((await d.json()).reservation.status).toBe("COMPLETED");
  });

  it("reject without reason → 400; with reason → 200 REJECTED", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    const bad = await staffPost(post(staffA, { action: "reject" }), ctx("reservationId", r.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("VALIDATION_ERROR");
    const ok = await staffPost(post(staffA, { action: "reject", reason: "No bed after all" }), ctx("reservationId", r.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).reservation).toMatchObject({ status: "REJECTED", rejectedReason: "No bed after all" });
  });

  it("invalid action → 400; other hospital's staff / citizen → 404; anonymous → 401; missing Origin → 400", async () => {
    const r = await makeHeld({ user: citizen, hospitalResourceId: hA.resources.ICU_BED!.id });
    const staffB = await login(await makeUser("HOSPITAL_STAFF", { hospitalId: hB.hospital.id }));
    expect((await staffPost(post(staffA, { action: "delete" }), ctx("reservationId", r.id))).status).toBe(400);
    expect((await staffPost(post(staffB, { action: "checkIn" }), ctx("reservationId", r.id))).status).toBe(404);
    expect((await staffPost(post(citizen, { action: "checkIn" }), ctx("reservationId", r.id))).status).toBe(404);
    expect((await staffPost(post(undefined, { action: "checkIn" }), ctx("reservationId", r.id))).status).toBe(401);
    expect((await staffPost(post(staffA, { action: "checkIn" }, {}, false), ctx("reservationId", r.id))).status).toBe(400);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("HELD");
  });
});

describe("GET /api/hospitals/:hospital/stock (public)", () => {
  it("by slug and by id → 200, no-store, resources sorted by sortOrder", async () => {
    for (const key of ["alpha", hA.hospital.id]) {
      const res = await stockGet(get(), ctx("hospital", key));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const json = await res.json();
      expect(json.hospital).toEqual({
        id: hA.hospital.id, slug: "alpha", nameBn: "alpha-bn", nameEn: "alpha-en", isDemo: true, liveDataEnabled: true,
      });
      expect(json.resources.map((r: { code: string }) => r.code)).toEqual(["ICU_BED", "ANTIVENOM"]);
      expect(json.resources[0]).toMatchObject({ id: hA.resources.ICU_BED!.id, hospitalId: hA.hospital.id, available: 3, total: 5, version: 1 });
    }
  });

  it("unknown or malformed → 404", async () => {
    for (const key of ["nope", "bad slug!", "x".repeat(65)]) {
      const res = await stockGet(get(), ctx("hospital", key));
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("NOT_FOUND");
    }
  });
});
