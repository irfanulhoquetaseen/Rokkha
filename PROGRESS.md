# PROGRESS

## Current phase
P0 Foundation & live deploy: **done** (24 Nov 2026). Next: P1.

## Done
- P0: Next.js 16.4.6 + React 19.3 + TS strict + Tailwind 4 + ESLint 9, in repo root.
- P0: `server.ts` runs Next + Socket.io 4.8.4 on one `PORT` (dev: `tsx watch`; prod: esbuild → `dist/server.mjs`, started with `cross-env NODE_ENV=production`).
- P0: Prisma 7.10.1 (`prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`), `prisma.config.ts`, migration `init_heartbeat`.
- P0: `GET /api/health` → `{ status, db, time }` via real `SELECT 1` with a 3 s timeout (503 when DB down); home page status panel (API + Socket.io).
- P0: Vitest unit test (`tests/unit/health.test.ts`, 3 cases) and Playwright E2E (`tests/e2e/health.spec.ts`, mobile 360×800 + desktop 1440×900).
- P0: Railway project `jibonsetu`: Postgres 18 + `web` service both in Singapore; web deploys from GitHub `main`; pre-deploy `npm run db:deploy`; healthcheck `/api/health`; sleep off.
- P0: Live verified: https://web-production-3fb89dc8.up.railway.app (health `db: "up"`, socket `connected`, real WebSocket upgrade OK, E2E 4/4 against live URL).

## Next
- P1: full schema + raw-SQL constraints, seed, auth & guards (test-first). See `docs/PLAN.md`.
- Set up an integration-test database (separate from prod) before P1 engine tests.

## Known issues
- **Railway auto-deploy on push is NOT active yet.** The `web` service has no GitHub deploy trigger: Railway reports "no one in the project has access to" the repo (the Railway GitHub App isn't installed for it). Deploys currently happen by re-connecting the source (the latest one, `aa0698a`, is live). Fix: install the Railway GitHub App with access to `jibonsetu`, then recreate the trigger.
- `npm audit`: 3 high in `effect` (pulled in by the Prisma 7 CLI config loader; dev/CLI only, not in the app runtime). The only "fix" is downgrading to Prisma 6. Accepted.
- Prisma CLI prints an "update available → 8.0.0-rc" banner: ignore. That is an RC on the `latest` tag.
- Railway warns Config-as-Code (`railway.json`) is deprecated (works until 2026-12-01). We don't use it; build/deploy settings live on the service.

## Decisions log
- 24 Nov: **Prisma 7.10.1** (latest stable), not 8.0.0-rc (npm `latest` tag points at an RC).
- 24 Nov: Keep TypeScript 5 and ESLint 9 as scaffolded by create-next-app 16.4.6 (TS 7 / ESLint 10 too new for Next tooling).
- 24 Nov: Keep `cacheComponents: true` (Next 16 template default). Dynamic route handlers use `await connection()` instead of `export const dynamic`.
- 24 Nov: `prisma` CLI is a runtime dependency so `prisma migrate deploy` runs in Railway's pre-deploy step.
- 24 Nov: Postgres public TCP proxy (`*.proxy.rlwy.net`) exists for local dev / migrations only; the app uses the internal URL (`${{Postgres.DATABASE_URL}}` → `postgres.railway.internal`).
- 24 Nov: Priority order if time runs short is recorded in `docs/PLAN.md` (A05 > A01 > auth > Finder > staff > admin > …).
