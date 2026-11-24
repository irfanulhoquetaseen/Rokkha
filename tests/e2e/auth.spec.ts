import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { auth } from "@/lib/i18n/auth";
import { common } from "@/lib/i18n/common";

// Test-only credential for throwaway E2E accounts (not a real secret).
const PASSWORD = "e2e-pass-123456";
const DUPLICATE_PHONE_BN = "এই ফোন নম্বরে আগে থেকেই অ্যাকাউন্ট আছে";
const WRONG_CREDENTIALS_BN = "ফোন নম্বর বা পাসওয়ার্ড ভুল";

function uniquePhone(): string {
  return "017" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
}

function uniqueName(): string {
  return `E2E User ${Math.random().toString(36).slice(2, 8)}`;
}

async function apiSignup(request: APIRequestContext, baseURL: string, phone: string, name: string) {
  const res = await request.post("/api/auth/signup", {
    data: { name, phone, password: PASSWORD },
    headers: { Origin: new URL(baseURL).origin },
  });
  expect(res.status()).toBe(201);
}

async function fillSignup(page: Page, name: string, phone: string, password = PASSWORD) {
  await page.getByLabel(auth.name.bn).fill(name);
  await page.getByLabel(auth.phone.bn).fill(phone);
  await page.getByLabel(auth.password.bn).fill(password);
  await page.getByRole("button", { name: auth.signupSubmit.bn }).click();
}

async function fillLogin(page: Page, phone: string, password: string) {
  await page.getByLabel(auth.phone.bn).fill(phone);
  await page.getByLabel(auth.password.bn).fill(password);
  await page.getByRole("button", { name: auth.loginSubmit.bn }).click();
}

test("signup → logout → login shows the user in the header each time", async ({ page }) => {
  const phone = uniquePhone();
  const name = uniqueName();
  const header = page.getByRole("banner");

  await page.goto("/signup");
  await fillSignup(page, name, phone);
  await expect(page).toHaveURL(/\/$/);
  await expect(header.getByText(name)).toBeVisible();

  await header.getByRole("button", { name: auth.logout.bn }).click();
  await expect(header.getByRole("link", { name: auth.login.bn })).toBeVisible();
  await expect(header.getByText(name)).toHaveCount(0);

  await page.goto("/login");
  await fillLogin(page, phone, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(header.getByText(name)).toBeVisible();
});

test("login honours a safe ?next= path", async ({ page, request, baseURL }) => {
  const phone = uniquePhone();
  const name = uniqueName();
  await apiSignup(request, baseURL!, phone, name);

  await page.goto("/login?next=%2Fstatus");
  await fillLogin(page, phone, PASSWORD);
  await expect(page).toHaveURL(/\/status$/);
  await expect(page.getByRole("banner").getByText(name)).toBeVisible();
});

test("invalid phone shows an inline Bangla error and sends no request", async ({ page }) => {
  const authRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/auth/")) authRequests.push(r.url());
  });

  await page.goto("/signup");
  await fillSignup(page, uniqueName(), "01211111111");
  await expect(page.getByText(common.phoneInvalid.bn)).toBeVisible();
  await expect(page.getByLabel(auth.phone.bn)).toHaveAttribute("aria-invalid", "true");
  expect(authRequests).toEqual([]);
  await expect(page).toHaveURL(/\/signup$/);
});

test("language toggle switches the UI and validation messages to English", async ({ page }) => {
  await page.goto("/signup");
  await page.getByRole("banner").getByRole("button", { name: auth.switchLangLabel.bn }).click();
  await expect(page.getByRole("banner").getByRole("link", { name: auth.login.en })).toBeVisible();

  await page.getByLabel(auth.name.en).fill(uniqueName());
  await page.getByLabel(auth.phone.en).fill("01211111111");
  await page.getByLabel(auth.password.en).fill(PASSWORD);
  await page.getByRole("button", { name: auth.signupSubmit.en }).click();
  await expect(page.getByText(common.phoneInvalid.en)).toBeVisible();
});

test("duplicate signup shows the CONFLICT message", async ({ page, request, baseURL }) => {
  const phone = uniquePhone();
  await apiSignup(request, baseURL!, phone, uniqueName());

  await page.goto("/signup");
  await fillSignup(page, uniqueName(), phone);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(DUPLICATE_PHONE_BN);
  await expect(page).toHaveURL(/\/signup$/);
});

test("wrong password shows the UNAUTHENTICATED message", async ({ page, request, baseURL }) => {
  const phone = uniquePhone();
  await apiSignup(request, baseURL!, phone, uniqueName());

  await page.goto("/login");
  await fillLogin(page, phone, "definitely-wrong-1");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(WRONG_CREDENTIALS_BN);
  await expect(page).toHaveURL(/\/login$/);
});

test("login POST without an Origin header is rejected with VALIDATION_ERROR", async ({ request }) => {
  const res = await request.post("/api/auth/login", { data: { phone: "01700000021", password: "whatever-123" } });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("VALIDATION_ERROR");
});

test("GET /api/auth/me reflects the session cookie", async ({ page, baseURL }) => {
  const anon = await page.request.get("/api/auth/me");
  expect(await anon.json()).toEqual({ user: null });

  const phone = uniquePhone();
  const name = uniqueName();
  // page.request shares the browser context's cookie jar, so the session cookie is kept.
  await apiSignup(page.request, baseURL!, phone, name);
  const me = (await (await page.request.get("/api/auth/me")).json()) as { user: { name: string; role: string } };
  expect(me.user).toMatchObject({ name, role: "CITIZEN" });
});

test.describe("before hydration (no JavaScript)", () => {
  test.use({ javaScriptEnabled: false });

  test("submitting the login form never puts credentials in the URL", async ({ page }) => {
    const phone = uniquePhone();
    await page.goto("/login");
    await page.getByLabel(auth.phone.bn).fill(phone);
    await page.getByLabel(auth.password.bn).fill(PASSWORD);
    const nav = page.waitForEvent("framenavigated");
    await page.getByRole("button", { name: auth.loginSubmit.bn }).click();
    await nav;
    expect(page.url()).not.toContain(PASSWORD);
    expect(page.url()).not.toContain(phone);
    expect(page.url()).not.toContain("password=");
  });
});
