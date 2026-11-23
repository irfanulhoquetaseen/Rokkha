# JibonSetu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each phase gets a detailed task plan (`docs/superpowers/plans/`) written at the start of that phase.

**Goal:** A live emergency healthcare finder + resource reservation system for Bangladesh that proves M01–M08, A05 (concurrency/transactions) and A01 (real-time sync) on the deployed site.

**Architecture:** One Node process (`server.ts`) runs Next.js 16 (App Router) + Socket.io on one port, deployed on Railway (Singapore) beside a Railway Postgres 18. Domain logic is in `src/server/*` (pure where possible, test-first); Prisma 7 with the `pg` driver adapter; raw-SQL constraints in migrations are the last line of defense.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript 5 strict, Tailwind 4, Prisma 7.10 + @prisma/adapter-pg, Socket.io 4.8, Zod 4, bcryptjs, Vitest 5, Playwright 1.65.

**Spec:** `CLAUDE.md` (final design; no brainstorming).

## Global Constraints
- Every input Zod-validated; one error shape `{ error: { code, message: {bn,en}, details? } }`; codes per CLAUDE.md §8.
- Never trust client-sent role / hospitalId / userId: derive from the session.
- Never read-then-write stock: conditional `updateMany` decrement only; socket emits only after commit.
- Engine code (reservations, state machine, matching, auth guards) is test-first against a real Postgres test DB. Never mocked.
- Finder initial JS < 150 KB gzip; Lighthouse mobile Perf ≥ 90, A11y ≥ 95; 360 px → 1920 px; touch targets ≥ 44 px.
- Windows-compatible npm scripts; no secrets in repo; "DEMO DATA" banner always visible.

## Timeline (today = 24 Nov 2026, deadline 26 Nov)
| Slot | Phases |
|---|---|
| 24 Nov early | P0 ✅, P1 |
| 24 Nov midday | P2 ∥ P3 (parallel subagents; both depend only on P1) |
| 24 Nov afternoon | P4 (critical path) |
| 24 Nov evening | P5, then P6 (parallel subtasks) |
| 25 Nov morning | P7 hardening |
| 25–26 Nov | buffer, demo rehearsal, submission |

**Priority if time runs short (cut from the bottom):** A05 engine > A01 sync > auth/roles > Finder+matching > staff console > admin CRUD > analytics > i18n polish > CSV import > PWA offline > presence indicator.

---

## P0 Foundation & live deploy: proves M07 (deploy), groundwork for all
- [x] Next.js 16 + TS strict + Tailwind + ESLint in repo root
- [x] `server.ts`: Next + Socket.io on one `PORT`; tsx watch (dev), esbuild → `dist/server.mjs` (prod)
- [x] Prisma 7 + Postgres; `SystemHeartbeat` model; first migration
- [x] `GET /api/health` (real `SELECT 1`, 503 when DB down) + home status panel (API + socket)
- [x] Scripts: dev, build, start, typecheck, lint, test, test:e2e, db:migrate, db:deploy, db:seed
- [x] Railway project `jibonsetu` (Singapore), Postgres, web service from GitHub, pre-deploy `prisma migrate deploy`, no sleep
- [x] Playwright on live URL at 360×800 and 1440×900

**DoD:** live URL serves `/api/health` → `db: "up"` and socket "connected"; typecheck, lint, test green.

## P1 Data model, constraints, seed, auth & roles: M02, M03, M06, A05 groundwork
- [ ] Prisma schema: User(role, phone, passwordHash, hospitalId?), Session, Hospital(type govt/private, freeService, lat/lng, area), ResourceType(kind, consumable, nameBn/En, code), HospitalResource(total, available, status, version, updatedAt), Condition(code, nameBn/En), ConditionRequirement(level CRITICAL|PREFERRED, minQty), BloodCompatibility, FirstAidGuide(sourceName, sourceUrl, reviewStatus, bn/en content), Reservation(status, qty, expiresAt, idempotencyKey unique, version), ReservationEvent, AuditLog, SoldOutEvent
- [ ] Raw-SQL migration: CHECK `available >= 0 AND available <= total`; partial unique index active holds `(userId, resourceTypeId) WHERE status IN ('HELD','ARRIVED')`; indexes for every filter/sort column
- [ ] Seed: 8 conditions + requirements, all resource types, ~25 fictional Dhaka/Chattogram hospitals, first-aid guides from WHO/IFRC/DGHS with URLs, demo accounts from env (admin, 2 staff, 3 citizens)
- [ ] Auth (test-first): bcryptjs hash, DB session, rotate on login, httpOnly+Secure+SameSite=Lax cookie, logout deletes session, rate-limited login, Origin check on mutations
- [ ] Guards (test-first): `requireRole`, `requireHospitalAccess`, `requireReservationOwner` (404 on foreign resources); error helper + error codes; audit writer
- [ ] Integration test DB setup (separate Railway/local test database, migrate reset per run)

