import { beforeEach, describe, expect, it, vi } from "vitest";

// `connection()` only works inside a Next request scope; route handlers are called directly here.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), connection: async () => {} }));

import { prisma } from "@/server/db";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { GET } from "@/app/api/staff/hospitals/[hospitalId]/resources/route";
import { PATCH } from "@/app/api/staff/resources/[resourceId]/route";
import { resetDb } from "../support/db";

const hospitalData = (slug: string) => ({
  slug, nameBn: `${slug}-bn`, nameEn: `${slug}-en`, type: "GOVT" as const, freeService: true, phone: "01700000000",
  division: "Dhaka", district: "Dhaka", area: "X", address: "Y", lat: 23.7, lng: 90.4,
});

let hA: string, hB: string, icuA: string, icuB: string, token: string;

beforeEach(async () => {
  await resetDb();
  const [a, b, icu] = await Promise.all([
    prisma.hospital.create({ data: hospitalData("a") }),
    prisma.hospital.create({ data: hospitalData("b") }),
    prisma.resourceType.create({ data: { code: "ICU_BED", kind: "COUNTABLE", consumable: false, nameBn: "আইসিইউ", nameEn: "ICU bed", sortOrder: 1 } }),
  ]);
  hA = a.id; hB = b.id;
  const staff = await prisma.user.create({ data: { phone: "01711111111", name: "staffA", passwordHash: "x", role: "HOSPITAL_STAFF", hospitalId: hA } });
  icuA = (await prisma.hospitalResource.create({ data: { hospitalId: hA, resourceTypeId: icu.id, total: 5, available: 3, updatedAt: new Date() } })).id;
  icuB = (await prisma.hospitalResource.create({ data: { hospitalId: hB, resourceTypeId: icu.id, total: 2, available: 1, updatedAt: new Date() } })).id;
  token = (await createSession(staff.id)).token;
});

const cookie = () => ({ cookie: `${SESSION_COOKIE}=${token}` });
const getReq = (h: Record<string, string> = cookie()) => new Request("http://localhost/api/staff/x", { headers: h });
const patchReq = (body: unknown, h: Record<string, string> = { ...cookie(), origin: "http://localhost", host: "localhost" }) =>
  new Request("http://localhost/api/staff/x", { method: "PATCH", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
const ctxH = (hospitalId: string) => ({ params: Promise.resolve({ hospitalId }) });
const ctxR = (resourceId: string) => ({ params: Promise.resolve({ resourceId }) });

describe("staff API", () => {
  it("GET own hospital -> 200", async () => {
    const res = await GET(getReq(), ctxH(hA));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hospital.id).toBe(hA);
    expect(json.resources).toHaveLength(1);
  });
  it("GET other hospital -> 404 error shape", async () => {
    const res = await GET(getReq(), ctxH(hB));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe("NOT_FOUND");
    expect(json.error.message).toHaveProperty("bn");
  });
  it("no cookie -> 401", async () => {
    const res = await GET(getReq({}), ctxH(hA));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
  it("PATCH ok -> 200 with resource", async () => {
    const res = await PATCH(patchReq({ version: 1, change: { op: "adjust", delta: 1 } }), ctxR(icuA));
    expect(res.status).toBe(200);
    expect((await res.json()).resource).toMatchObject({ available: 4, version: 2 });
  });
  it("PATCH stale version -> 409 CONFLICT with details.current", async () => {
    await PATCH(patchReq({ version: 1, change: { op: "adjust", delta: 1 } }), ctxR(icuA));
    const res = await PATCH(patchReq({ version: 1, change: { op: "adjust", delta: 1 } }), ctxR(icuA));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("CONFLICT");
    expect(json.error.details.current).toMatchObject({ id: icuA, available: 4, version: 2 });
  });
  it("PATCH without Origin -> 400", async () => {
    const res = await PATCH(patchReq({ version: 1, change: { op: "adjust", delta: 1 } }, cookie()), ctxR(icuA));
    expect(res.status).toBe(400);
  });
  it("PATCH other hospital's resource -> 404", async () => {
    const res = await PATCH(patchReq({ version: 1, change: { op: "adjust", delta: 1 } }), ctxR(icuB));
    expect(res.status).toBe(404);
  });
  it("PATCH invalid body -> 400", async () => {
    const res = await PATCH(patchReq({ version: 0 }), ctxR(icuA));
    expect(res.status).toBe(400);
  });
  it("PATCH without cookie -> 401 (valid or invalid body)", async () => {
    const anon = { origin: "http://localhost", host: "localhost" };
    for (const body of [{ version: 1, change: { op: "adjust", delta: 1 } }, { version: 0 }]) {
      const res = await PATCH(patchReq(body, anon), ctxR(icuA));
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    }
    expect((await prisma.hospitalResource.findUniqueOrThrow({ where: { id: icuA } })).available).toBe(3);
  });
});
