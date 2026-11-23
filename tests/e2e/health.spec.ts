import { expect, test } from "@playwright/test";

test("health endpoint reports the database is up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string; db: string; time: string };
  expect(body.db).toBe("up");
  expect(body.status).toBe("ok");
  expect(Number.isNaN(Date.parse(body.time))).toBe(false);
});

test("home page shows API health and a live Socket.io connection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("api-health")).toHaveText("ok (db up)");
  await expect(page.getByTestId("socket-status")).toHaveText("connected", { timeout: 15_000 });
});
