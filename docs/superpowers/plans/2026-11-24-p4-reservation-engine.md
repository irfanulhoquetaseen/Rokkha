# P4 Reservation Engine (A05) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A citizen can hold a scarce hospital resource for 30 minutes with correctness under any concurrency (never oversold, never double-returned, idempotent retries), follow it on a tracker, and hospital staff work the hold through check-in / reject / complete.

**Architecture:** All reservation writes go through `src/server/reservations/` — `state-machine.ts` (single source of truth for transitions + stock-return rules, compare-and-set), `reserve.ts` (one interactive transaction: user advisory lock → limits → conditional decrement → rows), `sweeper.ts` (expiry). Stock is changed only by conditional SQL (`updateMany … available >= qty` to take, `LEAST(total, available + qty)` to return). Route handlers under `/api/reservations/*` and `/api/staff/*` call these services; post-commit hooks call `src/server/realtime/publish.ts` (real emits; P5 adds room authorization and clients).

**Tech Stack:** Next.js 16.4 App Router (custom `server.ts`), TypeScript strict, Prisma 7.10 + `@prisma/adapter-pg`, Postgres 18, Zod 4, Vitest 5 (integration against real `DATABASE_URL_TEST`), Playwright 1.65.

**Spec:** `CLAUDE.md` §3.1, §1 (modules 1+3), §7, §8; `docs/PLAN.md` P4; `docs/prompts/NEXT_PROMPT_3.md` STEP 0, 0b, 1; `PROGRESS.md` "Must-do in P4".

## Global Constraints
- All earlier constraints apply: one error shape `{ error: { code, message: {bn,en}, details? } }`; 404 never 403 for foreign rows (audited `AUTHZ_DENIED`); Zod on every input; Origin check on every mutation (`apiHandler(..., { mutation: true })`); user/role/hospital always from the session; `cacheComponents` rules (request-time reads inside `<Suspense>`, route handlers via `apiHandler` which awaits `connection()`).
- Integration tests use only the `*_test` DB (`tests/support/db.ts` `resetDb()` in `beforeEach`), never mocks. Concurrency tests must be truly parallel: `Promise.all`/`allSettled` over service calls — the Prisma pg adapter pool hands each interactive transaction its own connection (assert `≥ 2` distinct `pg_backend_pid()` in one test to prove it).
- Never read-then-write stock. Take: `updateMany({ where: { id, available: { gte: qty } }, data: { available: { decrement: qty }, version: { increment: 1 } } })`. Return: raw SQL `SET "available" = LEAST("total", "available" + qty), "version" = "version" + 1`.
- Reservation-driven stock changes do **not** touch `HospitalResource.updatedAt` (freshness = last staff confirmation); they always bump `version`.
- Hold length `HOLD_MINUTES = 30`; limits `MAX_ACTIVE_TOTAL = 2`, 1 active per resource type; active = `HELD | ARRIVED`.
- Every transition is CAS `WHERE id = ? AND status = <expected>` (Prisma `updateMany`, `count === 0` → re-read → `INVALID_TRANSITION` with `details.status`), writes `ReservationEvent` + `AuditLog` (`RESERVATION_TRANSITION`) in the same transaction, emits only after commit.
- Stock return rules: CANCELLED / EXPIRED / REJECTED → return; COMPLETED → return only when `ResourceType.consumable === false`; ARRIVED → none.
- All new UI strings live in `src/lib/i18n/reservations.ts` (bn + en). Touch targets ≥ 44 px, mobile first, buttons disabled while submitting. No new npm dependencies.
- E2E account allocation (mobile and desktop projects run in parallel on one DB, and must not share holds): `reservations.spec` mobile citizen `01700000021` + arranger racer `…102`, desktop citizen `01700000022` + arranger `…103`; `staff-queue.spec` mobile `01700000023`, desktop `…101`; P5 `realtime-finder` `…104/…105`, `realtime-staff` `…106/…107`, `realtime-acceptance` `…108`–`…115`. `demo:race` uses all 20 racers and is never run while E2E runs.
- Commit after every task (conventional message, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); do not push (the controller pushes).

## Review Focus
- A hold that expired while the citizen/staff screen was open: cancel / check-in / reject return `INVALID_TRANSITION` with a bn/en "This hold has expired" message and the stock comes back exactly once (Task 3 test `actions on an overdue hold expire it first`).
- Staff lowered `total` below `available + held` while holds exist; a later cancel must not violate the CHECK (clamp test in Task 3 `return clamps to total`).
- Double-click / network retry on "Hold": the same `Idempotency-Key` returns the original 201 body, a different body with that key → 409 CONFLICT (Task 4 tests; Task 7 UI keeps the key until a definitive answer).
- A `SOLD_OUT` hold attempt is still recorded as unmet demand (`SoldOutEvent`) even though the response is an error (Task 4 test `sold out writes SoldOutEvent`).
- Server restarts with holds overdue: the boot sweep expires them and returns stock; a fresh/unmigrated DB only logs (Task 5 tests).

