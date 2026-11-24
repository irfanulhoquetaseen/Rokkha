import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { auth } from "@/lib/i18n/auth";
import { reservations as t } from "@/lib/i18n/reservations";
import { HOSPITALS } from "../../prisma/data/hospitals";

// Account allocation (global constraints): mobile and desktop run in parallel on one DB and never share holds.
const ACCOUNTS = {
  mobile: { citizen: "01700000021", arranger: "01700000102" },
  desktop: { citizen: "01700000022", arranger: "01700000103" },
} as const;

const DHANMONDI = HOSPITALS.find((h) => h.slug === "dhanmondi-care-general")!;
const KARNAPHULI = HOSPITALS.find((h) => h.slug === "chattogram-karnaphuli-medical")!;

// Finder URLs in canonical form (what finderHref produces), so "back to the same URL" is exact.
const DHAKA_STROKE = "/find?condition=STROKE&area=dhanmondi";
// Seeded last-unit ICU beds: Dhanmondi [6,1] for mobile; Karnaphuli [4,1] (not suitable for STROKE, but
// nearest to Chattogram, so on page 1 when sorted by distance) for desktop.
const SOLD_OUT = {
  mobile: { url: DHAKA_STROKE, hospital: DHANMONDI },
  desktop: { url: "/find?condition=STROKE&area=chattogram&sort=distance", hospital: KARNAPHULI },
} as const;

type Project = keyof typeof ACCOUNTS;
const project = (info: TestInfo = test.info()) => info.project.name as Project;
const baseURL = () => test.info().project.use.baseURL!;
const origin = () => new URL(baseURL()).origin;

// Each project's tests share one citizen: run them in order (one worker per project).
test.describe.configure({ mode: "default" });

function citizenPassword(): string {
  const p = process.env.SEED_CITIZEN_PASSWORD;
  if (!p) throw new Error("SEED_CITIZEN_PASSWORD must be set (in .env) for reservation E2E tests");
  return p;
}

async function login(req: APIRequestContext, phone: string) {
  const res = await req.post("/api/auth/login", { data: { phone, password: citizenPassword() }, headers: { Origin: origin() } });
  expect(res.ok(), `login ${phone}`).toBeTruthy();
}

/** A separate, logged-in API client (its own cookie jar). */
async function apiClient(phone: string): Promise<APIRequestContext> {
  const req = await pwRequest.newContext({ baseURL: baseURL() });
  await login(req, phone);
  return req;
}

type Row = { id: string; status: string; hospital: { id: string }; resource: { code: string } };

async function activeHolds(req: APIRequestContext): Promise<Row[]> {
  const res = await req.get("/api/reservations");
  expect(res.ok()).toBeTruthy();
  const { items } = (await res.json()) as { items: Row[] };
  return items.filter((r) => r.status === "HELD");
}

async function cancelAll(req: APIRequestContext) {
  for (const r of await activeHolds(req)) {
    await req.post(`/api/reservations/${r.id}/cancel`, { headers: { Origin: origin() } });
  }
}

async function reserve(req: APIRequestContext, hospitalId: string, resourceCode: string) {
  return req.post("/api/reservations", {
    data: { hospitalId, resourceCode },
    headers: { Origin: origin(), "Idempotency-Key": randomUUID() },
  });
}

async function hospitalIdBySlug(req: APIRequestContext, slug: string): Promise<string> {
  const res = await req.get(`/api/hospitals/${slug}/stock`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { hospital: { id: string } }).hospital.id;
}

async function stockOf(req: APIRequestContext, slug: string, code: string): Promise<number> {
  const res = await req.get(`/api/hospitals/${slug}/stock`);
  const { resources } = (await res.json()) as { resources: { code: string; available: number }[] };
  return resources.find((r) => r.code === code)!.available;
}

const card = (page: Page, nameBn: string) => page.getByTestId("hospital-card").filter({ hasText: nameBn });
const holdButton = (page: Page, nameBn: string, code: string) =>
  card(page, nameBn).locator(`[data-testid="hold-button"][data-resource="${code}"]`);

let citizen: APIRequestContext;
let arranger: APIRequestContext;

test.beforeEach(async () => {
  citizen = await apiClient(ACCOUNTS[project()].citizen);
  arranger = await apiClient(ACCOUNTS[project()].arranger);
  await cancelAll(citizen);
  await cancelAll(arranger);
});

test.afterEach(async () => {
  // Leave the DB as we found it (re-runnable, and safe against the live URL).
  await cancelAll(arranger);
  await cancelAll(citizen);
  await arranger.dispose();
  await citizen.dispose();
});

