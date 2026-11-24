# JibonSetu

Live emergency healthcare finder, resource reservation and first-aid guide for Bangladesh (Hack the Vibe 2026, World Problem Solver track).

> **DEMO DATA**: hospitals are fictional; this is not real hospital availability.

- Live: https://web-production-3fb89dc8.up.railway.app
- Plan: [`docs/PLAN.md`](docs/PLAN.md) · Progress: [`PROGRESS.md`](PROGRESS.md)

## Run locally (Windows PowerShell / any OS)
```powershell
npm install
copy .env.example .env   # then set DATABASE_URL
npm run db:migrate
npm run dev              # http://localhost:3000
```

Scripts: `dev`, `build`, `start`, `typecheck`, `lint`, `test`, `test:e2e`, `db:migrate`, `db:deploy`, `db:seed`.

Concurrency demo (demo hospitals only): `npm run demo:race -- --url http://localhost:3000 --hospital dhanmondi-care-general --resource ICU_BED --set-available 1 --n 20` fires 20 simultaneous holds at 1 ICU bed and prints who won (expect HELD 1 / SOLD_OUT 19), then cancels its holds and undoes the stock change (`--keep` / `--leave-stock` opt out); `--n` max 40.

Full README (architecture, demo script, future work) lands in P7.