---

### Task 1: Schema + seed carry-overs (isDemo, user FK, idempotency hash, safe stock reset, racer accounts)

**Files:**
- Modify: `prisma/schema.prisma`; Create: `prisma/migrations/<ts>_p4_reservations/migration.sql` (generate with `npx prisma migrate dev --create-only --name p4_reservations` against the **test** DB URL, review the SQL, then hand-edit if needed)
- Modify: `src/server/seed/run-seed.ts`, `prisma/data/hospitals.ts` (only if needed), `.env.example` (comment for `SEED_RESET_STOCK`)
- Test: `tests/integration/seed.test.ts`, `tests/integration/constraints.test.ts`

**Interfaces — Produces:**
- `Hospital.isDemo Boolean @default(false)`; every seeded hospital upserted with `isDemo: true`.
- `Reservation.user User @relation(fields: [userId], references: [id], onDelete: Restrict)`, `User.reservations Reservation[]`.
- `Reservation.requestHash String` (sha256 hex of the canonical reserve body; required, no default — table is empty everywhere), `Reservation.rejectedAt DateTime?`, `Reservation.expiredAt DateTime?`.
- `DEMO_RACERS`: 20 extra citizen accounts, phones `01700000101` … `01700000120`, names `Demo Racer 01` … `Demo Racer 20`, password = `SEED_CITIZEN_PASSWORD` (used only by `npm run demo:race` and concurrency E2E). Export `DEMO_RACER_PHONES: string[]` from `run-seed.ts`.
- `SEED_RESET_STOCK=1`: per row, `available = GREATEST(0, seedAvailable - activeHeldQty)` where `activeHeldQty = SUM(quantity)` of that row's reservations with status `HELD | ARRIVED`; `total` = seed total but never below `activeHeldQty` (`GREATEST(seedTotal, activeHeldQty)`). Done in the same single `UPDATE … FROM unnest(...)` statement with a correlated subquery — never breaks the CHECK, never strands a hold.

- [ ] **Step 1: Failing tests**
  - seed.test: `every seeded hospital is a demo hospital` (`count({ where: { isDemo: false } }) === 0`).
  - seed.test: `seed creates the 20 demo racer citizens` (all 20 phones exist with role CITIZEN; total users = 26).
  - seed.test: `reset stock subtracts active holds` — seed, create a HELD reservation of qty 2 and an ARRIVED of qty 1 on Dhanmondi `ICU_BED` (seed [6,1] → choose a row with seed available ≥ 3, e.g. Dhanmondi `GENERAL_BED` [120,74]) by inserting rows directly + decrementing available, re-seed with `resetStock: true` → `available === 74 - 3`; a CANCELLED reservation on the same row is ignored.
  - seed.test: `reset stock never goes negative` — HELD qty > seed available (Dhanmondi `ICU_BED` seed available 1, hold qty 2 with total raised first) → after reset `available === 0`, CHECK holds.
  - constraints.test: `reservation userId must reference a user` — raw insert with a random userId fails with FK violation (`23503`).
- [ ] **Step 2:** Run `npm run test:integration -- seed constraints` → FAIL.
- [ ] **Step 3:** Schema + migration + seed changes as above.
- [ ] **Step 4:** `npm run test:integration` (whole suite, other tests may need `requestHash` in direct inserts — fix them) → PASS; `npm run typecheck && npm run lint` → PASS.
- [ ] **Step 5:** Commit `feat(db): demo flag, reservation user FK, idempotency hash, hold-aware stock reset`.

### Task 2: Demo hospitals never ring a real phone

**Files:**
- Modify: `src/server/finder/search.ts` (select `isDemo` into `HospitalInfo` and `DirectoryEntry`), `src/components/finder/HospitalCard.tsx`, `src/components/finder/DirectoryList.tsx`, `src/lib/i18n/finder.ts`
- Create: `src/components/finder/HospitalPhone.tsx` (server component, shared by both)
- Test: `tests/e2e/finder.spec.ts`, `tests/integration/finder-search.test.ts`

**Interfaces — Produces:** `HospitalPhone({ phone, isDemo, name, lang })`: when `isDemo` → visible number (`dir="ltr"`) + a `DEMO` badge + a `<button type="button" disabled aria-disabled="true" title="Demo hospital — calling disabled">` (bn: "ডেমো হাসপাতাল — কল বন্ধ"), `data-testid="demo-phone"`, **no `tel:` link**; otherwise today's `tel:` link. `Call999Button` unchanged (`tel:999`).

