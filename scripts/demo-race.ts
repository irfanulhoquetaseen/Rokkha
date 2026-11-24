// `npm run demo:race -- --url <base> --hospital <slug> --resource <CODE> [--n 20] [--set-available 1] [--keep] [--leave-stock]`
//
// Live concurrency demo (A05): fires N reserve requests at the same instant from up to 20 seeded
// racer accounts and shows that exactly `available` of them win. Talks to the app only over its
// public HTTP API (no DB access), so it works the same against localhost and the deployed site.
// Never prints passwords or cookies. Refuses anything that is not a demo hospital.
// Leaves the target as it found it: its own holds are cancelled (unless --keep) and a
// --set-available change is undone (unless --leave-stock), also on errors and Ctrl+C.
// Exit codes: 0 OK, 1 failure (oversold, negative stock, 5xx/network, cleanup failed),
// 2 refused/aborted, 3 warning (fewer winners than expected, stock drift, rate limited).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { config } from "dotenv";

config({ quiet: true });

// Outside the repo: it holds live session cookies.
const SESSION_FILE = join(tmpdir(), "jibonsetu-demo-race-sessions.json");
const MAX_N = 40;
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
type ReservationItem = { id: string; status: string; createdAt: string; hospital: { id: string }; resource: { code: string } };

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
    "leave-stock": { type: "boolean", default: false },
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
  writeFileSync(SESSION_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
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
/** Cancels this racer's HELD holds on `code` at the target hospital only (never elsewhere). */
async function cancelActiveHolds(cookie: string, hospitalId: string, code: string): Promise<number> {
  let cancelled = 0;
  const cutoff = Date.now() - HOLD_WINDOW_MS;
  for (let page = 1; ; page++) {
    const { res, json } = await call(`/api/reservations?page=${page}`, { cookie });
    if (!res.ok) fail(`Listing reservations failed: HTTP ${res.status} ${errCode(json)}`);
    const { items, total, pageSize } = json as { items: ReservationItem[]; total: number; pageSize: number };
    for (const r of items) {
      if (r.status !== "HELD" || r.resource.code !== code || r.hospital.id !== hospitalId) continue;
      const c = await call(`/api/reservations/${r.id}/cancel`, { method: "POST", cookie });
      if (c.res.ok) cancelled++;
      else if (errCode(c.json) !== "INVALID_TRANSITION") fail(`Cancelling an old hold failed: HTTP ${c.res.status} ${errCode(c.json)}`);
    }
    const last = items.at(-1);
    if (!last || page * pageSize >= total || Date.parse(last.createdAt) < cutoff) return cancelled;
  }
}

/** Staff `adjust` by `delta` with the current version; re-reads and retries on a 409 CONFLICT. */
async function staffAdjust(cookie: string, hospitalSlug: string, code: string, delta: (r: StockResource) => number): Promise<number> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = pickResource(await getStock(hospitalSlug), code);
    const d = delta(r);
    if (d === 0) return 0;
    const { res, json } = await call(`/api/staff/resources/${r.id}`, {
      method: "PATCH", cookie, body: { version: r.version, change: { op: "adjust", delta: d } },
    });
    if (res.ok) return d;
    if (errCode(json) !== "CONFLICT") throw new Error(`Staff adjust failed: HTTP ${res.status} ${errCode(json)}`);
    // Someone (or a sweeper release) changed it meanwhile: re-read and retry with the new version.
  }
  throw new Error("Staff adjust kept conflicting");
}

type Outcome = { outcome: string; reservationId?: string; cookie: string };

// ---------- run state (shared with the cleanup that runs on finish, error and Ctrl+C) ----------
const state = {
  slug: "",
  code: "",
  staffCookie: "",
  original: undefined as number | undefined, // available right before --set-available
  setDelta: 0, // what --set-available applied; undone by the inverse adjust
  won: [] as Outcome[], // pushed as each HELD response lands
  racing: undefined as Promise<unknown> | undefined,
  cleanupFailed: false,
  warned: false,
};

async function race(cookies: string[], hospitalId: string, code: string, n: number): Promise<{ outcomes: Outcome[]; ms: number }> {
  const t0 = performance.now();
  const all = Promise.all(
    Array.from({ length: n }, async (_, i): Promise<Outcome> => {
      const cookie = cookies[i % cookies.length]!;
      try {
        const { res, json } = await call("/api/reservations", {
          method: "POST", cookie, headers: { "Idempotency-Key": randomUUID() }, body: { hospitalId, resourceCode: code },
        });
        if (res.status === 201 || res.status === 200) {
          const o = { outcome: "HELD", reservationId: (json as { reservation: { id: string } }).reservation.id, cookie };
          state.won.push(o);
          return o;
        }
        const c = errCode(json);
        return { outcome: ["SOLD_OUT", "LIMIT_REACHED", "RATE_LIMITED"].includes(c) ? c : `other (${res.status} ${c})`, cookie };
      } catch (e) {
        return { outcome: `other (network: ${(e as Error).message})`, cookie };
      }
    }),
  );
  state.racing = all;
  const outcomes = await all;
  return { outcomes, ms: Math.round(performance.now() - t0) };
}

