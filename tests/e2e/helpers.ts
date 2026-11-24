import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

// Shared E2E helpers (login via the API, a second device-matched browser context, hold clean-up,
// socket handshake wait). Everything works against the local test server and against BASE_URL.

export const baseURL = () => test.info().project.use.baseURL!;
/** Mutations must carry a same-origin Origin header (CSRF check). */
export const origin = () => new URL(baseURL()).origin;

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set (in .env) for E2E tests`);
  return v;
}

type Client = Page | APIRequestContext;
const requestOf = (c: Client): APIRequestContext => ("request" in c ? c.request : c);

/** Log in through the API; for a page, page.request shares the page's cookie jar. */
export async function apiLogin(client: Client, phone: string, password: string) {
  const res = await requestOf(client).post("/api/auth/login", { data: { phone, password }, headers: { Origin: origin() } });
  expect(res.ok(), `login ${phone}`).toBeTruthy();
}

/** A separate, logged-in API client (its own cookie jar). */
export async function apiClient(phone: string, password: string): Promise<APIRequestContext> {
  const req = await pwRequest.newContext({ baseURL: baseURL() });
  await apiLogin(req, phone, password);
  return req;
}

/** A second, independent browser context with the same device settings as the current project. */
export async function newProjectPage(browser: Browser): Promise<Page> {
  const { baseURL: b, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = test.info().project.use;
  const ctx = await browser.newContext({ baseURL: b, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  return ctx.newPage();
}

/** Cancel every HELD reservation of the signed-in citizen (leaves stock as it was before the holds). */
export async function cancelActive(client: Client) {
  const req = requestOf(client);
  const res = await req.get("/api/reservations");
  expect(res.ok()).toBeTruthy();
  const { items } = (await res.json()) as { items: { id: string; status: string }[] };
  for (const r of items.filter((x) => x.status === "HELD")) {
    const c = await req.post(`/api/reservations/${r.id}/cancel`, { headers: { Origin: origin() } });
    expect(c.ok(), `cancel ${r.id}`).toBeTruthy();
  }
}

/** Resolves once the page's live island has loaded its socket chunk and handshaken. Call before goto. */
export function socketHandshake(page: Page) {
  return page.waitForResponse((r) => r.url().includes("/socket.io/") && r.status() < 400, { timeout: 20_000 });
}
