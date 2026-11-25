# P6 Admin Area Report (25 Nov 2026)

Branch: `admin` merged into `main` (`b351df2`, `--no-ff`) and deployed live to `https://web-production-3fb89dc8.up.railway.app`.

## What was built
1. **Admin area & guards (`/admin`, `ADMIN` role only)**
   - Proxy routing rule in `src/proxy.ts` (`adminGate` calling `requireRole(user, "ADMIN")`): signed-out users redirect (`307`) to `/login?next=...`, signed-in non-admins (`CITIZEN` / `HOSPITAL_STAFF`) receive a real HTTP `404` and an `AUTHZ_DENIED` audit entry.
   - Defense-in-depth page guard (`src/server/admin/page-guard.ts`) enforced on `src/app/admin/layout.tsx` and every page (`/admin`, `/admin/users`, `/admin/audit`, `/admin/analytics`).
   - All `/api/admin/*` route handlers enforce `requireRole(user, "ADMIN")`, Origin checks on mutations, Zod validation, and the unified bilingual `{ error: { code, message } }` shape.
   - Mobile-first, accessible UI (≥ 44 px touch targets, associated `<label htmlFor>` elements, keyboard-submittable `<form>`s, bilingual `src/lib/i18n/admin.ts`, `SiteHeader` Admin link, DEMO DATA banner preserved).

2. **Hospitals CRUD & Archive (`1a` + optional CSV import)**
   - List (`GET /api/admin/hospitals`): search by `nameBn` / `nameEn` / `district`, filters (`type`, `liveDataEnabled`, `archived`), sort (`nameEn`, `district`, `updatedAt`), pagination.
   - Create (`POST /api/admin/hospitals`): Zod validation incl. Bangladesh coordinates (`lat 20.5–26.7`, `lng 88.0–92.7`), transactional creation of `Hospital` + picked `HospitalResource` rows (`COUNTABLE` totals/available and `STATUS` availability) + `AuditLog`, followed by post-commit `publishStock` finder refresh.
   - Edit (`PATCH /api/admin/hospitals/[hospitalId]`): partial Zod-validated updates (blocks archived hospitals), full old → new `AuditLog` in the same transaction, post-commit `publishStock`.
   - Delete vs Archive (`DELETE /api/admin/hospitals/[hospitalId]` + migration `20261125030000_p6_hospital_archived`):
     - Lazily expires overdue holds on that hospital first, then inside the transaction locks the hospital's `HospitalResource` rows (`SELECT "id" FROM "HospitalResource" WHERE "hospitalId" = $1 ORDER BY "id" FOR UPDATE`) before counting reservations/active holds. Paired with a post-`takeStock` `archivedAt` re-check in `reserve()`, an archive and a concurrent reservation can never leave a hospital both archived and holding an active `HELD` reservation.
     - Hard-deletes if the hospital has never had a reservation (cleaning up `SoldOutEvent` and `HospitalResource` rows in the same tx).
     - Otherwise blocks archiving with `409 CONFLICT` if active `HELD` / `ARRIVED` reservations exist, or sets `archivedAt` + writes `AuditLog` + publishes finder refresh.
     - Archived hospitals are excluded from `searchHospitals`, `listDirectory`, `firstLiveHospitalId`, `findAlternatives`, `reserve()`, and `/hospitals/<slug>` (real HTTP `404` via `src/proxy.ts` + `hospitalExists` / `getHospitalStock` / `getHospitalName`).
   - Optional CSV import (`POST /api/admin/hospitals/import`, `src/lib/csv.ts`, `src/server/admin/csv-import.ts`): RFC-4180 CSV parser, per-row Zod validation, in-file duplicate slug detection, idempotent re-import by `slug`, and a per-row status/error report.

3. **Users (`1b`)**
   - List (`GET /api/admin/users`): search by phone or name, filter by role, pagination.
   - Role change (`PATCH /api/admin/users`): `CITIZEN ↔ HOSPITAL_STAFF` (staff requires choosing one active, non-archived hospital). Self-change and demoting another admin are blocked (`409 CONFLICT`). `passwordHash` is never returned. All user sessions are deleted in the same transaction, live sockets are disconnected after commit, and `ADMIN_CHANGE` is audited.