// ---------- cleanup (runs at most once: on finish, on error, or on Ctrl+C) ----------
let cleanupPromise: Promise<void> | undefined;

function cleanup(): Promise<void> {
  cleanupPromise ??= doCleanup();
  return cleanupPromise;
}

async function doCleanup(): Promise<void> {
  if (!state.slug) return;
  const kept = args.keep ? state.won.length : 0;
  if (!args.keep) {
    const won = state.won.splice(0);
    let ok = 0;
    await Promise.all(
      won.map(async (o) => {
        try {
          const { res, json } = await call(`/api/reservations/${o.reservationId}/cancel`, { method: "POST", cookie: o.cookie });
          if (res.ok) ok++;
          else {
            console.error(`Cancel failed: HTTP ${res.status} ${errCode(json)}`);
            state.cleanupFailed = true;
          }
        } catch (e) {
          console.error(`Cancel failed: ${(e as Error).message}`);
          state.cleanupFailed = true;
        }
      }),
    );
    console.log(`Cancelled ${ok} of ${won.length} hold(s) created by this run.`);
  } else if (kept > 0) {
    console.log(`--keep: ${kept} hold(s) left in place (they expire after 30 minutes).`);
  }

  if (state.original === undefined) return; // --set-available was not used (or never applied)
  const setTo = state.original + state.setDelta;
  if (state.setDelta !== 0 && !args["leave-stock"]) {
    try {
      await staffAdjust(state.staffCookie, state.slug, state.code, () => -state.setDelta);
    } catch (e) {
      console.error(`Stock restore failed: ${(e as Error).message}`);
      state.cleanupFailed = true;
    }
  }
  try {
    const now = pickResource(await getStock(state.slug), state.code);
    const label = args["leave-stock"] ? "left at" : "restored to";
    console.log(`Stock ${state.code}: original ${state.original} -> set to ${setTo} -> ${label} ${now.available} (total ${now.total})`);
    const expected = (args["leave-stock"] ? setTo : state.original) - kept;
    if (!state.cleanupFailed && now.available !== expected) {
      console.warn(`WARNING: expected ${expected} available now; someone else may have changed it meanwhile.`);
      state.warned = true;
    }
  } catch (e) {
    console.error(`Re-reading stock failed: ${(e as Error).message}`);
    state.cleanupFailed = true;
  }
}

// Ctrl+C: let in-flight reserve requests land (so their holds are known), then clean up once.
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) return;
  interrupted = true;
  console.error("\nInterrupted: cleaning up...");
  void (async () => {
    if (state.racing) await Promise.race([state.racing.catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await cleanup();
    process.exit(state.cleanupFailed ? 1 : 130);
  })();
});