test("logged-out hold goes to login and back", async ({ page }) => {
  await page.goto(DHAKA_STROKE);
  const link = card(page, DHANMONDI.nameBn).getByTestId("login-to-hold");
  await expect(link).toHaveText(t.loginToHold.bn);
  await link.click();
  await expect(page).toHaveURL(/\/login\?next=/);
  // Wait for React to attach its submit handler: before hydration the form would submit natively.
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return !!form && Object.keys(form).some((k) => k.startsWith("__reactProps"));
  });

  await page.getByLabel(auth.phone.bn).fill(ACCOUNTS[project()].citizen);
  await page.getByLabel(auth.password.bn).fill(citizenPassword());
  await page.getByRole("button", { name: auth.loginSubmit.bn }).click();

  await expect(page).toHaveURL((u) => u.pathname + u.search === DHAKA_STROKE);
  await expect(holdButton(page, DHANMONDI.nameBn, "GENERAL_BED")).toBeVisible();
  await expect(page.getByTestId("login-to-hold")).toHaveCount(0);
});

test("hold → tracker shows HELD and a countdown → cancel → CANCELLED", async ({ page }) => {
  await login(page.request, ACCOUNTS[project()].citizen);
  await page.goto(DHAKA_STROKE);
  const btn = holdButton(page, DHANMONDI.nameBn, "GENERAL_BED");
  await expect(btn).toContainText("৩০ মিনিটের জন্য হোল্ড করুন");
  await btn.click();

  await expect(page).toHaveURL(/\/reservations\/[^/?]+$/, { timeout: 20_000 });
  const status = page.getByTestId("reservation-status");
  await expect(status).toHaveAttribute("data-status", "HELD");
  const countdown = page.getByTestId("countdown");
  await expect(countdown).toHaveText(/^(২৯|৩০|29|30):[০-৯0-9]{2}$/);
  const first = await countdown.textContent();
  await expect(countdown).not.toHaveText(first!, { timeout: 5_000 }); // it ticks
  await expect(page.getByTestId("timeline-event")).toHaveCount(1);
  await expect(page.getByRole("link", { name: new RegExp(t.firstAidLink.bn) })).toHaveAttribute("href", "/first-aid/STROKE");

  await page.getByTestId("cancel-button").click();
  const confirm = page.getByTestId("cancel-confirm");
  await expect(confirm).toHaveText(t.confirmCancel.bn);
  await expect(page.getByTestId("cancel-keep")).toHaveText(t.keepHold.bn);
  await expect(status).toHaveAttribute("data-status", "HELD"); // the first tap only asks
  await confirm.click();
  await expect(status).toHaveAttribute("data-status", "CANCELLED");
  await expect(page.getByTestId("countdown")).toHaveCount(0);
  await expect(page.getByTestId("cancel-button")).toHaveCount(0);
  await expect(page.getByTestId("timeline-event")).toHaveCount(2);

  // My reservations lists it with its status and a link back.
  await page.goto("/reservations");
  const row = page.getByTestId("reservation-row").first();
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "CANCELLED");
});

test("second hold of the same type shows LIMIT_REACHED", async ({ page }) => {
  await login(page.request, ACCOUNTS[project()].citizen);
  const dhanmondiId = await hospitalIdBySlug(citizen, DHANMONDI.slug);
  expect((await reserve(citizen, dhanmondiId, "GENERAL_BED")).status()).toBe(201);

  await page.goto(DHAKA_STROKE);
  await holdButton(page, DHANMONDI.nameBn, "GENERAL_BED").click();
  const err = card(page, DHANMONDI.nameBn).getByTestId("hold-error");
  await expect(err).toContainText(t.limitSameType.bn);
  await expect(err.getByRole("link", { name: t.seeMyReservations.bn })).toHaveAttribute("href", "/reservations");
  expect(await activeHolds(citizen)).toHaveLength(1);
});

