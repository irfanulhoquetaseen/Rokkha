import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { io as connect, type Socket } from "socket.io-client";
import type { Server as IOServer } from "socket.io";

// `connection()` only works inside a Next request scope; route handlers are called directly here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));
// The logout route reads/clears the cookie through next/headers; back it with a per-test jar.
const cookieJar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => { if (value) cookieJar.set(name, value); else cookieJar.delete(name); },
  }),
}));

import { prisma } from "@/server/db";
import { createSession, deleteSession, SESSION_COOKIE, type SessionUser } from "@/server/auth/session";
import { attachSocketServer } from "@/server/realtime/io";
import { reserve } from "@/server/reservations/reserve";
import { cancelReservation } from "@/server/reservations/transition";
import { MAX_ROOMS_PER_SOCKET } from "@/server/realtime/io";
import { PATCH } from "@/app/api/staff/resources/[resourceId]/route";
import { POST as LOGOUT } from "@/app/api/auth/logout/route";
import { resetDb } from "../support/db";
import { makeHeld, makeHospitalWithStock, makeUser } from "../support/fixtures";

type Ack = { ok: true } | { ok: false; code: string };

const globalForIO = globalThis as unknown as { io?: IOServer };
let httpServer: HttpServer;
let ioServer: IOServer;
let url: string;
let prevIO: IOServer | undefined;
const clients: Socket[] = [];

beforeEach(async () => {
  await resetDb();
  cookieJar.clear();
  prevIO = globalForIO.io;
  httpServer = createServer();
  ioServer = attachSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await ioServer.close(); // also closes httpServer
  globalForIO.io = prevIO;
});

async function client(token?: string, headers: Record<string, string> = {}): Promise<Socket> {
  const extraHeaders = { ...headers, ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}) };
  const c = connect(url, { path: "/socket.io", transports: ["websocket"], extraHeaders, reconnection: false, forceNew: true });
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    c.once("connect", () => resolve());
    c.once("connect_error", reject);
  });
  return c;
}

const subscribe = (c: Socket, payload: unknown): Promise<Ack> =>
  c.timeout(5000).emitWithAck("subscribe", payload) as Promise<Ack>;

function nextEvent<T>(c: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    c.once(event, (data: T) => { clearTimeout(t); resolve(data); });
  });
}

async function tokenFor(user: SessionUser): Promise<string> {
  return (await createSession(user.id)).token;
}

