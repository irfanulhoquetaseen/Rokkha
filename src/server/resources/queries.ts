import { z } from "zod";
import type { HospitalResource, ResourceKind, ResourceType } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";

/** A resource row is "stale" when nobody has confirmed it for more than 30 minutes. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export type ResourceView = {
  id: string;
  hospitalId: string;
  resourceTypeId: string;
  code: string;
  kind: ResourceKind;
  consumable: boolean;
  nameBn: string;
  nameEn: string;
  total: number;
  available: number;
  isAvailable: boolean;
  version: number;
  updatedAt: Date;
  stale: boolean;
};

export function toResourceView(row: HospitalResource & { resourceType: ResourceType }, now = Date.now()): ResourceView {
  const t = row.resourceType;
  return {
    id: row.id,
    hospitalId: row.hospitalId,
    resourceTypeId: row.resourceTypeId,
    code: t.code,
    kind: t.kind,
    consumable: t.consumable,
    nameBn: t.nameBn,
    nameEn: t.nameEn,
    total: row.total,
    available: row.available,
    isAvailable: row.isAvailable,
    version: row.version,
    updatedAt: row.updatedAt,
    stale: now - row.updatedAt.getTime() > STALE_AFTER_MS,
  };
}

const hospitalIdSchema = z.string().min(1).max(64);

export async function listHospitalResources(
  user: SessionUser | null,
  hospitalId: string,
): Promise<{ hospital: { id: string; nameBn: string; nameEn: string }; resources: ResourceView[] }> {
  // Guard first: a foreign hospital must look exactly like a missing one.
  await requireHospitalAccess(user, hospitalId);
  const parsed = hospitalIdSchema.safeParse(hospitalId);
  if (!parsed.success) throw new AppError("NOT_FOUND");

  const hospital = await prisma.hospital.findUnique({
    where: { id: parsed.data },
    select: {
      id: true, nameBn: true, nameEn: true,
      resources: { include: { resourceType: true }, orderBy: { resourceType: { sortOrder: "asc" } } },
    },
  });
  if (!hospital) throw new AppError("NOT_FOUND");
  const now = Date.now();
  return {
    hospital: { id: hospital.id, nameBn: hospital.nameBn, nameEn: hospital.nameEn },
    resources: hospital.resources.map((r) => toResourceView(r, now)),
  };
}
