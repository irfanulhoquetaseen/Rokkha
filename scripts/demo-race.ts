// `npm run demo:race -- --url <base> --hospital <slug> --resource <CODE> [--n 20] [--set-available 1] [--keep]`
//
// Live concurrency demo (A05): fires N reserve requests at the same instant from up to 20 seeded
// racer accounts and shows that exactly `available` of them win. Talks to the app only over its
// public HTTP API (no DB access), so it works the same against localhost and the deployed site.
// Never prints passwords or cookies. Refuses anything that is not a demo hospital.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { config } from "dotenv";

config({ quiet: true });

const SESSION_FILE = ".demo-race-sessions.json";
const SESSION_COOKIE = "jibonsetu_session";
const RACER_PHONES = Array.from({ length: 20 }, (_, i) => `017000001${String(i + 1).padStart(2, "0")}`);
// Only these two demo staff accounts exist; each is bound to exactly one hospital.
const STAFF_BY_HOSPITAL: Record<string, string> = {
  "dhanmondi-care-general": "01700000011",
  "mirpur-shastho-medical": "01700000012",
};
const HOLD_WINDOW_MS = 31 * 60 * 1000; // a HELD reservation is never older than the 30-min hold

type StockResource = { id: string; code: string; kind: "COUNTABLE" | "STATUS"; available: number; total: number; version: number };
type Stock = { hospital: { id: string; slug: string; isDemo: boolean }; resources: StockResource[] };
type ApiError = { error?: { code?: string; message?: { en?: string } } };
type ReservationItem = { id: string; status: string; createdAt: string; resource: { code: string } };

class Refused extends Error {}

function fail(msg: string): never {
  throw new Refused(msg);
}

// ---------- args ----------
const { values: args } = parseArgs({
  options: {
    url: { type: "string" },
    hospital: { type: "string" },
    resource: { type: "string" },
    n: { type: "string", default: "20" },
    "set-available": { type: "string" },
    keep: { type: "boolean", default: false },
  },
  strict: true,
});

function parseIntArg(name: string, raw: string, min: number, max: number): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) fail(`--${name} must be an integer between ${min} and ${max}`);
  return v;
}

// ---------- http ----------
let origin = "";

