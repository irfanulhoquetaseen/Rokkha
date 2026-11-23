import { describe, expect, it } from "vitest";
import {
  rankHospitals,
  type BloodGroup,
  type MatchHospital,
  type MatchInput,
  type MatchRequirement,
  type MatchResource,
} from "@/server/matching";

const NOW = new Date("2026-11-24T10:00:00Z");
const ORIGIN = { lat: 23.8103, lng: 90.4125 };

/** Recipient -> donors (red-cell compatibility). */
const DONORS: Record<BloodGroup, BloodGroup[]> = {
  O_NEG: ["O_NEG"],
  O_POS: ["O_POS", "O_NEG"],
  A_NEG: ["A_NEG", "O_NEG"],
  A_POS: ["A_POS", "A_NEG", "O_POS", "O_NEG"],
  B_NEG: ["B_NEG", "O_NEG"],
  B_POS: ["B_POS", "B_NEG", "O_POS", "O_NEG"],
  AB_NEG: ["AB_NEG", "A_NEG", "B_NEG", "O_NEG"],
  AB_POS: ["AB_POS", "AB_NEG", "A_POS", "A_NEG", "B_POS", "B_NEG", "O_POS", "O_NEG"],
};

function countable(code: string, available: number, extra: Partial<MatchResource> = {}): MatchResource {
  return {
    code, kind: "COUNTABLE", available, total: Math.max(available, 10), isAvailable: available > 0,
    updatedAt: NOW, bloodGroup: null, nameBn: `${code}-bn`, nameEn: code, ...extra,
  };
}
function status(code: string, on: boolean, extra: Partial<MatchResource> = {}): MatchResource {
  return {
    code, kind: "STATUS", available: 0, total: 0, isAvailable: on,
    updatedAt: NOW, bloodGroup: null, nameBn: `${code}-bn`, nameEn: code, ...extra,
  };
}
function blood(group: BloodGroup, available: number): MatchResource {
  return countable(`BLOOD_${group}`, available, { bloodGroup: group });
}
function req(resourceCode: string, level: "CRITICAL" | "PREFERRED", minQuantity = 1): MatchRequirement {
  return { resourceCode, isBlood: false, level, minQuantity, nameBn: `${resourceCode}-বাংলা`, nameEn: resourceCode };
}
const BLOOD_REQ: MatchRequirement = {
  resourceCode: null, isBlood: true, level: "CRITICAL", minQuantity: 1, nameBn: "রক্ত", nameEn: "Blood",
};
function hospital(id: string, resources: MatchResource[], lat = ORIGIN.lat, lng = ORIGIN.lng): MatchHospital {
  return { id, lat, lng, resources };
}
function input(partial: Partial<MatchInput>): MatchInput {
  return {
    requirements: [], bloodGroup: null, origin: ORIGIN, now: NOW, hospitals: [],
    compatibleDonors: DONORS, ...partial,
  };
}
function only<T>(arr: T[]): T {
  expect(arr).toHaveLength(1);
  return arr[0] as T;
}

const STROKE = [req("CT_SCAN", "CRITICAL"), req("ICU_BED", "CRITICAL"), req("NEUROLOGIST", "PREFERRED")];

