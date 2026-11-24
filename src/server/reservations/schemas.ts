import { createHash } from "node:crypto";
import { z } from "zod";
import { BLOOD_GROUPS } from "@/server/finder/params";
import type { BloodGroup } from "@/server/matching";

const code = z.string().regex(/^[A-Z0-9_]{1,40}$/);

export const reserveBodySchema = z.object({
  hospitalId: z.string().min(1).max(64),
  resourceCode: code,
  quantity: z.number().int().min(1).max(4).default(1),
  conditionCode: code.optional(),
  bloodGroup: z.enum(BLOOD_GROUPS as [BloodGroup, ...BloodGroup[]]).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/** What callers send (quantity may be omitted). */
export type ReserveBody = z.input<typeof reserveBodySchema>;
export type ParsedReserveBody = z.output<typeof reserveBodySchema>;

/** One UUID per user action; a retry of that action reuses it. */
export const idempotencyKeySchema = z.uuid();

/**
 * Fingerprint of what the request asks to hold. lat/lng/bloodGroup only shape the sold-out
 * alternatives, so a retry from a slightly different position is still the same request.
 */
export function requestHash(body: ReserveBody): string {
  const b = reserveBodySchema.parse(body);
  const canonical = JSON.stringify({
    hospitalId: b.hospitalId, resourceCode: b.resourceCode, quantity: b.quantity, conditionCode: b.conditionCode ?? null,
  });
  return createHash("sha256").update(canonical).digest("hex");
}