test("sold-out shows alternatives", async ({ page }) => {
  const { url, hospital } = SOLD_OUT[project()];
  await login(page.request, ACCOUNTS[project()].citizen);
  expect(await stockOf(citizen, hospital.slug, "ICU_BED"), "seeded last unit").toBe(1);
  // A stale page = no live connection (with live sync the button would vanish before the click).
  await page.route("**/socket.io/**", (route) => route.abort());

  await page.goto(url);
  const btn = holdButton(page, hospital.nameBn, "ICU_BED");
  await expect(btn).toContainText("১টি বাকি");

  // Someone else takes the last unit while this page is open (its button is now stale).
  const hospitalId = await card(page, hospital.nameBn).getAttribute("data-hospital-id");
  expect((await reserve(arranger, hospitalId!, "ICU_BED")).status()).toBe(201);

  await btn.click();
  const panel = card(page, hospital.nameBn).getByTestId("sold-out-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(t.soldOut.bn);
  expect(await panel.getByTestId("alternative").count()).toBeGreaterThanOrEqual(1);
  await expect(panel.getByTestId("alternative").first().getByTestId("hold-button")).toBeVisible();
  expect(await activeHolds(citizen)).toHaveLength(0);
});

test("double click creates one hold", async ({ page }) => {
  await login(page.request, ACCOUNTS[project()].citizen);
  expect(await activeHolds(citizen)).toHaveLength(0);
  await page.goto(DHAKA_STROKE);
  await holdButton(page, DHANMONDI.nameBn, "GENERAL_BED").dblclick();
  await expect(page).toHaveURL(/\/reservations\/[^/?]+$/, { timeout: 20_000 });
  await expect(page.getByTestId("reservation-status")).toHaveAttribute("data-status", "HELD");
  const holds = await activeHolds(citizen);
  expect(holds).toHaveLength(1);
  expect(page.url()).toContain(holds[0]!.id);
});

const BN = "০১২৩৪৫৬৭৮৯";
/** Seconds left from a "mm:ss" countdown (Bangla or ASCII digits). */
async function secondsLeft(page: Page): Promise<number> {
  const text = (await page.getByTestId("countdown").textContent())!.replace(/[০-৯]/g, (d) => String(BN.indexOf(d)));
  const m = /^(\d{2}):(\d{2})$/.exec(text.trim());
  expect(m, `countdown "${text}"`).not.toBeNull();
  return Number(m![1]) * 60 + Number(m![2]);
}

async function openOwnHold(page: Page): Promise<string> {
  await login(page.request, ACCOUNTS[project()].citizen);
  const dhanmondiId = await hospitalIdBySlug(citizen, DHANMONDI.slug);
  const res = await reserve(citizen, dhanmondiId, "GENERAL_BED");
  expect(res.status()).toBe(201);
  const { reservation } = (await res.json()) as { reservation: { id: string } };
  await page.goto(`/reservations/${reservation.id}`);
  await expect(page.getByTestId("reservation-status")).toHaveAttribute("data-status", "HELD");
  return reservation.id;
}

test("countdown is not inflated after Back (router cache)", async ({ page }) => {
  await openOwnHold(page);
  await page.waitForTimeout(2_000);
  const before = await secondsLeft(page);
  await page.getByRole("link", { name: new RegExp(t.myReservations.bn) }).last().click();
  await expect(page).toHaveURL(/\/reservations$/);
  await page.waitForTimeout(4_000);
  await page.goBack();
  await expect(page.getByTestId("countdown")).toBeVisible();
  // ≥ 4 s passed: the restored page must show less time, never the old render's value.
  await expect.poll(() => secondsLeft(page), { timeout: 3_000 }).toBeLessThanOrEqual(before - 3);
  expect(await secondsLeft(page)).toBeLessThanOrEqual(before);
});

test("an accidental double tap on Cancel keeps the hold", async ({ page }) => {
  await openOwnHold(page);
  const cancel = page.getByTestId("cancel-button");
  await cancel.dblclick();
  // The 2nd tap landed on "Keep hold" (same position), never on the confirm button.
  await expect(cancel).toBeVisible();
  await expect(page.getByTestId("cancel-confirm")).toHaveCount(0);
  await expect(page.getByTestId("reservation-status")).toHaveAttribute("data-status", "HELD");
  expect(await activeHolds(citizen)).toHaveLength(1);
  // Asking and then confirming still cancels, with no waiting.
  await cancel.click();
  await page.getByTestId("cancel-confirm").click();
  await expect(page.getByTestId("reservation-status")).toHaveAttribute("data-status", "CANCELLED");
});

test("foreign tracker is 404", async ({ page }) => {
  const dhanmondiId = await hospitalIdBySlug(arranger, DHANMONDI.slug);
  const res = await reserve(arranger, dhanmondiId, "GENERAL_BED");
  expect(res.status()).toBe(201);
  const { reservation } = (await res.json()) as { reservation: { id: string } };

  await login(page.request, ACCOUNTS[project()].citizen);
  const foreign = await page.goto(`/reservations/${reservation.id}`);
  expect(foreign?.status()).toBe(404);
  await expect(page.getByTestId("reservation-status")).toHaveCount(0);
  const missing = await page.goto("/reservations/does-not-exist");
  expect(missing?.status()).toBe(404);

  // Signed out: a real redirect to login that comes back here.
  await page.context().clearCookies();
  const anon = await page.goto("/reservations");
  expect(anon?.url()).toMatch(/\/login\?next=%2Freservations$/);
});