- [ ] **Step 1: Failing tests**
  - finder-search.test: `results and directory carry isDemo`.
  - finder.spec (both projects): on `/find?condition=STROKE`, `page.locator('a[href^="tel:"]:not([href="tel:999"])')` has count 0; `a[href="tel:999"]` count ≥ 1; first `[data-testid="demo-phone"]` contains text `DEMO` and its button is disabled with the title above.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test`, `npx playwright test tests/e2e/finder.spec.ts` → PASS; typecheck/lint PASS.
- [ ] **Step 5:** Commit `fix(finder): demo hospitals show a disabled call button instead of a tel: link`.

### Task 3: State machine, transitions and stock return

**Files:**
- Create: `src/server/reservations/state-machine.ts`, `src/server/reservations/transition.ts`, `src/server/reservations/stock.ts`, `src/server/reservations/constants.ts`, `src/server/realtime/publish.ts`
- Modify: `src/lib/i18n/` (create `reservations.ts`)
- Test: `tests/unit/state-machine.test.ts`, `tests/integration/reservation-transition.test.ts`, `tests/support/fixtures.ts` (create: `makeHospitalWithStock`, `makeUser`, `makeHeld` helpers shared by Tasks 3–6)

**Interfaces — Produces:**
- `constants.ts`: `HOLD_MINUTES = 30`, `MAX_ACTIVE_TOTAL = 2`, `ACTIVE_STATUSES = ["HELD","ARRIVED"] as const`.
- `state-machine.ts` (pure): `TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]>` = HELD→[ARRIVED, CANCELLED, EXPIRED, REJECTED], ARRIVED→[COMPLETED], others→[]; `canTransition(from, to): boolean`; `returnsStock(to, consumable): boolean`; `type Actor = { kind: "citizen" | "staff" | "system"; userId: string | null }`; `ACTION_TARGET = { cancel: "CANCELLED", checkIn: "ARRIVED", reject: "REJECTED", complete: "COMPLETED", expire: "EXPIRED" }`.
- `stock.ts`: `takeStock(tx, hospitalResourceId, qty): Promise<boolean>` (conditional decrement), `returnStock(tx, hospitalResourceId, qty): Promise<void>` (LEAST clamp, version+1), `readStock(tx, id): Promise<StockSnapshot>`; `type StockSnapshot = { id; hospitalId; resourceTypeId; code; available; total; isAvailable; version; updatedAt }`.
- `transition.ts`: `transitionReservation(tx, { reservationId, to: ReservationStatus, actor: Actor, reason?: string, now: Date }): Promise<TransitionResult>`; `type TransitionResult = { reservation: Reservation; from: ReservationStatus; stock: StockSnapshot | null /* non-null when stock was returned */ }`. CAS `updateMany({ where: { id, status: from, ...(to === "EXPIRED" ? { expiresAt: { lte: now } } : to === "ARRIVED" ? { expiresAt: { gt: now } } : {}) }, data: { status: to, version: { increment: 1 }, <timestamp field>: now, rejectedReason } })`; `from` = the single allowed predecessor of `to` (ARRIVED for COMPLETED, HELD otherwise). Count 0 → throw `INVALID_TRANSITION` (`details: { status: current }`; message "This hold has expired" when current is EXPIRED or overdue HELD).
- Public service functions (each runs its own `prisma.$transaction`, then `publishAfterCommit`):
  - `cancelReservation(user: SessionUser | null, reservationId): Promise<ReservationView>` — owner only (`requireReservationOwner`), HELD→CANCELLED.
  - `staffTransition(user, reservationId, action: "checkIn" | "reject" | "complete", reason?: string): Promise<ReservationView>` — `requireHospitalAccess(user, reservation.hospitalId)` (missing → NOT_FOUND before access check reveals nothing); `reject` requires `reason` 3–300 chars (VALIDATION_ERROR).
  - Every citizen/staff action first expires the row if it is HELD and overdue (same tx, via `transitionReservation(..., "EXPIRED")`), then throws `INVALID_TRANSITION` "expired".
  - `type ReservationView = { id; status; quantity; expiresAt; createdAt; arrivedAt; completedAt; cancelledAt; rejectedAt; expiredAt; rejectedReason; version; hospital: { id; slug; nameBn; nameEn; phone; isDemo }; resource: { code; nameBn; nameEn; consumable }; events: { toStatus; fromStatus; createdAt; note }[] }` and `toReservationView(row)` in `src/server/reservations/view.ts`.
- `publish.ts`: `publishStock(s: StockSnapshot)` → `getIO()?.to(["finder", `hospital:${s.hospitalId}`, `staff:${s.hospitalId}`]).emit("stock:changed", s)`; `publishReservation(r: { id; status; version; hospitalId; userId; expiresAt })` → rooms `reservation:${id}`, `staff:${hospitalId}`, event `reservation:changed`. No-ops when `getIO()` is undefined (tests, seed). Service functions call these **after** `$transaction` resolves.

- [ ] **Step 1: Failing unit tests** (`state-machine.test.ts`): every allowed pair true; every other pair of the 6×6 matrix false; `returnsStock` table: CANCELLED/EXPIRED/REJECTED × {true,false} → true; COMPLETED+consumable → false; COMPLETED+non-consumable → true; ARRIVED → false.
- [ ] **Step 2: Failing integration tests** (`reservation-transition.test.ts`, fixtures create hospital + ICU_BED (non-consumable) + ANTIVENOM (consumable) rows and a HELD reservation that already decremented stock):
  - `cancel returns stock and writes event + audit` (available +1, version +1, `updatedAt` unchanged, 1 ReservationEvent HELD→CANCELLED, 1 audit `RESERVATION_TRANSITION`).
  - `another citizen cancelling gets NOT_FOUND` (+ AUTHZ_DENIED audit).
  - `staff check-in then complete returns a bed` / `complete does not return a consumable`.
  - `reject requires a reason` (VALIDATION_ERROR, nothing changed) / `reject returns stock`.
  - `staff of another hospital gets NOT_FOUND`.
  - `return clamps to total` (hold qty 1, then staff `set` total = available = 0 via `updateHospitalResource`, cancel → available 0, no CHECK error).
  - `actions on an overdue hold expire it first` (expiresAt in past; cancel → INVALID_TRANSITION, status EXPIRED, stock returned once).
  - `double check-in: exactly one ARRIVED` (race test 6: `Promise.allSettled` ×2 → 1 fulfilled, 1 `INVALID_TRANSITION`).
  - `cancel, reject and expire race on a live hold: one wins, stock returned once` (race test 5a: `cancelReservation` ∥ `staffTransition(reject)` ∥ `expireOverdue(now)` [Task 5 — if not yet present, call `transitionReservation(...EXPIRED)` in its own tx] → exactly one of CANCELLED/REJECTED, available = start + 1, terminal events = 1).
  - `cancel, reject and expire race on an overdue hold: one EXPIRED, stock returned once` (race test 5b).
  - `transactions run on separate connections` (two parallel `$transaction`s each `SELECT pg_backend_pid()` while holding `pg_sleep(0.2)` → distinct pids).
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** `npm test` PASS ×2 consecutive runs (flake check); typecheck/lint PASS.
- [ ] **Step 6:** Commit `feat(reservations): state machine with compare-and-set transitions and clamped stock return`.

### Task 4: `reserve()` — one transaction, limits, idempotency, sold-out alternatives

**Files:**
- Create: `src/server/reservations/reserve.ts`, `src/server/reservations/alternatives.ts`, `src/server/reservations/schemas.ts`
- Test: `tests/integration/reserve.test.ts`, `tests/integration/reserve-concurrency.test.ts`

**Interfaces:**
- Consumes: Task 3 `takeStock`, `readStock`, `transitionReservation`, `publishStock`, `publishReservation`, `toReservationView`, constants; P3 `searchHospitals(params)`.
- Produces:
  - `reserveBodySchema = z.object({ hospitalId: z.string().min(1).max(64), resourceCode: z.string().regex(/^[A-Z0-9_]{1,40}$/), quantity: z.number().int().min(1).max(4).default(1), conditionCode: z.string().regex(/^[A-Z0-9_]{1,40}$/).optional(), bloodGroup: <BloodGroup enum>.optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() })`; `idempotencyKeySchema = z.uuid()`.
  - `reserve(user: SessionUser | null, input: { idempotencyKey: string; body: ReserveBody }, now = new Date()): Promise<{ reservation: ReservationView; replayed: boolean }>`; role must be CITIZEN (others → NOT_FOUND via `requireRole`).
  - `requestHash(body)` = sha256 of JSON with keys `hospitalId,resourceCode,quantity,conditionCode` in that order (lat/lng/blood excluded — they only shape alternatives).
  - `findAlternatives({ resourceCode, quantity, conditionCode?, bloodGroup?, origin?, excludeHospitalId }): Promise<Alternative[]>` — up to 3; with `conditionCode`: `searchHospitals({ condition, blood, lat, lng, resource: resourceCode, sort: "score", page: 1 })` results filtered to suitable, excluding the hospital, whose `resourceCode` row has `available >= quantity`; without: live hospitals with that row `available >= quantity`, nearest first when origin else most available. `type Alternative = { hospitalId; slug; nameBn; nameEn; distanceKm: number | null; available: number; score: number | null; isDemo: boolean }`.
- Algorithm (all inside one `prisma.$transaction(async tx => …, { timeout: 10_000 })`):
  1. `SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 0))`.
  2. Existing row by `idempotencyKey`: same user + same `requestHash` → return it, `replayed: true` (HTTP 200); different hash or different user → `CONFLICT` "This request key was already used for a different request".
  3. Expire this user's overdue HELD rows (`transitionReservation …EXPIRED`), collecting stock snapshots to publish.
  4. Resolve `HospitalResource` by (hospitalId, resourceType.code); missing, `STATUS` kind, or hospital `liveDataEnabled=false` → `NOT_FOUND` / `VALIDATION_ERROR` ("This resource cannot be held").
  5. Active rows of user: same `resourceTypeId` → `LIMIT_REACHED` (`details: { reason: "SAME_TYPE", reservationId }`); count ≥ 2 → `LIMIT_REACHED` (`details: { reason: "MAX_ACTIVE", max: 2 }`).
  6. `takeStock(qty)` false → create `SoldOutEvent { hospitalId, resourceTypeId, conditionId, userId }`, return a sold-out marker (transaction **commits** so the event persists). After commit throw `SOLD_OUT` with `details: { alternatives }` (alternatives computed after commit).
  7. Create Reservation (`HELD`, `expiresAt = now + 30 min`, `requestHash`, `conditionId` resolved from code or null) + ReservationEvent (null→HELD, actor user) + audit `RESERVATION_TRANSITION` (`after: { status: "HELD", quantity }`).
  8. Unique violation on `idempotencyKey` (P2002) or on `reservation_one_active_per_type` caught outside → re-read by key / map to `LIMIT_REACHED` (defence in depth; the advisory lock should make these unreachable).
  9. After commit: `publishStock`, `publishReservation`.

- [ ] **Step 1: Failing tests (`reserve.test.ts`)**: `holds one unit for 30 minutes` (status HELD, expiresAt = now+30m ±1s, available −1, version +1, event + audit); `staff and admin cannot reserve` (NOT_FOUND); `anonymous → UNAUTHENTICATED`; `same type twice → LIMIT_REACHED SAME_TYPE`; `third active hold → LIMIT_REACHED MAX_ACTIVE`; `limit frees after cancel`; `overdue own hold is expired lazily and does not count`; `sold out writes SoldOutEvent and returns ≤3 alternatives that have the resource` (seed 3 more hospitals with ICU, one excluded because available 0, current hospital excluded); `status resource cannot be held`; `directory-only hospital cannot be held`; `replay same key + same body returns the original with replayed=true and no second decrement`; `same key with a different body → CONFLICT`; `same key from another user → CONFLICT`; `non-uuid key → VALIDATION_ERROR`.
- [ ] **Step 2: Failing tests (`reserve-concurrency.test.ts`)** — each creates its users first, then fires calls with `Promise.allSettled`, then asserts on DB rows (not only return values) and `available >= 0`:
  1. `20 users race for the last unit` → 1 fulfilled, 19 `SOLD_OUT`, `available === 0`, HELD rows = 1, SoldOutEvent = 19.
  2. `30 requests for 10 units` (30 users) → 10 HELD, 20 SOLD_OUT, available 0.
  3. `one user fires 5 parallel reserves for the same type` (5 different keys) → 1 HELD, 4 LIMIT_REACHED, available = start − 1.
  4. `same idempotency key ×10 in parallel` → 10 fulfilled with the same reservation id, exactly 1 row, available = start − 1.
  - Extra: `one user, 5 parallel reserves for 5 different types` → exactly 2 HELD, 3 LIMIT_REACHED.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** `npm test` PASS ×3 consecutive runs; typecheck/lint PASS.
- [ ] **Step 6:** Commit `feat(reservations): transactional reserve with advisory lock, limits, idempotency and sold-out alternatives`.

### Task 5: Expiry sweeper (interval + boot + lazy) and fresh-DB tolerance

**Files:**
- Create: `src/server/reservations/sweeper.ts`
- Modify: `server.ts`
- Test: `tests/integration/sweeper.test.ts`

**Interfaces — Produces:**
- `expireOverdue(now = new Date(), opts?: { hospitalId?: string; userId?: string; limit?: number /* default 200 */ }): Promise<number>` — selects overdue HELD ids (index `status, expiresAt`), expires each in its own short transaction via `transitionReservation(... "EXPIRED", actor system)`, swallowing `INVALID_TRANSITION` (someone else won), publishes after each commit; returns the number this call expired.
- `startExpirySweeper({ intervalMs = 30_000, log = console }): { stop(): void }` — runs once immediately, then every `intervalMs`; never overlaps (skip tick if previous still running); any error is logged as `[sweeper] <name> <code>` (e.g. Prisma `P2021` table missing, `ECONNREFUSED`) and retried next tick, never thrown/unhandled. Timer `unref()`'d. `server.ts` starts it after `listen` and stops it in `shutdown`.

- [ ] **Step 1: Failing tests:** `expires overdue holds and returns stock`; `leaves live holds alone`; `scoped by hospitalId / userId`; `two sweeps in parallel return stock exactly once` (race test 7 variant); `sweeper and citizen cancel racing on an overdue hold → stock returned once, one terminal event` (race test 7); `sweeper and citizen cancel racing on a live hold → CANCELLED, sweeper 0`; `startExpirySweeper survives a failing tick` (pass a `run` override or point at a function that throws once → `log.error` called, second tick runs; use `intervalMs: 50`, `vi.waitFor`).
- [ ] **Step 2: Fresh-DB check (manual, record result in task report):** create an empty DB `jibonsetu_fresh_test` is NOT allowed to be created by the agent without asking → instead verify by unit test with an injected run function throwing a `PrismaClientKnownRequestError`-shaped `{ code: "P2021" }` error; and run `npm run dev` with `DATABASE_URL` pointing at a nonexistent database name on the test server (`…/jibonsetu_nonexistent_test`) for ~5 s: server must print `ready` and `[sweeper]` errors, and not exit.
- [ ] **Step 3:** FAIL → implement → PASS; typecheck/lint PASS.
- [ ] **Step 4:** Commit `feat(reservations): expiry sweeper on boot and every 30 s, tolerant of an unmigrated database`.

### Task 6: Reservation + staff queue + public stock API routes

**Files:**
- Create: `src/app/api/reservations/route.ts` (POST reserve, GET mine), `src/app/api/reservations/[reservationId]/route.ts` (GET), `src/app/api/reservations/[reservationId]/cancel/route.ts` (POST), `src/app/api/staff/hospitals/[hospitalId]/reservations/route.ts` (GET queue), `src/app/api/staff/reservations/[reservationId]/route.ts` (POST transition), `src/app/api/hospitals/[hospital]/stock/route.ts` (GET public; `hospital` = id or slug), `src/server/reservations/queries.ts`
- Modify: `src/server/auth/rate-limit.ts` (add `reserveLimiterByUser = createRateLimiter({ limit: envLimit("RESERVE_LIMIT_PER_USER", 20), windowMs: 60_000 })`), `.env.example`
- Test: `tests/integration/reservations-api.test.ts`

**Interfaces — Produces:**
- `POST /api/reservations` — header `Idempotency-Key` (uuid, required → VALIDATION_ERROR), body `reserveBodySchema` → 201 `{ reservation }` (200 when replayed); errors per Task 4 (`SOLD_OUT` body `details.alternatives`). Rate limited per user (`RATE_LIMITED` 429 + `Retry-After`). Authenticate before parsing body.
- `GET /api/reservations?page=` → `{ items: ReservationView[], page, pageSize: 10, total }` mine only, newest first; lazily expires the user's overdue holds first.
- `GET /api/reservations/:id` → `{ reservation }` (owner/admin, else 404); lazily expires it if overdue.
- `POST /api/reservations/:id/cancel` → `{ reservation }`.
- `GET /api/staff/hospitals/:hospitalId/reservations?status=&q=&sort=&page=` → `{ items: StaffReservationRow[], page, pageSize: 10, total }`; `status` ∈ `ACTIVE` (default: HELD+ARRIVED) | one `ReservationStatus` | `ALL`; `q` (≤ 64 chars) matches citizen name (insensitive contains), citizen phone (contains) or reservation id prefix; `sort` ∈ `expiresAt` (default, asc) | `newest` | `oldest`; lazily expires that hospital's overdue holds first. `StaffReservationRow = ReservationView & { citizen: { name; phone } }`.
- `POST /api/staff/reservations/:id` body `{ action: "checkIn" | "reject" | "complete", reason?: string }` → `{ reservation }`.
- `GET /api/hospitals/:hospital/stock` (public, `Cache-Control: no-store`) → `{ hospital: { id, slug, nameBn, nameEn, isDemo, liveDataEnabled }, resources: StockSnapshot[] /* sorted by ResourceType.sortOrder */ }`; unknown → 404.
- `listMyReservations(user, page)`, `getMyReservation(user, id)`, `listHospitalQueue(user, hospitalId, filters)`, `getHospitalStock(idOrSlug)` in `queries.ts` (each one query + `include`, no N+1; Zod for filters).

- [ ] **Step 1: Failing tests** (route handlers called directly with `new Request(...)`, real session cookies via `createSession`, `Origin` header): POST without key → 400; with non-uuid key → 400; anonymous → 401; happy path 201 then same key → 200 identical body; SOLD_OUT → 409 with `details.alternatives`; missing Origin → 400; 21st request in a minute → 429; GET mine shows only own; GET foreign id → 404; cancel → 200 then again → 409 INVALID_TRANSITION; staff queue: own hospital 200 with citizen name/phone, filter `status=ARRIVED`, `q` by phone, pagination `total`; other hospital → 404; staff transition reject without reason → 400; public stock by slug and by id → 200 and no-store; unknown → 404.
- [ ] **Step 2–4:** FAIL → implement → PASS; typecheck/lint PASS.
- [ ] **Step 5:** Commit `feat(api): reservation, staff queue and public stock endpoints`.

### Task 7: Citizen UI — hold from Finder, login round-trip, tracker, my reservations

**Files:**
- Modify: `src/server/finder/search.ts` (add `holdable` per result), `src/components/finder/HospitalCard.tsx`, `src/app/find/page.tsx` (pass `signedIn`, `bloodGroup`, location to cards), `src/proxy.ts` (gate `/reservations` and `/reservations/:id` → 307 login with `next`), `src/components/SiteHeader.tsx` (citizen link "My reservations")
- Create: `src/components/reservations/HoldButton.tsx` (client), `src/components/reservations/SoldOutPanel.tsx` (client), `src/components/reservations/Tracker.tsx` (client: countdown + cancel), `src/components/reservations/StatusBadge.tsx`, `src/app/reservations/page.tsx`, `src/app/reservations/[reservationId]/page.tsx`, `src/lib/api-client.ts` (tiny `postJson(url, body, { idempotencyKey? })` returning `{ ok, status, data | error }`, network errors → `{ ok: false, network: true }`)
- Test: `tests/integration/finder-search.test.ts`, `tests/e2e/reservations.spec.ts`

**Interfaces — Produces:**
- `FinderResult.results[n].holdable: { code; nameBn; nameEn; available; quantity: 1; consumable: boolean }[]` — COUNTABLE requirement resources of the condition with `available >= 1`, plus for a blood requirement the best compatible blood row (patient's exact group first, then other compatible donors by most available; unknown group → `BLOOD_O_NEG` only); empty for not-suitable hospitals is allowed (still holdable if stock exists — keep it, staff decide).
- `HoldButton({ hospitalId, resource, conditionCode, bloodGroup?, origin?, signedIn, loginHref, lang })`: not signed in → `<a href=loginHref>` "Log in to hold" (`loginHref = /login?next=<current finder URL>`); signed in → button "Hold <name> for 30 min (<available> left)" `data-testid="hold-button"`; one `crypto.randomUUID()` key kept in a ref from first click until a definitive response (2xx/4xx); network error/5xx → message "Network problem — try again" and the retry reuses the key; disabled + "Holding…" while submitting; 201/200 → `router.push(/reservations/<id>)`; SOLD_OUT → `SoldOutPanel` listing alternatives (name, distance, available) each with its own HoldButton (new key); LIMIT_REACHED → message + link `/reservations`.
- Tracker page `/reservations/[id]` (owner only; foreign → `notFound()`): hospital name + phone (via `HospitalPhone`), resource, status badge (`data-testid="reservation-status"` holds the raw status as `data-status`), live countdown `mm:ss` (`data-testid="countdown"`) to `expiresAt` that switches to "Expired" at 0 and then refetches `GET /api/reservations/:id`, cancel button (HELD only, confirm via an inline second click "Tap again to cancel" — never `window.confirm`), event timeline, Call 999, and first-aid link if `conditionCode`.
- `/reservations`: paginated list (10) with status badge and link.

- [ ] **Step 1: Failing tests:** finder-search: `holdable lists countable requirement stock and compatible blood` (TRAUMA + `blood=A_POS` → includes `BLOOD_A_POS` when available, falls back to `BLOOD_O_NEG` when A+ is 0; STATUS resources never holdable). E2E `reservations.spec.ts` (each project uses its own citizen: mobile `01700000021`, desktop `01700000022`; resets by cancelling its own active holds in `beforeEach` via API): `logged-out hold goes to login and back` (lands on the same finder URL); `hold → tracker shows HELD and a countdown → cancel → CANCELLED`; `second hold of the same type shows LIMIT_REACHED`; `sold-out shows alternatives` (open the STROKE finder, then an "arranger" racer takes the last unit through the API — mobile: racer `01700000102` on Dhanmondi `ICU_BED` [6,1]; desktop: racer `01700000103` on the seeded Karnaphuli last-unit `ICU_BED` [4,1] (pick a finder URL — condition/area — where that card is on page 1) — then the UI clicks that card's now-stale ICU hold button → SoldOutPanel visible with ≥ 1 alternative; afterEach cancels the arranger's hold); `double click creates one hold` (dblclick on the button → GET /api/reservations has exactly 1 new active item); `foreign tracker is 404`.
- [ ] **Step 2–4:** FAIL → implement → PASS on both projects; Finder first-load JS still < 150 KB gzip (`npm run build` and check the route's client chunks; report the number); typecheck/lint PASS.
- [ ] **Step 5:** Commit `feat(reservations): hold from finder, tracker with countdown and cancel, my reservations`.

### Task 8: Staff reservation queue + staff E2E restore by inverse adjust

**Files:**
- Create: `src/components/staff/ReservationQueue.tsx` (client), Modify: `src/app/staff/hospitals/[hospitalId]/page.tsx` (render queue under the resources, initial page server-rendered), `src/lib/i18n/staff.ts`
- Modify: `tests/e2e/staff.spec.ts` (restore: record the net delta each test applied per COUNTABLE row and undo it with `{ op: "adjust", delta: -net }` (retry on 409 with fresh version); STATUS rows restore with `status`; drop absolute `set` restore)
- Test: `tests/e2e/staff-queue.spec.ts`

**Interfaces — Consumes:** Task 6 queue + transition endpoints. **Produces:** `ReservationQueue({ hospitalId, initial, lang })` — search box (debounced 300 ms), status filter (Active / Held / Arrived / Completed / Rejected / Cancelled / Expired / All), sort (Expires soonest / Newest / Oldest), pagination (prev/next), per row: citizen name + phone, resource, qty, status badge, expires countdown, actions by status — HELD: "Check in" + "Reject" (reveals a required reason input, min 3 chars, submit disabled until valid); ARRIVED: "Complete". Buttons disabled while submitting; `INVALID_TRANSITION` shows the bn/en message and refetches the page.

- [ ] **Step 1: Failing E2E (`staff-queue.spec.ts`)**: citizen (API) holds a Dhanmondi `GENERAL_BED` → staff sees the row → Check in → ARRIVED → Complete → COMPLETED and Dhanmondi `GENERAL_BED` available back to its starting value (non-consumable); a second hold → Reject without reason disabled, with reason → REJECTED and stock back; search by citizen phone finds it; Mirpur staff never sees Dhanmondi rows. Mobile uses citizen `01700000023`, desktop uses racer `01700000101` (separate data per project).
- [ ] **Step 2–4:** FAIL → implement → PASS (whole E2E suite, both projects, twice); typecheck/lint PASS.
- [ ] **Step 5:** Commit `feat(staff): reservation queue with check-in, reject and complete` (+ separate `test(e2e): staff restore by inverse adjust`).

### Task 9: `npm run demo:race`

**Files:** Create `scripts/demo-race.ts`; Modify `package.json` (`"demo:race": "tsx scripts/demo-race.ts"`), `.gitignore` (`/.demo-race-sessions.json`), `README.md` (one usage line).

**Interfaces — Produces:** CLI `npm run demo:race -- --url <base> --hospital <slug> --resource <CODE> [--n 20] [--set-available 1] [--keep]`:
1. `GET /api/hospitals/<slug>/stock` → refuse unless `hospital.isDemo === true` and the resource is COUNTABLE.
2. Optional `--set-available k`: log in the demo staff bound to that hospital (only Dhanmondi `01700000011`, Mirpur `01700000012`; otherwise refuse) and `PATCH` `adjust` by `k - available` with the current version.
3. Log in racers `01700000101…` (password `SEED_CITIZEN_PASSWORD` from `.env`), caching cookies in `.demo-race-sessions.json` and reusing them when `GET /api/auth/me` is still 200 (login limiter friendly). Before racing, cancel each racer's active hold on that resource type.
4. Fire `n` `POST /api/reservations` simultaneously (`Promise.all`, request i uses racer `i % 20`, a fresh UUID key each), with `Origin`.
5. Print a `console.table` of outcomes (HELD / SOLD_OUT / LIMIT_REACHED / RATE_LIMITED / other) with counts, stock before/after (re-fetched), elapsed ms; exit code 1 if HELD > units available before or final available < 0.
6. Unless `--keep`, cancel the HELD reservations it created and print the restored stock.
Never prints passwords or cookies.

- [ ] **Step 1:** Implement. **Step 2:** Run against the local E2E-style dev server on the test DB (`DATABASE_URL=$DATABASE_URL_TEST`, seeded) with `--hospital dhanmondi-care-general --resource ICU_BED --set-available 1 --n 20` → expect `HELD 1, SOLD_OUT 19`, final 0, then restored. Paste the table in the task report. `--hospital` of a non-demo/unknown slug → refused.
- [ ] **Step 3:** typecheck/lint PASS (include `scripts/` in tsconfig/eslint scope if not already). **Step 4:** Commit `feat(demo): demo:race script for the live concurrency demo`.