async function call(path: string, init: { method?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { Accept: "application/json", ...init.headers };
  if (init.cookie) headers.Cookie = init.cookie;
  const method = init.method ?? "GET";
  if (method !== "GET") headers.Origin = origin; // CSRF Origin check on every mutation
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(origin + path, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const json = (await res.json().catch(() => ({}))) as unknown;
  return { res, json };
}

function errCode(json: unknown): string {
  return (json as ApiError)?.error?.code ?? "UNKNOWN";
}

async function getStock(hospital: string): Promise<Stock> {
  const { res, json } = await call(`/api/hospitals/${encodeURIComponent(hospital)}/stock`);
  if (res.status === 404) fail(`Hospital "${hospital}" not found`);
  if (!res.ok) fail(`Stock request failed: HTTP ${res.status} ${errCode(json)}`);
  return json as Stock;
}

function pickResource(stock: Stock, code: string): StockResource {
  const r = stock.resources.find((x) => x.code === code);
  if (!r) fail(`Hospital "${stock.hospital.slug}" has no resource ${code}`);
  return r;
}

// ---------- sessions (cached so repeated runs don't trip the login rate limiter) ----------
type SessionCache = Record<string, Record<string, string>>; // origin -> phone -> "name=value"

function loadCache(): SessionCache {
  try {
    return existsSync(SESSION_FILE) ? (JSON.parse(readFileSync(SESSION_FILE, "utf8")) as SessionCache) : {};
  } catch {
    return {};
  }
}

const cache = loadCache();

function saveCache() {
  writeFileSync(SESSION_FILE, JSON.stringify(cache, null, 2));
}

async function session(phone: string, password: string): Promise<string> {
  const mine = (cache[origin] ??= {});
  const cached = mine[phone];
  if (cached) {
    const { res, json } = await call("/api/auth/me", { cookie: cached });
    if (res.status === 200 && (json as { user?: { phone?: string } | null }).user?.phone === phone) return cached;
  }
  const { res, json } = await call("/api/auth/login", { method: "POST", body: { phone, password } });
  if (!res.ok) fail(`Login failed for ${phone}: HTTP ${res.status} ${errCode(json)}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) fail(`Login for ${phone} returned no session cookie`);
  mine[phone] = cookie;
  return cookie;
}

// ---------- reservations ----------
async function cancelActiveHolds(cookie: string, code: string): Promise<number> {
  let cancelled = 0;
  const cutoff = Date.now() - HOLD_WINDOW_MS;
  for (let page = 1; ; page++) {
    const { res, json } = await call(`/api/reservations?page=${page}`, { cookie });
    if (!res.ok) fail(`Listing reservations failed: HTTP ${res.status} ${errCode(json)}`);
    const { items, total, pageSize } = json as { items: ReservationItem[]; total: number; pageSize: number };
    for (const r of items) {
      if (r.status !== "HELD" || r.resource.code !== code) continue;
      const c = await call(`/api/reservations/${r.id}/cancel`, { method: "POST", cookie });
      if (c.res.ok) cancelled++;
      else if (errCode(c.json) !== "INVALID_TRANSITION") fail(`Cancelling an old hold failed: HTTP ${c.res.status} ${errCode(c.json)}`);
    }
    const last = items.at(-1);
    if (!last || page * pageSize >= total || Date.parse(last.createdAt) < cutoff) return cancelled;
  }
}

async function setAvailable(hospitalSlug: string, code: string, target: number, password: string) {
  const staffPhone = STAFF_BY_HOSPITAL[hospitalSlug];
  if (!staffPhone) fail(`--set-available needs a demo staff account; none exists for "${hospitalSlug}"`);
  const cookie = await session(staffPhone, password);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = pickResource(await getStock(hospitalSlug), code);
    if (target > r.total) fail(`--set-available ${target} exceeds total ${r.total}`);
    const delta = target - r.available;
    if (delta === 0) return;
    const { res, json } = await call(`/api/staff/resources/${r.id}`, {
      method: "PATCH", cookie, body: { version: r.version, change: { op: "adjust", delta } },
    });
    if (res.ok) return;
    if (errCode(json) !== "CONFLICT") fail(`Staff adjust failed: HTTP ${res.status} ${errCode(json)}`);
    // Someone (or a sweeper release) changed it meanwhile: re-read and retry with the new version.
  }
  fail("Staff adjust kept conflicting; try again");
}

type Outcome = { outcome: string; reservationId?: string; cookie: string };

async function race(cookies: string[], hospitalId: string, code: string, n: number): Promise<{ outcomes: Outcome[]; ms: number }> {
  const t0 = performance.now();
  const outcomes = await Promise.all(
    Array.from({ length: n }, async (_, i): Promise<Outcome> => {
      const cookie = cookies[i % cookies.length]!;
      try {
        const { res, json } = await call("/api/reservations", {
          method: "POST", cookie, headers: { "Idempotency-Key": randomUUID() }, body: { hospitalId, resourceCode: code },
        });
        if (res.status === 201 || res.status === 200) {
          return { outcome: "HELD", reservationId: (json as { reservation: { id: string } }).reservation.id, cookie };
        }
        const c = errCode(json);
        return { outcome: ["SOLD_OUT", "LIMIT_REACHED", "RATE_LIMITED"].includes(c) ? c : `other (${res.status} ${c})`, cookie };
      } catch (e) {
        return { outcome: `other (network: ${(e as Error).message})`, cookie };
      }
    }),
  );
  return { outcomes, ms: Math.round(performance.now() - t0) };
}

// ---------- main ----------
async function main(): Promise<number> {
  if (!args.url || !args.hospital || !args.resource) {
    fail("Usage: npm run demo:race -- --url <base> --hospital <slug> --resource <CODE> [--n 20] [--set-available 1] [--keep]");
  }
  let base: URL;
  try {
    base = new URL(args.url);
  } catch {
    fail(`--url is not a valid URL`);
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") fail("--url must be http(s)");
  origin = base.origin;
  const code = args.resource.trim().toUpperCase();
  const n = parseIntArg("n", args.n, 1, 200);
  const target = args["set-available"] === undefined ? undefined : parseIntArg("set-available", args["set-available"], 0, 100_000);

  // 1. Safety gate: demo hospitals and countable resources only.
  const initial = await getStock(args.hospital);
  if (initial.hospital.isDemo !== true) fail(`"${args.hospital}" is not a demo hospital; refusing to race it`);
  const slug = initial.hospital.slug;
  if (pickResource(initial, code).kind !== "COUNTABLE") fail(`${code} is a STATUS resource; only COUNTABLE resources can be reserved`);

  const citizenPw = process.env.SEED_CITIZEN_PASSWORD;
  if (!citizenPw) fail("SEED_CITIZEN_PASSWORD is not set (.env)");
  const staffPw = process.env.SEED_STAFF_PASSWORD;
  if (target !== undefined && !STAFF_BY_HOSPITAL[slug]) fail(`--set-available needs a demo staff account; none exists for "${slug}"`);
  if (target !== undefined && !staffPw) fail("SEED_STAFF_PASSWORD is not set (.env)");

  console.log(`Target: ${origin}  hospital=${slug}  resource=${code}  n=${n}`);

  // 3. Racer sessions (reused when still valid), then clear their old holds on this resource type.
  const racers = RACER_PHONES.slice(0, Math.min(n, RACER_PHONES.length));
  const cookies: string[] = [];
  try {
    for (const phone of racers) cookies.push(await session(phone, citizenPw));
  } finally {
    saveCache();
  }
  const cleared = (await Promise.all(cookies.map((c) => cancelActiveHolds(c, code)))).reduce((a, b) => a + b, 0);
  console.log(`Racers ready: ${cookies.length} (cleared ${cleared} earlier ${code} hold(s))`);

  // 2. Optional: staff sets the stock to exactly `target` (after clearing, so returns can't overshoot it).
  if (target !== undefined) {
    try {
      await setAvailable(slug, code, target, staffPw!);
    } finally {
      saveCache();
    }
  }

  // 4. Race.
  const before = pickResource(await getStock(slug), code);
  console.log(`Firing ${n} simultaneous reserve requests at ${code} (available ${before.available}/${before.total})...`);
  const { outcomes, ms } = await race(cookies, initial.hospital.id, code, n);
  const after = pickResource(await getStock(slug), code);

  // 5. Report.
  const counts: Record<string, { count: number }> = { HELD: { count: 0 }, SOLD_OUT: { count: 0 }, LIMIT_REACHED: { count: 0 }, RATE_LIMITED: { count: 0 } };
  for (const o of outcomes) (counts[o.outcome] ??= { count: 0 }).count++;
  console.table(counts);
  const held = counts.HELD!.count;
  console.table({
    "available before": { value: before.available },
    "available after": { value: after.available },
    total: { value: after.total },
    requests: { value: n },
    "elapsed ms": { value: ms },
  });
  let exit = 0;
  if (held > before.available) {
    console.error(`OVERSOLD: ${held} holds for ${before.available} unit(s)`);
    exit = 1;
  }
  if (after.available < 0) {
    console.error(`NEGATIVE STOCK: available ${after.available}`);
    exit = 1;
  }
  if (exit === 0) console.log(`OK: ${held} of ${n} won, no overselling.`);

  // 6. Clean up our own holds unless --keep.
  if (!args.keep) {
    const won = outcomes.filter((o) => o.reservationId);
    await Promise.all(
      won.map(async (o) => {
        const { res, json } = await call(`/api/reservations/${o.reservationId}/cancel`, { method: "POST", cookie: o.cookie });
        if (!res.ok) console.error(`Cancel failed: HTTP ${res.status} ${errCode(json)}`);
      }),
    );
    const restored = pickResource(await getStock(slug), code);
    console.log(`Cancelled ${won.length} hold(s); restored stock: ${restored.available}/${restored.total}`);
  } else {
    console.log("--keep: holds left in place (they expire after 30 minutes).");
  }
  return exit;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof Refused ? `Refused: ${e.message}` : `Error: ${(e as Error).message}`);
    process.exitCode = 2;
  },
);
