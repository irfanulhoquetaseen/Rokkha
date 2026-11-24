import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { disconnectSessionSockets } from "@/server/realtime/registry";

export const SESSION_COOKIE = "jibonsetu_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

export type SessionUser = { id: string; name: string; phone: string; role: Role; hospitalId: string | null };

/** The DB never stores the raw token, only its SHA-256 — a leaked sessions table can't be replayed. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { id: hashSessionToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

export async function validateSessionToken(token: string): Promise<SessionUser | null> {
  if (!token) return null;
  return validateSessionHash(hashSessionToken(token));
}

/** Same as validateSessionToken, for callers that keep only the hash (the socket server). */
export async function validateSessionHash(id: string): Promise<SessionUser | null> {
  if (!id) return null;
  const session = await prisma.session.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, phone: true, role: true, hospitalId: true } } },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await deleteSessionByHash(id);
    return null;
  }
  if (now - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    await prisma.session.updateMany({ where: { id }, data: { lastSeenAt: new Date(now) } });
  }
  const { user } = session;
  return { id: user.id, name: user.name, phone: user.phone, role: user.role, hospitalId: user.hospitalId };
}

/** The raw session token from a Cookie header, or null. Shared by route handlers and the socket handshake. */
export function sessionTokenFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export async function deleteSession(token: string): Promise<void> {
  if (!token) return;
  await deleteSessionByHash(hashSessionToken(token));
}

/** Deletes the session row, then disconnects its live sockets (they lose every private room). */
async function deleteSessionByHash(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
  disconnectSessionSockets(id);
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}
