# P5 Real-time Sync (A01) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen that shows stock or a reservation stays correct live — Finder counts/ranking, the public hospital page, the staff console (stock + queue) and the citizen tracker — with authorized rooms, version-ordered events, snapshot recovery after reconnect and a visible "Reconnecting…" banner.

**Architecture:** Server: `src/server/realtime/io.ts` authenticates the Socket.io handshake from the session cookie and authorizes `subscribe` requests per room (`src/server/realtime/rooms.ts`, pure + DB guard helpers); P4's `publish.ts` already emits `stock:changed` / `reservation:changed` after commit, and P5 adds the staff resource PATCH as a publisher. Client: one lazily imported `socket.io-client` singleton (`src/components/realtime/socket.ts`) with a tiny hook API; each live island keeps the last `version` per entity, drops events with `version ≤` known, and refetches a snapshot on every (re)connect. The Finder (server-rendered) refreshes through `router.refresh()` so ranking is always recomputed by the one matching engine.

**Tech Stack:** Socket.io 4.8 server + client, Next.js 16 App Router, Playwright multi-context.

**Spec:** `CLAUDE.md` §3.2, §4; `docs/PLAN.md` P5; `docs/prompts/NEXT_PROMPT_3.md` STEP 2; P4 plan `docs/superpowers/plans/2026-11-24-p4-reservation-engine.md` (Interfaces of Tasks 3 and 6).

## Global Constraints
- Rooms: `finder` and `hospital:{id}` public; `staff:{hospitalId}` only HOSPITAL_STAFF of that hospital or ADMIN; `reservation:{id}` only its owner or ADMIN. Unauthorized → ack `{ ok: false, code: "NOT_FOUND" }` (never reveal existence) and audit `AUTHZ_DENIED` for signed-in users. Clients never choose a room they are not authorized for; the server joins rooms only via `subscribe`.
- Socket messages Zod-validated: `subscribe` / `unsubscribe` payload `{ room: string ≤ 100 }` matching `/^(finder|hospital:[\w-]{1,64}|staff:[\w-]{1,64}|reservation:[\w-]{1,64})$/`.
- Event payloads (exact): `stock:changed` = P4 `StockSnapshot` `{ id, hospitalId, resourceTypeId, code, available, total, isAvailable, version, updatedAt }`; `reservation:changed` = `{ id, status, version, hospitalId, expiresAt }` (no personal data on the wire; staff refetch the queue, owners refetch their reservation).
- Emit only after commit (already true for P4 services; the staff PATCH publishes after `updateHospitalResource` resolves).
- Client ignores events whose `version` ≤ the version it holds for that entity; on every `connect` (first and re-) it refetches its snapshot.
- Banner: "Reconnecting…" / "আবার সংযোগ হচ্ছে…" (`role="status"`, `data-testid="reconnecting-banner"`) shown while a live island's socket is disconnected after it first connected, or immediately on `window` `offline`; hidden on reconnect. `offline` → `socket.disconnect()`, `online` → `socket.connect()`.
- Finder first-load JS stays < 150 KB gzip: `socket.io-client` is loaded with `import()` after hydration, never in the initial chunk. Respect `prefers-reduced-motion` (no animations beyond a colour flash that is disabled under reduced motion).
- All strings in `src/lib/i18n/realtime.ts`. No new npm dependencies. Commit per task; do not push.

## Review Focus
- An event arriving out of order (v5 then v4) must not roll a count back (unit test in Task 2 `ignores stale versions`).
- A user who logs out keeps an open socket: their staff/reservation rooms must not keep receiving events after the session ends — the server re-validates the session on every `subscribe` and the client reconnects (new handshake) after login/logout (Task 1 test `subscribe after logout is denied`).
- Phone sleeps for minutes and wakes up: snapshot refetch on reconnect shows the true stock even though every missed event is lost (Task 5 E2E d).
- A burst of 20 stock events (demo:race) must not trigger 20 Finder refreshes — debounce 300 ms, at most one refresh in flight, a trailing refresh if events arrived meanwhile (Task 3 unit test `coalesces bursts`).
- Staff typing a "Set" value while another staff member changes the same row: the live update must not silently replace their typed value or its base version; saving must produce the conflict panel (Task 4 E2E b).

---

### Task 1: Authenticated handshake + room authorization + staff PATCH publishes

**Files:**
- Modify: `src/server/realtime/io.ts`, `src/app/api/staff/resources/[resourceId]/route.ts` (call `publishStock` after success), `src/server/resources/update.ts` (return the `StockSnapshot` fields needed, or map in the route)
- Create: `src/server/realtime/rooms.ts`
- Test: `tests/integration/realtime.test.ts` (real `http.createServer()` on port 0 + `attachSocketServer`, real `socket.io-client` connections with/without a `Cookie` header from `createSession`; events produced by calling the real P4 services)

