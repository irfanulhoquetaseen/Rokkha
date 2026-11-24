import { randomUUID } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { fmtNum } from "@/components/finder/format";
import { HOSPITALS } from "../../prisma/data/hospitals";

// Live sync, single browser context (multi-context races live in a later spec). The page is signed out;
// a separate API client (a demo racer) reserves and cancels, and the page must follow without a reload.
// Allocation: no other spec (nor the other project) touches these Dhanmondi rows, so counts are exact.
const SETUP = {
  mobile: { racer: "01700000104", code: "RABIES_VACCINE", finder: "/find?condition=ANIMAL_BITE&area=dhanmondi" },
  desktop: { racer: "01700000105", code: "ANTIVENOM", finder: "/find?condition=SNAKEBITE&area=dhanmondi" },
} as const;
const DHANMONDI = HOSPITALS.find((h) => h.slug === "dhanmondi-care-general")!;
const LIVE_MS = 2000; // brief: the change shows within 2 s

const setup = (info: TestInfo = test.info()) => SETUP[info.project.name as keyof typeof SETUP];
const baseURL = () => test.info().project.use.baseURL!;
const origin = () => new URL(baseURL()).origin;

test.describe.configure({ mode: "default" }); // one racer per project: run in order

let racer: APIRequestContext;
let hospitalId: string;

async function activeHoldIds(req: APIRequestContext): Promise<string[]> {
  const res = await req.get("/api/reservations");
  expect(res.ok()).toBeTruthy();
  const { items } = (await res.json()) as { items: { id: string; status: string }[] };
  return items.filter((r) => r.status === "HELD").map((r) => r.id);
}

async function cancel(id: string) {
  const res = await racer.post(`/api/reservations/${id}/cancel`, { headers: { Origin: origin() } });
  expect(res.ok(), `cancel ${id}`).toBeTruthy();
}

async function cancelAll() {
  for (const id of await activeHoldIds(racer)) await cancel(id);
}

async function reserve(): Promise<string> {
  const res = await racer.post("/api/reservations", {
    data: { hospitalId, resourceCode: setup().code },
    headers: { Origin: origin(), "Idempotency-Key": randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { reservation: { id: string } }).reservation.id;
}

async function available(): Promise<number> {
  const res = await racer.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  const { resources } = (await res.json()) as { resources: { code: string; available: number }[] };
  return resources.find((r) => r.code === setup().code)!.available;
}

/** Resolves once the page's live island has loaded its socket chunk and handshaken. Call before goto. */
function socketHandshake(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/socket.io/") && r.status() < 400, { timeout: 20_000 });
}

test.beforeEach(async () => {
  racer = await pwRequest.newContext({ baseURL: baseURL() });
  const password = process.env.SEED_CITIZEN_PASSWORD;
  if (!password) throw new Error("SEED_CITIZEN_PASSWORD must be set (in .env) for realtime E2E tests");
  const login = await racer.post("/api/auth/login", { data: { phone: setup().racer, password }, headers: { Origin: origin() } });
  expect(login.ok(), "racer login").toBeTruthy();
  await cancelAll();
  const res = await racer.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  hospitalId = ((await res.json()) as { hospital: { id: string } }).hospital.id;
});

test.afterEach(async () => {
  await cancelAll(); // leave stock as we found it (safe against the live URL)
  await racer.dispose();
});

test("Finder: a hold elsewhere lowers the count live, a cancel raises it back", async ({ page }) => {
  const before = await available();
  const handshake = socketHandshake(page);
  await page.goto(setup().finder);
  const card = page.getByTestId("hospital-card").filter({ hasText: DHANMONDI.nameBn });
  const count = card.locator(`[data-testid="hold-available"][data-code="${setup().code}"]`);
  await expect(count).toHaveText(fmtNum(before, "bn"));
  await expect(card.getByRole("link", { name: DHANMONDI.nameBn })).toHaveAttribute("href", `/hospitals/${DHANMONDI.slug}`);
  await handshake;

  const id = await reserve();
  await expect(count).toHaveText(fmtNum(before - 1, "bn"), { timeout: LIVE_MS });
  await cancel(id);
  await expect(count).toHaveText(fmtNum(before, "bn"), { timeout: LIVE_MS });
});

test("Hospital page: stock rows update live in place", async ({ page }) => {
  const before = await available();
  const handshake = socketHandshake(page);
  await page.goto(`/hospitals/${DHANMONDI.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: DHANMONDI.nameBn })).toBeVisible();
  const row = page.locator(`[data-testid="stock-row"][data-code="${setup().code}"]`);
  const count = row.getByTestId("stock-available");
  await expect(count).toHaveText(fmtNum(before, "bn"));
  await handshake;

  const id = await reserve();
  await expect(count).toHaveText(fmtNum(before - 1, "bn"), { timeout: LIVE_MS });
  await cancel(id);
  await expect(count).toHaveText(fmtNum(before, "bn"), { timeout: LIVE_MS });
  expect(await available()).toBe(before);
});

test("unknown hospital → real 404", async ({ page }) => {
  const res = await page.goto("/hospitals/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});
