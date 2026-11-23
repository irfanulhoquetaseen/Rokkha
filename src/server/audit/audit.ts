import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

export type AuditAction =
  | "SIGNUP" | "LOGIN" | "LOGIN_FAILED" | "LOGOUT" | "STOCK_CHANGE"
  | "RESERVATION_TRANSITION" | "ADMIN_CHANGE" | "AUTHZ_DENIED";

export type AuditEntry = {
  actorUserId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
};

const json = (v: unknown) =>
  v === undefined || v === null ? Prisma.DbNull : (v as Prisma.InputJsonValue);

export async function audit(entry: AuditEntry, db: Prisma.TransactionClient = prisma): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
      ip: entry.ip ?? null,
    },
  });
}
