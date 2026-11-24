import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { auth } from "@/lib/i18n/auth";
import { staff } from "@/lib/i18n/staff";
import { HOSPITALS } from "../../prisma/data/hospitals";
import { apiLogin as login, newProjectPage, origin } from "./helpers";

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

// mobile and desktop run in parallel against the same DB: each project mutates its OWN Dhanmondi rows.
// Dhanmondi row allocation across specs (no two touch the same row): reservations.spec GENERAL_BED +
// ICU_BED; staff-queue.spec VENTILATOR (mobile) / STRETCHER (desktop); this spec the rows below.
const ROWS = {
  mobile: { step: "CCU_BED", conflict: "OXYGEN_CYLINDER", status: "CT_SCAN" },
  desktop: { step: "NICU_BED", conflict: "PLATELETS", status: "CATH_LAB" },
} as const;
const rowsFor = (info: TestInfo) => ROWS[info.project.name as keyof typeof ROWS];

/** Log in through the API as demo staff; page.request shares the page's cookie jar. */
const apiLogin = (page: Page, phone: string) => login(page, phone, staffPassword());

type ApiRow = { id: string; code: string; kind: "COUNTABLE" | "STATUS"; available: number; total: number; isAvailable: boolean; version: number };

async function apiRow(page: Page, hospitalId: string, code: string): Promise<ApiRow> {
  const res = await page.request.get(`/api/staff/hospitals/${hospitalId}/resources`);
  expect(res.ok()).toBeTruthy();
  const { resources } = (await res.json()) as { resources: ApiRow[] };
  return resources.find((r) => r.code === code)!;
}

const hospitalIdOf = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

// The suite must be idempotent against ANY database (local test DB or the live URL): every test
// records the rows it touches and afterEach undoes exactly what the test did via the versioned PATCH API.
// COUNTABLE rows are restored by the inverse `adjust` of the net delta this test applied — never an
// absolute `set`, which would wipe out holds/releases other specs made on the same row meanwhile.
// STATUS rows (only ever touched by this project) are restored with `status`.
type Touched = { page: Page; hospitalId: string; original: ApiRow; net: number };
const toRestore: Touched[] = [];
async function remember(page: Page, code: string): Promise<Touched> {
  const hospitalId = hospitalIdOf(page);
  const touched: Touched = { page, hospitalId, original: await apiRow(page, hospitalId, code), net: 0 };
  toRestore.push(touched);
  return touched;
}

const RESTORE_ATTEMPTS = 5;
test.afterEach(async () => {
  for (const { page, hospitalId, original: o, net } of toRestore.splice(0)) {
    if (o.kind === "COUNTABLE" && net === 0) continue;
    let restored = false;
    for (let attempt = 0; attempt < RESTORE_ATTEMPTS && !restored; attempt++) {
      const now = await apiRow(page, hospitalId, o.code);
      if (o.kind === "STATUS" && now.isAvailable === o.isAvailable) {
        restored = true;
        break;
      }
      const change = o.kind === "STATUS" ? { op: "status", isAvailable: o.isAvailable } : { op: "adjust", delta: -net };
      const res = await page.request.patch(`/api/staff/resources/${o.id}`, {
        data: { version: now.version, change }, headers: { Origin: origin() },
      });
      if (res.ok()) {
        restored = true;
        break;
      }
      // 409 = someone else (a hold, the other project) bumped the version: re-read and retry.
      expect(res.status(), `restore ${o.code}: ${await res.text()}`).toBe(409);
    }
    if (!restored) throw new Error(`restore ${o.code}: every attempt hit 409 (version kept changing)`);
  }
});

const row = (page: Page, code: string) => page.locator(`[data-code="${code}"]`);

/** + when there is room, otherwise − (so the step is always possible whatever the stock is). */
function stepFor(o: ApiRow): { button: string; delta: 1 | -1 } {
  return o.available < o.total ? { button: staff.increase.bn, delta: 1 } : { button: staff.decrease.bn, delta: -1 };
}
const stepButton = (r: Locator, button: string) => r.getByRole("button", { name: button });

