# JibonSetu — Project Constitution (read fully before every task)

## 0. Context
- Event: "Hack the Vibe 2026" solo vibe-coding championship (CodeArenaX). Hard deadline: 26 Nov 2026. Judges test the LIVE site with hidden test cases and ask technical questions.
- Track: **World Problem Solver**.
- Declared advanced challenges: **A05 Concurrency & Transaction Management** and **A01 Real-Time Data Synchronization**.
- Scoring: 60 marks mandatory (M01–M08) + 40 marks for the two challenges. Verified behavior beats visual polish. Every feature must really work end to end — no fake data flows, no mocked endpoints, no "coming soon" buttons.
- Developer machine: Windows 11, PowerShell, Node 24. All npm scripts must work on Windows (no bash-only syntax; use cross-platform tools).

## 1. Product
**JibonSetu** — live emergency healthcare finder, reservation and first-aid guide for Bangladesh.
Problem: in an emergency, families go hospital to hospital not knowing where an ICU bed, the right blood group, antivenom, rabies vaccine or the right specialist is available right now. Time is lost; people die.
Solution: pick the emergency → see nearby hospitals ranked by how well they can treat it right now (with reasons) → hold the needed resource for 30 minutes → follow live status. While travelling, show first-aid do's and don'ts.

### Supported conditions (exactly 8, stored as DATA, not code)
stroke, heart attack, road accident/trauma, severe dengue, breathing emergency (asthma/COPD/pneumonia), pregnancy/delivery emergency, snakebite, dog/cat bite (rabies).

### Resources (generic model — adding a new type must need zero new code)
- COUNTABLE (reservable, has total/available): general bed, ICU bed, CCU bed, NICU bed, ventilator, oxygen cylinder, wheelchair/stretcher, blood bags per group (A+, A-, B+, B-, O+, O-, AB+, AB-), platelets, antivenom vials, rabies vaccine doses, rabies immunoglobulin (RIG).
- STATUS (live on/off only): CT scan, cath lab, operation theatre, neurologist on duty, cardiologist on duty, surgeon on duty, gynecologist on duty.
- Each ResourceType has: kind (COUNTABLE|STATUS), consumable (true for blood, platelets, vaccine, antivenom, RIG, oxygen; false for beds/ventilator/wheelchair), names in bn + en.
- Condition requirements: per condition, each requirement is CRITICAL or PREFERRED, plus minimum quantity. Blood requirements are resolved by the patient's blood group using a compatibility matrix (red cell compatibility, e.g. O- donates to all).

### Modules (M01 — must be interconnected)
1. **Hospital Resource Console** (HOSPITAL_STAFF): update live stock/status of their own hospital; accept check-in, reject or complete reservations.
2. **Emergency Finder** (public, NO login needed): choose condition (+ optional blood group, location) → ranked hospitals with explanation → first-aid card + "Call 999" button.
3. **Reservation & Case Tracker** (CITIZEN, login needed): hold → live tracker → arrival. A hold changes stock in module 1 instantly and appears live in module 2.
4. **Admin** (ADMIN): hospitals, users, conditions/requirements, first-aid guides, audit log, analytics.

### Roles
- CITIZEN: search (public), reserve, see/cancel only their own reservations.
- HOSPITAL_STAFF: bound to exactly one hospital; can read/write only that hospital's resources and reservations (resource isolation enforced server-side on every query).
- ADMIN: everything + audit log + analytics.
Never trust a role, hospitalId or userId sent by the client — derive from the session.

## 2. Tech stack (decided — do not change without asking)
- Next.js (latest stable, App Router) + TypeScript `strict`. Server Components by default.
- Custom Node server (`server.ts`) running Next.js + Socket.io on ONE port (Railway supports long-lived WebSockets).
- PostgreSQL on Railway + Prisma ORM. Check current Prisma/Next.js docs with context7 before writing setup code (APIs change between major versions).
- Auth: own implementation — `bcryptjs` password hashing, DB-backed sessions, httpOnly + Secure + SameSite=Lax cookie, session rotation on login, logout invalidates server-side, rate-limited login. (We own it so we can explain it to judges.)
- Validation: Zod on EVERY server input (API routes, server actions, socket messages).
- UI: Tailwind CSS; shadcn/ui components only when needed. Bangla font: Noto Sans Bengali via `next/font` (self-hosted, subset).
- Tests: Vitest (unit + integration against a real Postgres test DB) and Playwright (E2E, mobile + desktop viewports, concurrency scenarios).
- Deploy: Railway, Southeast Asia (Singapore) region for app and DB (closest to Bangladesh). Never enable sleep/serverless mode (no cold starts).

