import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { fmtNum } from "@/components/finder/format";
import { staff } from "@/lib/i18n/staff";
import { HOSPITALS } from "../../prisma/data/hospitals";
import { apiClient, apiLogin, env, newProjectPage, origin, socketHandshake } from "./helpers";

// A01 acceptance: independent browser contexts (A and B, each with the project's device settings) see
// each other's changes live, without a reload. Safe against the live URL: every hold is cancelled /
// completed in afterEach and every stock change (staff edits, consumed units) is given back with a
// versioned `adjust`, so the rows end where they started.
//
// Allocation (Dhanmondi Care General, "full" profile). Rows NO other spec touches — others use
// GENERAL_BED, ICU_BED, CCU_BED, NICU_BED, VENTILATOR, STRETCHER, OXYGEN_CYLINDER, PLATELETS, CT_SCAN,
// CATH_LAB, RABIES_VACCINE, ANTIVENOM, BLOOD_AB_NEG, BLOOD_B_NEG; BLOOD_O_NEG is left alone because it
// is the Finder's default blood pick. Mobile and desktop never share a row or a racer, so counts are
// exact; inside a project the tests run in order, so (b) and (c) may share a row.
//   mobile : (a) RABIES_IG 8   (b)+(c) BLOOD_AB_POS 6   (d) BLOOD_O_POS 12   racers 108 / 109 / 110
//   desktop: (a) BLOOD_A_POS 10 (b)+(c) BLOOD_B_POS 10  (d) BLOOD_A_NEG 5    racers 111 / 112 / 113
// Staff: Dhanmondi 01700000011 in every staff context (logins are sequential: per-phone limiter).
const SETUP = {
  mobile: {
    a: { racer: "01700000108", code: "RABIES_IG", finder: "/find?condition=ANIMAL_BITE&area=dhanmondi" },
    b: { code: "BLOOD_AB_POS" },
    c: { racer: "01700000109", code: "BLOOD_AB_POS" },
    d: { racer: "01700000110", code: "BLOOD_O_POS", finder: "/find?condition=DENGUE&blood=O_POS&area=dhanmondi" },
  },
  desktop: {
    a: { racer: "01700000111", code: "BLOOD_A_POS", finder: "/find?condition=DENGUE&blood=A_POS&area=dhanmondi" },
    b: { code: "BLOOD_B_POS" },
    c: { racer: "01700000112", code: "BLOOD_B_POS" },
    d: { racer: "01700000113", code: "BLOOD_A_NEG", finder: "/find?condition=DENGUE&blood=A_NEG&area=dhanmondi" },
  },
} as const;
const DHANMONDI_STAFF = "01700000011";
const DHANMONDI = HOSPITALS.find((h) => h.slug === "dhanmondi-care-general")!;
/** (a): 1 s is the judged target, asserted against BASE_URL (production build); the local dev server
 *  compiles on demand, so locally the bound is 3 s (P5 ledger ruling). The measured ms is annotated. */
const FINDER_MS = process.env.BASE_URL ? 1000 : 3000;
const LIVE_MS = 2000; // (b), (c): within 2 s
const RECOVER_MS = 5000; // (d): banner gone and state correct within 5 s of coming back online

const setup = (info: TestInfo = test.info()) => SETUP[info.project.name as keyof typeof SETUP];

test.describe.configure({ mode: "default" }); // shared rows inside a project: run in order

let staffReq: APIRequestContext;
let hospitalId: string;
/** Citizen sessions used by the test (cleaned up in afterEach while their contexts are still open). */
let citizens: APIRequestContext[] = [];
/** Extra browser contexts opened by the test. */
let contexts: BrowserContext[] = [];
/** Units to give back per resource code (staff edits undone, consumed units returned). */
let giveBack = new Map<string, number>();

type StaffRow = { id: string; code: string; available: number; total: number; version: number };

async function staffRow(code: string): Promise<StaffRow> {
  const res = await staffReq.get(`/api/staff/hospitals/${hospitalId}/resources`);
  expect(res.ok()).toBeTruthy();
  const { resources } = (await res.json()) as { resources: StaffRow[] };
  return resources.find((r) => r.code === code)!;
}

