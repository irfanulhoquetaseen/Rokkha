# PROGRESS

## Current phase
P1 + P2 + P3: **done** (24 Nov 2026). Next: **P4 reservation engine (A05)**.

## Done
- **P0** Foundation: Next.js 16.4.6 + custom `server.ts` (Next + Socket.io 4.8.4 on one port), Prisma 7.10.1 + Postgres 18 on Railway Singapore, `/api/health`, live deploy. Auto-deploy on push to `main` proven (GitHub trigger on the `web` service).
- **Test infra:** integration tests use only `DATABASE_URL_TEST` and refuse any DB whose name doesn't end in `_test`; local E2E boots its own dev server on `E2E_PORT` (default 3100) wired to the test DB and reseeds it (never the live DB).
- **P1** Data model: all entities from CLAUDE.md (+ `Hospital.liveDataEnabled/phone/division/district/address`, `BloodCompatibility`), raw-SQL constraints (`hospital_resource_stock_bounds`, `reservation_one_active_per_type` partial unique index, `condition_requirement_target`, `reservation_quantity_positive`, `hospital_coords_valid`).
- **P1** Seed (idempotent, safe on live): 25 fictional hospitals (17 Dhaka across 8 areas, 3 Chattogram, 5 Rajshahi incl. upazilas), 5 directory-only; 26 resource types; 8 conditions + requirements; 27-row red-cell compatibility matrix; 8 sourced first-aid guides (IFRC 2020 guidelines + WHO fact sheets, `SOURCE_CHECKED`); stock variety (last-unit, sold-out, stale > 30 min, specialists off duty); 6 demo accounts with passwords from env.
- **P1** Auth (own implementation): bcryptjs (72-byte guard), DB sessions storing only SHA-256 of a 256-bit token, httpOnly/SameSite=Lax/Secure cookie, rotation on login + signup, server-side logout, rate limits (per phone + per IP, env-tunable, first block audited), Origin check on every mutation, guards returning 404 (never 403) with `AUTHZ_DENIED` audit, one bilingual error shape. `/signup`, `/login`, logout, bn/en toggle, BD phone validation.
- **P2** Staff console `/staff`: own-hospital resources grouped, +/−, Set, status switches, search/filter (low/stale), optimistic concurrency (version CAS → 409 with current values → "Another staff member changed this" Reload / Re-apply), `STOCK_CHANGE` audit old→new; `proxy.ts` gives real 307/404 status codes. Reservation queue moved to P4 (needs the state machine).
- **P3** Matching engine (pure, unit-tested): CRITICAL/PREFERRED weights, blood resolved by recipient group (unknown → O− only), stale penalty, Haversine distance, score 0–100, rank, bn/en reasons. Public Finder (no login): 8 condition buttons, blood group, area or GPS, radius, govt/private, free only, resource, sort (score/distance/freshness), pagination, notices, empty state; first-aid card (do's/don'ts, Call 999, source link, disclaimer); "Unverified — call before going" directory section.

## Next
- **P4** reservation engine (A05) + state machine + expiry sweeper + staff reservation queue (check-in / reject / complete).
- **P5** real-time sync (A01). **P6** admin/audit/analytics/i18n/PWA. **P7** hardening.

## Known issues
- Bangla first-aid text needs a native-speaker proofread (content is sourced and reviewed for fidelity, translation not proofread by a native speaker).
- `npm audit`: 3 high in `effect` (Prisma 7 CLI config loader; dev/CLI only). Accepted.
- Prisma CLI "update available → 8.0.0-rc" banner: ignore.
- Lighthouse can't run inside agent sandboxes; measured by the controller on the live URL (see docs/reports/P1-P3.md).
- Directory section lists only directory-only hospitals and is unpaginated (5 rows); full "browse all hospitals" directory is tracked for P6.
- Finder ranks all live hospitals in memory per request (fine at 20 live hospitals; document scale assumption in P7).

## Must-do in P4 (load-bearing, carried from reviews)
- Returning stock on CANCELLED/EXPIRED/REJECTED must clamp: `available = LEAST(total, available + qty)` — staff `set`/`adjust` don't know about held stock.
- `SEED_RESET_STOCK=1` must subtract active HELD/ARRIVED quantities (or refuse while holds exist). Until then: use it only before a demo with no active holds.
- Add FK `Reservation.userId → User`.
- Expiry sweeper (on boot) must tolerate a fresh/unmigrated DB (E2E dev server boots before global-setup migrates).
- Staff E2E restore should use inverse `adjust` once reservations change stock concurrently.

## Decisions log
- 24 Nov: **Prisma 7.10.1** (latest stable), not 8.0.0-rc.
- 24 Nov: Keep TypeScript 5 / ESLint 9 (Next 16 tooling).
- 24 Nov: Keep `cacheComponents: true`; route handlers call `await connection()`; request-time 404/307 for `/staff/*` and `/first-aid/*` are decided in `src/proxy.ts` because streamed pages always start with HTTP 200.
- 24 Nov: `prisma` CLI is a runtime dependency (pre-deploy `migrate deploy`).
- 24 Nov: Postgres public TCP proxy is for local dev / migrations only; the app uses the internal URL.
- 24 Nov: Separate test DBs: `jibonsetu_test` (main), `jibonsetu_p2_test` / `jibonsetu_p3_test` (parallel worktrees). Guard: name must end in `_test`.
- 24 Nov: Resource types = 26 (6 + 13 + 7); plan's "32" was an arithmetic error.
- 24 Nov: Anonymous guard failures (401) are not audited (authentication, not authorization); signed-in denials are audited as `AUTHZ_DENIED`.
- 24 Nov: Rate-limit trade-off: per-phone limit (5 / 15 min) means anyone can lock one account's login for 15 min by guessing wrong 5 times; per-IP limits are env-tunable (`LOGIN_LIMIT_PER_IP`, `SIGNUP_LIMIT_PER_IP`) so judges behind one NAT aren't blocked. Rate limiter is in-memory (single Railway instance).
- 24 Nov: Client IP = right-most `X-Forwarded-For` hop (Railway's edge appends it); left-most is client-controlled.
- 24 Nov: Matching scores: capability 70 (CRITICAL weight 3, PREFERRED 1), distance 20 (linear to 0 at 30 km; 10 when no location), freshness 10. Not-suitable hospitals are listed after all suitable ones.
- 24 Nov: Unknown patient blood group counts only O− stock (universal red-cell donor).
- 24 Nov: First-aid sources: IFRC International First Aid Guidelines 2020 (page-anchored) for stroke, heart attack, trauma, breathing, pregnancy; WHO fact sheets for dengue, snakebite, rabies. Trauma positioning keyed to *suspected* spinal injury.
- 24 Nov: `SEED_RESET_STOCK` is opt-in; default re-seed never touches stock.
