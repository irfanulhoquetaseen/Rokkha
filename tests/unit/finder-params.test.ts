import { describe, expect, it } from "vitest";
import { AREAS } from "@/server/finder/areas";
import { parseFinderParams } from "@/server/finder/params";

describe("parseFinderParams", () => {
  it("defaults when empty", () => {
    const { params, notices } = parseFinderParams({});
    expect(params).toEqual({ sort: "score", page: 1 });
    expect(notices).toEqual([]);
  });
  it("accepts valid values", () => {
    const { params, notices } = parseFinderParams({ condition: "STROKE", blood: "O_NEG", lat: "23.7", lng: "90.4", radius: "25", type: "GOVT", free: "1", sort: "distance", page: "3" });
    expect(params).toMatchObject({ condition: "STROKE", blood: "O_NEG", lat: 23.7, lng: 90.4, radius: 25, type: "GOVT", free: true, sort: "distance", page: 3 });
    expect(notices).toEqual([]);
  });
  it("drops an invalid blood group with a notice", () => {
    const { params, notices } = parseFinderParams({ blood: "X_POS" });
    expect(params.blood).toBeUndefined();
    expect(notices).toHaveLength(1);
    expect(notices[0].bn).toBeTruthy();
    expect(notices[0].en).toBeTruthy();
  });
  it("drops both coordinates when lat is out of range", () => {
    const { params, notices } = parseFinderParams({ lat: "999", lng: "90" });
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
    expect(notices).toHaveLength(1);
  });
  it("drops coordinates when only one is given", () => {
    const { params, notices } = parseFinderParams({ lat: "23.7" });
    expect(params.lat).toBeUndefined();
    expect(notices).toHaveLength(1);
  });
  it("resolves an area to coordinates", () => {
    const { params } = parseFinderParams({ area: "dhanmondi" });
    const a = AREAS.find((x) => x.id === "dhanmondi")!;
    expect(params).toMatchObject({ area: "dhanmondi", lat: a.lat, lng: a.lng });
  });
  it("ignores unknown area with notice", () => {
    const { params, notices } = parseFinderParams({ area: "nowhere" });
    expect(params.lat).toBeUndefined();
    expect(notices).toHaveLength(1);
  });
  it("resets a bad page to 1 and drops bad radius/type/sort/free", () => {
    const { params, notices } = parseFinderParams({ page: "-2", radius: "7", type: "X", sort: "foo", free: "yes" });
    expect(params).toEqual({ sort: "score", page: 1 });
    expect(notices).toHaveLength(5);
  });
  it("emits notices for non-numeric radius and page", () => {
    const { params, notices } = parseFinderParams({ radius: "abc", page: "x" });
    expect(params).toEqual({ sort: "score", page: 1 });
    expect(notices).toHaveLength(2);
  });
  it("takes the first value of repeated params", () => {
    expect(parseFinderParams({ page: ["2", "5"] }).params.page).toBe(2);
  });
  it("has 10 areas", () => expect(AREAS).toHaveLength(10));
});
