import { chromium } from "playwright";
import { readFileSync } from "node:fs";
// Usage: node scripts/take-screenshots.mjs  (needs .env seed passwords + `npx playwright install chromium`)
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
    })
);
const BASE = "https://web-production-3fb89dc8.up.railway.app";
const out = "docs/screenshots";
const sizes = { mobile: { width: 360, height: 800 }, desktop: { width: 1440, height: 900 } };
const b = await chromium.launch();

async function ctx(size, dark, storageState) {
  const c = await b.newContext({
    viewport: size,
    deviceScaleFactor: 2,
    locale: "bn-BD",
    colorScheme: dark ? "dark" : "light",
    ...(storageState ? { storageState } : {}),
  });
  if (dark) {
    await c.addInitScript(() => {
      try {
        localStorage.setItem("rokkha-theme", "dark");
      } catch {}
    });
  }
  return c;
}

async function login(page, phone, pw) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator('input[name="phone"],input[type="tel"]').first().fill(phone);
  await page.locator('input[type="password"]').first().fill(pw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function shoot(page, file) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  if (overflow.scrollWidth > overflow.innerWidth) {
    console.warn(`OVERFLOW on ${file}: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`);
  }
  await page.screenshot({ path: `${out}/${file}` });
}

for (const [name, size] of Object.entries(sizes)) {
  const c = await ctx(size, false);
  const p = await c.newPage();
  const pub = { home: "/", find: "/find?condition=STROKE", "first-aid": "/first-aid/STROKE", login: "/login" };
  for (const [k, u] of Object.entries(pub)) {
    await p.goto(BASE + u, { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    await shoot(p, `${k}-${name}.png`);
  }
  await login(p, "01700000011", env.SEED_STAFF_PASSWORD);
  await p.goto(BASE + "/staff", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await shoot(p, `staff-${name}.png`);
  await c.close();

  const c2 = await ctx(size, false);
  const p2 = await c2.newPage();
  await login(p2, "01700000001", env.SEED_ADMIN_PASSWORD);
  await p2.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await p2.waitForTimeout(1200);
  await shoot(p2, `admin-${name}.png`);
  await c2.close();

  const c4 = await ctx(size, true);
  const p4 = await c4.newPage();
  await p4.goto(BASE + "/", { waitUntil: "networkidle" });
  await p4.waitForTimeout(800);
  await shoot(p4, `home-dark-${name}.png`);
  await c4.close();
}

// Tracker shots: hold ONE non-critical resource (GENERAL_BED on STROKE) via UI, screenshot /reservations/<id> at both viewports, then cancel via UI.
const cMob = await ctx(sizes.mobile, false);
const pMob = await cMob.newPage();
let trackerUrl = null;
try {
  await login(pMob, "01700000021", env.SEED_CITIZEN_PASSWORD);
  await pMob.goto(BASE + "/find?condition=STROKE&area=dhanmondi", { waitUntil: "networkidle" });
  const holdBtn = pMob.locator('[data-testid="hold-button"][data-resource="GENERAL_BED"]').first();
  await holdBtn.waitFor({ state: "visible" });
  await holdBtn.click();
  await pMob.waitForURL(/\/reservations\/[^/?]+$/, { timeout: 20_000 });
  await pMob.getByTestId("countdown").waitFor({ state: "visible" });
  await pMob.waitForLoadState("networkidle");
  await pMob.waitForTimeout(1200);
  trackerUrl = pMob.url();
  await shoot(pMob, "tracker-mobile.png");

  const storageState = await cMob.storageState();
  const cDesk = await ctx(sizes.desktop, false, storageState);
  const pDesk = await cDesk.newPage();
  await pDesk.goto(trackerUrl, { waitUntil: "networkidle" });
  await pDesk.getByTestId("countdown").waitFor({ state: "visible" });
  await pDesk.waitForTimeout(1200);
  await shoot(pDesk, "tracker-desktop.png");
  await cDesk.close();

  await pMob.getByTestId("cancel-button").click();
  await pMob.getByTestId("cancel-confirm").click();
  await pMob.locator('[data-testid="reservation-status"][data-status="CANCELLED"]').waitFor({ state: "visible", timeout: 15_000 });
} finally {
  // Safety fallback: ensure no HELD reservation remains for 01700000021
  try {
    const res = await pMob.request.get(BASE + "/api/reservations");
    if (res.ok()) {
      const { items } = await res.json();
      for (const r of items.filter((x) => x.status === "HELD")) {
        await pMob.request.post(`${BASE}/api/reservations/${r.id}/cancel`, { headers: { Origin: BASE } });
      }
    }
  } catch {}
  await cMob.close();
}

await b.close();
console.log("done", trackerUrl);
