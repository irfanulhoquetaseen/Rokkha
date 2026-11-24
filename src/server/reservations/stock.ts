import type { Prisma } from "@/generated/prisma/client";

// Reservation-driven stock movements. Never read-then-write: both statements are single
// atomic UPDATEs, so concurrent holds/releases can neither oversell nor lose a return.
// They bump `version` (clients drop stale socket events) but leave `updatedAt` alone —
// freshness means "last confirmed by staff", not "last reservation".

export type StockSnapshot = {
  id: string;
  hospitalId: string;
  resourceTypeId: string;
  code: string;
  available: number;
  total: number;
  isAvailable: boolean;
  version: number;
  updatedAt: Date;
};

/** Conditional decrement: true when `qty` units were taken, false when not enough were left. */
export async function takeStock(tx: Prisma.TransactionClient, hospitalResourceId: string, qty: number): Promise<boolean> {
  const { count } = await tx.hospitalResource.updateMany({
    where: { id: hospitalResourceId, available: { gte: qty } },
    data: { available: { decrement: qty }, version: { increment: 1 } },
  });
  return count === 1;
}

/**
 * Gives `qty` units back, clamped to `total`: staff may have lowered total while the hold
 * was active, and the CHECK (available <= total) must never fire on a release.
 */
export async function returnStock(tx: Prisma.TransactionClient, hospitalResourceId: string, qty: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE "HospitalResource"
    SET "available" = LEAST("total", "available" + ${qty}::int), "version" = "version" + 1
    WHERE "id" = ${hospitalResourceId}`;
}

export async function readStock(tx: Prisma.TransactionClient, id: string): Promise<StockSnapshot> {
  const r = await tx.hospitalResource.findUniqueOrThrow({ where: { id }, include: { resourceType: { select: { code: true } } } });
  return {
    id: r.id, hospitalId: r.hospitalId, resourceTypeId: r.resourceTypeId, code: r.resourceType.code,
    available: r.available, total: r.total, isAvailable: r.isAvailable, version: r.version, updatedAt: r.updatedAt,
  };
}
