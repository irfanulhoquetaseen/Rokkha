import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { admin } from "@/lib/i18n/admin";
import { auth } from "@/lib/i18n/auth";
import { apiLogin, baseURL, origin } from "./helpers";

const ADMIN_PHONE = "01700000001";
const CITIZEN_PHONE = "01700000021";

function adminPassword(): string {
  const p = process.env.SEED_ADMIN_PASSWORD;
  if (!p) throw new Error("SEED_ADMIN_PASSWORD must be set (in .env) for admin E2E tests");
  return p;
}

function citizenPassword(): string {
  const p = process.env.SEED_CITIZEN_PASSWORD;
  if (!p) throw new Error("SEED_CITIZEN_PASSWORD must be set (in .env) for admin E2E tests");
  return p;
}

// Keep tests in this file sequential per project so shared admin login doesn't burst the per-phone rate limit.
test.describe.configure({ mode: "default" });

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

test("logged-out /admin redirects to login; citizen gets real 404", async ({ request, page }) => {
  const anonRes = await request.get("/admin", { maxRedirects: 0 });
  expect(anonRes.status()).toBe(307);
  expect(anonRes.headers().location).toMatch(/\/login\?next=%2Fadmin$/);

  await apiLogin(page, CITIZEN_PHONE, citizenPassword());
  expect((await page.request.get("/admin")).status()).toBe(404);
  expect((await page.request.get("/api/admin/hospitals")).status()).toBe(404);

  const nav = await page.goto("/admin");
  expect(nav?.status()).toBe(404);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByTestId("admin-hospitals-table")).toHaveCount(0);
});

