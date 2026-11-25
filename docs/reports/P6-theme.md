# P6 Rokkha Rebrand & Theme Report (25 Nov 2026)

Branch: `theme` (rebrand & theme commit `46bdb6f`, plus this report; `main` merge `8de2cfa` was committed externally during test execution, and no further changes were made to `main`).

## What changed

1. **Brand identity & assets (`রক্ষা` / `Rokkha`)**
   - Updated user-facing titles, metadata, auth headers, and page copy from JibonSetu to **Rokkha** (`রক্ষা`) with bilingual tagline:
     - Bangla: `"জরুরি মুহূর্তে, সঠিক হাসপাতাল"`
     - English: `"The right hospital, right when it matters"`
   - Kept internal identifiers (`package.json` `"jibonsetu"`, session cookie `jibonsetu_session`, DB names `jibonsetu_test`, repository URL, env vars, Socket.io events) and `src/server/**`, `prisma/**`, `server.ts`, `src/app/api/**` unchanged (`0` files touched in restricted directories).
   - Added vector brand assets (`public/logo.svg`, `src/app/icon.svg`, `180×180` `src/app/apple-icon.png`, `32×32` `src/app/favicon.ico`, plus `docs/screenshots/logo-512.png`), `Logo` / `LogoMark` (`src/components/brand/Logo.tsx`), and inline SVG `ConditionIcon` icons (`src/components/brand/ConditionIcon.tsx`, `aria-hidden="true"`) for all 8 emergency conditions.

2. **Light-by-default medical theme & flash-free dark toggle**
   - Defined semantic CSS custom properties (`:root` light & `.dark` dark palettes) and `@custom-variant dark (&:where(.dark, .dark *));` in `src/app/globals.css`, loaded `Noto_Sans_Bengali` via `next/font/google` in `src/app/layout.tsx`, and added synchronous `THEME_INIT_SCRIPT` (default light unless `localStorage.getItem("rokkha-theme") === "dark"`).
   - Added `ThemeToggle` (`src/components/ThemeToggle.tsx`) using CSS icon visibility (`hidden dark:inline` / `inline dark:hidden`) with zero hydration mismatch.
   - Replaced the full-width top warning strip with a compact header `DemoBadge` (`src/components/DemoBadge.tsx`) pill (`"ডেমো"` / `"Demo"`, `≥ 44 px` vertical touch height) with accessible hover Preview + click/tap Pin popover (`data-testid="demo-popover"`), plus `"ডেমো"` / `"Demo"` tags on demo hospital headers and cards.

3. **Page & component styling + E2E updates**
   - Styled hero card (`12 px` radius, 3-step guide chips), 8-condition card grid, Call `999` emergency card (reserving `--emergency` `#C8102E` exclusively for `999`, `Hold`, sold-out alerts, reject, and confirmation cancel), First Aid Do's/Don'ts cards, Finder filters & cards, Reservation countdown tracker, Staff ResourceConsole (including `sm:whitespace-nowrap` filter tabs), and Admin tables/charts cleanly across light and dark modes.
   - Updated `tests/e2e/health.spec.ts`, `tests/e2e/finder.spec.ts`, and `tests/e2e/admin.spec.ts` from the old top `DEMO DATA` banner assertion to `demo-badge`, `demo-popover`, and `hospital-demo-tag`.

## Bundle Size Comparison (`/find` & `/`)

Measured from `.next/build-manifest.json` (`polyfillFiles`) and `.next/server/app/{find,index}.html` script chunks using `zlib.gzipSync`:

| Route HTML | Metric | Baseline (pre-theme) | Post-edit (`next build`) | Delta |
|---|---|---|---|---|
| `.next/server/app/find.html` (9 scripts) | Total scripts raw / gzip | `592.3 KB` / `184.0 KB` | `596.4 KB` / `185.2 KB` | `+4.1 KB` / `+1.2 KB` |
| `.next/server/app/find.html` (non-polyfill) | Non-polyfill raw / gzip | — / `145.3 KB` | `486.4 KB` / `146.5 KB` | `+1.2 KB` gzip (**under `< 150 KB` budget**) |
| `.next/server/app/index.html` (8 scripts) | Total scripts raw / gzip | — / `177.7 KB` | `579.1 KB` / `178.9 KB` | `+1.2 KB` gzip (`140.2 KB` non-polyfill) |
| Custom server bundle (`dist/server.mjs`) | esbuild ESM bundle | `116.2 kb` | `116.2 kb` | `0` |

