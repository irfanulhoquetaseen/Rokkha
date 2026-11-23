import { haversineKm } from "./geo";
import type { BloodGroup, MatchHospital, MatchInput, MatchRequirement, MatchResource, RankedHospital, Reason } from "./types";

/** A resource row not updated for longer than this is "stale". */
export const STALE_AFTER_MS = 30 * 60_000;

const WEIGHT = { CRITICAL: 3, PREFERRED: 1 } as const;
const CAPABILITY_MAX = 70;
const DISTANCE_MAX = 20;
const DISTANCE_ZERO_AT_KM = 30;
const DISTANCE_NO_ORIGIN = 10;
const FRESHNESS_MAX = 10;

type Check = { req: MatchRequirement; satisfied: boolean; have: number; countable: boolean; rows: MatchResource[] };

/** Is one requirement met by this hospital? Returns the rows it looked at (for staleness). */
function checkRequirement(req: MatchRequirement, h: MatchHospital, input: MatchInput): Check {
  if (req.isBlood) {
    const donors: BloodGroup[] = input.bloodGroup ? input.compatibleDonors[input.bloodGroup] : ["O_NEG"];
    const rows = h.resources.filter((r) => r.bloodGroup !== null && donors.includes(r.bloodGroup));
    const have = rows.reduce((sum, r) => sum + r.available, 0);
    return { req, satisfied: have >= req.minQuantity, have, countable: true, rows };
  }
  const row = h.resources.find((r) => r.code === req.resourceCode);
  if (!row) return { req, satisfied: false, have: 0, countable: false, rows: [] };
  if (row.kind === "STATUS") return { req, satisfied: row.isAvailable, have: 0, countable: false, rows: [row] };
  return { req, satisfied: row.available >= req.minQuantity, have: row.available, countable: true, rows: [row] };
}

function okReason({ req, have, countable }: Check): Reason {
  return countable
    ? { kind: "ok", bn: `✅ ${req.nameBn} পাওয়া যাচ্ছে (${have}টি)`, en: `✅ ${req.nameEn} available (${have})` }
    : { kind: "ok", bn: `✅ ${req.nameBn} উপলব্ধ`, en: `✅ ${req.nameEn} available` };
}

function unmetReason({ req, have, countable }: Check): Reason {
  const critical = req.level === "CRITICAL";
  const kind = critical ? "missing" : "warn";
  const icon = critical ? "❌" : "⚠️";
  if (countable && have > 0) {
    return {
      kind,
      bn: `${icon} পর্যাপ্ত ${req.nameBn} নেই (দরকার ${req.minQuantity}টি, আছে ${have}টি)`,
      en: `${icon} Not enough ${req.nameEn} (${have} available, ${req.minQuantity} needed)`,
    };
  }
  return { kind, bn: `${icon} ${req.nameBn} এখন পাওয়া যাচ্ছে না`, en: `${icon} ${req.nameEn} not available` };
}

function scoreHospital(h: MatchHospital, input: MatchInput): Omit<RankedHospital, "rank"> {
  const checks = input.requirements.map((req) => checkRequirement(req, h, input));

  const totalWeight = checks.reduce((s, c) => s + WEIGHT[c.req.level], 0);
  const metWeight = checks.reduce((s, c) => s + (c.satisfied ? WEIGHT[c.req.level] : 0), 0);
  const capability = totalWeight === 0 ? CAPABILITY_MAX : (CAPABILITY_MAX * metWeight) / totalWeight;

  const distanceKm = input.origin ? haversineKm(input.origin, h) : null;
  const distance =
    distanceKm === null ? DISTANCE_NO_ORIGIN : DISTANCE_MAX * Math.max(0, 1 - distanceKm / DISTANCE_ZERO_AT_KM);

  const nowMs = input.now.getTime();
  const oldestMs = Math.min(...checks.flatMap((c) => c.rows.map((r) => r.updatedAt.getTime())));
  const stale = nowMs - oldestMs > STALE_AFTER_MS; // Math.min([]) = Infinity -> never stale
  const freshness = stale ? 0 : FRESHNESS_MAX;

  const score = Math.min(100, Math.max(0, Math.round(capability + distance + freshness)));

  const warnings: Reason[] = checks.filter((c) => !c.satisfied && c.req.level === "PREFERRED").map(unmetReason);
  if (stale) {
    const minutes = Math.floor((nowMs - oldestMs) / 60_000);
    warnings.push({
      kind: "warn",
      bn: `⚠️ ${minutes} মিনিট ধরে তথ্য হালনাগাদ হয়নি`,
      en: `⚠️ Data not updated for ${minutes} min`,
    });
  }
  if (input.bloodGroup === null && checks.some((c) => c.req.isBlood)) {
    warnings.push({
      kind: "warn",
      bn: "⚠️ রক্তের গ্রুপ জানা নেই — শুধু O− গণনা করা হয়েছে",
      en: "⚠️ Blood group unknown — counting O− only",
    });
  }

  const reasons = [
    ...checks.filter((c) => !c.satisfied && c.req.level === "CRITICAL").map(unmetReason),
    ...warnings,
    ...checks.filter((c) => c.satisfied).map(okReason),
  ];

  const updatedMs = h.resources.map((r) => r.updatedAt.getTime());
  return {
    hospitalId: h.id,
    score,
    suitable: checks.every((c) => c.satisfied || c.req.level !== "CRITICAL"),
    distanceKm,
    stale,
    reasons,
    lastUpdatedAt: updatedMs.length ? new Date(Math.max(...updatedMs)) : null,
  };
}

/** Rank hospitals for an emergency: suitable first, then score desc, then distance asc. */
export function rankHospitals(input: MatchInput): RankedHospital[] {
  return input.hospitals
    .map((h) => scoreHospital(h, input))
    .sort(
      (a, b) =>
        Number(b.suitable) - Number(a.suitable) ||
        b.score - a.score ||
        (a.distanceKm ?? 0) - (b.distanceKm ?? 0),
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