async function staffAct(id: string, data: { action: "checkIn" | "complete" | "reject"; reason?: string }) {
  const res = await staffReq.post(`/api/staff/reservations/${id}`, { data, headers: { Origin: origin() } });
  expect(res.ok(), `${data.action} ${id}: ${await res.text()}`).toBeTruthy();
}

/** Versioned staff adjust; a 409 means the version moved meanwhile: re-read and retry. */
async function adjust(code: string, delta: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await staffRow(code);
    const res = await staffReq.patch(`/api/staff/resources/${row.id}`, {
      data: { version: row.version, change: { op: "adjust", delta } }, headers: { Origin: origin() },
    });
    if (res.ok()) return;
    expect(res.status(), `adjust ${code} ${delta}: ${await res.text()}`).toBe(409);
  }
  throw new Error(`adjust ${code} ${delta}: every attempt hit 409`);
}

const owe = (code: string, units: number) => giveBack.set(code, (giveBack.get(code) ?? 0) + units);

/** No active reservation left for this citizen: cancel HELD, complete ARRIVED (and owe the consumed unit). */
async function settle(citizen: APIRequestContext) {
  const res = await citizen.get("/api/reservations");
  expect(res.ok()).toBeTruthy();
  const { items } = (await res.json()) as { items: { id: string; status: string; quantity: number; resource: { code: string } }[] };
  for (const r of items) {
    if (r.status === "HELD") {
      const c = await citizen.post(`/api/reservations/${r.id}/cancel`, { headers: { Origin: origin() } });
      expect(c.ok(), `cancel ${r.id}`).toBeTruthy();
    }
    if (r.status === "ARRIVED") {
      await staffAct(r.id, { action: "complete" });
      owe(r.resource.code, r.quantity); // every row of this spec is consumable
    }
  }
}

/** A signed-in citizen page with no active reservation. */
async function citizenPage(page: Page, phone: string): Promise<Page> {
  await apiLogin(page, phone, env("SEED_CITIZEN_PASSWORD"));
  citizens.push(page.request);
  await settle(page.request);
  return page;
}

/** A second context signed in as Dhanmondi staff, on the live console. */
async function staffConsole(page: Page): Promise<Page> {
  await apiLogin(page, DHANMONDI_STAFF, env("SEED_STAFF_PASSWORD"));
  const handshake = socketHandshake(page);
  await page.goto(`/staff/hospitals/${hospitalId}`);
  await expect(page.getByTestId("reservation-queue")).toHaveAttribute("data-hydrated", "true");
  await handshake;
  return page;
}

async function extraPage(browser: Parameters<typeof newProjectPage>[0]): Promise<Page> {
  const p = await newProjectPage(browser);
  contexts.push(p.context());
  return p;
}

async function publicAvailable(code: string): Promise<number> {
  const res = await staffReq.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  const { resources } = (await res.json()) as { resources: { code: string; available: number }[] };
  return resources.find((r) => r.code === code)!.available;
}

async function reserve(citizen: APIRequestContext, code: string): Promise<string> {
  const res = await citizen.post("/api/reservations", {
    data: { hospitalId, resourceCode: code },
    headers: { Origin: origin(), "Idempotency-Key": randomUUID() },
  });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { reservation: { id: string } }).reservation.id;
}

const card = (page: Page) => page.locator(`[data-testid="hospital-card"][data-hospital-id="${hospitalId}"]`);
const finderCount = (page: Page, code: string) => card(page).locator(`[data-testid="hold-available"][data-code="${code}"]`);
const consoleRow = (page: Page, code: string) => page.locator(`li[data-code="${code}"]`);

/** Clicks a queue action in the staff page and waits for its committed (2xx) response. */
async function staffClick(page: Page, row: Locator, name: string) {
  const done = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/api/staff/reservations/") && r.request().method() === "POST");
  await row.getByRole("button", { name }).click();
  const res = await done;
  expect(res.ok(), `${name}: ${await res.text()}`).toBeTruthy();
}

/** Marks the document, so a later check proves the page was never reloaded. */
const mark = (page: Page) => page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true));
const notReloaded = (page: Page) =>
  expect(page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload === true)).resolves.toBe(true);

test.beforeEach(async () => {
  citizens = [];
  contexts = [];
  giveBack = new Map();
  staffReq = await apiClient(DHANMONDI_STAFF, env("SEED_STAFF_PASSWORD"));
  const res = await staffReq.get(`/api/hospitals/${DHANMONDI.slug}/stock`);
  hospitalId = ((await res.json()) as { hospital: { id: string } }).hospital.id;
});

