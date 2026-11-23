import type { Reservation, Role } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit/audit";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";

// Denials for a signed-in user are reported as NOT_FOUND (never 403) so the response does not
// reveal that the resource exists; each one is written to the audit log as AUTHZ_DENIED.
// Anonymous requests get UNAUTHENTICATED and are not audited (no actor, would only add noise).

async function deny(user: SessionUser, entityType: string, entityId: string | null, reason: string): Promise<never> {
  await audit({ actorUserId: user.id, action: "AUTHZ_DENIED", entityType, entityId, after: { reason, role: user.role } });
  throw new AppError("NOT_FOUND");
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}

export async function requireRole(user: SessionUser | null, ...roles: Role[]): Promise<SessionUser> {
  const u = requireUser(user);
  if (!roles.includes(u.role)) await deny(u, "Role", roles.join(","), "ROLE_REQUIRED");
  return u;
}

export async function requireHospitalAccess(user: SessionUser | null, hospitalId: string): Promise<SessionUser> {
  const u = requireUser(user);
  if (u.role === "ADMIN") return u;
  if (u.role === "HOSPITAL_STAFF" && u.hospitalId !== null && u.hospitalId === hospitalId) return u;
  return deny(u, "Hospital", hospitalId, "OTHER_HOSPITAL");
}

export async function requireReservationOwner(user: SessionUser | null, reservationId: string): Promise<Reservation> {
  const u = requireUser(user);
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) return deny(u, "Reservation", reservationId, "MISSING");
  if (u.role !== "ADMIN" && reservation.userId !== u.id) return deny(u, "Reservation", reservationId, "NOT_OWNER");
  return reservation;
}
