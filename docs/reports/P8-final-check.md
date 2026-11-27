# P8 Final Pre-Submission Check Report (Rokkha)

Executed on branch `main` starting from commit `561dc7d38bb74327a5ea1a7f81ce14684da1965e` against local test DB (`DATABASE_URL_TEST`, ending in `_test`) and live Railway URL `https://web-production-3fb89dc8.up.railway.app`.

| Check | Result | Notes |
|---|---|---|
| Git branch & clean tree | **PASS** | Branch `main`, working tree clean before adding this report (`main` == `origin/main` at `561dc7d`). |
| `npm ci` | **SKIPPED** | `node_modules` already present and intact. |
| `npm run typecheck` | **PASS** | `next typegen && tsc --noEmit` completed with 0 errors. |
| `npm run lint` | **PASS** | `eslint .` completed with 0 errors and 0 warnings. |
| `npm run test:unit` | **PASS** | Vitest `unit` project: 17 / 17 files, 113 / 113 tests passed (`645ms`). |
| `npm run build` | **PASS** | `prisma generate && next build && npm run build:server` succeeded (`33/33` static/partial pages + `dist/server.mjs` `116.2kb`). |
| `DATABASE_URL_TEST` guard | **PASS** | `DATABASE_URL_TEST` is set and ends with `_test` (value not printed). |
| `npm run test:integration` | **PASS** | Vitest `integration` project against `jibonsetu_test`: 17 / 17 files, 200 / 200 tests passed (`543.89s`). |
| `npm run test:e2e` | **PASS** | Playwright (`--reporter=line --workers=2 --retries=1`) against `jibonsetu_test`: **120 / 120 passed** (`6.1m`; Finder live update latency `(a)`: `925 ms` mobile, `970 ms` desktop). |
| Live HTTP 200 & console (`/`, `/find`, `/find?condition=STROKE`, `/first-aid/STROKE`, `/login`, `/icon.svg`, `/logo.svg`) | **PASS** | All 7 routes returned HTTP `200`, `0` console errors, `0` page errors; `/icon.svg` & `/logo.svg` served valid `<svg>`. |
| Live `/tracker` check | **FAIL** | Returned HTTP `404` (with expected 404 resource console message). This app exposes reservation routes at `/reservations` (`307` -> `/login?next=%2Freservations` when signed out) and `/reservations/[reservationId]` (live tracker), not `/tracker`. |
| Live mobile (`390px`) & desktop (`1440px`) layout | **PASS** | `0` horizontal overflow (`scrollWidth === innerWidth`), header `<svg>` logo visible (`true`), `0` sibling element overlaps across `/`, `/find`, `/find?condition=STROKE`, `/first-aid/STROKE`, and `/login`. |
| Live real-time sync (A01) | **PASS** | Two contexts logged in as Dhanmondi staff (`01700000011`) on `/staff`: incrementing `CCU_BED` `5 -> 6` in context 1 appeared in context 2 in **`230 ms`** (`<= 3000 ms`) with no reload (`c2Reloaded: false`); restored `CCU_BED` back to `5`. |
| Live concurrency race (A05) | **PASS** | Ran `npm run demo:race -- --url https://web-production-3fb89dc8.up.railway.app --hospital dhanmondi-care-general --resource ICU_BED --n 20 --set-available 1`: **`HELD: 1`**, **`SOLD_OUT: 19`**, `LIMIT_REACHED: 0`, `RATE_LIMITED: 0`; `available before: 1`, `available after: 0` (`316 ms`); cancelled 1/1 hold and restored `ICU_BED` to `1/6`. |
| Live demo stock refresh (`/admin`) | **PASS** | Triggered `/admin` UI demo refresh (`POST /api/admin/demo-refresh` -> HTTP `200`, `{ "refreshed": 20 }`). |
| `README.md` TODOs & links | **PASS** | Only placeholder found: `TODO_YOUTUBE_URL` (lines 13 and 24; untouched). All 7 image links (`public/logo.svg`, 6 `docs/screenshots/*.png`) and all docs links (`docs/JUDGE_GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/reports/lighthouse-find-mobile.json`) exist. |
| Git hygiene (`git ls-files` & `origin/main`) | **PASS** | 269 tracked files; no `.env`, secrets, `test-results/`, or `_to_delete/` tracked; `main` equalled `origin/main` (`561dc7d`) prior to this commit. |