describe("realtime sockets", () => {
  it("anonymous can subscribe to finder and hospital rooms", async () => {
    const { hospital } = await makeHospitalWithStock();
    const c = await client();
    expect(await subscribe(c, { room: "finder" })).toEqual({ ok: true });
    expect(await subscribe(c, { room: `hospital:${hospital.id}` })).toEqual({ ok: true });
  });

  it("anonymous cannot join staff or reservation rooms", async () => {
    const { hospital, resources } = await makeHospitalWithStock();
    const citizen = await makeUser("CITIZEN");
    const r = await makeHeld({ user: citizen, hospitalResourceId: resources.ICU_BED!.id });
    const c = await client();
    expect(await subscribe(c, { room: `staff:${hospital.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await subscribe(c, { room: `reservation:${r.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("citizen cannot join another citizen's reservation room", async () => {
    const { resources } = await makeHospitalWithStock();
    const owner = await makeUser("CITIZEN");
    const other = await makeUser("CITIZEN");
    const r = await makeHeld({ user: owner, hospitalResourceId: resources.ICU_BED!.id });
    const c = await client(await tokenFor(other));
    expect(await subscribe(c, { room: `reservation:${r.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });
    const denied = await prisma.auditLog.findFirst({ where: { action: "AUTHZ_DENIED", actorUserId: other.id, entityId: r.id } });
    expect(denied).not.toBeNull();
    // The owner is allowed.
    const o = await client(await tokenFor(owner));
    expect(await subscribe(o, { room: `reservation:${r.id}` })).toEqual({ ok: true });
  });

  it("citizen cannot join a staff room", async () => {
    const { hospital } = await makeHospitalWithStock();
    const citizen = await makeUser("CITIZEN");
    const c = await client(await tokenFor(citizen));
    expect(await subscribe(c, { room: `staff:${hospital.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await prisma.auditLog.count({ where: { action: "AUTHZ_DENIED", actorUserId: citizen.id } })).toBe(1);
  });

  it("staff can join own staff room but not another hospital's", async () => {
    const a = await makeHospitalWithStock();
    const b = await makeHospitalWithStock();
    const staff = await makeUser("HOSPITAL_STAFF", { hospitalId: a.hospital.id });
    const c = await client(await tokenFor(staff));
    expect(await subscribe(c, { room: `staff:${a.hospital.id}` })).toEqual({ ok: true });
    expect(await subscribe(c, { room: `staff:${b.hospital.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });
    // Admin may join any staff room.
    const admin = await makeUser("ADMIN");
    const ad = await client(await tokenFor(admin));
    expect(await subscribe(ad, { room: `staff:${b.hospital.id}` })).toEqual({ ok: true });
  });

  it("owner receives reservation:changed after cancel, with version", async () => {
    const { resources } = await makeHospitalWithStock();
    const owner = await makeUser("CITIZEN");
    const r = await makeHeld({ user: owner, hospitalResourceId: resources.ICU_BED!.id });
    const c = await client(await tokenFor(owner));
    expect(await subscribe(c, { room: `reservation:${r.id}` })).toEqual({ ok: true });
    const got = nextEvent<Record<string, unknown>>(c, "reservation:changed");
    await cancelReservation(owner, r.id);
    const ev = await got;
    expect(Object.keys(ev).sort()).toEqual(["expiresAt", "hospitalId", "id", "status", "version"]);
    expect(ev).toMatchObject({ id: r.id, status: "CANCELLED", version: r.version + 1, hospitalId: r.hospitalId });
  });

  it("finder room receives stock:changed after reserve, after commit", async () => {
    const { hospital, resources } = await makeHospitalWithStock();
    const citizen = await makeUser("CITIZEN");
    const c = await client();
    expect(await subscribe(c, { room: "finder" })).toEqual({ ok: true });
    const icu = resources.ICU_BED!;
    const seenInDb = new Promise<{ ev: Record<string, unknown>; dbAvailable: number; dbVersion: number }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout waiting for stock:changed")), 5000);
      c.once("stock:changed", (ev: Record<string, unknown>) => {
        prisma.hospitalResource.findUniqueOrThrow({ where: { id: icu.id } })
          .then((row) => { clearTimeout(t); resolve({ ev, dbAvailable: row.available, dbVersion: row.version }); }, reject);
      });
    });
    await reserve(citizen, { idempotencyKey: randomUUID(), body: { hospitalId: hospital.id, resourceCode: "ICU_BED" } });
    const { ev, dbAvailable, dbVersion } = await seenInDb;
    expect(Object.keys(ev).sort()).toEqual(
      ["available", "code", "hospitalId", "id", "isAvailable", "resourceTypeId", "total", "updatedAt", "version"],
    );
    expect(ev).toMatchObject({ id: icu.id, hospitalId: hospital.id, code: "ICU_BED", available: icu.available - 1, version: icu.version + 1 });
    expect(dbAvailable).toBe(ev.available);
    expect(dbVersion).toBe(ev.version);
  });

  it("staff PATCH publishes stock:changed", async () => {
    const { hospital, resources } = await makeHospitalWithStock();
    const staff = await makeUser("HOSPITAL_STAFF", { hospitalId: hospital.id });
    const token = await tokenFor(staff);
    const c = await client(token);
    expect(await subscribe(c, { room: `staff:${hospital.id}` })).toEqual({ ok: true });
    const pub = await client();
    expect(await subscribe(pub, { room: `hospital:${hospital.id}` })).toEqual({ ok: true });
    const icu = resources.ICU_BED!;
    const gotStaff = nextEvent<Record<string, unknown>>(c, "stock:changed");
    const gotPublic = nextEvent<Record<string, unknown>>(pub, "stock:changed");
    const res = await PATCH(
      new Request("http://localhost/api/staff/x", {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}`, origin: "http://localhost", host: "localhost" },
        body: JSON.stringify({ version: icu.version, change: { op: "adjust", delta: 1 } }),
      }),
      { params: Promise.resolve({ resourceId: icu.id }) },
    );
    expect(res.status).toBe(200);
    for (const ev of [await gotStaff, await gotPublic]) {
      expect(ev).toMatchObject({ id: icu.id, hospitalId: hospital.id, code: "ICU_BED", available: icu.available + 1, version: icu.version + 1 });
      expect(Object.keys(ev)).not.toContain("nameEn");
    }
  });

  it("subscribe after logout is denied", async () => {
    const { hospital } = await makeHospitalWithStock();
    const staff = await makeUser("HOSPITAL_STAFF", { hospitalId: hospital.id });
    const token = await tokenFor(staff);
    const c = await client(token);
    expect(await subscribe(c, { room: `staff:${hospital.id}` })).toEqual({ ok: true });
    // Every subscribe re-validates: a session row gone by any path (here a raw delete that skips
    // the socket revocation) no longer authorizes private rooms.
    await prisma.session.deleteMany({ where: { userId: staff.id } });
    expect(await subscribe(c, { room: `staff:${hospital.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });

    // deleteSession (logout path) also disconnects; reconnecting with the dead cookie stays anonymous.
    const token2 = await tokenFor(staff);
    const c2 = await client(token2);
    const gone = nextEvent<string>(c2, "disconnect");
    await deleteSession(token2);
    expect(await gone).toBe("io server disconnect");
    const c3 = await client(token2);
    expect(await subscribe(c3, { room: `staff:${hospital.id}` })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("logout disconnects the session's sockets, so private rooms stop receiving", async () => {
    const { resources } = await makeHospitalWithStock();
    const owner = await makeUser("CITIZEN");
    const admin = await makeUser("ADMIN");
    const r = await makeHeld({ user: owner, hospitalResourceId: resources.ICU_BED!.id });
    const token = await tokenFor(owner);
    const c = await client(token);
    expect(await subscribe(c, { room: `reservation:${r.id}` })).toEqual({ ok: true });
    let received = 0;
    c.on("reservation:changed", () => { received++; });
    const disconnected = nextEvent<string>(c, "disconnect");

    cookieJar.set(SESSION_COOKIE, token);
    const res = await LOGOUT(new Request("http://localhost/api/auth/logout", {
      method: "POST", headers: { origin: "http://localhost", host: "localhost" },
    }), undefined as never);
    expect(res.status).toBe(200);
    expect(await disconnected).toBe("io server disconnect");

    await cancelReservation(admin, r.id);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received).toBe(0);
    expect(ioServer.sockets.adapter.rooms.get(`reservation:${r.id}`)).toBeUndefined();
  });

  it("clients cannot subscribe to or leave internal session rooms", async () => {
    const owner = await makeUser("CITIZEN");
    const token = await tokenFor(owner);
    const c = await client(token);
    expect(await subscribe(c, { room: `session:${"a".repeat(64)}` })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    const sessionRooms = [...ioServer.sockets.adapter.rooms.keys()].filter((k) => k.startsWith("session:"));
    expect(sessionRooms).toHaveLength(1);
    expect(await c.timeout(5000).emitWithAck("unsubscribe", { room: sessionRooms[0] })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(ioServer.sockets.adapter.rooms.get(sessionRooms[0]!)?.size).toBe(1);
    // socket.data holds only the session hash, never the raw token.
    const [srv] = await ioServer.fetchSockets();
    expect(JSON.stringify(srv!.data)).not.toContain(token);
    expect(srv!.data).toMatchObject({ userId: owner.id });
  });

  it("caps rooms per socket with LIMIT_REACHED", async () => {
    const c = await client(await tokenFor(await makeUser("CITIZEN")));
    expect(MAX_ROOMS_PER_SOCKET).toBe(20);
    for (let i = 0; i < MAX_ROOMS_PER_SOCKET; i++) {
      expect(await subscribe(c, { room: `hospital:h${i}` })).toEqual({ ok: true });
    }
    // Re-subscribing to a joined room is still fine; a new one is refused.
    expect(await subscribe(c, { room: "hospital:h0" })).toEqual({ ok: true });
    expect(await subscribe(c, { room: "finder" })).toEqual({ ok: false, code: "LIMIT_REACHED" });
    expect(await c.timeout(5000).emitWithAck("unsubscribe", { room: "hospital:h0" })).toEqual({ ok: true });
    expect(await subscribe(c, { room: "finder" })).toEqual({ ok: true });
  });

  it("invalid payload acks VALIDATION_ERROR", async () => {
    const c = await client();
    for (const bad of [null, "finder", { room: "admin" }, { room: "staff:" }, { room: `hospital:${"x".repeat(65)}` }, { room: 42 }, { room: "finder\n" }]) {
      expect(await subscribe(c, bad)).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    }
    expect(await c.timeout(5000).emitWithAck("unsubscribe", { room: "nope" })).toEqual({ ok: false, code: "VALIDATION_ERROR" });
    expect(await c.timeout(5000).emitWithAck("unsubscribe", { room: "finder" })).toEqual({ ok: true });
  });

  it("rejects a cross-origin browser handshake", async () => {
    await expect(client(undefined, { origin: "https://evil.example" })).rejects.toBeTruthy();
    const ok = await client(undefined, { origin: url });
    expect(await subscribe(ok, { room: "finder" })).toEqual({ ok: true });
  });
});