## 3. Core engine rules
### 3.1 Reservation engine (A05) — the heart of the project
- Reserve = ONE database transaction:
  1. `pg_advisory_xact_lock` on the user id (prevents the same user racing themselves).
  2. Enforce per-user limits: max 1 active hold per resource type, max 2 active holds total.
  3. Atomic conditional decrement: `updateMany({ where: { id, available: { gte: qty } }, data: { available: { decrement: qty }, version: { increment: 1 } } })`. Count 0 → `SOLD_OUT` (409) and return the next best alternative hospitals. NEVER read-then-write stock.
  4. Insert reservation (status HELD, expiresAt = now + 30 min) + ReservationEvent + AuditLog.
- Idempotency: client sends an `Idempotency-Key` (UUID per user action). Unique constraint on it; a retry returns the original result, never a second hold.
- DB-level defense in depth (raw SQL in migrations): CHECK `available >= 0 AND available <= total`; partial unique index on active holds per (userId, resourceTypeId).
- State machine (single source of truth in `src/server/reservations/state-machine.ts`):
  HELD → ARRIVED | CANCELLED (citizen) | EXPIRED (system) | REJECTED (staff, reason required)
  ARRIVED → COMPLETED. Any other transition = 409 INVALID_TRANSITION.
  Every transition is compare-and-set (`WHERE id = ? AND status = <expected>`), so double release/double check-in is impossible.
- Stock return: CANCELLED/EXPIRED/REJECTED return stock. COMPLETED returns stock only for non-consumables (bed freed on discharge). Consumables stay consumed.
- Expiry sweeper: runs every 30 s inside the server and once on boot (recovers after restarts); also lazily expire on read.
- Socket events are emitted only AFTER the transaction commits.

### 3.2 Real-time sync (A01)
- Socket.io rooms: `hospital:{id}`, `finder` (public stock changes), `reservation:{id}` (owner only), `staff:{hospitalId}`. Authenticate the handshake with the session cookie; staff/owner rooms are authorized server-side.
- Every event carries the entity `version`; clients ignore events with a version ≤ the one they hold.
- On (re)connect the client refetches a snapshot — no lost updates. Show a clear "Reconnecting…" banner when offline.
- Staff edits use optimistic concurrency: the request carries `version`; `WHERE id AND version` → 0 rows → 409 `CONFLICT` with the current server values, and the UI shows "Another staff member changed this" with a choice to reload or re-apply.
- Stretch: "X is editing" presence indicator in the staff console.

### 3.3 Matching engine (M04) — pure, unit-tested function `src/server/matching/`
- For a condition + blood group + location: per hospital, check each requirement. Missing CRITICAL → "Not suitable" (still listed at the bottom, with reasons). Missing PREFERRED → lower score.
- Penalties: stale data (resource not updated for > 30 min, shown in yellow), distance (Haversine).
- Output: score 0–100, rank, and a human-readable reasons list in bn + en ("✅ ICU available", "⚠️ Neurologist not on duty", "❌ No CT scan").

### 3.4 Data processing (M05)
- Finder: filter by condition, resource, distance radius, govt/private, "free service only"; sort by match score, distance, freshness. Staff/admin lists: search + filter + sort + pagination.
- Admin analytics: reservations per condition/day, sold-out events (unmet demand) per resource and area, hold-expiry rate, average hold→arrival time, hospitals with stale data. Computed with SQL aggregation (not by loading all rows into JS).

## 4. Non-negotiable: speed and smoothness on every device
Emergency users are panicking, on cheap Android phones and slow mobile data. Lag is a failure.
- Mobile-first design; must work perfectly from 360 px phones to 1920 px desktops. Big touch targets (≥ 44 px), one-thumb reachable main actions.
- Performance budget (public pages, Lighthouse mobile): Performance ≥ 90, Accessibility ≥ 95, LCP < 2.5 s on throttled 4G, CLS < 0.1, initial JS for Finder < 150 KB gzipped.
- Server Components by default; `"use client"` only for genuinely interactive parts. No heavy libraries on public pages (no full lodash, moment, big chart libs). Charts only on admin pages and lazy-loaded.
- Hospital list first; a map (if added) must be lazy-loaded and optional.
- Skeleton loaders, never blank screens or spinners blocking the whole page. Optimistic UI where safe; disable buttons while submitting.
- DB indexes for every filter/sort column; paginate every list; no N+1 queries.
- First-aid pages cached by a small service worker so they open even with no internet. App is installable (PWA manifest).
- Respect `prefers-reduced-motion`; no heavy animations.

