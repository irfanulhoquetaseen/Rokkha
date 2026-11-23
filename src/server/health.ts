export type HealthReport = {
  status: "ok" | "degraded";
  db: "up" | "down";
  time: string;
};

/**
 * Runs a DB probe with a timeout and reports the result.
 * The probe is injected so the logic is testable; the API route passes a real `SELECT 1`.
 */
export async function checkHealth(
  probe: () => Promise<unknown>,
  now: () => Date = () => new Date(),
  timeoutMs = 3000,
): Promise<HealthReport> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("db probe timed out")), timeoutMs);
  });
  let db: HealthReport["db"] = "up";
  try {
    await Promise.race([probe(), timeout]);
  } catch {
    db = "down";
  } finally {
    clearTimeout(timer);
  }
  return { status: db === "up" ? "ok" : "degraded", db, time: now().toISOString() };
}