**Interfaces — Produces:**
- `authorizeRoom(user: SessionUser | null, room: string): Promise<boolean>` in `rooms.ts` — parses with the regex above; `staff:{id}` → `requireHospitalAccess`; `reservation:{id}` → `requireReservationOwner` (both throw → false).
- Socket protocol: on connection the server reads `socket.handshake.headers.cookie`, resolves the session token (`SESSION_COOKIE`) → `socket.data.userId` (or null). `socket.on("subscribe", payload, ack)` re-validates the session from the stored token on every call (so logout revokes), authorizes, `socket.join(room)`, `ack({ ok: true })`; failure `ack({ ok: false, code })`. `unsubscribe` leaves. `server:hello` kept.
- Tests: `anonymous can subscribe to finder and hospital rooms`; `anonymous cannot join staff or reservation rooms` (ack NOT_FOUND); `citizen cannot join another citizen's reservation room`; `citizen cannot join a staff room`; `staff can join own staff room but not another hospital's`; `owner receives reservation:changed after cancel, with version`; `finder room receives stock:changed after reserve, after commit` (assert DB already shows the new value when the event arrives); `staff PATCH publishes stock:changed`; `subscribe after logout is denied` (delete session, subscribe again → NOT_FOUND); `invalid payload acks VALIDATION_ERROR`.

- [ ] **Step 1:** Failing tests. **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** `npm test` PASS; typecheck/lint PASS. **Step 5:** Commit `feat(realtime): cookie-authenticated socket rooms with server-side authorization`.

### Task 2: Client realtime core — socket singleton, version gate, reconnect banner

**Files:**
- Create: `src/components/realtime/socket.ts` (lazy singleton), `src/components/realtime/useLive.ts` (hook), `src/components/realtime/version-gate.ts` (pure), `src/components/realtime/ReconnectingBanner.tsx`, `src/lib/i18n/realtime.ts`
- Test: `tests/unit/version-gate.test.ts`, `tests/unit/coalesce.test.ts`

**Interfaces — Produces:**
- `createVersionGate(): { accept(id: string, version: number): boolean; set(id: string, version: number): void }` — `accept` true only when `version >` stored (unknown id → true and stores).
- `createCoalescer(fn: () => Promise<void>, delayMs = 300): { trigger(): void; cancel(): void }` (in `version-gate.ts` or its own file) — debounced, single flight, one trailing run if triggered during a run.
- `useLive({ rooms: string[], onEvent: { "stock:changed"?: (s) => void; "reservation:changed"?: (r) => void }, onConnect: () => void /* snapshot refetch */ }): { state: "connecting" | "connected" | "reconnecting" }` — subscribes after every connect, unsubscribes on unmount, handles `online`/`offline`.
- `ReconnectingBanner({ state, lang })` — sticky top, high-contrast, ≥ 44 px tall tap-free.
- Tests: `ignores stale versions` (5 accepted, 4 rejected, 5 rejected, 6 accepted); `coalesces bursts` (20 triggers within 100 ms → fn called ≤ 2 times; trigger during run → exactly one trailing call).

- [ ] **Step 1–4:** failing unit tests → implement → PASS; typecheck/lint PASS. **Step 5:** Commit `feat(realtime): client socket core with version gate, coalescing and reconnect banner`.

### Task 3: Live Finder + public hospital page