test("admin logs in, creates a hospital, edits it, archives it, and sees it vanish from the Finder", async ({ page }, info) => {
  const suffix = `${info.project.name}-${Date.now().toString(36)}`;
  const slug = `e2e-admin-${suffix}`;
  const nameBn = `ইটুই হাসপাতাল ${suffix}`;
  const nameEn = `E2E Hospital ${suffix}`;
  const updatedNameBn = `আপডেটেড হাসপাতাল ${suffix}`;
  const updatedNameEn = `Updated Hospital ${suffix}`;

  // 1. Log in as admin via login page
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  await page.getByLabel(auth.phone.bn).fill(ADMIN_PHONE);
  await page.getByLabel(auth.password.bn).fill(adminPassword());
  await page.getByRole("button", { name: auth.loginSubmit.bn }).click();

  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  await expect(page.getByTestId("admin-hospitals-table")).toBeVisible();
  await expect(page.getByText("DEMO DATA — not real hospital availability")).toBeVisible();
  await expectNoHorizontalScroll(page);

  // 2. Create a new live hospital with ICU_BED + GENERAL_BED in Dhanmondi
  await page.getByTestId("create-hospital-btn").click();
  const form = page.getByTestId("hospital-form");
  await expect(form).toBeVisible();

  await form.getByLabel(admin.nameBn.bn).fill(nameBn);
  await form.getByLabel(admin.nameEn.bn).fill(nameEn);
  await form.getByLabel(admin.slug.bn).fill(slug);
  await form.getByLabel(admin.phone.bn).fill("01799887766");
  await form.getByLabel(admin.division.bn).fill("Dhaka");
  await form.getByLabel(admin.district.bn).fill("Dhaka");
  await form.getByLabel(admin.area.bn).fill("Dhanmondi");
  await form.getByLabel(admin.address.bn).fill("Road 9, Dhanmondi, Dhaka");
  await form.getByLabel(admin.lat.bn).fill("23.748");
  await form.getByLabel(admin.lng.bn).fill("90.376");
  await form.getByLabel(admin.isDemo.bn).check();

  // Add ICU_BED resource
  await form.getByRole("button", { name: `+ ${admin.addResource.bn}` }).click();
  const resSelect = form.getByLabel(`${admin.resourceType.bn} 1`);
  const icuVal = await resSelect.locator("option").evaluateAll((opts) => {
    const match = opts.find((o) => o.textContent?.includes("আইসিইউ") || o.textContent?.includes("ICU"));
    return match ? (match as HTMLOptionElement).value : "";
  });
  expect(icuVal).toBeTruthy();
  await resSelect.selectOption(icuVal);
  await form.locator("#res-total-0").fill("4");
  await form.locator("#res-avail-0").fill("2");

  await form.getByRole("button", { name: admin.save.bn }).click();
  await expect(page.getByText(admin.hospitalCreated.bn)).toBeVisible();

  // Filter table to find our newly created hospital
  await page.getByPlaceholder(admin.searchHospitals.bn).fill(suffix);
  const row = page.locator(`tr[data-hospital-slug="${slug}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText(nameBn);

  // 3. Verify it appears on the Finder (sorted by freshness so it is guaranteed on page 1)
  await page.goto("/find?condition=DENGUE&area=dhanmondi&radius=5&resource=ICU_BED&sort=freshness");
  await expect(page.getByText(nameBn)).toBeVisible();

  // 4. Go back to /admin and edit the hospital
  await page.goto("/admin");
  await page.getByPlaceholder(admin.searchHospitals.bn).fill(suffix);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `${admin.edit.bn} ${nameEn}` }).click();
  const editForm = page.getByTestId("hospital-form");
  await editForm.getByLabel(admin.nameBn.bn).fill(updatedNameBn);
  await editForm.getByLabel(admin.nameEn.bn).fill(updatedNameEn);
  await editForm.getByRole("button", { name: admin.save.bn }).click();
  await expect(page.getByText(admin.hospitalUpdated.bn)).toBeVisible();
  await expect(row).toContainText(updatedNameBn);

  // 5. Create a reservation at this hospital so delete triggers archive (and test active hold blocks archive)
  const hRes = await page.request.get(`/api/admin/hospitals?search=${encodeURIComponent(suffix)}`);
  const hData = await hRes.json() as { items: { id: string }[] };
  const hospitalId = hData.items[0].id;

  const projDigit = info.project.name === "mobile" ? "1" : "2";
  const citizenPhone = `018${projDigit}${String(Date.now()).slice(-7)}`;
  const citizenReq = await page.context().browser()!.newContext({ baseURL: baseURL() });
  const cApi = citizenReq.request;
  const signup = await cApi.post("/api/auth/signup", {
    data: { name: "E2E Archive Citizen", phone: citizenPhone, password: citizenPassword() },
    headers: { Origin: origin() },
  });
  expect(signup.ok()).toBeTruthy();

  const holdRes = await cApi.post("/api/reservations", {
    data: { hospitalId, resourceCode: "ICU_BED", quantity: 1 },
    headers: { Origin: origin(), "Idempotency-Key": randomUUID() },
  });
  expect(holdRes.status()).toBe(201);
  const { reservation } = await holdRes.json() as { reservation: { id: string } };

  // Reload /admin -> row now has 1 reservation -> button says Archive; active hold blocks it with 409 CONFLICT
  await page.reload();
  await page.getByPlaceholder(admin.searchHospitals.bn).fill(suffix);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: `${admin.archiveHospital.bn} ${updatedNameEn}` }).click();
  await row.getByRole("button", { name: admin.yes.bn, exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: admin.archiveBlockedByHold.bn })).toBeVisible();
  await expect(row).toBeVisible();

  // Cancel the hold -> archiving now succeeds
  const cancelRes = await cApi.post(`/api/reservations/${reservation.id}/cancel`, { headers: { Origin: origin() } });
  expect(cancelRes.ok()).toBeTruthy();
  await citizenReq.close();

  await row.getByRole("button", { name: `${admin.archiveHospital.bn} ${updatedNameEn}` }).click();
  await row.getByRole("button", { name: admin.yes.bn, exact: true }).click();
  await expect(page.getByText(admin.hospitalArchived.bn)).toBeVisible();
  await expect(row).toHaveCount(0);

  // 6. Verify archived hospital vanished from Finder
  await page.goto("/find?condition=DENGUE&area=dhanmondi&radius=5&resource=ICU_BED&sort=freshness");
  await expect(page.getByText(updatedNameBn)).toHaveCount(0);

  // 7. Also verify admin Users, Audit, and Analytics subpages render cleanly at this viewport
  for (const [subpath, testid] of [
    ["/admin/users", "admin-users-table"],
    ["/admin/audit", "admin-audit-table"],
    ["/admin/analytics", "admin-analytics"],
  ] as const) {
    await page.goto(subpath);
    await expect(page.getByTestId(testid)).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});

test("admin demo stock refresh confirmation opens and cancels cleanly", async ({ page }) => {
  await apiLogin(page, ADMIN_PHONE, adminPassword());
  await page.goto("/admin");
  await page.getByTestId("demo-refresh-btn").click();
  await expect(page.getByText(admin.refreshConfirm.bn)).toBeVisible();
  await page.getByRole("button", { name: admin.no.bn, exact: true }).click();
  await expect(page.getByText(admin.refreshConfirm.bn)).toHaveCount(0);
});
