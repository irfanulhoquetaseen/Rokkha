import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { reservations as rt } from "@/lib/i18n/reservations";
import { staff } from "@/lib/i18n/staff";
import { HOSPITALS } from "../../prisma/data/hospitals";

// Account allocation (global constraints): mobile and desktop run in parallel on one DB and never share holds.
const CITIZEN = { mobile: "01700000023", desktop: "01700000101" } as const;
const DHANMONDI_STAFF = "01700000011";
const MIRPUR_STAFF = "01700000012";
const DHANMONDI = HOSPITALS.find((h) => h.slug === "dhanmondi-care-general")!;
const CODE = "GENERAL_BED";

// Both tests use this project's citizen: run them in order.
test.describe.configure({ mode: "default" });

const citizenPhone = (info: TestInfo = test.info()) => CITIZEN[info.project.name as keyof typeof CITIZEN];
const baseURL = () => test.info().project.use.baseURL!;
const origin = () => new URL(baseURL()).origin;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (in .env) for staff queue E2E tests`);
  return v;
}

async function apiClient(phone: string, passwordVar: string): Promise<APIRequestContext> {
  const req = await pwRequest.newContext({ baseURL: baseURL() });
  const res = await req.post("/api/auth/login", { data: { phone, password: env(passwordVar) }, headers: { Origin: origin() } });
  expect(res.ok(), `login ${phone}`).toBeTruthy();
  return req;
}

async function loginPage(page: Page, phone: string) {
  const res = await page.request.post("/api/auth/login", {
    data: { phone, password: env("SEED_STAFF_PASSWORD") }, headers: { Origin: origin() },
  });
  expect(res.ok()).toBeTruthy();
}

async function stock(req: APIRequestContext): Promise<number> {
  const res = await req.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  expect(res.ok()).toBeTruthy();
  const { resources } = (await res.json()) as { resources: { code: string; available: number }[] };
  return resources.find((r) => r.code === CODE)!.available;
}

async function dhanmondiId(req: APIRequestContext): Promise<string> {
  const res = await req.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  return ((await res.json()) as { hospital: { id: string } }).hospital.id;
}

async function hold(citizen: APIRequestContext, hospitalId: string): Promise<string> {
  const res = await citizen.post("/api/reservations", {
    data: { hospitalId, resourceCode: CODE },
    headers: { Origin: origin(), "Idempotency-Key": randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { reservation: { id: string } }).reservation.id;
}

type QueueItem = { id: string; status: string; citizen: { phone: string } };

/** Leave this project's citizen with no active reservation (cancel HELD, staff completes ARRIVED). */
async function clearActive(citizen: APIRequestContext, staffReq: APIRequestContext, hospitalId: string) {
  const res = await citizen.get("/api/reservations");
  const { items } = (await res.json()) as { items: { id: string; status: string }[] };
  for (const r of items) {
    if (r.status === "HELD") await citizen.post(`/api/reservations/${r.id}/cancel`, { headers: { Origin: origin() } });
  }
  const q = await staffReq.get(`/api/staff/hospitals/${hospitalId}/reservations?status=ARRIVED&q=${citizenPhone()}`);
  for (const r of ((await q.json()) as { items: QueueItem[] }).items) {
    await staffReq.post(`/api/staff/reservations/${r.id}`, { data: { action: "complete" }, headers: { Origin: origin() } });
  }
}

const queue = (page: Page) => page.getByTestId("reservation-queue");
const rowOf = (page: Page, id: string) => queue(page).locator(`[data-reservation-id="${id}"]`);
/** The filters are client state: wait for hydration before using them. */
const hydrated = (page: Page) => expect(queue(page)).toHaveAttribute("data-hydrated", "true");

async function openQueue(page: Page) {
  await loginPage(page, DHANMONDI_STAFF);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  await hydrated(page);
}

test("staff checks in and completes a hold, then rejects one with a reason; stock comes back", async ({ page }) => {
  const citizen = await apiClient(citizenPhone(), "SEED_CITIZEN_PASSWORD");
  const staffReq = await apiClient(DHANMONDI_STAFF, "SEED_STAFF_PASSWORD");
  const hid = await dhanmondiId(citizen);
  await clearActive(citizen, staffReq, hid);

  const start = await stock(citizen);
  const first = await hold(citizen, hid);
  await openQueue(page);

  // Narrow the list to this project's citizen (the other project uses the same hospital in parallel).
  await queue(page).getByLabel(staff.queueSearch.bn).fill(citizenPhone());
  const r1 = rowOf(page, first);
  await expect(r1).toBeVisible();
  await expect(r1).toContainText(citizenPhone());
  await expect(r1.getByTestId("queue-status")).toHaveAttribute("data-status", "HELD");
  await expect(r1.getByTestId("queue-countdown")).toBeVisible();

  await r1.getByRole("button", { name: staff.checkIn.bn }).click();
  await expect(r1.getByTestId("queue-status")).toHaveAttribute("data-status", "ARRIVED");
  await r1.getByRole("button", { name: staff.complete.bn }).click();
  await expect(r1.getByTestId("queue-status")).toHaveAttribute("data-status", "COMPLETED");
  // GENERAL_BED is non-consumable: completing frees the bed. Other specs hold Dhanmondi beds in parallel,
  // so wait for the count to settle back rather than reading it once.
  await expect.poll(() => stock(citizen), { timeout: 20_000 }).toBe(start);

  // Second hold → reject needs a reason (≥ 3 chars).
  const second = await hold(citizen, hid);
  await queue(page).getByLabel(staff.queueStatus.bn).selectOption("HELD");
  const r2 = rowOf(page, second);
  await expect(r2).toBeVisible();
  await r2.getByRole("button", { name: staff.reject.bn }).click();
  const submit = r2.getByRole("button", { name: staff.rejectSubmit.bn });
  await expect(submit).toBeDisabled();
  await r2.getByLabel(staff.rejectReason.bn).fill("ab");
  await expect(submit).toBeDisabled();
  await r2.getByLabel(staff.rejectReason.bn).fill("No bed after all");
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(r2.getByTestId("queue-status")).toHaveAttribute("data-status", "REJECTED");
  await expect(r2).toContainText("No bed after all");
  await expect.poll(() => stock(citizen), { timeout: 20_000 }).toBe(start);

  // Status filter "All" + newest first + search by phone finds both, with their final statuses (server
  // truth after reload). Newest first: this citizen keeps older reservations from earlier runs.
  await page.reload();
  await hydrated(page);
  await queue(page).getByLabel(staff.queueStatus.bn).selectOption("ALL");
  await queue(page).getByLabel(staff.queueSort.bn).selectOption("newest");
  await queue(page).getByLabel(staff.queueSearch.bn).fill(citizenPhone());
  await expect(rowOf(page, first).getByTestId("queue-status")).toHaveAttribute("data-status", "COMPLETED");
  await expect(rowOf(page, second).getByTestId("queue-status")).toHaveAttribute("data-status", "REJECTED");
  await expect(queue(page).getByTestId("queue-row")).not.toHaveCount(0);
  for (const phone of await queue(page).getByTestId("queue-phone").allTextContents()) expect(phone).toContain(citizenPhone());

  await citizen.dispose();
  await staffReq.dispose();
});

test("an action on a hold that changed meanwhile shows the message and refreshes; Mirpur staff never sees it", async ({ page, browser }) => {
  const citizen = await apiClient(citizenPhone(), "SEED_CITIZEN_PASSWORD");
  const staffReq = await apiClient(DHANMONDI_STAFF, "SEED_STAFF_PASSWORD");
  const hid = await dhanmondiId(citizen);
  await clearActive(citizen, staffReq, hid);

  const id = await hold(citizen, hid);
  await openQueue(page);
  await queue(page).getByLabel(staff.queueSearch.bn).fill(citizenPhone());
  const row = rowOf(page, id);
  await expect(row).toBeVisible();

  // The citizen cancels while the staff page still shows HELD → Check in is an INVALID_TRANSITION.
  expect((await citizen.post(`/api/reservations/${id}/cancel`, { headers: { Origin: origin() } })).ok()).toBeTruthy();
  await row.getByRole("button", { name: staff.checkIn.bn }).click();
  await expect(queue(page).getByRole("alert")).toContainText(rt.invalidTransition.bn);
  // Refetched with the default "Active" filter: the cancelled hold is gone.
  await expect(row).toHaveCount(0);

  // Mirpur staff: the Dhanmondi queue API is a 404, and their own queue never lists this citizen.
  const { baseURL: b, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const ctx = await browser.newContext({ baseURL: b, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const mirpur = await ctx.newPage();
  await loginPage(mirpur, MIRPUR_STAFF);
  expect((await mirpur.request.get(`/api/staff/hospitals/${hid}/reservations?status=ALL`)).status()).toBe(404);
  await mirpur.goto("/staff");
  await expect(mirpur).toHaveURL(/\/staff\/hospitals\/[^/]+$/);
  await hydrated(mirpur);
  await queue(mirpur).getByLabel(staff.queueStatus.bn).selectOption("ALL");
  await queue(mirpur).getByLabel(staff.queueSearch.bn).fill(citizenPhone());
  await expect(queue(mirpur).getByTestId("queue-empty")).toBeVisible();
  await expect(queue(mirpur).locator(`[data-reservation-id="${id}"]`)).toHaveCount(0);
  await ctx.close();

  await citizen.dispose();
  await staffReq.dispose();
});
