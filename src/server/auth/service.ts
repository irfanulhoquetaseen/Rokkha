import { z } from "zod";
import { AppError } from "@/lib/errors";
import { bdPhoneSchema } from "@/lib/validation/phone";
import { audit } from "@/server/audit/audit";
import { prisma } from "@/server/db";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { loginLimiterByIp, loginLimiterByPhone, signupLimiterByIp } from "@/server/auth/rate-limit";
import { createSession, deleteSession, validateSessionToken, type SessionUser } from "@/server/auth/session";

// bcrypt only uses the first 72 BYTES; a Bangla character is ~3 bytes in UTF-8, so limit bytes, not chars.
const PASSWORD_TOO_LONG = {
  bn: "পাসওয়ার্ড অনেক লম্বা (সর্বোচ্চ ৭২ বাইট)",
  en: "Password is too long (max 72 bytes)",
};
const fitsBcrypt = (p: string) => Buffer.byteLength(p, "utf8") <= 72;

// z.object strips unknown keys, so a client-sent `role` / `hospitalId` can never reach the DB.
const signupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: bdPhoneSchema,
  password: z.string().min(8).refine(fitsBcrypt, { message: PASSWORD_TOO_LONG.en }),
});

const loginSchema = z.object({
  phone: bdPhoneSchema,
  password: z.string().min(1).refine(fitsBcrypt, { message: PASSWORD_TOO_LONG.en }),
});

type AuthResult = { user: SessionUser; token: string; expiresAt: Date };

const WRONG_CREDENTIALS = { bn: "ফোন নম্বর বা পাসওয়ার্ড ভুল", en: "Wrong phone number or password" };
const DUPLICATE_PHONE = {
  bn: "এই ফোন নম্বরে আগে থেকেই অ্যাকাউন্ট আছে",
  en: "An account with this phone number already exists",
};

// Unknown phones are still checked against a real bcrypt hash so both failure paths cost the same
// time and the response timing does not reveal which phone numbers have accounts.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("jibonsetu-timing-equalizer"));

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  const details = r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  throw new AppError("VALIDATION_ERROR", undefined, details);
}

type HitResult = { allowed: boolean; retryAfterSec: number; firstBlock?: boolean };

function rateLimited(result: HitResult): AppError {
  return new AppError("RATE_LIMITED", undefined, { retryAfterSec: result.retryAfterSec });
}

function enforce(result: HitResult): void {
  if (!result.allowed) throw rateLimited(result);
}

/** Like enforce, but the first blocked attempt of each window is audited (later ones are not, to avoid log floods). */
async function enforceLogin(result: HitResult, entityId: string, ip: string | null): Promise<void> {
  if (result.allowed) return;
  if (result.firstBlock) {
    await audit({ action: "LOGIN_FAILED", entityType: "User", entityId, ip, after: { reason: "RATE_LIMITED" } });
  }
  throw rateLimited(result);
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

export async function signup(
  input: { name: string; phone: string; password: string },
  meta: { ip: string | null; previousToken?: string | null },
): Promise<AuthResult> {
  if (meta.ip) enforce(signupLimiterByIp.hit(meta.ip));
  const data = parse(signupSchema, input);
  const passwordHash = await hashPassword(data.password);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: data.name, phone: data.phone, passwordHash, role: "CITIZEN" },
        select: { id: true, name: true, phone: true, role: true, hospitalId: true },
      });
      await audit({ actorUserId: user.id, action: "SIGNUP", entityType: "User", entityId: user.id, ip: meta.ip }, tx);
      return user;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("CONFLICT", DUPLICATE_PHONE);
    throw e;
  }

  // Rotation parity with login: any pre-signup session is destroyed.
  if (meta.previousToken) await deleteSession(meta.previousToken);
  const { token, expiresAt } = await createSession(created.id);
  return { user: created, token, expiresAt };
}

export async function login(
  input: { phone: string; password: string },
  meta: { ip: string | null; previousToken?: string | null },
): Promise<AuthResult> {
  if (meta.ip) await enforceLogin(loginLimiterByIp.hit(meta.ip), meta.ip, meta.ip);
  const data = parse(loginSchema, input);
  await enforceLogin(loginLimiterByPhone.hit(data.phone), data.phone, meta.ip);

  const user = await prisma.user.findUnique({ where: { phone: data.phone } });
  const ok = await verifyPassword(data.password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) {
    await audit({
      actorUserId: user?.id ?? null, action: "LOGIN_FAILED", entityType: "User", entityId: data.phone, ip: meta.ip,
    });
    throw new AppError("UNAUTHENTICATED", WRONG_CREDENTIALS);
  }

  // Session rotation: the pre-login session (if any) is destroyed so a fixated token can't be reused.
  if (meta.previousToken) await deleteSession(meta.previousToken);
  loginLimiterByPhone.reset(data.phone);
  const { token, expiresAt } = await createSession(user.id);
  await audit({ actorUserId: user.id, action: "LOGIN", entityType: "User", entityId: user.id, ip: meta.ip });
  return {
    user: { id: user.id, name: user.name, phone: user.phone, role: user.role, hospitalId: user.hospitalId },
    token,
    expiresAt,
  };
}

export async function logout(token: string | null, meta: { ip: string | null }): Promise<void> {
  if (!token) return;
  const user = await validateSessionToken(token);
  await deleteSession(token);
  if (user) await audit({ actorUserId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id, ip: meta.ip });
}
