import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { disconnectSessionSockets } from "@/server/realtime/registry";

export const userListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  role: z.enum(["CITIZEN", "HOSPITAL_STAFF", "ADMIN"]).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export const changeRoleSchema = z.object({
  userId: z.string().min(1).max(64),
  newRole: z.enum(["CITIZEN", "HOSPITAL_STAFF"]),
  hospitalId: z.string().min(1).max(64).optional(),
}).refine(
  (d) => d.newRole !== "HOSPITAL_STAFF" || !!d.hospitalId,
  { message: "hospitalId is required when setting role to HOSPITAL_STAFF", path: ["hospitalId"] },
);

const safeUserSelect = {
  id: true,
  phone: true,
  name: true,
  role: true,
  hospitalId: true,
  hospital: { select: { id: true, nameEn: true, nameBn: true } },
  createdAt: true,
  updatedAt: true,
} as const;

export async function listUsers(user: SessionUser | null, input: z.infer<typeof userListSchema>) {
  await requireRole(user, "ADMIN");
  const where: Prisma.UserWhereInput = {};
  if (input.search) {
    where.OR = [
      { phone: { contains: input.search, mode: "insensitive" } },
      { name: { contains: input.search, mode: "insensitive" } },
    ];
  }
  if (input.role) where.role = input.role;

  const [total, items] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      select: safeUserSelect,
    }),
  ]);
  return { items, total, page: input.page, pageSize: input.pageSize };
}

export async function changeUserRole(actor: SessionUser | null, rawInput: z.infer<typeof changeRoleSchema>) {
  const admin = await requireRole(actor, "ADMIN");
  const input = changeRoleSchema.parse(rawInput);

  if (input.userId === admin.id) {
    throw new AppError("CONFLICT", {
      bn: "আপনি নিজের ভূমিকা পরিবর্তন করতে পারবেন না",
      en: "You cannot change your own role",
    });
  }

  const target = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, hospitalId: true } });
  if (!target) throw new AppError("NOT_FOUND");

  if (target.role === "ADMIN") {
    throw new AppError("CONFLICT", {
      bn: "অন্য অ্যাডমিনের ভূমিকা পরিবর্তন করা যাবে না",
      en: "Cannot change another admin's role",
    });
  }

  if (input.newRole === "HOSPITAL_STAFF") {
    const hospital = await prisma.hospital.findFirst({
      where: { id: input.hospitalId!, archivedAt: null },
      select: { id: true },
    });
    if (!hospital) throw new AppError("NOT_FOUND", { bn: "হাসপাতাল খুঁজে পাওয়া যায়নি", en: "Hospital not found" });
  }

  const nextHospitalId = input.newRole === "HOSPITAL_STAFF" ? input.hospitalId! : null;

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: input.userId },
      data: { role: input.newRole, hospitalId: nextHospitalId },
      select: safeUserSelect,
    });

    const sessions = await tx.session.findMany({ where: { userId: input.userId }, select: { id: true } });
    await tx.session.deleteMany({ where: { userId: input.userId } });

    await audit({
      actorUserId: admin.id, action: "ADMIN_CHANGE", entityType: "User", entityId: input.userId,
      before: { role: target.role, hospitalId: target.hospitalId },
      after: { role: input.newRole, hospitalId: nextHospitalId },
    }, tx);

    return { updated, sessionIds: sessions.map((s) => s.id) };
  });

  for (const id of result.sessionIds) {
    disconnectSessionSockets(id);
  }

  return result.updated;
}
