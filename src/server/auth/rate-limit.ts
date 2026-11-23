/**
 * In-memory fixed-window rate limiter.
 * JibonSetu runs as a single long-lived Node process (one Railway instance), so process memory
 * is the whole truth. Scaling to several instances would need a shared store (Postgres/Redis).
 */
export type RateLimiter = {
  hit(key: string): { allowed: boolean; retryAfterSec: number };
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
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((w.start + windowMs - t) / 1000)) };
    },
    reset(key) {
      windows.delete(key);
    },
  };
}

const MIN = 60 * 1000;
export const loginLimiterByPhone = createRateLimiter({ limit: 5, windowMs: 15 * MIN });
export const loginLimiterByIp = createRateLimiter({ limit: 30, windowMs: 15 * MIN });
export const signupLimiterByIp = createRateLimiter({ limit: 10, windowMs: 60 * MIN });