test("logged-out /staff is a real redirect to login", async ({ request }) => {
  const res = await request.get("/staff", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(res.headers().location).toMatch(/\/login\?next=%2Fstaff$/);
});

test("staff logs in, lands on own hospital, and a step persists after reload", async ({ page }, info) => {
  const code = rowsFor(info).step;

  await page.goto("/staff");
  await expect(page).toHaveURL(/\/login\?next=%2Fstaff$/);
  await page.getByLabel(auth.phone.bn).fill(DHANMONDI_STAFF);
  await page.getByLabel(auth.password.bn).fill(staffPassword());
  await page.getByRole("button", { name: auth.loginSubmit.bn }).click();

  // Multi-hop navigation: login POST (bcrypt) -> /staff (proxy 307) -> console RSC render, plus the
  // router.refresh() that re-renders the header. Under the full parallel dev-server run this takes
  // longer than the 5 s default, so give it a realistic budget (the button stays "submitting" meanwhile).
  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(DHANMONDI.nameBn);

  const touched = await remember(page, code);
  const { original } = touched;
  const { button, delta } = stepFor(original);
  const r = row(page, code);
  await expect(r.getByTestId("available")).toHaveText(String(original.available));
  await stepButton(r, button).click();
  await expect(r.getByTestId("available")).toHaveText(String(original.available + delta));
  touched.net += delta;
  await expect(r).toHaveAttribute("aria-busy", "false");

  await page.reload();
  await expect(row(page, code).getByTestId("available")).toHaveText(String(original.available + delta));
});

test("toggling a status switch persists after reload", async ({ page }, info) => {
  const code = rowsFor(info).status;
  await apiLogin(page, DHANMONDI_STAFF);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/);

  const { original } = await remember(page, code);
  const sw = row(page, code).getByRole("switch");
  await expect(sw).toHaveAttribute("aria-checked", String(original.isAvailable));
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(!original.isAvailable));
  await expect(sw).toBeEnabled();

  await page.reload();
  await expect(row(page, code).getByRole("switch")).toHaveAttribute("aria-checked", String(!original.isAvailable));
});

test("another hospital's console is a real 404 and its API PATCH is 404", async ({ page, browser }) => {
  // Find Mirpur's hospital id + one resource as Mirpur staff.
  const mirpur = await newProjectPage(browser);
  await apiLogin(mirpur, MIRPUR_STAFF);
  await mirpur.goto("/staff");
  await expect(mirpur).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  const mirpurId = hospitalIdOf(mirpur);
  const list = (await (await mirpur.request.get(`/api/staff/hospitals/${mirpurId}/resources`)).json()) as { resources: ApiRow[] };
  const target = list.resources.find((x) => x.kind === "COUNTABLE")!;
  await mirpur.context().close();

  await apiLogin(page, DHANMONDI_STAFF);
  expect((await page.request.get(`/staff/hospitals/${mirpurId}`)).status()).toBe(404);
  const nav = await page.goto(`/staff/hospitals/${mirpurId}`);
  expect(nav?.status()).toBe(404);
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await expect(page.locator("[data-code]")).toHaveCount(0);

  // Real version + a same-value set: only the hospital guard can reject it, and the data stays as it was.
  const res = await page.request.patch(`/api/staff/resources/${target.id}`, {
    data: { version: target.version, change: { op: "set", available: target.available, total: target.total } },
    headers: { Origin: origin() },
  });
  expect(res.status()).toBe(404);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
});

test("stale page gets the conflict panel; Reload adopts the other page's value", async ({ page, browser }, info) => {
  const code = rowsFor(info).conflict;
  const pageB = await newProjectPage(browser);
  // A live console follows page A's change (realtime-staff.spec covers that, and the dirty-form conflict).
  // Page B is a console whose live connection is down: the versioned PATCH must still catch it.
  await pageB.route("**/socket.io/**", (route) => route.abort());
  await Promise.all([apiLogin(page, DHANMONDI_STAFF), apiLogin(pageB, DHANMONDI_STAFF)]);
  await Promise.all([page.goto("/staff"), pageB.goto("/staff")]);
  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  await expect(pageB).toHaveURL(/\/staff\/hospitals\/[^/]+$/);

  const touched = await remember(page, code);
  const { original } = touched;
  const { button, delta } = stepFor(original);
  const expected = String(original.available + delta);
  const a = row(page, code);
  const b = row(pageB, code);
  await expect(a.getByTestId("available")).toHaveText(String(original.available));
  await expect(b.getByTestId("available")).toHaveText(String(original.available));

  await stepButton(a, button).click();
  await expect(a.getByTestId("available")).toHaveText(expected);
  touched.net += delta;

  // Page B still holds the old version.
  await stepButton(b, button).click();
  const panel = b.getByRole("alert").filter({ hasText: staff.conflictTitle.bn });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(expected);

  await panel.getByRole("button", { name: staff.reload.bn }).click();
  await expect(panel).toHaveCount(0);
  await expect(b.getByTestId("available")).toHaveText(expected);
  await pageB.context().close();
});
