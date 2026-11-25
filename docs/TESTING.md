# Testing Strategy & Verification

JibonSetu uses a three-layer test suite (**Vitest unit**, **Vitest real-Postgres integration**, and **Playwright mobile + desktop E2E**), with strict isolation so automated tests never touch or truncate a non-test database.

---

## 1. Suite Organization

| Suite | Command | Config | Environment |
|---|---|---|---|
| **Unit** (`tests/unit/*.test.ts`) | `npm run test:unit` | `vitest.config.ts` (`project: unit`) | Node environment, zero DB or network I/O |
| **Integration** (`tests/integration/*.test.ts`) | `npm run test:integration` | `vitest.config.ts` (`project: integration`) | Real PostgreSQL (`DATABASE_URL_TEST`), `fileParallelism: false` so file resets never collide |
| **All Vitest** | `npm test -- --reporter=dot` | `vitest.config.ts` | Runs both `unit` (17 files) and `integration` (17 files) |
| **End-to-End** (`tests/e2e/*.spec.ts`) | `npm run test:e2e` | `playwright.config.ts` | Chromium across **Mobile (`360×800`, Pixel 7)** and **Desktop (`1440×900`)** |
| **Typecheck & Lint** | `npm run typecheck; npm run lint` | `tsconfig.json`, `eslint.config.mjs` | `next typegen && tsc --noEmit` + ESLint 9 |

---

## 2. The `_test` Database Safety Guard

Production protection is enforced in code (`tests/support/test-db-guard.ts`, unit-tested in `tests/unit/test-db-guard.test.ts`):

1. `assertTestDatabaseUrl(process.env.DATABASE_URL_TEST)` parses the URL pathname and throws unless the database name strictly **ends with `_test`** (names like `test_db` or production database names are rejected).
2. `tests/integration/global-setup.ts` validates `DATABASE_URL_TEST` and runs `npx prisma migrate deploy` against it once before integration tests start.
3. `tests/integration/setup-env.ts` overwrites `process.env.DATABASE_URL` with the validated `DATABASE_URL_TEST` before `@/server/db` is imported, and strips custom `LOGIN_LIMIT_*` / `SIGNUP_LIMIT_*` / `RESERVE_LIMIT_*` overrides so rate-limit tests execute against documented defaults.
4. `resetDb()` (`tests/support/db.ts`) re-runs `assertTestDatabaseUrl(process.env.DATABASE_URL)` before executing `TRUNCATE ... RESTART IDENTITY CASCADE` across `public` tables (preserving `_prisma_migrations`).
5. Local Playwright runs (`playwright.config.ts`, when `BASE_URL` is unset) build into a separate `.next-e2e` directory on `E2E_PORT` (default `3100`) wired directly to `DATABASE_URL_TEST`, so an active dev server on port `3000` is never reused. `tests/e2e/global-setup.ts` migrates, seeds (`SEED_RESET_STOCK=1`), and warms routes before launching tests.
6. `npm run demo:race` (`scripts/demo-race.ts`) refuses any hospital where `isDemo !== true`.

---

## 3. What Unit, Integration & Concurrency Tests Prove

### Unit Tests (`17` files — `tests/unit/*.test.ts`)
- **Matching & Geo (`rank.test.ts`, `geo.test.ts`, `finder-params.test.ts`)**: `CRITICAL`/`PREFERRED` weights (`3`/`1`), blood compatibility fallback (`O_NEG` when blood group unknown), stale `> 30 min` penalty (`0` freshness points using only matched requirement rows), Haversine distance (`0` at 30 km, `10` with null origin), parameter sanitization (`10` seeded areas, bilingual notices on invalid inputs).
- **State Machine & Errors (`state-machine.test.ts`, `errors.test.ts`)**: Complete `6 × 6` status transition matrix, terminal empty out-edges, `returnsStock` consumable vs. non-consumable rules, `ZodError → 400` mapping, stack trace redaction.
- **Security & Infra (`origin.test.ts`, `client-ip.test.ts`, `rate-limit.test.ts`, `phone.test.ts`, `safe-next.test.ts`, `test-db-guard.test.ts`, `health.test.ts`)**: Same-origin CSRF check, right-most `X-Forwarded-For` hop extraction, fixed-window rate limiting + `firstBlock` auditing trigger, BD phone normalization (`+880`/`880` → `01[3-9]XXXXXXXX`), open-redirect `?next=` prevention, DB health probe timeout handling, `_test` DB guard enforcement.
- **Realtime Client Core & CSV (`version-gate.test.ts`, `coalesce.test.ts`, `backoff.test.ts`, `live-socket.test.ts`, `csv-import.test.ts`)**: Monotonic version gating for events vs. snapshots, `300 ms`/`1000 ms` burst coalescer, exponential backoff, `online` snapshot recovery, RFC-4180 CSV quoted commas/escaped quotes/CRLF/BOM parsing.

