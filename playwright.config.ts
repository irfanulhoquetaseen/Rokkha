import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";
import { assertTestDatabaseUrl } from "./tests/support/test-db-guard";

// E2E runs against BASE_URL when set (e.g. the live Railway URL). Otherwise it boots a FRESH local
// dev server on port 3100 wired to the *_test database — local E2E never touches the live DB, and a
// dev server already running on 3000 (live DB) is never reused by accident.
const externalBaseURL = process.env.BASE_URL;
const LOCAL_PORT = Number(process.env.E2E_PORT ?? 3100); // per-worktree override so parallel tracks never collide
const E2E_DIST_DIR = ".next-e2e";
const baseURL = externalBaseURL ?? `http://localhost:${LOCAL_PORT}`;

function localWebServer() {
  const testDbUrl = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  return {
    // Start from an empty dist dir: a Turbopack dev cache left by an earlier run (after source edits)
    // was observed to put browsers into an HMR full-reload loop. Cold compile costs a few seconds.
    command: `node -e "require('fs').rmSync('${E2E_DIST_DIR}', { recursive: true, force: true })" && npm run dev`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    // Safe because dotenv (server.ts) and Next's env loading never override a variable that is
    // already set: this DATABASE_URL (the *_test DB) wins over the one in .env.
    env: {
      DATABASE_URL: testDbUrl,
      PORT: String(LOCAL_PORT),
      // Separate Next dist dir: Next 16 refuses a 2nd dev server sharing .next/dev (lockfile).
      NEXT_DIST_DIR: E2E_DIST_DIR,
      // All parallel E2E workers share one IP; keep the per-phone login limit at its default.
      LOGIN_LIMIT_PER_IP: "1000",
      SIGNUP_LIMIT_PER_IP: "1000",
    },
  };
}

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 800 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  globalSetup: externalBaseURL ? undefined : "./tests/e2e/global-setup.ts",
  webServer: externalBaseURL ? undefined : localWebServer(),
});