test.afterEach(async () => {
  for (const c of citizens) await settle(c);
  for (const [code, units] of giveBack) if (units !== 0) await adjust(code, units);
  for (const ctx of contexts) await ctx.close();
  await staffReq.dispose();
});

test("citizen hold in A updates Finder in B within 1 s", async ({ page, browser }) => {
  const { racer, code, finder } = setup().a;
  const before = await publicAvailable(code);
  expect(before).toBeGreaterThan(0);

  // B: anyone, signed out, watching the Finder.
  const b = await extraPage(browser);
  const handshake = socketHandshake(b);
  await b.goto(finder);
  const countB = finderCount(b, code);
  await expect(countB).toHaveText(fmtNum(before, "bn"));
  await handshake;
  await mark(b);

  // A: a citizen holding from the same Finder, through the UI.
  await citizenPage(page, racer);
  await page.goto(finder);
  const hold = card(page).locator(`[data-testid="hold-button"][data-resource="${code}"]`);
  await expect(hold.getByTestId("hold-available")).toHaveText(fmtNum(before, "bn"));
  const created = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/reservations" && r.request().method() === "POST");
  await hold.click();
  const res = await created;
  const t0 = Date.now();
  expect(res.status()).toBe(201);

  await expect.poll(() => countB.textContent(), { timeout: FINDER_MS, intervals: [20] }).toBe(fmtNum(before - 1, "bn"));
  const ms = Date.now() - t0;
  test.info().annotations.push({ type: "latency-ms", description: `${ms} ms (201 in A → Finder count in B; bound ${FINDER_MS} ms, ${test.info().project.name})` });
  console.log(`[latency] (a) ${test.info().project.name}: ${ms} ms`);
  await notReloaded(b);

  await expect(page).toHaveURL(/\/reservations\/[^/?]+$/);
  await expect(page.getByTestId("reservation-status")).toHaveAttribute("data-status", "HELD");
  expect(await publicAvailable(code)).toBe(before - 1);
});

test("two staff editing the same resource → second sees the conflict UI", async ({ page, browser }) => {
  const { code } = setup().b;
  const { available: start, total } = await staffRow(code);
  expect(start).toBeGreaterThanOrEqual(3);
  const a = await staffConsole(page);
  const b = await staffConsole(await extraPage(browser));
  const rowA = consoleRow(a, code);
  const rowB = consoleRow(b, code);
  await expect(rowA.getByTestId("available")).toHaveText(String(start));
  await expect(rowB.getByTestId("available")).toHaveText(String(start));

  /** A types `mine` into its Set form; B saves `theirs` meanwhile; A saves → the conflict panel. */
  async function race(mine: number, theirs: number, aBase: number): Promise<Locator> {
    await rowA.getByRole("button", { name: staff.set.bn }).click();
    await rowA.getByLabel(staff.available.bn, { exact: true }).fill(String(mine));

    await rowB.getByRole("button", { name: staff.set.bn }).click();
    await rowB.getByLabel(staff.available.bn, { exact: true }).fill(String(theirs));
    await rowB.getByRole("button", { name: staff.save.bn }).click();
    await expect(rowB.getByTestId("available")).toHaveText(String(theirs));
    giveBack.set(code, start - theirs);

    // A's unsaved edit survives the live change, which is flagged instead.
    await expect(rowA.getByTestId("changed-elsewhere")).toBeVisible({ timeout: LIVE_MS });
    await expect(rowA.getByLabel(staff.available.bn, { exact: true })).toHaveValue(String(mine));
    await expect(rowA.getByTestId("available")).toHaveText(String(aBase));

    await rowA.getByRole("button", { name: staff.save.bn }).click();
    const panel = rowA.getByRole("alert").filter({ hasText: staff.conflictTitle.bn });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(`${theirs} / ${total}`); // current server value
    await expect(panel).toContainText(`${mine} / ${total}`); // A's intended value
    return panel;
  }

  // Round 1 → Reload adopts B's value; nothing of A's is saved.
  const p1 = await race(start - 1, start - 2, start);
  await p1.getByRole("button", { name: staff.reload.bn }).click();
  await expect(p1).toHaveCount(0);
  await expect(rowA.getByTestId("available")).toHaveText(String(start - 2));
  expect((await staffRow(code)).available).toBe(start - 2);

  // Round 2 → Re-apply saves A's value over B's newer one; B follows live.
  const p2 = await race(start - 3, start - 1, start - 2);
  await p2.getByRole("button", { name: staff.reapply.bn }).click();
  await expect(p2).toHaveCount(0);
  await expect(rowA.getByTestId("available")).toHaveText(String(start - 3));
  giveBack.set(code, 3);
  await expect(rowB.getByTestId("available")).toHaveText(String(start - 3), { timeout: LIVE_MS });
  expect((await staffRow(code)).available).toBe(start - 3);
});

