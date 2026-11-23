# P2 Hospital Resource Console (staff) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hospital staff update their own hospital's live stock/status with optimistic concurrency, audit trail and strict hospital isolation.

**Architecture:** `src/server/resources/update.ts` is the single write path (guard → compare-and-set `updateMany` on `version` → audit in the same transaction). API routes under `/api/staff/*`; UI at `/staff` → `/staff/hospitals/[hospitalId]`. The reservation queue (check-in/reject/complete) is **out of scope here — moved to P4** (needs the state machine); no placeholder buttons.

**Tech Stack:** as P1. **Spec:** `CLAUDE.md` §1 (module 1), §3.2 (optimistic concurrency), §7, §8 + `docs/PLAN.md` P2 + P1 plan interfaces (`docs/superpowers/plans/2026-11-24-p1-data-auth.md`).

## Global Constraints
- All P1 Global Constraints apply (error shape, 404 not 403, Zod everywhere, Origin check, cacheComponents rules, test DB guard, commit format, no push).
- Hospital is derived from the session (`user.hospitalId`); a client-supplied hospitalId is only a lookup key that must pass `requireHospitalAccess`.
- Stock never read-then-written: every change is `updateMany({ where: { id, version: expectedVersion }, data: {..., version: { increment: 1 }, updatedAt: now, updatedById } })`; 0 rows → 409 CONFLICT with `details.current` (`{ id, available, total, isAvailable, version, updatedAt }`), or 404 if the row does not exist / belongs to another hospital.
- Countable: `0 ≤ available ≤ total` validated before write (VALIDATION_ERROR) and enforced by DB CHECK. Status kind: only `isAvailable` changes.
- Audit `STOCK_CHANGE` with `before`/`after` `{available,total,isAvailable,version}` in the same transaction.
- Mobile-first, touch targets ≥ 44px, `/staff` client JS kept small (no new UI libraries). i18n strings in `src/lib/i18n/staff.ts` only.

## Review Focus
- Two staff tabs edit the same row: second save gets the conflict panel showing the current server values with "Reload" and "Re-apply my change" — re-apply sends the user's intended *absolute* values with the new version.
- `-` pressed on `available = 0` → button disabled; API returns VALIDATION_ERROR if forced.
- Staff of hospital A requesting B's page or B's resource id → 404 (page and API), audited AUTHZ_DENIED.
- Citizen or logged-out user visiting `/staff` → logged out: redirect to `/login?next=/staff`; citizen: 404.
- Rapid double-click on "+" → second request carries a stale version → conflict handled, not a silent double increment.

---

### Task 1: Resource update service (test-first, real DB)

**Files:** Create `src/server/resources/update.ts`, `src/server/resources/queries.ts`; Test `tests/integration/resource-update.test.ts`

**Interfaces — Consumes (P1):** `prisma` (`@/server/db`), `SessionUser`, `requireHospitalAccess`, `requireRole`, `AppError`, `audit`.
**Produces:**
- `type ResourceChange = { op: "adjust"; delta: number /* integer, ≠ 0, |delta| ≤ 1000 */ } | { op: "set"; available: number; total: number } | { op: "status"; isAvailable: boolean }`.
- `type ResourceView = { id; hospitalId; resourceTypeId; code; kind: ResourceKind; consumable: boolean; nameBn; nameEn; total; available; isAvailable; version; updatedAt: Date; stale: boolean /* > 30 min */ }`.
- `updateHospitalResource(user: SessionUser | null, input: { resourceId: string; expectedVersion: number; change: ResourceChange }): Promise<ResourceView>` — `adjust`/`set` only for COUNTABLE, `status` only for STATUS (else VALIDATION_ERROR). `adjust` computes the new value from the row read in the same transaction but writes with the version CAS (so a concurrent change → CONFLICT, never a lost update).
- `listHospitalResources(user: SessionUser | null, hospitalId: string): Promise<{ hospital: { id; nameBn; nameEn }; resources: ResourceView[] }>` — guard first; sorted by `ResourceType.sortOrder`.
- `resourceChangeSchema` (zod) and `updateResourceBodySchema = { version: int ≥ 1, change: resourceChangeSchema }` exported for the route.

