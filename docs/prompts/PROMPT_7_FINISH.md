# PROMPT 7 — Finish Rokkha (screenshots, verification, final push)

You are finishing the Rokkha (রক্ষা) project. Read CLAUDE.md first. The rebrand/theme work is already merged into `main` and deployed to https://web-production-3fb89dc8.up.railway.app. Do ONLY the tasks below.

## Safety rules
- Local `DATABASE_URL` in `.env` points at the LIVE database. NEVER run `db:seed`, `db:migrate reset`, truncate, or any destructive command against it. Integration tests use `DATABASE_URL_TEST` only.
- Never print, commit, or screenshot passwords or `.env` contents.
- Do not change server, DB, API, auth, realtime or reservation logic.
- Work on `main` (`git checkout main && git pull`). The stray `theme` branch is already merged.

## Task 1 — Refresh README screenshots (new logo)
1. `npx playwright install chromium`
2. `node scripts/take-screenshots.mjs` (it logs in with the seed passwords from `.env`, shoots the LIVE site at 360x800 and 1440x900, and overwrites `docs/screenshots/*.png`).
3. Open each new image and verify: the logo is the NEW one (green location pin, white disc, red anatomical heart with vessels and a white ECG line, small yellow dot), light theme, header "ডেমো" pill present, no yellow "DEMO DATA" banner, no horizontal overflow, nothing cropped. Re-take any bad one.
4. The `tracker-*` shots must show a real reservation, not an empty list: as citizen 01700000021 hold ONE non-critical resource at one demo hospital on the live site via the UI, screenshot `/reservations/<id>` (mobile + desktop) into `tracker-mobile.png` / `tracker-desktop.png`, then Cancel that hold so stock returns. If you cannot do this safely, say so and leave the shots as they are.
5. Add `home-desktop.png` etc. only if missing. Keep file names unchanged so README links keep working.

## Task 2 — Verify the live theme and fix gaps
On the live site check, and fix in code if broken (small, visual-only changes):
- Header "ডেমো/Demo" pill + popover works (tap and keyboard), and every hospital card/page shows a "Demo" tag.
- Logo heart beats; animation stops under `prefers-reduced-motion`.
- Theme toggle switches light/dark with no flash, choice persists after reload.
- Language toggle works on all pages.
- Contrast: run an accessibility check (axe or Lighthouse) on `/`, `/find?condition=STROKE`, `/first-aid/STROKE`, `/login`; fix any AA contrast failure.

## Task 3 — Quality gates
Run and report results: `npm run typecheck`, `npm run lint`, `npm test -- --reporter=dot`, `npm run test:e2e`. Fix anything the rebrand broke (e.g. tests asserting old text like "JibonSetu" or the old banner). Do not weaken tests.

## Task 4 — Lighthouse on the live URL (mobile)
`npx lighthouse "https://web-production-3fb89dc8.up.railway.app/find?condition=STROKE" --only-categories=performance,accessibility --form-factor=mobile --output=json --output-path=docs/reports/lighthouse-find-mobile.json --chrome-flags="--headless"`
Also run it for `/`. Report Performance and Accessibility scores (targets: Perf >= 90, A11y >= 95). If below target, fix the cheapest causes (image sizes, unused JS, missing labels) and re-run. Then update the "Known minor items" bullet in README.md (replace "has not yet been executed" with the real scores).

## Task 5 — Docs and commit
1. Finish `docs/reports/P6-theme.md` (what changed, before/after Finder JS size, test results, Lighthouse scores, screenshots list).
2. In README.md keep `TODO_YOUTUBE_URL` untouched.
3. `git add -A`, commit "docs/theme: refresh screenshots, verification and Lighthouse results", `git push origin main`.
4. Reply with: pass/fail table for Tasks 1-4, the Lighthouse scores, the commit hash, and anything you could not do. End with "ready for review".
