import { z } from "zod";
import type { HospitalResource } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit/audit";
import { requireHospitalAccess, requireUser } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { publishStock } from "@/server/realtime/publish";
import { toResourceView, type ResourceView } from "./queries";

const MAX_STOCK = 100_000;

export const resourceChangeSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("adjust"),
    delta: z.number().int().min(-1000).max(1000).refine((d) => d !== 0, "delta must not be 0"),
  }),
  z.object({
    op: z.literal("set"),
    available: z.number().int().min(0).max(MAX_STOCK),
    total: z.number().int().min(0).max(MAX_STOCK),
  }).refine((v) => v.available <= v.total, { message: "available must not exceed total", path: ["available"] }),
  z.object({ op: z.literal("status"), isAvailable: z.boolean() }),
]);
export type ResourceChange = z.infer<typeof resourceChangeSchema>;

export const updateResourceBodySchema = z.object({
  version: z.number().int().min(1),
  change: resourceChangeSchema,
});

const inputSchema = z.object({
  resourceId: z.string().min(1).max(64),
  expectedVersion: z.number().int().min(1),
  change: resourceChangeSchema,
});

const validation = (en: string, bn: string, details?: unknown) => new AppError("VALIDATION_ERROR", { bn, en }, details);

type Snapshot = Pick<HospitalResource, "available" | "total" | "isAvailable" | "version">;
const snapshot = (r: Snapshot): Snapshot => ({ available: r.available, total: r.total, isAvailable: r.isAvailable, version: r.version });
const current = (r: HospitalResource) => ({
  id: r.id, available: r.available, total: r.total, isAvailable: r.isAvailable, version: r.version, updatedAt: r.updatedAt,
});
const conflict = (r: HospitalResource) =>
  new AppError("CONFLICT", { bn: "অন্য একজন স্টাফ এটি পরিবর্তন করেছেন", en: "Another staff member changed this" }, { current: current(r) });

function isStockCheckViolation(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${JSON.stringify((e as { meta?: unknown }).meta ?? null)}` : "";
  return text.includes("hospital_resource_stock_bounds") || text.includes("23514");
}

/**
 * Versioned (optimistic-concurrency) update of one hospital resource.
 * New values are computed from the row read inside the transaction, but the write is a
 * compare-and-set on `version`, so a concurrent change yields CONFLICT — never a lost update.
 */
export async function updateHospitalResource(
  user: SessionUser | null,
  input: { resourceId: string; expectedVersion: number; change: ResourceChange },
): Promise<ResourceView> {
  const actor = requireUser(user);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw validation("The submitted data is invalid", "প্রদত্ত তথ্য সঠিক নয়",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  const { resourceId, expectedVersion, change } = parsed.data;

  // Guard before revealing existence: missing and foreign rows both end in NOT_FOUND.
  const owner = await prisma.hospitalResource.findUnique({
    where: { id: resourceId },
    select: { hospitalId: true, resourceType: { select: { kind: true } } },
  });
  if (!owner) throw new AppError("NOT_FOUND");
  await requireHospitalAccess(actor, owner.hospitalId);

  const kind = owner.resourceType.kind;
  if (change.op === "status" ? kind !== "STATUS" : kind !== "COUNTABLE") {
    throw validation(
      `Operation "${change.op}" is not allowed for a ${kind} resource`,
      "এই ধরনের রিসোর্সে এই পরিবর্তন করা যায় না",
    );
  }

  let view: ResourceView;
  try {
    view = await prisma.$transaction(async (tx) => {
      const before = await tx.hospitalResource.findUnique({ where: { id: resourceId } });
      if (!before) throw new AppError("NOT_FOUND");
      if (before.version !== expectedVersion) throw conflict(before);

      let next: Pick<Snapshot, "available" | "total" | "isAvailable">;
      if (change.op === "adjust") {
        next = { available: before.available + change.delta, total: before.total, isAvailable: before.isAvailable };
      } else if (change.op === "set") {
        next = { available: change.available, total: change.total, isAvailable: before.isAvailable };
      } else {
        next = { available: before.available, total: before.total, isAvailable: change.isAvailable };
      }
      if (next.available < 0 || next.available > next.total) {
        throw validation(
          `Available must stay between 0 and total (${next.total})`,
          `প্রাপ্যতা ০ থেকে মোট (${next.total}) এর মধ্যে থাকতে হবে`,
          { available: next.available, total: next.total },
        );
      }

      const updated = await tx.hospitalResource.updateMany({
        where: { id: resourceId, version: expectedVersion },
        data: { ...next, version: { increment: 1 }, updatedAt: new Date(), updatedById: actor.id },
      });
      if (updated.count === 0) {
        const latest = await tx.hospitalResource.findUnique({ where: { id: resourceId } });
        if (!latest) throw new AppError("NOT_FOUND");
        throw conflict(latest);
      }

      const after = await tx.hospitalResource.findUniqueOrThrow({ where: { id: resourceId }, include: { resourceType: true } });
      await audit({
        actorUserId: actor.id, action: "STOCK_CHANGE", entityType: "HospitalResource", entityId: resourceId,
        before: snapshot(before), after: snapshot(after),
      }, tx);
      return toResourceView(after);
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (isStockCheckViolation(e)) throw validation("Available must stay between 0 and total", "প্রাপ্যতা ০ থেকে মোটের মধ্যে থাকতে হবে");
    throw e;
  }
  // Emit only after the transaction committed (the finder, hospital and staff rooms update live).
  publishStock({
    id: view.id, hospitalId: view.hospitalId, resourceTypeId: view.resourceTypeId, code: view.code,
    available: view.available, total: view.total, isAvailable: view.isAvailable, version: view.version, updatedAt: view.updatedAt,
  });
  return view;
}
