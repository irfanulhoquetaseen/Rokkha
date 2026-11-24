import { expect, test, type Page } from "@playwright/test";
import { CONDITIONS } from "../../prisma/data/conditions";
import { finder } from "@/lib/i18n/finder";

// Public pages: no login anywhere in this file. UI defaults to Bangla (no `lang` cookie).

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

for (const c of CONDITIONS) {
  test(`/find?condition=${c.code} shows ranked hospitals, first aid and the directory`, async ({ page }) => {
    await page.goto(`/find?condition=${c.code}`);

    const cards = page.getByTestId("hospital-card");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toHaveAttribute("data-rank", "1");
    expect(await cards.first().getByTestId("reason").count()).toBeGreaterThan(0);

    const firstAid = page.getByTestId("first-aid-card");
    await expect(firstAid).toBeVisible();
    await expect(firstAid.locator('a[href="tel:999"]')).toBeVisible();
    await expect(firstAid.getByTestId("first-aid-source")).toHaveAttribute("href", /^https:\/\//);
    await expect(firstAid.getByText(finder.disclaimer.bn)).toBeVisible();
    await expect(firstAid.getByText(finder.disclaimer.en)).toBeVisible();

    await expect(page.getByRole("heading", { name: finder.directoryTitle.bn })).toBeVisible();
    await expect(page.getByText("DEMO DATA — not real hospital availability")).toBeVisible();
  });
}

test("demo hospitals never expose a tel: link; only Call 999 dials", async ({ page }) => {
  await page.goto("/find?condition=STROKE");
  await expect(page.getByTestId("hospital-card").first()).toBeVisible();
  await expect(page.locator('a[href^="tel:"]:not([href="tel:999"])')).toHaveCount(0);
  expect(await page.locator('a[href="tel:999"]').count()).toBeGreaterThanOrEqual(1);
  const demo = page.getByTestId("demo-phone").first();
  await expect(demo).toContainText("DEMO");
  const btn = demo.locator("button");
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute("title", "Demo hospital — calling disabled");
});

test("home → tap Stroke lands on the stroke results", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('a[href="tel:999"]').first()).toBeVisible();
  await page.getByRole("link", { name: "স্ট্রোক", exact: true }).click();
  await expect(page).toHaveURL(/\/find\?condition=STROKE$/);
  await expect(page.getByTestId("hospital-card").first()).toHaveAttribute("data-rank", "1");
});

test("unknown condition shows the condition picker and a notice", async ({ page }) => {
  await page.goto("/find?condition=FOO");
  await expect(page.getByTestId("notice").filter({ hasText: finder.unknownCondition.bn })).toBeVisible();
  await expect(page.getByRole("link", { name: "স্ট্রোক", exact: true })).toBeVisible();
  await expect(page.getByTestId("hospital-card")).toHaveCount(0);
});

test("type=GOVT shows only government hospitals", async ({ page }) => {
  await page.goto("/find?condition=SNAKEBITE&type=GOVT");
  const badges = page.getByTestId("hospital-card").getByTestId("type-badge");
  await expect(badges.first()).toBeVisible();
  const texts = await badges.allTextContents();
  expect(texts.length).toBeGreaterThan(0);
  for (const t of texts) expect(t.trim()).toBe(finder.govt.bn);
});

test("filter form submits as a GET and keeps the condition", async ({ page }) => {
  await page.goto("/find?condition=DENGUE");
  await page.getByLabel(finder.area.bn).selectOption("mirpur");
  await page.getByLabel(finder.radius.bn).selectOption("10");
  await page.getByRole("button", { name: finder.apply.bn }).click();
  await expect(page).toHaveURL(/condition=DENGUE/);
  await expect(page).toHaveURL(/area=mirpur/);
  const first = page.getByTestId("hospital-card").first();
  await expect(first).toBeVisible();
  await expect(first.getByTestId("distance")).toContainText(/km|কিমি/);
});

test("resource filter is a labelled select carried in the GET URL; unknown code shows a notice", async ({ page }) => {
  await page.goto("/find?condition=STROKE");
  await page.getByLabel(finder.resource.bn).selectOption("ICU_BED");
  await page.getByRole("button", { name: finder.apply.bn }).click();
  await expect(page).toHaveURL(/resource=ICU_BED/);
  await expect(page.getByTestId("hospital-card").first()).toBeVisible();
  await expect(page.getByLabel(finder.resource.bn)).toHaveValue("ICU_BED");

  await page.goto("/find?condition=STROKE&resource=NOPE_RESOURCE");
  await expect(page.getByTestId("notice").filter({ hasText: finder.resourceIgnored.bn })).toBeVisible();
  await expect(page.getByTestId("hospital-card").first()).toBeVisible();
});

test("empty result suggests widening the radius", async ({ page }) => {
  // Rajshahi centre + 5 km + PRIVATE: the only private hospital that close is directory-only (no live data) → no ranked results.
  await page.goto("/find?condition=HEART_ATTACK&area=rajshahi&radius=5&type=PRIVATE");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page.getByRole("link", { name: finder.clearFilters.bn })).toBeVisible();
});

test("radius without a location shows a notice", async ({ page }) => {
  await page.goto("/find?condition=STROKE&radius=10");
  await expect(page.getByTestId("notice").filter({ hasText: finder.radiusIgnored.bn })).toBeVisible();
});

test("full first-aid page shows do's, don'ts, Call 999 and the source", async ({ page }) => {
  await page.goto("/first-aid/SNAKEBITE");
  const card = page.getByTestId("first-aid-card");
  await expect(card.getByRole("heading", { name: `✅ ${finder.dos.bn}`, exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: `❌ ${finder.donts.bn}`, exact: true })).toBeVisible();
  await expect(card.locator('a[href="tel:999"]')).toBeVisible();
  await expect(card.getByTestId("first-aid-source")).toHaveAttribute("href", /^https:\/\//);
});

test("first aid for an unknown or malformed condition is a real HTTP 404; a known one is 200", async ({ request, page }) => {
  for (const path of ["/first-aid/NOPE", "/first-aid/bad%20code", `/first-aid/${"X".repeat(65)}`]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
  expect((await request.get("/first-aid/STROKE", { maxRedirects: 0 })).status()).toBe(200);
  const res = await page.goto("/first-aid/NOPE");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("no horizontal scroll on home, finder and first aid", async ({ page }) => {
  for (const url of ["/", "/find?condition=TRAUMA&area=dhanmondi", "/find", "/first-aid/PREGNANCY"]) {
    await page.goto(url);
    await expect(page.locator("main")).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});
