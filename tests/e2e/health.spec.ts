import { expect, test } from "@playwright/test";

test("health endpoint reports the database is up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string; db: string; time: string };
  expect(body.db).toBe("up");
  expect(body.status).toBe("ok");
  expect(Number.isNaN(Date.parse(body.time))).toBe(false);
});

test("status page shows API health and a live Socket.io connection", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("api-health")).toHaveText("ok (db up)");
  await expect(page.getByTestId("socket-status")).toHaveText("connected", { timeout: 15_000 });
});

test("Demo pill badge is visible at the top of every page and opens its popover", async ({ page }) => {
  for (const path of ["/", "/login", "/signup", "/status"]) {
    await page.goto(path);
    const badge = page.getByTestId("demo-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("ডেমো");
    const box = await badge.boundingBox();
    expect(box?.y).toBeLessThan(80);
  }
  await page.getByTestId("demo-badge").click();
  await expect(page.getByTestId("demo-popover")).toContainText("এই হাসপাতালগুলো কাল্পনিক");
});
