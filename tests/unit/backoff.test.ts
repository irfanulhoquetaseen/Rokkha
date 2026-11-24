import { describe, expect, it } from "vitest";
import { backoffDelay } from "@/components/realtime/backoff";

describe("backoffDelay", () => {
  it("doubles from the base and caps at the max", () => {
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, 1000, 2000))).toEqual([1000, 2000, 2000, 2000]);
    expect([0, 1, 2].map((a) => backoffDelay(a, 500, 4000))).toEqual([500, 1000, 2000]);
  });
});