## 5. UX and language
- Bilingual: Bangla default, English toggle (simple typed dictionary, no heavy i18n lib).
- Emergency Finder and first aid are public — never force login before showing help. Login only to reserve (phone number + password).
- A permanent, visible banner: "DEMO DATA — not real hospital availability" (hospitals in seed data are fictional to avoid misleading real people).
- Every first-aid card shows: Do's, Don'ts, "Call 999" button, source name, and the disclaimer "This is first aid, not a substitute for medical treatment."

## 6. Medical content safety
- Never invent medical guidance. First-aid content must come from recognized sources (WHO, IFRC/Red Cross, DGHS Bangladesh), with source name + URL stored per guide. Mark each guide `reviewStatus` and show the source in the UI.
- No diagnosis, no drug dosing. Condition requirements are admin-editable data.

## 7. Security (M03 + general)
- Authorization checked server-side in one helper per action (`requireRole`, `requireHospitalAccess`, `requireReservationOwner`). Return 404 (not 403) for other users' resources to avoid leaking existence.
- CSRF: SameSite=Lax cookies + Origin header check on mutations. Rate limit login and reserve endpoints.
- Audit log for: login/logout, failed login, stock change (old→new), reservation transitions, admin changes, authorization failures.
- No secrets in code, logs, screenshots or the repo. `.env.example` documents every variable.

## 8. Errors and edge cases (M06)
- One error shape everywhere: `{ error: { code, message, details? } }`, messages in bn + en, no stack traces to clients.
- Codes: VALIDATION_ERROR (400), UNAUTHENTICATED (401), NOT_FOUND (404), CONFLICT (409), SOLD_OUT (409), INVALID_TRANSITION (409), LIMIT_REACHED (409), RATE_LIMITED (429), INTERNAL (500).
- Handle: double-click/double-submit, duplicate phone signup, expired hold actions, stale versions, socket disconnects, DB failure (friendly message + retry with the same idempotency key), invalid coordinates, empty results (suggest widening radius).

## 9. Folder structure
```
server.ts                  custom server: Next + Socket.io + expiry sweeper
prisma/                    schema, migrations (incl. raw SQL constraints), seed.ts
src/app/                   routes: (public) finder, first-aid; (citizen) reservations; staff/; admin/; api/
src/server/                server-only domain logic
  auth/  reservations/  matching/  resources/  realtime/  audit/  analytics/
src/components/            UI components
src/lib/                   shared utils, zod schemas, i18n dictionary, error helpers
tests/unit  tests/integration  tests/e2e
docs/                      PLAN.md, ARCHITECTURE.md, DEMO_SCRIPT.md
```

## 10. How to work (always)
- Think before coding: restate the task, list assumptions, then implement the simplest solution that fully works. No speculative abstractions.
- Surgical changes: touch only what the task needs. Don't reformat or refactor unrelated code.
- Test-driven for engine logic (reservation, state machine, matching, auth guards): write the failing test first.
- A task is done only when: typecheck passes, lint passes, relevant tests pass, and you verified the behavior (Playwright for UI). Never claim something works without running it.
- After each completed task: update `PROGRESS.md` (done / next / known issues / decisions) and make a git commit (conventional commit message). Never commit `.env` or secrets.
- If blocked or a decision is ambiguous, stop and ask with 2–3 options and a recommendation.
- Ask before destructive actions (dropping DB, deleting files, force push, resetting migrations on Railway).
- Use context7 for library docs instead of guessing APIs.
- Keep this file the source of truth; if a rule must change, propose the edit first.

## 10b. Quality first, without waste
- Quality is the priority over cost. Every task keeps the full loop: implementer + independent reviewer + fix round, including UI, admin and docs (judges see the UI and test it on phones).
- Use the strongest model (Opus) for engine, concurrency, realtime, security AND user-facing UI/UX work. Sonnet only for purely mechanical edits (renames, copy changes, config).
- Waste to avoid (no quality cost): while iterating, run only the tests you touched with a compact reporter (`--reporter=dot`; Playwright `--reporter=line`) and show only failures; run full suites at the end of every task and phase. Read only the files a task needs; don't re-read files you just wrote.

## 11. Demo accounts (seeded; passwords only in .env / private submission notes, never in README)
- admin, 2 hospital staff (different hospitals), 3 citizens — for live concurrency demos.

## 12. Out of scope (document as Future Work in README)
Ambulance dispatch, pharmacies, doctor appointments, blood donor network, SMS/OTP, real hospital integrations, payments.
