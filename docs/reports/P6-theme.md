# P6–P7 Rokkha Rebrand, Theme Verification & Lighthouse Report (26 Nov 2026)

Commits on `main`: `46bdb6f` (rebrand/theme on `theme`), `8de2cfa` (merge into `main`), `daadba8` (Task 2 contrast, table focusability & demo-badge fixes), followed by the final screenshots, verification, and docs commit. Deployed live at `https://web-production-3fb89dc8.up.railway.app`.

## What changed

1. **Brand identity & assets (`রক্ষা` / `Rokkha`)**
   - Updated user-facing titles, metadata, auth headers, and page copy from JibonSetu to **Rokkha** (`রক্ষা`) with bilingual tagline (`"জরুরি মুহূর্তে, সঠিক হাসপাতাল"` / `"The right hospital, right when it matters"`).
   - Kept internal identifiers (`package.json` `"jibonsetu"`, session cookie `jibonsetu_session`, DB names `jibonsetu_test`, env vars, Socket.io events) and `src/server/**`, `prisma/**`, `server.ts`, `src/app/api/**` untouched.
   - Added vector brand assets (`public/logo.svg`, `src/app/icon.svg`, `180×180` `src/app/apple-icon.png`, `32×32` `src/app/favicon.ico`, `docs/screenshots/logo-512.png`), `Logo` / `LogoMark` (`src/components/brand/Logo.tsx`), and inline SVG `ConditionIcon` icons (`src/components/brand/ConditionIcon.tsx`, `aria-hidden="true"`) for all 8 emergency conditions.

2. **Light-by-default medical theme & flash-free dark toggle**
   - Semantic CSS custom properties (`:root` light & `.dark` dark) and `@custom-variant dark (&:where(.dark, .dark *));` in `src/app/globals.css` (`html, body` sharing `--bg-page`), `Noto_Sans_Bengali` via `next/font/google` in `src/app/layout.tsx`, and synchronous `THEME_INIT_SCRIPT` (default light unless `localStorage.getItem("rokkha-theme") === "dark"`).
   - `ThemeToggle` (`src/components/ThemeToggle.tsx`) using CSS icon visibility (`hidden dark:inline` / `inline dark:hidden`) with zero hydration mismatch.
   - Compact header `DemoBadge` (`src/components/DemoBadge.tsx`) pill (`"ডেমো"` / `"Demo"`, `≥ 44 px` touch height) with hover preview + click/tap/keyboard (`Enter`/`Space`/`Escape`) popover (`data-testid="demo-popover"`), plus `"ডেমো"` / `"Demo"` tags on demo hospital cards and pages (`/find`, directory, `/hospitals/[hospital]`, `/reservations`, `/reservations/[reservationId]`, `SoldOutPanel`, and `/admin`).

3. **Task 2 visual & accessibility fixes (`daadba8`)**
   - Replaced dark-mode AA contrast failures (`text-zinc-500`, `3.57:1` on `#121D19`) in `src/components/admin/{HospitalList,AnalyticsDashboard,AuditLogViewer,UserList}.tsx` with `text-[var(--text-muted)]` (`8.04:1` in dark mode, `7.18:1` in light mode).
   - Added `tabIndex={0}` and `role="region"` labels to horizontally scrollable `.overflow-x-auto` admin tables (`HospitalList`, `AuditLogViewer`, `UserList`, `AnalyticsDashboard`) to resolve `scrollable-region-focusable`.
   - Added `html` to `html, body { background-color: var(--bg-page); }` in `src/app/globals.css` so dark reload paints `#0B1210` immediately before `DOMContentLoaded`.
   - Added `hospital-demo-tag` badges to `src/app/reservations/page.tsx`, `src/app/reservations/[reservationId]/page.tsx`, `src/components/reservations/SoldOutPanel.tsx`, and `src/components/admin/HospitalList.tsx`.

## Bundle Size Comparison (`/find` & `/`)

Measured from `.next/build-manifest.json` (`polyfillFiles`) and `.next/server/app/{find,index}.html` script chunks using `zlib.gzipSync`:

| Route HTML | Metric | Pre-theme baseline | Rebrand (`8de2cfa`) | Final (`daadba8`) |
|---|---|---|---|---|
| `.next/server/app/find.html` (9 scripts) | Total scripts raw / gzip | `592.3 KB` / `184.0 KB` | `596.4 KB` / `185.2 KB` | `604.2 KB` / `187.3 KB` |
| `.next/server/app/find.html` (non-polyfill) | Non-polyfill raw / gzip | `—` / `145.3 KB` | `486.4 KB` / `146.5 KB` | `494.3 KB` / **`148.6 KB`** (`< 150 KB` budget) |
| `.next/server/app/index.html` (8 scripts) | Total scripts raw / gzip | `—` / `177.7 KB` | `579.1 KB` / `178.9 KB` | `579.1 KB` / `178.9 KB` |
| `.next/server/app/index.html` (non-polyfill) | Non-polyfill raw / gzip | `—` | `469.2 KB` / `140.2 KB` | `469.2 KB` / `140.2 KB` |
| Custom server bundle (`dist/server.mjs`) | esbuild ESM bundle | `116.2 kb` | `116.2 kb` | `116.2 kb` |

## Live Verification (Task 2 — `https://web-production-3fb89dc8.up.railway.app` on `daadba8`)

