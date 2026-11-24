import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoalescer } from "@/components/realtime/coalesce";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("coalescer", () => {
  it("coalesces bursts", async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 300);
    for (let i = 0; i < 20; i++) {
      c.trigger();
      await vi.advanceTimersByTimeAsync(5); // 20 triggers within 100 ms
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("runs exactly one trailing call when triggered during a run", async () => {
    let release!: () => void;
    let calls = 0;
    const fn = vi.fn(() => {
      calls++;
      return calls === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    });
    const c = createCoalescer(fn, 300);
    c.trigger();
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(1); // in flight

    c.trigger();
    c.trigger();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(1); // single flight: no overlap

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2); // exactly one trailing run
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel() drops a pending run", async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 300);
    c.trigger();
    c.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("keeps working after fn rejects", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("net")).mockResolvedValue(undefined);
    const c = createCoalescer(fn, 300);
    c.trigger();
    await vi.advanceTimersByTimeAsync(300);
    c.trigger();
    await vi.advanceTimersByTimeAsync(300);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("maxWait: a steady stream of triggers still runs (at least every ~1 s)", async () => {
    const fn = vi.fn(async () => {});
    const c = createCoalescer(fn, 300, 1000);
    for (let t = 0; t < 3000; t += 200) {
      c.trigger();
      await vi.advanceTimersByTimeAsync(200); // never 300 ms quiet: a pure debounce would never fire
    }
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fn.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
