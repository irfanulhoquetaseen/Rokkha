import { describe, expect, it } from "vitest";
import { haversineKm, isValidCoord } from "@/server/matching";

describe("haversineKm", () => {
  it("Dhaka to Chattogram is about 213 km", () => {
    const d = haversineKm({ lat: 23.8103, lng: 90.4125 }, { lat: 22.3569, lng: 91.7832 });
    expect(Math.abs(d - 213)).toBeLessThanOrEqual(3);
  });

  it("same point is 0", () => {
    expect(haversineKm({ lat: 23.8103, lng: 90.4125 }, { lat: 23.8103, lng: 90.4125 })).toBe(0);
  });
});

describe("isValidCoord", () => {
  it("rejects out-of-range and non-finite values", () => {
    expect(isValidCoord({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoord({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidCoord({ lat: Number.NaN, lng: 0 })).toBe(false);
  });

  it("accepts a valid coordinate", () => {
    expect(isValidCoord({ lat: 23.8103, lng: 90.4125 })).toBe(true);
    expect(isValidCoord({ lat: -90, lng: 180 })).toBe(true);
  });
});