### Postgres Integration & Concurrency Tests (`17` files — `tests/integration/*.test.ts`)
All concurrency tests open parallel `prisma.$transaction` calls across separate PostgreSQL pooled connections using `Promise.allSettled`:
- **PostgreSQL Constraints (`constraints.test.ts`)**: Proves raw-SQL `hospital_resource_stock_bounds` rejects `available < 0` and `available > total`, partial unique index `reservation_one_active_per_type` rejects duplicate active holds while allowing `CANCELLED + HELD`, `condition_requirement_target` XOR rule, `reservation_quantity_positive`, `hospital_coords_valid`, `Reservation_userId_fkey` (`P2003`), and queue sort indexes exist.
- **Contention Races (`reserve-concurrency.test.ts`)**:
  - `20` users racing for `1` last `ICU_BED` → **`1 HELD`**, **`19 SOLD_OUT`**, `available = 0`, `19 SoldOutEvent` rows.
  - `30` requests for `10` units → **`10 HELD`**, **`20 SOLD_OUT`**, `version` bumped by `10`.
  - Single user firing `5` parallel reserves for the same resource type → **`1 HELD`**, `4 LIMIT_REACHED` (`SAME_TYPE`).
  - Single user firing `5` parallel reserves across different types → **`2 HELD`**, `3 LIMIT_REACHED` (`MAX_ACTIVE`).
  - Same `Idempotency-Key × 10` in parallel → `1` DB row created, `1` non-replayed response, `9` replays.
  - Same `Idempotency-Key` from `2` different users in parallel → **`1` hold, `1 CONFLICT`**.
  - Crossed overdue holds (`A` holds `X` reserving `Y`, `B` holds `Y` reserving `X` × 5 rounds) → zero deadlocks.
- **CAS State Transitions & Expiry Sweeper (`reservation-transition.test.ts`, `sweeper.test.ts`)**:
  - Double `checkIn` in parallel → `1 ARRIVED`, `1 INVALID_TRANSITION`.
  - Parallel `cancel + reject + expire` races (on live and overdue holds) → exactly one transition wins, stock returned once.
  - Parallel sweeps (`expireOverdue`) & `sweeper vs. citizen cancel` races → stock returned strictly once.
  - `returnStock` clamps `LEAST(total, available + qty)` when staff lowered `total`; `COMPLETED` returns non-consumable beds and keeps consumables consumed; boot sweeper tolerates failing ticks and prevents tick overlap.
- **Archive-vs-Reserve Races & Admin (`admin.test.ts`)**:
  - `15`-iteration `Promise.allSettled` loop + two deterministic hook races (`vi.spyOn` on `takeStock` and `readStock`) prove a hospital can never end up archived (`archivedAt !== null`) while holding a `HELD` reservation, even when archive commits right before `takeStock` or blocks on `SELECT ... FOR UPDATE`.
  - Admin CRUD, Bangladesh bounds validation, hard-delete vs. archive (`409 CONFLICT` on active holds), CSV idempotent import, `CITIZEN ↔ HOSPITAL_STAFF` role change session revocation, SQL analytics accuracy, and hold-aware demo refresh.
