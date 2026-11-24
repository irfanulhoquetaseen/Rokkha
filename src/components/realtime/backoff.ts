/** Exponential backoff: base * 2^attempt, capped at maxMs. `attempt` starts at 0. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** attempt);
}