**DoD:** `db:seed` populates live DB; signup/login/logout E2E; guard + auth tests green; constraints proven by integration tests (direct SQL violating them fails).

## P2 Hospital Resource Console (staff): M01, M02, M05
- [ ] `/staff`: own hospital's resources (countable +/- and set, status toggles), versioned updates (409 CONFLICT w/ current values)
- [ ] Staff reservation queue: check-in (ARRIVED), reject (reason), complete; search/filter/sort/paginate
- [ ] Stock change audit (old→new)

**DoD:** staff of hospital A gets 404 for hospital B data (test); stock edits persist and audit-logged; E2E on mobile + desktop.

## P3 Emergency Finder, matching, first aid, directory: M01, M04, M05
- [ ] Matching engine (pure, test-first): requirements × blood compatibility × stale penalty (>30 min) × Haversine distance → score 0–100, rank, bn/en reasons; not-suitable at bottom
- [ ] Finder page (public, no login): condition, blood group, location (geolocation or area), filters (radius, govt/private, free only), sorts (score, distance, freshness), empty state suggests widening radius
- [ ] First-aid card per condition: do's, don'ts, Call 999, source + URL, disclaimer
- [ ] Directory mode: browse all hospitals with filters + pagination

**DoD:** matching unit tests cover CRITICAL/PREFERRED/blood/stale/distance; Finder JS < 150 KB gzip; E2E search flow on 360 px.

## P4 Reservation engine + state machine + sweeper (A05): A05, M06
- [ ] State machine module (test-first): allowed transitions, compare-and-set update, stock return rules (consumable vs not)
- [ ] `reserve()` (test-first, real DB): one transaction: advisory lock on user, limits (1/type, 2 total), conditional decrement, reservation + event + audit; SOLD_OUT returns alternatives; Idempotency-Key replay
- [ ] Endpoints: reserve, cancel, staff transitions; citizen tracker page
- [ ] Expiry sweeper every 30 s + on boot + lazy expire on read
- [ ] Concurrency tests: N parallel reserves on 1 unit → exactly 1 success; double cancel / double check-in → one wins; same idempotency key ×10 → one hold

**DoD:** all concurrency integration tests green against real Postgres; stock never negative; E2E hold→arrive→complete.

## P5 Real-time sync + optimistic concurrency (A01): A01, M06
- [ ] Handshake auth via session cookie; rooms `finder`, `hospital:{id}`, `staff:{hospitalId}`, `reservation:{id}` authorized server-side
- [ ] Emit after commit with entity `version`; client ignores stale versions; snapshot refetch on (re)connect; "Reconnecting…" banner
- [ ] Staff conflict UI: "Another staff member changed this" → reload / re-apply
- [ ] Stretch: "X is editing" presence

**DoD:** Playwright multi-context tests: hold in browser A updates Finder in browser B < 1 s; two staff edit same row → second gets conflict UI; offline→online recovers state.

## P6 Admin, audit, analytics, i18n, a11y, PWA: M01, M03, M05, M08
- [ ] Admin CRUD: hospitals (+CSV import, Zod-validated per row), users (assign staff to hospital), conditions/requirements, first-aid guides
- [ ] Audit log viewer (filter/paginate)
- [ ] Analytics (SQL aggregation): reservations per condition/day, sold-out per resource/area, expiry rate, avg hold→arrival, stale hospitals; lazy-loaded charts
- [ ] bn/en typed dictionary + toggle; Noto Sans Bengali via next/font
- [ ] Accessibility pass (labels, focus, contrast, reduced motion); PWA manifest + service worker caching first-aid pages

**DoD:** admin E2E; analytics queries verified against seeded data; Lighthouse A11y ≥ 95; first-aid opens offline.

## P7 Hardening: M06, M07, M08
- [ ] Full E2E suite incl. concurrency + conflict on live URL (mobile + desktop)
- [ ] Performance budget check (Lighthouse mobile, bundle size)
- [ ] README (setup, architecture summary, demo accounts note, Future Work), `docs/ARCHITECTURE.md`, `docs/DEMO_SCRIPT.md`

**DoD:** all suites green on live URL; budgets met or deviations documented.

## Review Focus
- Two citizens holding the last unit simultaneously → exactly one HELD, other SOLD_OUT with alternatives (P4 concurrency test).
- Network retry / double-click on Reserve → same reservation returned via Idempotency-Key (P4 test).
- Hold expiring while citizen is mid-way → actions return INVALID_TRANSITION with a clear message; stock returned exactly once (P4 sweeper test).
- Socket drops on a phone then reconnects → snapshot refetch shows current stock, no stale event overwrites it (P5 test).
- Invalid / missing geolocation → Finder still works sorted by score, distance hidden (P3 test).