## WCAG AA Contrast Verification (all 20 tested pairs pass)

| Mode | Foreground / Background | Computed Ratio | Result |
|---|---|---|---|
| Light | `#14201B` (`--text-primary`) on `#FFFFFF` (`--bg-surface`) | `16.77:1` | PASS AA |
| Light | `#14201B` (`--text-primary`) on `#F7F9F8` (`--bg-page`) | `15.86:1` | PASS AA |
| Light | `#4B5B55` (`--text-muted`) on `#FFFFFF` | `7.18:1` | PASS AA |
| Light | `#005E45` (`--brand-primary-text`) on `#FFFFFF` / `#E8F3EE` | `7.82:1` / `6.88:1` | PASS AA |
| Light | `#FFFFFF` on `#006A4E` (`--brand-primary`) | `6.62:1` | PASS AA |
| Light | `#A80D26` (`--emergency-text`) on `#FFFFFF` / `#FDF2F4` | `7.63:1` / `6.97:1` | PASS AA |
| Light | `#FFFFFF` on `#C8102E` (`--emergency`) | `5.88:1` | PASS AA |
| Light | `#6B4A00` (`--warning-text`) on `#FEF6DF` (`--warning-bg`) | `7.47:1` | PASS AA |
| Dark | `#ECF2EF` (`--text-primary`) on `#121D19` (`--bg-surface`) | `15.23:1` | PASS AA |
| Dark | `#ECF2EF` (`--text-primary`) on `#0B1210` (`--bg-page`) | `16.71:1` | PASS AA |
| Dark | `#A3B5AD` (`--text-muted`) on `#121D19` | `8.04:1` | PASS AA |
| Dark | `#5CE0B3` (`--brand-primary-text`) on `#121D19` / `#102B22` | `10.50:1` / `9.18:1` | PASS AA |
| Dark | `#FFFFFF` on `#0A7B5C` (`--brand-primary`) | `5.25:1` | PASS AA |
| Dark | `#FDA4AF` (`--emergency-text`) on `#121D19` / `#2A1217` | `9.14:1` / `9.28:1` | PASS AA |
| Dark | `#FFFFFF` on `#C8102E` (`--emergency`) | `5.88:1` | PASS AA |
| Dark | `#FDE08D` (`--warning-text`) on `#29200A` (`--warning-bg`) | `12.43:1` | PASS AA |

## Post-final-edit Verification Results

| Check | Scope | Result |
|---|---|---|
| `npm run typecheck` | `next typegen && tsc --noEmit` | Passed (0 errors) |
| `npm run lint` | `eslint .` | Passed (0 errors, 0 warnings) |
| `npm run build` | `prisma generate && next build && npm run build:server` | Passed (`33/33` pages + `dist/server.mjs 116.2kb`) |
| `npm test -- --reporter=dot` | Vitest unit + integration against `jibonsetu_test` | **34 / 34 files, 313 / 313 passed** (`590.53s`) |
| `npm run test:e2e -- --reporter=line --workers=2 --retries=1` | Playwright mobile (`360×800`) + desktop (`1440×900`) against `jibonsetu_test` | **120 / 120 passed** (`5.7m`, 0 failed, 0 skipped; desktop hold-to-finder latency `(a)`: `343 ms`) |

## Screenshot Inventory (`docs/screenshots/`)

Captured against a local dev server wired strictly to `DATABASE_URL_TEST` (`360×800` mobile and `1440×900` desktop; `scrollWidth === innerWidth` with `0` horizontal overflow verified across all 16 UI captures):

- `home-mobile.png` (`54,632` B), `home-desktop.png` (`93,966` B), `home-dark-mobile.png` (`54,906` B), `home-dark-desktop.png` (`93,642` B)
- `find-mobile.png` (`67,349` B), `find-desktop.png` (`117,543` B)
- `first-aid-mobile.png` (`66,717` B), `first-aid-desktop.png` (`99,893` B)
- `login-mobile.png` (`33,795` B), `login-desktop.png` (`39,624` B)
- `tracker-mobile.png` (`51,311` B), `tracker-desktop.png` (`67,354` B)
- `staff-mobile.png` (`52,789` B), `staff-desktop.png` (`93,783` B)
- `admin-mobile.png` (`43,443` B), `admin-desktop.png` (`136,129` B)
- `logo-512.png` (`98,232` B)
