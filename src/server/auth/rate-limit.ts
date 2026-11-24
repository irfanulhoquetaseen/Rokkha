/**
 * In-memory fixed-window rate limiter.
 * JibonSetu runs as a single long-lived Node process (one Railway instance), so process memory
 * is the whole truth. Scaling to several instances would need a shared store (Postgres/Redis).
 */
export type RateLimiter = {
  /** `firstBlock` is true only on the first rejected hit of a window (count === limit + 1). */
  hit(key: string): { allowed: boolean; retryAfterSec: number; firstBlock?: boolean };
  reset(key: string): void;
};

export function createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const { limit, windowMs, now = Date.now } = opts;
  const windows = new Map<string, { start: number; count: number }>();

  return {
    hit(key) {
      const t = now();
      let w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        // Drop expired windows opportunistically so the map can't grow without bound.
        if (windows.size > 10_000) {
          for (const [k, v] of windows) if (t - v.start >= windowMs) windows.delete(k);
        }
        w = { start: t, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      if (w.count <= limit) return { allowed: true, retryAfterSec: 0 };
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)),
        firstBlock: w.count === limit + 1,
      };
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

/** Positive integer from env, else the default (invalid values never disable limiting). */
export function envLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

const MIN = 60 * 1000;
export const loginLimiterByPhone = createRateLimiter({ limit: envLimit("LOGIN_LIMIT_PER_PHONE", 5), windowMs: 15 * MIN });
export const loginLimiterByIp = createRateLimiter({ limit: envLimit("LOGIN_LIMIT_PER_IP", 30), windowMs: 15 * MIN });
export const signupLimiterByIp = createRateLimiter({ limit: envLimit("SIGNUP_LIMIT_PER_IP", 10), windowMs: 60 * MIN });
export const reserveLimiterByUser = createRateLimiter({ limit: envLimit("RESERVE_LIMIT_PER_USER", 20), windowMs: 60_000 });
