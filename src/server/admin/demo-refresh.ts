import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { publishStock } from "@/server/realtime/publish";
import { resetDemoHospitalsStock } from "@/server/seed/run-seed";

/**
 * Resets stock for active demo hospitals (`isDemo: true`) only.
 * Reuses `resetDemoHospitalsStock` (the exact hold-aware logic of SEED_RESET_STOCK),
 * writes an AuditLog entry in the same transaction, and publishes stock updates after commit.
 */
export async function refreshDemoStock(user: SessionUser | null, now: Date = new Date()) {
  const actor = await requireRole(user, "ADMIN");

  const result = await prisma.$transaction(async (tx) => {
    const res = await resetDemoHospitalsStock(tx, now);
    await audit({
      actorUserId: actor.id,
      action: "ADMIN_CHANGE",
      entityType: "DemoStock",
      entityId: null,
      after: { action: "REFRESH_DEMO_STOCK", hospitalCount: res.refreshed },
    }, tx);
    return res;
  });

  if (result.hospitalIds.length > 0) {
    const hrs = await prisma.hospitalResource.findMany({
      where: { hospitalId: { in: result.hospitalIds } },
      include: { resourceType: { select: { code: true } } },
    });
    for (const hr of hrs) {
      publishStock({
        id: hr.id,
        hospitalId: hr.hospitalId,
        resourceTypeId: hr.resourceTypeId,
        code: hr.resourceType.code,
        available: hr.available,
        total: hr.total,
        isAvailable: hr.isAvailable,
        version: hr.version,
        updatedAt: hr.updatedAt,
      });
    }
  }

  return { refreshed: result.refreshed };
}
