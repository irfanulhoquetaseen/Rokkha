import { z } from "zod";
import { parseCsv } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit/audit";
import { requireRole } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { BD_LAT_MAX, BD_LAT_MIN, BD_LNG_MAX, BD_LNG_MIN } from "./hospitals";

const MAX_CSV_BYTES = 1_000_000;
const MAX_CSV_ROWS = 500;

export const csvImportSchema = z.object({
  csv: z.string().min(1).refine((s) => Buffer.byteLength(s, "utf8") <= MAX_CSV_BYTES, "CSV exceeds 1 MB limit"),
});

const REQUIRED_HEADERS = [
  "slug", "nameBn", "nameEn", "type", "freeService", "liveDataEnabled",
  "phone", "division", "district", "area", "address", "lat", "lng",
] as const;

const csvBool = z.string().trim().toLowerCase().transform((v, ctx) => {
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  ctx.addIssue({ code: "custom", message: "Expected boolean (true/false/1/0)" });
  return z.NEVER;
});

const csvNum = (min: number, max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).transform((v, ctx) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      ctx.addIssue({ code: "custom", message: `${label} must be between ${min} and ${max}` });
      return z.NEVER;
    }
    return n;
  });

const csvRowSchema = z.object({
  slug: z.string().trim().min(2).max(200).regex(/^[a-z0-9-]+$/, "Invalid slug (lowercase a-z, 0-9, -)"),
  nameBn: z.string().trim().min(2).max(200),
  nameEn: z.string().trim().min(2).max(200),
  type: z.string().trim().toUpperCase().pipe(z.enum(["GOVT", "PRIVATE"])),
  freeService: csvBool,
  liveDataEnabled: csvBool,
  phone: z.string().trim().min(6).max(20),
  division: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  area: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(500),
  lat: csvNum(BD_LAT_MIN, BD_LAT_MAX, "lat"),
  lng: csvNum(BD_LNG_MIN, BD_LNG_MAX, "lng"),
  isDemo: z.string().trim().optional().transform((v, ctx) => {
    if (!v) return false;
    const r = csvBool.safeParse(v);
    if (!r.success) {
      ctx.addIssue({ code: "custom", message: "isDemo must be boolean" });
      return z.NEVER;
    }
    return r.data;
  }),
});

export { parseCsv };

export type CsvRowStatus = "created" | "updated" | "unchanged" | "error";
export type CsvRowReport = { rowNumber: number; slug: string; status: CsvRowStatus; errors?: string[] };
export type CsvImportReport = {
  summary: { total: number; created: number; updated: number; unchanged: number; errors: number };
  rows: CsvRowReport[];
};

const EDITABLE_KEYS = [
  "nameBn", "nameEn", "type", "freeService", "liveDataEnabled", "isDemo",
  "phone", "division", "district", "area", "address", "lat", "lng",
] as const;

export async function importHospitalsCsv(user: SessionUser | null, csvText: string): Promise<CsvImportReport> {
  const actor = await requireRole(user, "ADMIN");
  const { csv } = csvImportSchema.parse({ csv: csvText });
  const grid = parseCsv(csv);
  if (grid.length < 2) {
    throw new AppError("VALIDATION_ERROR", {
      bn: "CSV ফাইলে হেডার এবং কমপক্ষে একটি সারি থাকতে হবে",
      en: "CSV must include a header row and at least one data row",
    });
  }

  const headers = grid[0]!.map((h) => h.trim());
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    throw new AppError("VALIDATION_ERROR", {
      bn: `প্রয়োজনীয় কলাম নেই: ${missing.join(", ")}`,
      en: `Missing required CSV columns: ${missing.join(", ")}`,
    }, { missing });
  }

  const dataRows = grid.slice(1);
  if (dataRows.length > MAX_CSV_ROWS) {
    throw new AppError("VALIDATION_ERROR", {
      bn: `সর্বোচ্চ ${MAX_CSV_ROWS}টি সারি একসাথে ইমপোর্ট করা যাবে`,
      en: `Maximum ${MAX_CSV_ROWS} rows per import`,
    });
  }

  const seenSlugs = new Set<string>();
  const rows: CsvRowReport[] = [];
  const validEntries: { rowNumber: number; data: z.infer<typeof csvRowSchema> }[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // 1-based including header
    const cells = dataRows[i]!;
    const raw: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) raw[headers[c]!] = cells[c] ?? "";

    const parsed = csvRowSchema.safeParse(raw);
    if (!parsed.success) {
      rows.push({
        rowNumber,
        slug: (raw.slug ?? "").trim(),
        status: "error",
        errors: parsed.error.issues.map((iss) => `${iss.path.join(".") || "row"}: ${iss.message}`),
      });
      continue;
    }

    if (seenSlugs.has(parsed.data.slug)) {
      rows.push({
        rowNumber,
        slug: parsed.data.slug,
        status: "error",
        errors: [`Duplicate slug "${parsed.data.slug}" in CSV`],
      });
      continue;
    }
    seenSlugs.add(parsed.data.slug);
    validEntries.push({ rowNumber, data: parsed.data });
  }

  if (validEntries.length > 0) {
    const existingList = await prisma.hospital.findMany({
      where: { slug: { in: validEntries.map((v) => v.data.slug) } },
    });
    const existingBySlug = new Map(existingList.map((h) => [h.slug, h]));

    await prisma.$transaction(async (tx) => {
      for (const { rowNumber, data } of validEntries) {
        const cur = existingBySlug.get(data.slug);
        if (!cur) {
          const created = await tx.hospital.create({ data });
          await audit({
            actorUserId: actor.id, action: "ADMIN_CHANGE", entityType: "Hospital", entityId: created.id,
            before: null, after: { action: "CSV_CREATE", slug: created.slug, nameEn: created.nameEn },
          }, tx);
          rows.push({ rowNumber, slug: data.slug, status: "created" });
          continue;
        }

        if (cur.archivedAt !== null) {
          rows.push({ rowNumber, slug: data.slug, status: "error", errors: ["Hospital is archived"] });
          continue;
        }

        const changed = EDITABLE_KEYS.some((k) => cur[k] !== data[k]);
        if (!changed) {
          rows.push({ rowNumber, slug: data.slug, status: "unchanged" });
          continue;
        }

        const beforeSnap = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, cur[k]]));
        const afterSnap = Object.fromEntries(EDITABLE_KEYS.map((k) => [k, data[k]]));
        await tx.hospital.update({ where: { id: cur.id }, data });
        await audit({
          actorUserId: actor.id, action: "ADMIN_CHANGE", entityType: "Hospital", entityId: cur.id,
          before: beforeSnap, after: { action: "CSV_UPDATE", ...afterSnap },
        }, tx);
        rows.push({ rowNumber, slug: data.slug, status: "updated" });
      }
    });
  }

  rows.sort((a, b) => a.rowNumber - b.rowNumber);
  const summary = {
    total: rows.length,
    created: rows.filter((r) => r.status === "created").length,
    updated: rows.filter((r) => r.status === "updated").length,
    unchanged: rows.filter((r) => r.status === "unchanged").length,
    errors: rows.filter((r) => r.status === "error").length,
  };
  return { summary, rows };
}
