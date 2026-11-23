import { z } from "zod";
import { isValidCoord } from "@/server/matching";
import type { BloodGroup } from "@/server/matching";
import type { Bilingual } from "@/lib/errors";
import { findArea } from "./areas";

export const RADIUS_OPTIONS = [5, 10, 25, 50, 100] as const;
export const SORT_OPTIONS = ["score", "distance", "freshness"] as const;
export const BLOOD_GROUPS: BloodGroup[] = ["A_POS", "A_NEG", "B_POS", "B_NEG", "O_POS", "O_NEG", "AB_POS", "AB_NEG"];

export const finderParamsSchema = z.object({
  condition: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  blood: z.enum(BLOOD_GROUPS as [BloodGroup, ...BloodGroup[]]).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  area: z.string().optional(),
  radius: z
    .union([z.literal(5), z.literal(10), z.literal(25), z.literal(50), z.literal(100)])
    .optional(),
  type: z.enum(["GOVT", "PRIVATE"]).optional(),
  free: z.boolean().optional(),
  sort: z.enum(SORT_OPTIONS).default("score"),
  page: z.number().int().min(1).default(1),
});

export type FinderParams = z.infer<typeof finderParamsSchema>;

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined || s === "" ? undefined : s;
}

function num(s: string | undefined): number | undefined {
  if (s === undefined || s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Lenient parse: every bad field is dropped (with a bilingual notice) instead of failing the page. */
export function parseFinderParams(sp: SP): { params: FinderParams; notices: Bilingual[] } {
  const notices: Bilingual[] = [];
  const raw: Record<string, unknown> = {};

  const check = (key: keyof FinderParams, value: unknown, notice: Bilingual) => {
    if (value === undefined) return;
    const r = (finderParamsSchema.shape[key] as z.ZodType).safeParse(value);
    if (r.success) raw[key] = r.data;
    else notices.push(notice);
  };

  check("condition", first(sp.condition), { bn: "অবস্থার কোড বৈধ নয়, উপেক্ষা করা হয়েছে।", en: "Invalid condition ignored." });
  check("blood", first(sp.blood), { bn: "রক্তের গ্রুপ বৈধ নয়, উপেক্ষা করা হয়েছে।", en: "Invalid blood group ignored." });

  // Location: explicit lat/lng wins; else area.
  const latS = first(sp.lat);
  const lngS = first(sp.lng);
  if (latS !== undefined || lngS !== undefined) {
    const lat = num(latS);
    const lng = num(lngS);
    if (lat !== undefined && lng !== undefined && isValidCoord({ lat, lng })) {
      raw.lat = lat;
      raw.lng = lng;
    } else {
      notices.push({ bn: "অবস্থানের স্থানাঙ্ক বৈধ নয়, উপেক্ষা করা হয়েছে।", en: "Invalid location coordinates ignored." });
    }
  }
  const areaId = first(sp.area);
  if (areaId !== undefined) {
    const area = findArea(areaId);
    if (!area) {
      notices.push({ bn: "এলাকা চেনা যায়নি, উপেক্ষা করা হয়েছে।", en: "Unknown area ignored." });
    } else {
      raw.area = area.id;
      if (raw.lat === undefined) {
        raw.lat = area.lat;
        raw.lng = area.lng;
      }
    }
  }

  const radiusS = first(sp.radius);
  if (radiusS !== undefined) check("radius", num(radiusS) ?? Number.NaN, { bn: "দূরত্বের সীমা বৈধ নয়, উপেক্ষা করা হয়েছে।", en: "Invalid radius ignored." });
  check("type", first(sp.type), { bn: "হাসপাতালের ধরন বৈধ নয়, উপেক্ষা করা হয়েছে।", en: "Invalid hospital type ignored." });
  const freeS = first(sp.free);
  if (freeS !== undefined) {
    if (freeS === "1") raw.free = true;
    else notices.push({ bn: "বিনামূল্যের ফিল্টার বৈধ নয়, উপেক্ষা করা হয়েছে।", en: "Invalid free-service filter ignored." });
  }
  check("sort", first(sp.sort), { bn: "সাজানোর ধরন বৈধ নয়, ডিফল্ট ব্যবহার করা হয়েছে।", en: "Invalid sort ignored; using default." });
  const pageS = first(sp.page);
  if (pageS !== undefined) check("page", num(pageS) ?? Number.NaN, { bn: "পৃষ্ঠা নম্বর বৈধ নয়, ১ ধরা হয়েছে।", en: "Invalid page; showing page 1." });

  return { params: finderParamsSchema.parse(raw), notices };
}
