import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  createSession, deleteSession, sessionCookieOptions, validateSessionToken, SESSION_COOKIE,
} from "@/server/auth/session";
import { resetDb } from "../support/db";

async function makeUser() {
  return prisma.user.create({ data: { phone: "01711111111", name: "Rahim", passwordHash: "x" } });
}

describe("DB sessions", () => {
  beforeEach(resetDb);

  it("a created token validates to its user", async () => {
    const u = await makeUser();
    const { token, expiresAt } = await createSession(u.id);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    const su = await validateSessionToken(token);
    expect(su).toEqual({ id: u.id, name: "Rahim", phone: "01711111111", role: "CITIZEN", hospitalId: null });
  });

  it("stores only the sha256 of the token", async () => {
    const u = await makeUser();
    const { token } = await createSession(u.id);
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(token);
    expect(rows[0].id).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("an expired session returns null and its row is deleted", async () => {
    const u = await makeUser();
    const { token } = await createSession(u.id);
    await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("unknown / garbage tokens return null", async () => {
    expect(await validateSessionToken("nope")).toBeNull();
    expect(await validateSessionToken("")).toBeNull();
  });

  it("updates lastSeenAt only when older than 5 minutes", async () => {
    const u = await makeUser();
    const { token } = await createSession(u.id);
    const old = new Date(Date.now() - 10 * 60_000);
    await prisma.session.updateMany({ data: { lastSeenAt: old } });
    await validateSessionToken(token);
    const after = (await prisma.session.findFirstOrThrow()).lastSeenAt;
    expect(after.getTime()).toBeGreaterThan(old.getTime());
    await validateSessionToken(token);
    expect((await prisma.session.findFirstOrThrow()).lastSeenAt.getTime()).toBe(after.getTime());
  });

  it("deleteSession makes the token invalid and is idempotent", async () => {
    const u = await makeUser();
    const { token } = await createSession(u.id);
    await deleteSession(token);
    expect(await validateSessionToken(token)).toBeNull();
    await expect(deleteSession(token)).resolves.toBeUndefined();
  });

  it("cookie options are httpOnly, lax, path /", () => {
    const expires = new Date();
    expect(SESSION_COOKIE).toBe("jibonsetu_session");
    expect(sessionCookieOptions(expires)).toEqual({
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires,
    });
  });
});