// ---------- main ----------
async function main(): Promise<number> {
  if (!args.url || !args.hospital || !args.resource) {
    fail("Usage: npm run demo:race -- --url <base> --hospital <slug> --resource <CODE> [--n 20] [--set-available 1] [--keep] [--leave-stock]");
  }
  let base: URL;
  try {
    base = new URL(args.url);
  } catch {
    fail(`--url is not a valid URL`);
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") fail("--url must be http(s)");
  if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)) {
    console.warn("WARNING: --url is plain http:// on a non-local host; session cookies travel unencrypted.");
  }
  origin = base.origin;
  const code = args.resource.trim().toUpperCase();
  const n = parseIntArg("n", args.n, 1, MAX_N);
  const target = args["set-available"] === undefined ? undefined : parseIntArg("set-available", args["set-available"], 0, 100_000);

  // 1. Safety gate: demo hospitals and countable resources only.
  const initial = await getStock(args.hospital);
  if (initial.hospital.isDemo !== true) fail(`"${args.hospital}" is not a demo hospital; refusing to race it`);
  const slug = initial.hospital.slug;
  const hospitalId = initial.hospital.id;
  const initialRes = pickResource(initial, code);
  if (initialRes.kind !== "COUNTABLE") fail(`${code} is a STATUS resource; only COUNTABLE resources can be reserved`);
  if (target !== undefined && target > initialRes.total) fail(`--set-available ${target} exceeds total ${initialRes.total}`);

  const citizenPw = process.env.SEED_CITIZEN_PASSWORD;
  if (!citizenPw) fail("SEED_CITIZEN_PASSWORD is not set (.env)");
  const staffPw = process.env.SEED_STAFF_PASSWORD;
  const staffPhone = STAFF_BY_HOSPITAL[slug];
  if (target !== undefined && !staffPhone) fail(`--set-available needs a demo staff account; none exists for "${slug}"`);
  if (target !== undefined && !staffPw) fail("SEED_STAFF_PASSWORD is not set (.env)");

  console.log(`Target: ${origin}  hospital=${slug}  resource=${code}  n=${n}`);

  // 3. Racer sessions (reused when still valid), then clear their old holds on this resource here.
  const racers = RACER_PHONES.slice(0, Math.min(n, RACER_PHONES.length));
  const cookies: string[] = [];
  try {
    for (const phone of racers) cookies.push(await session(phone, citizenPw));
    if (target !== undefined) state.staffCookie = await session(staffPhone!, staffPw!);
  } finally {
    saveCache();
  }
  const cleared = (await Promise.all(cookies.map((c) => cancelActiveHolds(c, hospitalId, code)))).reduce((a, b) => a + b, 0);
  console.log(`Racers ready: ${cookies.length} (cleared ${cleared} earlier ${code} hold(s) at this hospital)`);

  state.slug = slug;
  state.code = code;
  let exit = 0;
  try {
    // 2. Optional: staff sets the stock to exactly `target` (after clearing, so returns can't overshoot it).
    if (target !== undefined) {
      state.setDelta = await staffAdjust(state.staffCookie, slug, code, (r) => {
        state.original = r.available;
        return target - r.available;
      });
    }

    // 4. Race.
    const before = pickResource(await getStock(slug), code);
    console.log(`Firing ${n} simultaneous reserve requests at ${code} (available ${before.available}/${before.total})...`);
    const { outcomes, ms } = await race(cookies, hospitalId, code, n);
    const after = pickResource(await getStock(slug), code);

    // 5. Report.
    const counts: Record<string, { count: number }> = { HELD: { count: 0 }, SOLD_OUT: { count: 0 }, LIMIT_REACHED: { count: 0 }, RATE_LIMITED: { count: 0 } };
    for (const o of outcomes) (counts[o.outcome] ??= { count: 0 }).count++;
    console.table(counts);
    const held = counts.HELD!.count;
    const other = outcomes.filter((o) => o.outcome.startsWith("other")).length;
    const rateLimited = counts.RATE_LIMITED!.count;
    console.table({
      "available before": { value: before.available },
      "available after": { value: after.available },
      total: { value: after.total },
      requests: { value: n },
      "elapsed ms": { value: ms },
    });

    const errors: string[] = [];
    const warnings: string[] = [];
    if (held > before.available) errors.push(`OVERSOLD: ${held} holds for ${before.available} unit(s)`);
    if (after.available < 0) errors.push(`NEGATIVE STOCK: available ${after.available}`);
    if (other > 0) errors.push(`${other} request(s) failed with a server/network error`);
    // Each racer may hold one unit of a type, so at most `racers.length` requests can ever win.
    const expectedWinners = Math.min(before.available, racers.length);
    if (held < expectedWinners) warnings.push(`only ${held} hold(s) won, expected ${expectedWinners}`);
    if (after.available !== before.available - held) {
      warnings.push(`stock moved by ${before.available - after.available}, not by ${held} (changed by someone else meanwhile?)`);
    }
    if (rateLimited > 0) warnings.push(`${rateLimited} request(s) were RATE_LIMITED`);

    for (const e of errors) console.error(`FAIL: ${e}`);
    for (const w of warnings) console.warn(`WARNING: ${w}`);
    if (errors.length > 0) exit = 1;
    else if (warnings.length > 0) exit = 3;
    else console.log(`OK: ${held} of ${n} won, ${n - held} turned away, no overselling.`);
  } finally {
    // 6. Cancel our holds (unless --keep) and undo --set-available (unless --leave-stock), even on errors.
    await cleanup();
  }
  if (state.cleanupFailed) return 1;
  if (exit === 0 && state.warned) return 3;
  return exit;
}

main().then(
  (code) => {
    if (!interrupted) process.exitCode = code;
  },
  (e: unknown) => {
    if (interrupted) return;
    console.error(e instanceof Refused ? `Refused: ${e.message}` : `Error: ${(e as Error).message}`);
    process.exitCode = state.cleanupFailed ? 1 : 2;
  },
);