test("staff check-in updates the citizen tracker live", async ({ page, browser }) => {
  const { racer, code } = setup().c;
  // A: the citizen's tracker.
  await citizenPage(page, racer);
  const id = await reserve(page.request, code);
  const handshake = socketHandshake(page);
  await page.goto(`/reservations/${id}`);
  const status = page.getByTestId("reservation-status");
  await expect(status).toHaveAttribute("data-status", "HELD");
  await expect(page.getByTestId("countdown")).toBeVisible();
  await handshake;
  await mark(page);

  // B: Dhanmondi staff, acting from the queue.
  const b = await staffConsole(await extraPage(browser));
  const queue = b.getByTestId("reservation-queue");
  await queue.getByLabel(staff.queueSearch.bn).fill(racer);
  const row = queue.locator(`[data-reservation-id="${id}"]`);
  await expect(row.getByTestId("queue-status")).toHaveAttribute("data-status", "HELD");

  // The 2 s window starts when B's action has committed (its response), as in (a).
  await staffClick(b, row, staff.checkIn.bn);
  await expect(status).toHaveAttribute("data-status", "ARRIVED", { timeout: LIVE_MS });
  await expect(page.getByTestId("countdown")).toHaveCount(0);

  await staffClick(b, row, staff.complete.bn);
  await expect(row.getByTestId("queue-status")).toHaveAttribute("data-status", "COMPLETED");
  owe(code, 1); // consumable: the completed unit stays consumed until afterEach gives it back
  await expect(status).toHaveAttribute("data-status", "COMPLETED", { timeout: LIVE_MS });
  await notReloaded(page);
});

test("offline then online recovers", async ({ page }) => {
  const { racer, code, finder } = setup().d;
  const before = await publicAvailable(code);
  expect(before).toBeGreaterThanOrEqual(3);

  // A: one citizen context with the tracker and the Finder open.
  await citizenPage(page, racer);
  const id = await reserve(page.request, code);
  const tracking = socketHandshake(page);
  await page.goto(`/reservations/${id}`);
  const status = page.getByTestId("reservation-status");
  await expect(status).toHaveAttribute("data-status", "HELD");
  await tracking;

  const finderPage = await page.context().newPage();
  const finding = socketHandshake(finderPage);
  await finderPage.goto(finder);
  const count = finderCount(finderPage, code);
  await expect(count).toHaveText(fmtNum(before - 1, "bn"));
  await finding;
  await mark(page);
  await mark(finderPage);

  await page.context().setOffline(true);
  await expect(page.getByTestId("reconnecting-banner")).toBeVisible();
  await expect(finderPage.getByTestId("reconnecting-banner")).toBeVisible();

  // B (staff, its own session) meanwhile: stock −2, and A's hold is rejected (+1 back).
  await adjust(code, -2);
  owe(code, 2);
  await staffAct(id, { action: "reject", reason: "Offline acceptance test" });
  expect(await publicAvailable(code)).toBe(before - 2);
  // Nothing reached A while offline.
  await expect(count).toHaveText(fmtNum(before - 1, "bn"));
  await expect(status).toHaveAttribute("data-status", "HELD");

  await page.context().setOffline(false);
  await expect(page.getByTestId("reconnecting-banner")).toHaveCount(0, { timeout: RECOVER_MS });
  await expect(finderPage.getByTestId("reconnecting-banner")).toHaveCount(0, { timeout: RECOVER_MS });
  await expect(count).toHaveText(fmtNum(before - 2, "bn"), { timeout: RECOVER_MS });
  await expect(status).toHaveAttribute("data-status", "REJECTED", { timeout: RECOVER_MS });
  await notReloaded(page);
  await notReloaded(finderPage);
});
