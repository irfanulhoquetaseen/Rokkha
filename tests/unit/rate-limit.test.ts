import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, envLimit } from "@/server/auth/rate-limit";

describe("createRateLimiter (fixed window)", () => {
  it("allows `limit` hits then blocks with a positive retryAfterSec", () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, now: () => t });
    for (let i = 0; i < 5; i++) expect(rl.hit("k").allowed).toBe(true);
    t += 10_000;
    const sixth = rl.hit("k");
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterSec).toBe(50);
  });

  it("rolls over to a fresh window after windowMs", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => t });
    rl.hit("k");
    rl.hit("k");
    expect(rl.hit("k").allowed).toBe(false);
    t = 1_000;
    expect(rl.hit("k")).toEqual({ allowed: true, retryAfterSec: 0 });
  });

  it("keeps keys independent and reset clears one key", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(rl.hit("a").allowed).toBe(true);
    expect(rl.hit("a").allowed).toBe(false);
    expect(rl.hit("b").allowed).toBe(true);
    rl.reset("a");
    expect(rl.hit("a").allowed).toBe(true);
    expect(rl.hit("b").allowed).toBe(false);
  });

  it("flags only the first blocked hit of a window as firstBlock", () => {
    const rl = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 0 });
    expect(rl.hit("k").firstBlock).toBeFalsy();
    expect(rl.hit("k").firstBlock).toBeFalsy();
    expect(rl.hit("k")).toMatchObject({ allowed: false, firstBlock: true });
    expect(rl.hit("k")).toMatchObject({ allowed: false, firstBlock: false });
  });
});

describe("envLimit", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("parses positive ints and falls back on missing/invalid values", () => {
    expect(envLimit("JS_TEST_LIMIT", 5)).toBe(5);
    vi.stubEnv("JS_TEST_LIMIT", "12");
    expect(envLimit("JS_TEST_LIMIT", 5)).toBe(12);
    for (const bad of ["0", "-3", "abc", "1.5", "", " "]) {
      vi.stubEnv("JS_TEST_LIMIT", bad);
      expect(envLimit("JS_TEST_LIMIT", 5)).toBe(5);
    }
  });
});
