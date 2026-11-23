import { describe, expect, it } from "vitest";
import { checkHealth } from "@/server/health";

describe("checkHealth", () => {
  const fixedNow = () => new Date("2026-11-24T10:00:00.000Z");

  it("reports db up when the probe resolves", async () => {
    const result = await checkHealth(async () => {}, fixedNow);
    expect(result).toEqual({ status: "ok", db: "up", time: "2026-11-24T10:00:00.000Z" });
  });

  it("reports db down (and degraded status) when the probe throws", async () => {
    const result = await checkHealth(async () => {
      throw new Error("connection refused");
    }, fixedNow);
    expect(result).toEqual({ status: "degraded", db: "down", time: "2026-11-24T10:00:00.000Z" });
  });

  it("reports db down when the probe hangs past the timeout", async () => {
    const result = await checkHealth(() => new Promise<void>(() => {}), fixedNow, 20);
    expect(result.db).toBe("down");
  });
});