4. **Audit log viewer (`1c`)**
   - Read-only newest-first table (`GET /api/admin/audit`, `/admin/audit`) with batch actor resolution (`name` + `phone`), action filter dropdown, date range (`from` / `to`), concise change summaries, and pagination.

5. **SQL analytics (`1d`)**
   - Pure SQL aggregation (`src/server/admin/analytics.ts`, `GET /api/admin/analytics`, `/admin/analytics`):
     - Reservations per condition per day (last 7 days)
     - Sold-out events (unmet demand) per resource type and district
     - Hold outcome rates (`ARRIVED` incl. `COMPLETED`, `EXPIRED`, `CANCELLED`, `REJECTED`)
     - Average minutes from `HELD` to `ARRIVED`
     - Live non-archived hospitals with stale data (> 30 min)
   - Rendered as responsive tables + plain inline SVG bars (no chart library) with clear empty states.

6. **Demo data refresh (`1e`)**
   - Admin-only "Refresh demo stock" button with in-page confirmation (`POST /api/admin/demo-refresh`).
   - Imports and reuses `resetDemoHospitalsStock` / `resetHospitalStockRows` from `src/server/seed/run-seed.ts` (zero duplicated stock-reset logic; hold-aware; affects active `isDemo: true` hospitals only), writes `AuditLog`, and publishes `stock:changed` after commit.

## Database migration status
- `20261125030000_p6_hospital_archived` was created without modifying `DATABASE_URL` during development (`npx prisma migrate dev --create-only`) and verified first against `jibonsetu_test` (`DATABASE_URL_TEST`).
- Post-merge Railway deploy executed `prisma migrate deploy`, applying `20261125030000_p6_hospital_archived` to the live DB (`railway` at `yamabiko.proxy.rlwy.net:36777`).
- Confirmed via read-only `npx prisma migrate status` against `DATABASE_URL`: **6 migrations found in `prisma/migrations` — `Database schema is up to date!`**

## Test counts & verification (post-final code edit `949b61c` / merge `b351df2`)
| Check | Scope | Result |
|---|---|---|
| `npm run typecheck` | `next typegen && tsc --noEmit` | ✅ clean |
| `npm run lint` | `eslint .` | ✅ clean (0 errors, 0 warnings) |
| `npm run build` | Pre-follow-up local build + Railway production build & deploy (`b351df2`) | ✅ clean / deployed live |
| `npm test -- --reporter=dot` | Unit (17 files, 113 tests) + Integration against `jibonsetu_test` (17 files, 200 tests, incl. 12 in `tests/integration/admin.test.ts` with deterministic + 15-iteration `Promise.allSettled` archive-vs-reserve race coverage) | ✅ **313 / 313 passed** (34 files) |
| `npm run test:e2e -- --reporter=line --workers=2 --retries=1` | Full Playwright suite across mobile (`360×800`) + desktop (`1440×900`) | ✅ **120 / 120 passed** (`5.0m`, zero retries; latency (a): `810 ms` mobile, `789 ms` desktop) |

## Live URL verification (`https://web-production-3fb89dc8.up.railway.app`)
- `GET /api/health`: `200 {"status":"ok","db":"up","time":"2026-11-25T06:44:14.710Z"}`
- Anonymous `GET /admin`: `307` redirect to `/login?next=%2Fadmin`
- Admin login (`01700000001`): `200`; `GET /admin`, `/admin/users`, `/admin/audit`, `/admin/analytics` -> all `200` (`hasTitle=true`, `hasFallback=false`); `GET /api/admin/hospitals`, `/api/admin/users`, `/api/admin/audit`, `/api/admin/analytics` -> all `200`
- Citizen login (`01700000021`): `200`; `GET /admin`, `/admin/users`, `/admin/audit`, `/admin/analytics`, `/api/admin/hospitals` -> all `404`
- Non-mutating Playwright E2E against live URL (`tests/e2e/admin.spec.ts -g "logged-out /admin|demo stock refresh"`): **4 / 4 passed** in `5.6s` (mobile `360×800` + desktop `1440×900`)

## Not done / deferred
- Admin editors for `Condition`, `ConditionRequirement`, and `FirstAidGuide` (beyond Prompt #4 scope; tracked for follow-up).
- Full paginated directory browse, PWA manifest/service worker, and live-URL Lighthouse check remain for P6 follow-up / P7.
