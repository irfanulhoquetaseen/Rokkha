import { execSync } from "node:child_process";
import "dotenv/config";
import type { FullConfig } from "@playwright/test";
import { assertTestDatabaseUrl } from "../support/test-db-guard";

// Pages compiled on first request; warming them avoids dev-server cold-compile reloads mid-test.
const WARM_ROUTES = ["/", "/login", "/signup", "/status", "/find?condition=STROKE", "/first-aid/STROKE"];

/**
 * Local E2E only (playwright.config.ts skips this when BASE_URL is set). Playwright starts the
 * webServer BEFORE globalSetup, so this migrates + seeds the *_test database and then warms routes.
 * The seed runs in a tsx child process (prisma/seed.ts -> runSeed) because the generated
 * Prisma client is ESM (`import.meta`), which Playwright's CJS config loader can't import.
 */
export default async function globalSetup(config: FullConfig) {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  const env = { ...process.env, DATABASE_URL: url, DOTENV_OVERRIDE: "false", SEED_RESET_STOCK: "1" };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });

  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  for (const route of WARM_ROUTES) {
    const res = await fetch(new URL(route, baseURL));
    if (!res.ok) throw new Error(`Warm-up of ${route} failed with HTTP ${res.status}`);
    await res.text();
  }
}
