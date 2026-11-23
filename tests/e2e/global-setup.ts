import { execSync } from "node:child_process";
import "dotenv/config";
import type { FullConfig } from "@playwright/test";
import { assertTestDatabaseUrl } from "../support/test-db-guard";

// Pages compiled on first request; warming them avoids dev-server cold-compile reloads mid-test.
const WARM_ROUTES = ["/", "/login", "/signup", "/status", "/find?condition=STROKE", "/first-aid/STROKE"];
// Expected non-200s that still compile code paths used by the specs (proxy 404 / not-found page).
const WARM_STATUS_ROUTES: [string, number][] = [["/first-aid/NOPE", 404]];
// Seeded demo staff (Dhanmondi Care General); used to compile the authenticated staff console.
const WARM_STAFF_PHONE = "01700000011";

/**
 * Local E2E only (playwright.config.ts skips this when BASE_URL is set). Playwright starts the
 * webServer BEFORE globalSetup, so this migrates + seeds the *_test database and then warms routes.
 * The seed runs in a tsx child process (prisma/seed.ts -> runSeed) because the generated
 * Prisma client is ESM (`import.meta`), which Playwright's CJS config loader can't import.
 */
export default async function globalSetup(config: FullConfig) {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  // dotenv never overrides an already-set variable, so the child processes use the *_test DB.
  const env = { ...process.env, DATABASE_URL: url, SEED_RESET_STOCK: "1" };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });

  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  for (const route of WARM_ROUTES) {
    const res = await fetch(new URL(route, baseURL));
    if (!res.ok) throw new Error(`Warm-up of ${route} failed with HTTP ${res.status}`);
    await res.text();
  }
  for (const [route, status] of WARM_STATUS_ROUTES) {
    const res = await fetch(new URL(route, baseURL));
    if (res.status !== status) throw new Error(`Warm-up of ${route}: expected HTTP ${status}, got ${res.status}`);
    await res.text();
  }
  await warmStaffConsole(baseURL);
}

/**
 * The staff console is only rendered for a signed-in staff user, so the anonymous warm-up above never
 * compiles it. Without this, the first staff spec pays the cold compile of the proxy's authenticated
 * path + /staff/hospitals/[hospitalId] + its API route in the middle of the full parallel run, and the
 * post-login navigation (login -> /staff 307 -> console) overran its assertion timeout.
 */
async function warmStaffConsole(baseURL: string) {
  const password = process.env.SEED_STAFF_PASSWORD;
  if (!password) throw new Error("SEED_STAFF_PASSWORD must be set (in .env) for the staff E2E warm-up");
  const origin = new URL(baseURL).origin;
  const login = await fetch(new URL("/api/auth/login", baseURL), {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ phone: WARM_STAFF_PHONE, password }),
  });
  if (!login.ok) throw new Error(`Warm-up login failed with HTTP ${login.status}`);
  await login.text();
  const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const get = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(new URL(path, baseURL), { redirect: "manual", ...init, headers: { cookie, ...init.headers } });
    await res.text();
    return res;
  };

  const entry = await get("/staff");
  const consolePath = entry.headers.get("location");
  if (entry.status !== 307 || !consolePath) throw new Error(`Warm-up of /staff: expected a 307, got ${entry.status}`);
  const page = await get(consolePath);
  if (!page.ok) throw new Error(`Warm-up of ${consolePath} failed with HTTP ${page.status}`);
  const hospitalId = new URL(consolePath, baseURL).pathname.split("/").pop()!;
  const api = await get(`/api/staff/hospitals/${hospitalId}/resources`);
  if (!api.ok) throw new Error(`Warm-up of the staff resources API failed with HTTP ${api.status}`);
  // Compiles the PATCH route without changing data: an invalid body is rejected with 400 before any write.
  const patch = await get("/api/staff/resources/warm-up", {
    method: "PATCH", headers: { origin, "content-type": "application/json" }, body: "{}",
  });
  if (patch.status !== 400) throw new Error(`Warm-up of the staff PATCH API: expected HTTP 400, got ${patch.status}`);
  await get("/api/auth/logout", { method: "POST", headers: { origin } });
}
