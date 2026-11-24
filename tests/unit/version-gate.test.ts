import { describe, expect, it } from "vitest";
import { createVersionGate } from "@/components/realtime/version-gate";

describe("version gate", () => {
  it("ignores stale versions", () => {
    const gate = createVersionGate();
    expect(gate.accept("r1", 5)).toBe(true);
    expect(gate.accept("r1", 4)).toBe(false);
    expect(gate.accept("r1", 5)).toBe(false);
    expect(gate.accept("r1", 6)).toBe(true);
  });

  it("tracks each entity independently", () => {
    const gate = createVersionGate();
    expect(gate.accept("a", 3)).toBe(true);
    expect(gate.accept("b", 1)).toBe(true);
    expect(gate.accept("a", 2)).toBe(false);
  });

  it("set() seeds the gate from a snapshot", () => {
    const gate = createVersionGate();
    gate.set("r1", 7);
    expect(gate.accept("r1", 7)).toBe(false);
    expect(gate.accept("r1", 8)).toBe(true);
  });
});
