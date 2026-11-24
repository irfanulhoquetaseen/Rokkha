// Burst coalescer for snapshot refetches: debounced, single flight, and at most one trailing
// run when triggered while a run is in flight. Keeps a burst of 20 socket events from turning
// into 20 HTTP requests on a slow phone connection.

export type Coalescer = { trigger(): void; cancel(): void };

export function createCoalescer(fn: () => Promise<void>, delayMs = 300): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let pending = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };

  async function run() {
    timer = null;
    running = true;
    try {
      await fn();
    } catch {
      // The caller owns error reporting; a failed refetch must not wedge the coalescer.
    } finally {
      running = false;
    }
    if (pending) {
      pending = false;
      schedule();
    }
  }

  return {
    trigger() {
      if (running) pending = true;
      else schedule();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
