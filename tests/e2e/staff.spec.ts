import { expect, test, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import { auth } from "@/lib/i18n/auth";
import { staff } from "@/lib/i18n/staff";
import { HOSPITALS } from "../../prisma/data/hospitals";

// Seeded demo staff (prisma seed): 01700000011 → Dhanmondi Care General, 01700000012 → Mirpur Shastho.
const DHANMONDI_STAFF = "01700000011";
const MIRPUR_STAFF = "01700000012";
const DHANMONDI = HOSPITALS.find((h) => h.slug === "dhanmondi-care-general")!;

function staffPassword(): string {
  const p = process.env.SEED_STAFF_PASSWORD;
  if (!p) throw new Error("SEED_STAFF_PASSWORD must be set (in .env) for staff E2E tests");
  return p;
}

// All tests log in as the SAME demo staff phone; the per-phone login limiter (5 in flight before a
// success resets it) would reject a burst of parallel logins. Run this file's tests in order per project
// (≤ 2 concurrent logins per project, ≤ 4 overall).
test.describe.configure({ mode: "default" });

// mobile and desktop run in parallel against the same DB: each project mutates its OWN rows.
const ROWS = {
  mobile: { increment: "CCU_BED", conflict: "VENTILATOR", status: "CT_SCAN" },
  desktop: { increment: "NICU_BED", conflict: "STRETCHER", status: "CATH_LAB" },
} as const;
const rowsFor = (info: TestInfo) => ROWS[info.project.name as keyof typeof ROWS];

/** Log in through the API; page.request shares the page's cookie jar. */
async function apiLogin(page: Page, phone: string) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await page.request.post("/api/auth/login", { data: { phone, password: staffPassword() }, headers: { Origin: origin } });
  expect(res.ok()).toBeTruthy();
}

/** A second, independent browser context with the same device settings as the current project. */
async function newProjectPage(browser: Browser): Promise<Page> {
  const { baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const ctx = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  return ctx.newPage();
}

const row = (page: Page, code: string) => page.locator(`[data-code="${code}"]`);
async function availableOf(r: Locator): Promise<number> {
  return Number((await r.getByTestId("available").textContent())?.trim());
}

test("staff logs in, lands on own hospital, and + persists after reload", async ({ page }, info) => {
  const code = rowsFor(info).increment;

  await page.goto("/staff");
  await expect(page).toHaveURL(/\/login\?next=%2Fstaff$/);
  await page.getByLabel(auth.phone.bn).fill(DHANMONDI_STAFF);
  await page.getByLabel(auth.password.bn).fill(staffPassword());
  await page.getByRole("button", { name: auth.loginSubmit.bn }).click();

  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(DHANMONDI.nameBn);

  const r = row(page, code);
  const before = await availableOf(r);
  await r.getByRole("button", { name: staff.increase.bn }).click();
  await expect(r.getByTestId("available")).toHaveText(String(before + 1));
  await expect(r.getByRole("button", { name: staff.increase.bn })).toBeEnabled();

  await page.reload();
  await expect(row(page, code).getByTestId("available")).toHaveText(String(before + 1));
});

test("toggling a status switch persists after reload", async ({ page }, info) => {
  const code = rowsFor(info).status;
  await apiLogin(page, DHANMONDI_STAFF);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/);

  const sw = row(page, code).getByRole("switch");
  const was = (await sw.getAttribute("aria-checked")) === "true";
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(!was));
  await expect(sw).toBeEnabled();

  await page.reload();
  await expect(row(page, code).getByRole("switch")).toHaveAttribute("aria-checked", String(!was));
});

test("another hospital's console is a 404 page and its API PATCH is 404", async ({ page, browser }) => {
  // Find Mirpur's hospital id + one resource as Mirpur staff.
  const mirpur = await newProjectPage(browser);
  await apiLogin(mirpur, MIRPUR_STAFF);
  await mirpur.goto("/staff");
  await expect(mirpur).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  const mirpurId = new URL(mirpur.url()).pathname.split("/").pop()!;
  const list = (await (await mirpur.request.get(`/api/staff/hospitals/${mirpurId}/resources`)).json()) as {
    resources: { id: string; version: number; kind: string }[];
  };
  const target = list.resources.find((x) => x.kind === "COUNTABLE")!;
  await mirpur.context().close();

  await apiLogin(page, DHANMONDI_STAFF);
  await page.goto(`/staff/hospitals/${mirpurId}`);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.locator("[data-code]")).toHaveCount(0);

  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await page.request.patch(`/api/staff/resources/${target.id}`, {
    data: { version: target.version, change: { op: "adjust", delta: 1 } },
    headers: { Origin: origin },
  });
  expect(res.status()).toBe(404);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
});

test("stale page gets the conflict panel; Reload adopts the other page's value", async ({ page, browser }, info) => {
  const code = rowsFor(info).conflict;
  const pageB = await newProjectPage(browser);
  await Promise.all([apiLogin(page, DHANMONDI_STAFF), apiLogin(pageB, DHANMONDI_STAFF)]);
  await Promise.all([page.goto("/staff"), pageB.goto("/staff")]);
  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  await expect(pageB).toHaveURL(/\/staff\/hospitals\/[^/]+$/);

  const a = row(page, code);
  const b = row(pageB, code);
  const before = await availableOf(a);
  expect(await availableOf(b)).toBe(before);

  await a.getByRole("button", { name: staff.increase.bn }).click();
  await expect(a.getByTestId("available")).toHaveText(String(before + 1));

  // Page B still holds the old version.
  await b.getByRole("button", { name: staff.increase.bn }).click();
  const panel = b.getByRole("alert").filter({ hasText: staff.conflictTitle.bn });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(String(before + 1));

  await panel.getByRole("button", { name: staff.reload.bn }).click();
  await expect(panel).toHaveCount(0);
  await expect(b.getByTestId("available")).toHaveText(String(before + 1));
  await pageB.context().close();
});
