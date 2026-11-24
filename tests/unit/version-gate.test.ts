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

describe("version gate snapshots", () => {
  it("older snapshot after a newer event is ignored", () => {
    const gate = createVersionGate();
    expect(gate.accept("r1", 9)).toBe(true); // live event arrives first
    expect(gate.snapshot("r1", 8)).toBe(false); // slower snapshot fetch must not roll back
    gate.set("r1", 8);
    expect(gate.accept("r1", 9)).toBe(false); // set() never lowers the held version
  });

  it("accepts a snapshot row with an equal or newer version", () => {
    const gate = createVersionGate();
    expect(gate.snapshot("r1", 3)).toBe(true); // unknown id
    expect(gate.snapshot("r1", 3)).toBe(true); // same version: same data, safe to apply
    expect(gate.snapshot("r1", 4)).toBe(true);
    expect(gate.accept("r1", 4)).toBe(false);
  });
});
