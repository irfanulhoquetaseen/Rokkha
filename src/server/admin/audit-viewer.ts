import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

export const auditListSchema = z.object({
  action: z.string().trim().max(50).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export async function listAuditLogs(user: SessionUser | null, input: z.infer<typeof auditListSchema>) {
  await requireRole(user, "ADMIN");
  const where: Prisma.AuditLogWhereInput = {};
  if (input.action) where.action = input.action;
  if (input.from || input.to) {
    where.createdAt = {};
    if (input.from) where.createdAt.gte = input.from;
    if (input.to) where.createdAt.lte = input.to;
  }

  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
  ]);

  const actorIds = [...new Set(items.map((i) => i.actorUserId).filter((id): id is string => id !== null))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, phone: true } })
    : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  return {
    items: items.map((i) => ({ ...i, actor: i.actorUserId ? (actorMap.get(i.actorUserId) ?? null) : null })),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

/** Distinct action values for the filter dropdown. */
export async function distinctActions(user: SessionUser | null): Promise<string[]> {
  await requireRole(user, "ADMIN");
  const rows = await prisma.auditLog.findMany({
    distinct: ["action"],
    select: { action: true },
    orderBy: { action: "asc" },
  });
  return rows.map((r) => r.action);
}