- **Header `DemoBadge` & hospital Demo tags:** Pill renders `"ডেমো"` / `"Demo"`; tap, `Enter`, `Space`, and `Escape` toggle/dismiss `demo-popover` with zero horizontal overflow on `360×800` (`popRect.right = 357 px <= 360 px`). `10/10` `/find?condition=STROKE` cards and `/hospitals/dhanmondi-care-general` show `hospital-demo-tag`.
- **Logo heartbeat & reduced motion:** `.rk-beat` runs `rk-heartbeat` (`1.6s`) when `reducedMotion: "no-preference"`, and computes `animationName: "none"` (`0s`) under `prefers-reduced-motion: reduce`.
- **Theme toggle & flash-free dark load:** Defaults to light; toggling stores `rokkha-theme="dark"` and applies `.dark`; inline `<head>` `THEME_INIT_SCRIPT` keeps `.dark` and `#0B1210` (`rgb(11, 18, 16)`) active at `DOMContentLoaded` across reload.
- **Language toggle:** Verified `bn ↔ en` switching on `/`, `/find?condition=STROKE`, `/first-aid/STROKE`, `/login`, `/hospitals/dhanmondi-care-general`, `/reservations`, `/staff`, and `/admin/*`.
- **`axe-core` WCAG 2.0/2.1 A/AA contrast & accessibility:** **`0` violations** across `/`, `/find?condition=STROKE`, `/first-aid/STROKE`, `/login`, `/hospitals/dhanmondi-care-general`, `/reservations`, `/staff`, `/admin`, `/admin/users`, `/admin/audit`, and `/admin/analytics` in **both light and dark modes** (`0` horizontal overflow at `360×800`).

## Quality Gate & Test Results (Task 3)

| Check | Scope | Result |
|---|---|---|
| `npm run typecheck` | `next typegen && tsc --noEmit` (after final edit) | **Passed** (`0` errors) |
| `npm run lint` | `eslint .` (after final edit) | **Passed** (`0` errors, `0` warnings) |
| `npm run build` | `prisma generate && next build && npm run build:server` | **Passed** (`33/33` pages + `dist/server.mjs 116.2kb`) |
| `npm test -- --reporter=dot` | Vitest unit + integration against `jibonsetu_test` | **34 / 34 files, 313 / 313 passed** (`577.55s`) |
| `npm run test:e2e -- --reporter=line --workers=2 --retries=1` | Playwright mobile (`360×800`) + desktop (`1440×900`) against `jibonsetu_test` (after final edit `daadba8`) | **120 / 120 passed** (`5.4m`; Finder live latency `(a)`: `804 ms` mobile, `831 ms` desktop) |

*(Note: an initial non-retry `test:e2e --workers=2` run hit one transient Windows Chromium worker crash `code=3221226505` on `realtime-finder.spec.ts:95` with 119/120 passing; the `--retries=1` run passed all 120/120 tests with zero failures.)*

## Live Mobile Lighthouse Results (Task 4 — `https://web-production-3fb89dc8.up.railway.app` on `daadba8`)

| Route | Performance | Accessibility | FCP | LCP | TBT | CLS | Report |
|---|---|---|---|---|---|---|---|
| `/find?condition=STROKE` | **100** | **100** | `1.1 s` | `1.1 s` | `40 ms` | `0` | [`docs/reports/lighthouse-find-mobile.json`](lighthouse-find-mobile.json) |
| `/` | **100** | **100** | `1.0 s` | `1.0 s` | `40 ms` | `0` | [`docs/reports/lighthouse-home-mobile.json`](lighthouse-home-mobile.json) |
| `/first-aid/STROKE` | **100** | **100** | `0.9 s` | `0.9 s` | `30 ms` | `0` | Verified in session |
| `/login` | **100** | **100** | `0.9 s` | `0.9 s` | `40 ms` | `0` | Verified in session |

## Screenshot Inventory (`docs/screenshots/`)

Refreshed against the live Railway deployment (`https://web-production-3fb89dc8.up.railway.app`) via `scripts/take-screenshots.mjs` at `360×800` (mobile) and `1440×900` (desktop) with `deviceScaleFactor: 2` (`0` horizontal overflow across all 16 UI screenshots; visually verified for new logo, light theme default, header `"ডেমো"` pill, no `"DEMO DATA"` banner, and zero cropping). `tracker-mobile.png` and `tracker-desktop.png` capture an active `GENERAL_BED` hold for citizen `01700000021` on `/reservations/<id>`, which was then cancelled via the UI so stock returned cleanly.

- `home-mobile.png` (`133,879` B), `home-desktop.png` (`229,104` B)
- `home-dark-mobile.png` (`135,819` B), `home-dark-desktop.png` (`231,333` B)
- `find-mobile.png` (`179,397` B), `find-desktop.png` (`303,906` B)
- `first-aid-mobile.png` (`178,893` B), `first-aid-desktop.png` (`261,528` B)
- `login-mobile.png` (`81,014` B), `login-desktop.png` (`101,648` B)
- `tracker-mobile.png` (`121,431` B), `tracker-desktop.png` (`184,911` B)
- `staff-mobile.png` (`144,251` B), `staff-desktop.png` (`270,083` B)
- `admin-mobile.png` (`103,290` B), `admin-desktop.png` (`371,283` B)
- `logo-512.png` (`98,232` B)
