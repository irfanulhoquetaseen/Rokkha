import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { realtime } from "@/lib/i18n/realtime";
import { staff } from "@/lib/i18n/staff";
import { HOSPITALS } from "../../prisma/data/hospitals";
import { socketHandshake } from "./helpers";

// Live staff console, live reservation queue and live citizen tracker (single browser context; the
// "someone else" is an API client). Allocation: these Dhanmondi blood rows and racers are used by no
// other spec (nor by the other project), so counts are exact. Blood is consumable: a COMPLETED hold
// keeps its unit, so the tracker test gives it back with a versioned staff `adjust`.
const SETUP = {
  mobile: { racer: "01700000106", code: "BLOOD_AB_NEG" },
  desktop: { racer: "01700000107", code: "BLOOD_B_NEG" },
} as const;
const DHANMONDI_STAFF = "01700000011";
const DHANMONDI = HOSPITALS.find((h) => h.slug === "dhanmondi-care-general")!;
const LIVE_MS = 2000; // the change shows within 2 s, no reload

const setup = (info: TestInfo = test.info()) => SETUP[info.project.name as keyof typeof SETUP];
const baseURL = () => test.info().project.use.baseURL!;
const origin = () => new URL(baseURL()).origin;

test.describe.configure({ mode: "default" }); // one racer per project: run in order

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (in .env) for realtime staff E2E tests`);
  return v;
}

async function login(req: APIRequestContext, phone: string, passwordVar: string) {
  const res = await req.post("/api/auth/login", { data: { phone, password: env(passwordVar) }, headers: { Origin: origin() } });
  expect(res.ok(), `login ${phone}`).toBeTruthy();
}

async function apiClient(phone: string, passwordVar: string): Promise<APIRequestContext> {
  const req = await pwRequest.newContext({ baseURL: baseURL() });
  await login(req, phone, passwordVar);
  return req;
}

let racer: APIRequestContext;
let staffReq: APIRequestContext;
let hospitalId: string;
/** Units of this project's row consumed by completed holds, to give back in afterEach. */
let consumed = 0;

type StaffRow = { id: string; code: string; available: number; total: number; version: number };

async function staffRow(): Promise<StaffRow> {
  const res = await staffReq.get(`/api/staff/hospitals/${hospitalId}/resources`);
  expect(res.ok()).toBeTruthy();
  const { resources } = (await res.json()) as { resources: StaffRow[] };
  return resources.find((r) => r.code === setup().code)!;
}

async function reserve(): Promise<string> {
  const res = await racer.post("/api/reservations", {
    data: { hospitalId, resourceCode: setup().code },
    headers: { Origin: origin(), "Idempotency-Key": randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { reservation: { id: string } }).reservation.id;
}

async function cancel(id: string) {
  const res = await racer.post(`/api/reservations/${id}/cancel`, { headers: { Origin: origin() } });
  expect(res.ok(), `cancel ${id}`).toBeTruthy();
}

async function staffAct(id: string, action: "checkIn" | "complete") {
  const res = await staffReq.post(`/api/staff/reservations/${id}`, { data: { action }, headers: { Origin: origin() } });
  expect(res.ok(), `${action} ${id}: ${await res.text()}`).toBeTruthy();
}

/** Cancel HELD, complete ARRIVED (counting the consumed unit), then give consumed units back. */
async function cleanUp() {
  const res = await racer.get("/api/reservations");
  const { items } = (await res.json()) as { items: { id: string; status: string; quantity: number }[] };
  for (const r of items) {
    if (r.status === "HELD") await cancel(r.id);
    if (r.status === "ARRIVED") {
      await staffAct(r.id, "complete");
      consumed += r.quantity;
    }
  }
  for (let attempt = 0; consumed > 0 && attempt < 5; attempt++) {
    const row = await staffRow();
    const patch = await staffReq.patch(`/api/staff/resources/${row.id}`, {
      data: { version: row.version, change: { op: "adjust", delta: consumed } }, headers: { Origin: origin() },
    });
    if (patch.ok()) consumed = 0;
    else expect(patch.status(), `restore: ${await patch.text()}`).toBe(409); // version moved: retry
  }
  expect(consumed, "consumed units given back").toBe(0);
}

async function openConsole(page: Page) {
  await login(page.request, DHANMONDI_STAFF, "SEED_STAFF_PASSWORD");
  const handshake = socketHandshake(page);
  await page.goto(`/staff/hospitals/${hospitalId}`);
  await expect(page.getByTestId("reservation-queue")).toHaveAttribute("data-hydrated", "true");
  await handshake;
}

const consoleRow = (page: Page) => page.locator(`li[data-code="${setup().code}"]`);

test.beforeEach(async () => {
  consumed = 0;
  racer = await apiClient(setup().racer, "SEED_CITIZEN_PASSWORD");
  staffReq = await apiClient(DHANMONDI_STAFF, "SEED_STAFF_PASSWORD");
  const res = await racer.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  hospitalId = ((await res.json()) as { hospital: { id: string } }).hospital.id;
  await cleanUp();
});

test.afterEach(async () => {
  await cleanUp(); // leave stock as we found it (safe against the live URL)
  await racer.dispose();
  await staffReq.dispose();
});

test("console: a hold elsewhere lowers the row and adds a queue row live; a cancel undoes both", async ({ page }) => {
  const before = (await staffRow()).available;
  expect(before).toBeGreaterThan(0);
  await openConsole(page);
  const available = consoleRow(page).getByTestId("available");
  await expect(available).toHaveText(String(before));
  // Only this racer's holds (other specs hold at Dhanmondi in parallel).
  const queue = page.getByTestId("reservation-queue");
  await queue.getByLabel(staff.queueSearch.bn).fill(setup().racer);
  await expect(queue.getByTestId("queue-empty")).toBeVisible();

  const id = await reserve();
  await expect(available).toHaveText(String(before - 1), { timeout: LIVE_MS });
  const queueRow = queue.locator(`[data-reservation-id="${id}"]`);
  await expect(queueRow).toHaveAttribute("data-status", "HELD", { timeout: LIVE_MS });

  await cancel(id);
  await expect(available).toHaveText(String(before), { timeout: LIVE_MS });
  await expect(queueRow).toHaveCount(0, { timeout: LIVE_MS }); // left the "active" filter
});

test("console: a live change never overwrites a dirty Set form; saving shows the conflict panel", async ({ page }) => {
  const { available: before, total } = await staffRow();
  expect(before).toBeGreaterThan(1);
  await openConsole(page);
  const row = consoleRow(page);
  await row.getByRole("button", { name: staff.set.bn }).click();
  const input = row.getByLabel(staff.available.bn, { exact: true });
  await input.fill(String(before - 2)); // the staff member's own (unsaved) edit
  const hint = row.getByTestId("changed-elsewhere");
  await expect(hint).toHaveCount(0);

  await reserve(); // someone else changes the row meanwhile
  await expect(hint).toHaveText(realtime.changedElsewhere.bn, { timeout: LIVE_MS });
  await expect(input).toHaveValue(String(before - 2)); // the edit survives
  await expect(row.getByTestId("available")).toHaveText(String(before)); // still the form's base

  await row.getByRole("button", { name: staff.save.bn }).click();
  const panel = row.getByRole("alert").filter({ hasText: staff.conflictTitle.bn });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(`${before - 1} / ${total}`); // the server's value
  await expect(panel).toContainText(`${before - 2} / ${total}`); // and the staff member's
  await panel.getByRole("button", { name: staff.reload.bn }).click();
  await expect(panel).toHaveCount(0);
  await expect(row.getByTestId("available")).toHaveText(String(before - 1));
  expect((await staffRow()).available).toBe(before - 1); // nothing was saved over the hold
});

test("console: an open but untouched Set form follows live values", async ({ page }) => {
  const { available: before } = await staffRow();
  await openConsole(page);
  const row = consoleRow(page);
  await row.getByRole("button", { name: staff.set.bn }).click();
  const input = row.getByLabel(staff.available.bn, { exact: true });
  await expect(input).toHaveValue(String(before));

  await reserve();
  await expect(row.getByTestId("available")).toHaveText(String(before - 1), { timeout: LIVE_MS });
  await expect(input).toHaveValue(String(before - 1));
  await expect(row.getByTestId("changed-elsewhere")).toHaveCount(0);
});

test("tracker: staff check-in and completion show up live, without a reload", async ({ page }) => {
  await login(page.request, setup().racer, "SEED_CITIZEN_PASSWORD");
  const id = await reserve();
  const handshake = socketHandshake(page);
  await page.goto(`/reservations/${id}`);
  const status = page.getByTestId("reservation-status");
  await expect(status).toHaveAttribute("data-status", "HELD");
  await expect(page.getByTestId("countdown")).toBeVisible();
  await expect(page.getByTestId("cancel-button")).toBeVisible();
  await handshake;

  await staffAct(id, "checkIn");
  await expect(status).toHaveAttribute("data-status", "ARRIVED", { timeout: LIVE_MS });
  await expect(page.getByTestId("countdown")).toHaveCount(0);
  await expect(page.getByTestId("cancel-button")).toHaveCount(0);
  await expect(page.getByTestId("timeline-event")).toHaveCount(2);

  await staffAct(id, "complete");
  consumed += 1;
  await expect(status).toHaveAttribute("data-status", "COMPLETED", { timeout: LIVE_MS });
  await expect(page.getByTestId("timeline-event")).toHaveCount(3);
});