describe("rankHospitals", () => {
  it("all criticals satisfied -> suitable with ✅ reasons", () => {
    const r = only(rankHospitals(input({
      requirements: STROKE,
      hospitals: [hospital("h1", [status("CT_SCAN", true), countable("ICU_BED", 3), status("NEUROLOGIST", true)])],
    })));
    expect(r.suitable).toBe(true);
    expect(r.score).toBe(100);
    expect(r.reasons.every((x) => x.kind === "ok")).toBe(true);
    expect(r.reasons.map((x) => x.en)).toContain("✅ ICU_BED available (3)");
    expect(r.reasons.every((x) => x.bn.startsWith("✅") && x.en.startsWith("✅"))).toBe(true);
  });

  it("one critical missing -> not suitable and ranked after a lower-scoring suitable hospital", () => {
    const out = rankHospitals(input({
      requirements: STROKE,
      hospitals: [
        // near, has everything except CT scan (critical)
        hospital("near-no-ct", [status("CT_SCAN", false), countable("ICU_BED", 5), status("NEUROLOGIST", true)]),
        // far, no neurologist, stale -> low score but suitable
        hospital("far-ok", [
          status("CT_SCAN", true, { updatedAt: new Date(NOW.getTime() - 60 * 60_000) }),
          countable("ICU_BED", 1), status("NEUROLOGIST", false),
        ], 24.5, 91.0),
      ],
    }));
    const [first, second] = out;
    expect(first?.hospitalId).toBe("far-ok");
    expect(second?.hospitalId).toBe("near-no-ct");
    expect(second?.suitable).toBe(false);
    expect(second!.score).toBeGreaterThan(first!.score);
    expect(second?.reasons[0]?.kind).toBe("missing");
    expect(second?.reasons[0]?.en.startsWith("❌")).toBe(true);
  });

  it("missing preferred lowers score vs identical hospital that has it", () => {
    const out = rankHospitals(input({
      requirements: STROKE,
      hospitals: [
        hospital("no-neuro", [status("CT_SCAN", true), countable("ICU_BED", 3), status("NEUROLOGIST", false)]),
        hospital("with-neuro", [status("CT_SCAN", true), countable("ICU_BED", 3), status("NEUROLOGIST", true)]),
      ],
    }));
    expect(out[0]?.hospitalId).toBe("with-neuro");
    expect(out[1]?.suitable).toBe(true);
    expect(out[1]!.score).toBeLessThan(out[0]!.score);
    expect(out[1]?.reasons[0]?.kind).toBe("warn");
    expect(out[1]?.reasons[0]?.en.startsWith("⚠️")).toBe(true);
  });

  it("stale requirement rows -> stale, freshness 0, ⚠️ reason with minutes", () => {
    const old = new Date(NOW.getTime() - 45 * 60_000);
    const r = only(rankHospitals(input({
      requirements: [req("ICU_BED", "CRITICAL")],
      hospitals: [hospital("h", [countable("ICU_BED", 2, { updatedAt: old })])],
    })));
    expect(r.stale).toBe(true);
    expect(r.score).toBe(90); // 70 capability + 20 distance + 0 freshness
    const warn = r.reasons.find((x) => x.kind === "warn");
    expect(warn?.en).toContain("45");
    expect(warn?.bn).toContain("45");
  });

  it("rows not used by any requirement do not make a hospital stale", () => {
    const old = new Date(NOW.getTime() - 120 * 60_000);
    const r = only(rankHospitals(input({
      requirements: [req("ICU_BED", "CRITICAL")],
      hospitals: [hospital("h", [countable("ICU_BED", 2), countable("GENERAL_BED", 9, { updatedAt: old })])],
    })));
    expect(r.stale).toBe(false);
    expect(r.score).toBe(100);
  });

  it("nearer hospital outranks a farther identical one", () => {
    const res = () => [countable("ICU_BED", 2)];
    const out = rankHospitals(input({
      requirements: [req("ICU_BED", "CRITICAL")],
      hospitals: [hospital("far", res(), 23.95, 90.4125), hospital("near", res(), 23.82, 90.4125)],
    }));
    expect(out.map((x) => x.hospitalId)).toEqual(["near", "far"]);
    expect(out[0]!.distanceKm!).toBeLessThan(out[1]!.distanceKm!);
  });

  it("origin null -> distanceKm null and both get 10 distance points", () => {
    const out = rankHospitals(input({
      origin: null,
      requirements: [req("ICU_BED", "CRITICAL")],
      hospitals: [hospital("a", [countable("ICU_BED", 2)], 22, 91), hospital("b", [countable("ICU_BED", 2)], 24, 90)],
    }));
    for (const r of out) {
      expect(r.distanceKm).toBeNull();
      expect(r.score).toBe(90); // 70 + 10 + 10
    }
  });

  it("blood: A_NEG recipient with only O_NEG stock is satisfied", () => {
    const r = only(rankHospitals(input({
      bloodGroup: "A_NEG", requirements: [BLOOD_REQ],
      hospitals: [hospital("h", [blood("O_NEG", 2)])],
    })));
    expect(r.suitable).toBe(true);
    expect(r.reasons[0]?.kind).toBe("ok");
  });

  it("blood: A_NEG recipient with only A_POS stock is missing", () => {
    const r = only(rankHospitals(input({
      bloodGroup: "A_NEG", requirements: [BLOOD_REQ],
      hospitals: [hospital("h", [blood("A_POS", 8)])],
    })));
    expect(r.suitable).toBe(false);
    expect(r.reasons[0]?.kind).toBe("missing");
  });

  it("blood: unknown group with only O_POS stock -> missing + unknown-blood warning", () => {
    const r = only(rankHospitals(input({
      bloodGroup: null, requirements: [BLOOD_REQ],
      hospitals: [hospital("h", [blood("O_POS", 8)])],
    })));
    expect(r.suitable).toBe(false);
    expect(r.reasons.map((x) => x.kind)).toEqual(["missing", "warn"]);
    expect(r.reasons[1]?.en).toContain("O−");
  });

  it("minQuantity 2 with available 1 -> missing", () => {
    const r = only(rankHospitals(input({
      requirements: [req("ANTIVENOM", "CRITICAL", 2)],
      hospitals: [hospital("h", [countable("ANTIVENOM", 1)])],
    })));
    expect(r.suitable).toBe(false);
    expect(r.reasons[0]?.kind).toBe("missing");
  });

  it("resource absent from hospital counts as missing", () => {
    const r = only(rankHospitals(input({
      requirements: [req("CATH_LAB", "CRITICAL")],
      hospitals: [hospital("h", [])],
    })));
    expect(r.suitable).toBe(false);
    expect(r.lastUpdatedAt).toBeNull();
  });

  it("no requirements -> capability 70", () => {
    const r = only(rankHospitals(input({ hospitals: [hospital("h", [])] })));
    expect(r.score).toBe(100);
    expect(r.suitable).toBe(true);
  });

  it("scores within 0..100, ranks 1..n contiguous, all reasons bilingual", () => {
    const out = rankHospitals(input({
      bloodGroup: null,
      requirements: [...STROKE, { ...BLOOD_REQ, level: "PREFERRED" }],
      hospitals: [
        hospital("a", [status("CT_SCAN", true), countable("ICU_BED", 3)], 23.9, 90.5),
        hospital("b", [blood("O_NEG", 1), status("NEUROLOGIST", true)], 25, 92),
        hospital("c", [countable("ICU_BED", 0, { updatedAt: new Date(NOW.getTime() - 90 * 60_000) })], 23.81, 90.41),
        hospital("d", [status("CT_SCAN", true), countable("ICU_BED", 1), status("NEUROLOGIST", true), blood("O_NEG", 4)]),
      ],
    }));
    expect(out.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
    for (const r of out) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.score)).toBe(true);
      for (const reason of r.reasons) {
        expect(reason.bn.length).toBeGreaterThan(0);
        expect(reason.en.length).toBeGreaterThan(0);
      }
    }
  });
});
