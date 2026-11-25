# P6 Admin Area Report (25 Nov 2026)

Branch: `admin` (not merged into `main`).

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
- `20261125030000_p6_hospital_archived` was created without modifying `DATABASE_URL` (live production DB).
- Applied to test DB (`jibonsetu_test` via `DATABASE_URL_TEST`).
- Verified via `npx prisma migrate status` against `DATABASE_URL`: `20261125030000_p6_hospital_archived` has **not yet been applied** to the live DB (`railway`).

## Test counts & verification
| Check | Scope | Result |
|---|---|---|
| `npm run typecheck` | `next typegen && tsc --noEmit` | ✅ clean |
| `npm run lint` | `eslint .` | ✅ clean (0 errors, 0 warnings) |
| `npm run build` | `prisma generate && next build && npm run build:server` | ✅ clean |
| `npm test` (Vitest) | Unit (17 files, 113 tests) + Integration against `jibonsetu_test` (17 files, 198 tests, incl. 10 new admin/CSV/race/404 tests) | ✅ **311 / 311 passed** (34 files) |
| `tests/e2e/admin.spec.ts` + `realtime-finder.spec.ts` | Mobile 360×800 + Desktop 1440×900 (guard 307/404, login, create w/ resources, Finder visibility, edit, hold blocks archive, cancel → archive → vanish from Finder & `/hospitals/<slug>` 404, subpages, demo refresh confirmation, live Finder) | ✅ **12 / 12 passed** |
| `npm run test:e2e` (`--workers=4`, pre-follow-up full run) | Full Playwright suite (120 tests across mobile + desktop) | **119 / 120 passed**; 1 transient `ECONNRESET` on `[mobile] realtime-acceptance:352` which passed on immediate rerun (`1 / 1`, and `14 / 14` on `realtime-finder + realtime-acceptance`) |

## Not done / deferred
- Admin editors for `Condition`, `ConditionRequirement`, and `FirstAidGuide` (beyond Prompt #4 scope; tracked for follow-up).
- Full paginated directory browse, PWA manifest/service worker, and live-URL Lighthouse check remain for P6 follow-up / P7.
