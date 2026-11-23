import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-next";

describe("safeNextPath", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNextPath("/status")).toBe("/status");
    expect(safeNextPath("/reservations?id=1#top")).toBe("/reservations?id=1#top");
    expect(safeNextPath(["/a", "/b"])).toBe("/a");
    expect(safeNextPath("/staff?x=1")).toBe("/staff?x=1");
  });

  it.each([
    undefined, null, "", "status", "https://evil.example", "//evil.example", "/\\evil.example",
    "/\t/evil.example", "/\n/evil.example", " /status", "javascript:alert(1)", "/" + "a".repeat(600),
    // Dot segments normalize to a protocol-relative path inside new URL(): must be caught on the OUTPUT.
    "/.//evil.example", "/a/..//evil.example", "/./%2e/..//evil.example",
  ])("falls back to / for %j", (v) => {
    expect(safeNextPath(v)).toBe("/");
  });
});
