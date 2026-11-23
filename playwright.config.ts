import { defineConfig, devices } from "@playwright/test";

// E2E runs against BASE_URL when set (e.g. the live Railway URL); otherwise it boots the local dev server.
const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

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
  webServer: process.env.BASE_URL
    ? undefined
    : { command: "npm run dev", url: `${baseURL}/api/health`, reuseExistingServer: true, timeout: 120_000 },
});