- [ ] **Step 1: Failing tests** (seed minimal data per test: 2 hospitals, staff A, staff B, admin, citizen, ICU_BED countable + CT_SCAN status rows):
  - `staff adjusts own countable stock and version increments` (+1 → available+1, version+1, audit row with before/after).
  - `set validates bounds` (available > total → VALIDATION_ERROR; negative → VALIDATION_ERROR).
  - `adjust below zero is rejected` (available 0, delta −1 → VALIDATION_ERROR, row unchanged).
  - `stale version returns CONFLICT with current values` (`details.current.version` = server version).
  - `concurrent adjusts with the same version: exactly one succeeds` (`Promise.allSettled` of 5 calls with same expectedVersion → 1 fulfilled, 4 CONFLICT; final available = start + 1).
  - `staff of another hospital gets NOT_FOUND` (+ AUTHZ_DENIED audit) for both update and list; `citizen gets NOT_FOUND`; `null user UNAUTHENTICATED`; `admin can update any`.
  - `status toggle on STATUS kind; adjust on STATUS kind → VALIDATION_ERROR`.
  - `unknown resource id → NOT_FOUND`.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npm test` PASS; typecheck/lint PASS.
- [ ] **Step 5:** Commit `feat(staff): versioned hospital resource updates with audit and isolation`.

### Task 2: Staff API routes

**Files:** Create `src/app/api/staff/hospitals/[hospitalId]/resources/route.ts` (GET), `src/app/api/staff/resources/[resourceId]/route.ts` (PATCH); Test `tests/integration/staff-api.test.ts` (calls the exported route handlers directly with `new Request(...)` and a real session cookie created via `createSession`).

**Produces:** `GET` → 200 `{ hospital, resources: ResourceView[] }`; `PATCH` body `updateResourceBodySchema` → 200 `{ resource: ResourceView }`; errors via `apiHandler` (PATCH `mutation: true`).
- [ ] **Step 1: Failing tests:** own hospital GET 200; other hospital GET 404 with error body shape; PATCH stale version → 409 `CONFLICT` with `details.current`; PATCH without Origin → 400; no cookie → 401.
- [ ] **Step 2–4:** FAIL → implement → PASS (+typecheck/lint).
- [ ] **Step 5:** Commit `feat(staff): staff resource API routes`.

### Task 3: Staff console UI

**Files:** Create `src/app/staff/page.tsx` (redirects: logged out → `/login?next=/staff`; HOSPITAL_STAFF → `/staff/hospitals/{own}`; ADMIN → first hospital id; others → `notFound()`), `src/app/staff/hospitals/[hospitalId]/page.tsx` (server: `listHospitalResources`; NOT_FOUND → `notFound()`), `src/components/staff/ResourceConsole.tsx` (client), `src/components/staff/ConflictPanel.tsx`, `src/lib/i18n/staff.ts`; Test `tests/e2e/staff.spec.ts`.

**Behavior:** groups (Beds & equipment / Blood & medicines / Services & specialists), client-side search by name + filter (all / low stock (available ≤ 1) / stale); each countable row: name, `available / total`, `−` `+` buttons (disabled while saving and at bounds), "Set" inline form (available + total); status rows: on/off switch (`role="switch"`, `aria-checked`). Shows "Updated N min ago", stale (> 30 min) in yellow. On 409 → `ConflictPanel`: "Another staff member changed this" (bn/en), current server values, buttons Reload (adopt server row) / Re-apply (send intended absolute `set`/`status` with new version). Errors shown in `role="alert"`.

- [ ] **Step 1: Failing E2E** (uses seeded demo staff `01700000011` with `SEED_STAFF_PASSWORD` from env; mobile + desktop):
  - staff logs in → `/staff` lands on own hospital; `+` on a countable row increments the shown value and it persists after reload.
  - toggling a status switch persists after reload.
  - visiting `/staff/hospitals/<id of mirpur-shastho-medical>` as Dhanmondi staff → 404 page; API PATCH on that hospital's resource → 404.
  - conflict: two browser contexts logged in as the two... (same staff, two pages) — page A `+`, page B (stale) `+` → conflict panel visible; Reload shows A's value.
- [ ] **Step 2–4:** FAIL → implement → PASS on both projects; full `npm test`, typecheck, lint PASS.
- [ ] **Step 5:** Commit `feat(staff): mobile-first resource console with conflict handling`.
