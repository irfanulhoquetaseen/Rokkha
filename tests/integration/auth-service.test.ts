import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/lib/errors";
import { login, logout, signup } from "@/server/auth/service";
import { validateSessionToken } from "@/server/auth/session";
import { loginLimiterByIp, loginLimiterByPhone, signupLimiterByIp } from "@/server/auth/rate-limit";
import { resetDb } from "../support/db";

const IP = "10.0.0.1";
const meta = { ip: IP };

async function errOf(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return e as AppError;
  }
  throw new Error("expected rejection");
}

describe("auth service", () => {
  beforeEach(async () => {
    await resetDb();
    loginLimiterByPhone.reset("01711111111");
    loginLimiterByPhone.reset("01799999999");
    loginLimiterByIp.reset(IP);
    signupLimiterByIp.reset(IP);
  });

  it("signup always creates a CITIZEN (extra keys like role are stripped) and a valid session", async () => {
    const input = { name: "Rahim", phone: "+880 1711-111111", password: "secret123", role: "ADMIN", hospitalId: "h1" };
    const res = await signup(input as unknown as { name: string; phone: string; password: string }, meta);
    expect(res.user).toMatchObject({ name: "Rahim", phone: "01711111111", role: "CITIZEN", hospitalId: null });
    const row = await prisma.user.findUniqueOrThrow({ where: { phone: "01711111111" } });
    expect(row.role).toBe("CITIZEN");
    expect(row.hospitalId).toBeNull();
    expect(row.passwordHash).not.toContain("secret123");
    expect(await validateSessionToken(res.token)).toMatchObject({ id: row.id });
  });

  it("rejects invalid signup input with VALIDATION_ERROR", async () => {
    const e = await errOf(signup({ name: "R", phone: "123", password: "short" }, meta));
    expect(e.code).toBe("VALIDATION_ERROR");
  });

  it("duplicate phone in another format → CONFLICT", async () => {
    await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    const e = await errOf(signup({ name: "Karim", phone: "8801711111111", password: "secret123" }, meta));
    expect(e.code).toBe("CONFLICT");
    expect(e.bilingual.en).toBe("An account with this phone number already exists");
  });

  it("login ok returns a valid token", async () => {
    await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    const res = await login({ phone: "+8801711111111", password: "secret123" }, meta);
    expect(res.user.phone).toBe("01711111111");
    expect(await validateSessionToken(res.token)).toMatchObject({ phone: "01711111111" });
  });

  it("wrong password and unknown phone produce identical UNAUTHENTICATED errors", async () => {
    await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    const a = await errOf(login({ phone: "01711111111", password: "wrongpass" }, meta));
    const b = await errOf(login({ phone: "01799999999", password: "secret123" }, meta));
    expect(a.code).toBe("UNAUTHENTICATED");
    expect(b.code).toBe("UNAUTHENTICATED");
    expect(a.bilingual).toEqual(b.bilingual);
    expect(a.bilingual.en).toBe("Wrong phone number or password");
    expect(a.details).toEqual(b.details);
  });

  it("6th failed attempt for a phone → RATE_LIMITED with retryAfterSec", async () => {
    await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    for (let i = 0; i < 5; i++) {
      expect((await errOf(login({ phone: "01711111111", password: "wrongpass" }, meta))).code).toBe("UNAUTHENTICATED");
    }
    const e = await errOf(login({ phone: "01711111111", password: "secret123" }, meta));
    expect(e.code).toBe("RATE_LIMITED");
    expect((e.details as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
  });

  it("login with previousToken deletes the old session (rotation)", async () => {
    const s = await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    const res = await login({ phone: "01711111111", password: "secret123" }, { ip: IP, previousToken: s.token });
    expect(await validateSessionToken(s.token)).toBeNull();
    expect(await validateSessionToken(res.token)).not.toBeNull();
    expect(await prisma.session.count()).toBe(1);
  });

  it("logout deletes the session; null token is a no-op", async () => {
    const s = await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    await logout(s.token, meta);
    expect(await validateSessionToken(s.token)).toBeNull();
    await expect(logout(null, meta)).resolves.toBeUndefined();
  });

  it("writes audit rows for SIGNUP, LOGIN, LOGIN_FAILED, LOGOUT without secrets", async () => {
    const s = await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    await errOf(login({ phone: "017-1111-1111", password: "wrongpass" }, meta));
    const l = await login({ phone: "01711111111", password: "secret123" }, { ip: IP, previousToken: s.token });
    await logout(l.token, meta);
    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.action)).toEqual(["SIGNUP", "LOGIN_FAILED", "LOGIN", "LOGOUT"]);
    const failed = rows.find((r) => r.action === "LOGIN_FAILED")!;
    expect(failed.entityId).toBe("01711111111");
    expect(failed.ip).toBe(IP);
    expect(rows.find((r) => r.action === "LOGOUT")!.actorUserId).toBe(s.user.id);
    const dump = JSON.stringify(rows);
    for (const secret of ["secret123", "wrongpass", s.token, l.token]) expect(dump).not.toContain(secret);
  });

  it("rejects a password over 72 UTF-8 bytes (30 Bangla chars) with VALIDATION_ERROR", async () => {
    const bangla = "অ".repeat(30); // 30 chars, 90 bytes
    const e = await errOf(signup({ name: "Rahim", phone: "01711111111", password: bangla }, meta));
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(await prisma.user.count()).toBe(0);
    const l = await errOf(login({ phone: "01711111111", password: bangla }, meta));
    expect(l.code).toBe("VALIDATION_ERROR");
  });

  it("audits only the first rate-limited login of a window", async () => {
    await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    const codes: string[] = [];
    for (let i = 0; i < 7; i++) codes.push((await errOf(login({ phone: "01711111111", password: "wrongpass" }, meta))).code);
    expect(codes).toEqual([...Array(5).fill("UNAUTHENTICATED"), "RATE_LIMITED", "RATE_LIMITED"]);
    const failed = await prisma.auditLog.findMany({ where: { action: "LOGIN_FAILED" } });
    const limited = failed.filter((r) => (r.after as { reason?: string } | null)?.reason === "RATE_LIMITED");
    expect(failed).toHaveLength(6);
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ entityId: "01711111111", ip: IP });
  });

  it("signup with previousToken deletes the old session (rotation)", async () => {
    const a = await signup({ name: "Rahim", phone: "01711111111", password: "secret123" }, meta);
    const b = await signup({ name: "Karim", phone: "01722222222", password: "secret123" }, { ip: IP, previousToken: a.token });
    expect(await validateSessionToken(a.token)).toBeNull();
    expect(await validateSessionToken(b.token)).toMatchObject({ phone: "01722222222" });
    expect(await prisma.session.count()).toBe(1);
  });
});