- **Auth, Guards, Finder, Staff CAS & Realtime (`auth-service.test.ts`, `session.test.ts`, `guards.test.ts`, `staff-api.test.ts`, `resource-update.test.ts`, `reservations-api.test.ts`, `reserve.test.ts`, `finder-search.test.ts`, `realtime.test.ts`, `seed.test.ts`, `audit.test.ts`, `health-db.test.ts`)**:
  - Auth rate limits, 72-byte bcrypt guard, timing-equalized unknown-phone lookup, SHA-256 DB session storage, `404` + `AUTHZ_DENIED` on cross-hospital/citizen/non-admin access, `409 CONFLICT` with server values on concurrent staff edits, cross-origin WebSocket refusal, session revocation disconnecting sockets, `MAX_ROOMS_PER_SOCKET = 20`, hold-aware seed reset, and `/hospitals/<slug>` 404 when archived.

---

## 4. End-to-End Suites & Viewports (`10` specs × `2` viewports)

Every E2E test runs across both **`mobile` (`360×800`, Pixel 7)** and **`desktop` (`1440×900`, Desktop Chrome)**:
- `auth.spec.ts` — signup, logout, `?next=` login redirect, invalid BD phone client validation, `bn`/`en` toggle, duplicate `CONFLICT`, wrong password `UNAUTHENTICATED`, missing `Origin` rejection, pre-hydration submit safety.
- `finder.spec.ts` — public condition selection, filter/sort URL state, resource filter & notices, empty radius guidance, `/first-aid/[condition]` sources & 404, disabled `tel:` on demo hospitals vs. clickable `999`, zero horizontal overflow at `360 px`.
- `health.spec.ts` — `/api/health` (`db: "up"`), `/status` Socket.io connected, `DEMO DATA` banner visibility.
- `reservations.spec.ts` — auth round-trip, hold → tracker countdown → two-tap cancel, double-click idempotency, `LIMIT_REACHED`, `SOLD_OUT` alternatives, foreign tracker `404`.
- `staff.spec.ts` & `staff-queue.spec.ts` — own-hospital console edits & status switches, foreign hospital `404`, `409` ConflictPanel Reload flow, check-in/complete/reject queue workflow (non-destructive restore in `afterEach`).
- `realtime-finder.spec.ts`, `realtime-staff.spec.ts`, `realtime-acceptance.spec.ts` — multi-context live Finder `< 1 s` assertion (when `BASE_URL` set; `< 3 s` locally), live `/hospitals/<slug>` updates, dirty `Set` form freeze + `409 CONFLICT`, live tracker updates from staff actions, DevTools offline `"Reconnecting…"` + online snapshot recovery.
- `admin.spec.ts` — logged-out `307`, citizen `404`, create/edit/Finder visibility/active-hold block/archive & `/hospitals/<slug>` 404, demo refresh confirmation, no horizontal scroll.

---

## 5. Latest Verified Results

| Check | Scope | Result | Timing / Notes |
|---|---|---|---|
| `npm test -- --reporter=dot` | **Vitest** (`17` unit files + `17` integration files against real `*_test` Postgres) | ✅ **313 / 313 passed** (`34` files) | Verified on branch `docs` (`532.89s`) |
| `npm run typecheck` | `next typegen && tsc --noEmit` | ✅ clean | Verified after last code edit (`949b61c`) |
| `npm run lint` | `eslint .` | ✅ clean (`0` errors, `0` warnings) | Verified after last code edit (`949b61c`) |
| `npm run test:e2e -- --reporter=line --workers=2 --retries=1` | **Playwright** (`mobile 360×800` + `desktop 1440×900`, full suite) | ✅ **120 / 120 passed** (`0` retries) | Verified after last code edit (`5.0m`; Finder live sync `810 ms` mobile, `789 ms` desktop) |
| Live URL (`https://web-production-3fb89dc8.up.railway.app`) | `/api/health`, `prisma migrate status`, admin/citizen HTTP guards + non-mutating `admin.spec.ts` | ✅ **Up / 4/4 E2E passed** | Schema up to date (`6` migrations); `/api/health` `db: "up"` |