**Files:**
- Create: `src/components/finder/FinderLive.tsx` (client island, renders the banner + nothing else), `src/app/hospitals/[hospital]/page.tsx` (public; resources table; `notFound()` for unknown), `src/components/hospital/LiveStockTable.tsx` (client)
- Modify: `src/app/find/page.tsx` (mount `FinderLive` with `relevantCodes` = the condition's requirement resource codes + all `BLOOD_*` codes when blood is required, and `versions` = `{ [hospitalResourceId]: version }` of rows on the page), `src/server/finder/search.ts` (expose those ids/versions on results — add `stockVersions: Record<string, number>` to `FinderResult`), `src/components/finder/HospitalCard.tsx` (hospital name links to `/hospitals/<slug>`; holdable counts get `data-testid="hold-available"` with `data-code`)
- Test: `tests/e2e/realtime-finder.spec.ts` (local single-context sanity; multi-context goes in Task 5)

**Interfaces — Produces:** `FinderLive({ relevantCodes: string[], versions: Record<string, number>, lang })` — subscribes `finder`; on `stock:changed` with relevant `code` and gate-accepted version → `coalescer.trigger()` → `router.refresh()`; on reconnect → `router.refresh()`. `LiveStockTable({ hospitalId, initial: StockSnapshot[], lang })` — subscribes `hospital:{id}`, updates rows in place by version, refetches `GET /api/hospitals/:id/stock` on connect; rows `data-testid="stock-row"` `data-code`.

- [ ] **Step 1:** Failing E2E: Finder page shows `[data-testid="hold-available"][data-code="ICU_BED"]` for Dhanmondi; a reserve via API (racer) → the count drops by 1 within 2 s without reload; `/hospitals/dhanmondi-care-general` row updates live the same way; `/hospitals/nope` → 404.
- [ ] **Step 2–4:** FAIL → implement → PASS; Finder first-load JS < 150 KB gzip (report number); typecheck/lint PASS. **Step 5:** Commit `feat(realtime): live finder ranking and public hospital stock page`.

### Task 4: Live staff console (stock + queue, conflict-safe) and live citizen tracker

**Files:**
- Modify: `src/components/staff/ResourceConsole.tsx` (subscribe `staff:{hospitalId}` via `useLive`; on accepted `stock:changed` update the row **unless that row has an open, dirty Set form** — then keep the form's base version and show a small "Changed by someone else" hint, so saving yields the existing conflict panel; on connect refetch `GET /api/staff/hospitals/:id/resources`), `src/components/staff/ReservationQueue.tsx` (on `reservation:changed` → coalesced refetch of the current page; on connect refetch), `src/components/reservations/Tracker.tsx` (subscribe `reservation:{id}`; on accepted event refetch `GET /api/reservations/:id`; on connect refetch), mount `ReconnectingBanner` in all three.
- Test: `tests/e2e/realtime-staff.spec.ts`

- [ ] **Step 1:** Failing E2E (single browser, two contexts allowed here): staff console open; a racer reserves Dhanmondi `GENERAL_BED` via API → the row's available drops and a queue row appears within 2 s, no reload.
- [ ] **Step 2–4:** FAIL → implement → PASS; existing `staff.spec.ts` conflict test still passes; typecheck/lint PASS. **Step 5:** Commit `feat(realtime): live staff console, queue and citizen tracker`.

### Task 5: Playwright multi-context acceptance (a)–(d)

**Files:** Create `tests/e2e/realtime-acceptance.spec.ts` (+ shared helpers in `tests/e2e/helpers.ts`: `apiLogin(page, phone, password)`, `newProjectPage(browser)`, `cancelActive(page)` — move duplicates from `staff.spec.ts` / `reservations.spec.ts` here).

Each test uses independent browser contexts with the project's device settings, accounts and rows separated per project (mobile vs desktop) so both projects run in parallel on the same DB, cleans up its holds/edits in `afterEach`, and is safe against the live URL:
- (a) `citizen hold in A updates Finder in B within 1 s`: B opens the finder; A (citizen, UI) clicks Hold; measure from A's 201 response to B's `hold-available` text change with `expect.poll(..., { timeout: 1000 })` — on the live URL record the measured ms in the test annotations.
- (b) `two staff editing the same resource → second sees the conflict UI` (same hospital, two staff sessions: Dhanmondi staff in two contexts; A opens Set on row X and types, B saves a change to X, A saves → "Another staff member changed this" panel with current values, Reload and Re-apply both work).
- (c) `staff check-in updates the citizen tracker live` (citizen tracker open in A; staff in B clicks Check in → A shows ARRIVED within 2 s, no reload; then Complete → COMPLETED).
- (d) `offline then online recovers` (Finder + tracker in A; `context.setOffline(true)` → banner visible; meanwhile B changes stock and staff rejects A's hold; `setOffline(false)` → banner hidden within 5 s, the count and the REJECTED status are correct without reload).

- [ ] **Step 1:** Write tests. **Step 2:** Run locally on both projects ×2 → PASS (fix root causes, never add sleeps or retries to hide races). **Step 3:** Commit `test(e2e): multi-context realtime acceptance (finder, conflict, tracker, offline)`.

### Task 6 (stretch — only if Tasks 1–5 are green): presence indicator

**Files:** Modify `src/server/realtime/io.ts` (`presence:editing` `{ resourceId, editing: boolean }` from staff sockets in their `staff:{hospitalId}` room → broadcast `presence:changed { resourceId, userName, editing }` to that room except sender; clear on disconnect), `src/components/staff/ResourceConsole.tsx` (emit when a Set form opens/closes; show "<name> is editing <resource>" chip), test in `tests/integration/realtime.test.ts` (`presence only reaches the same hospital's staff`) and one E2E assertion in `realtime-acceptance.spec.ts` (b).

- [ ] **Step 1–4:** test → implement → PASS. **Step 5:** Commit `feat(realtime): staff presence indicator`.
