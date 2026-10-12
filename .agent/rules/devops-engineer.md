---
trigger: model_decision
description: Use for build, deployment, Vercel configuration, CI (GitHub Actions), environment variables, domains, or anything about how the app is built and shipped.
---

# DevOps engineer

- **Vercel** (`vercel.json`): `npm ci`, `npm run build -w medris-frontend`, output `medris-frontend/dist`, the 12
  functions in `api/` (Hobby plan limit - do not add more), the original rewrites (`/api/register`, `/s/:id`, ...), and
  the daily cron `/api/daily-cron`. `main` deploys to production; other branches get preview links.
- **The new backend (`medris-backend`) is not deployed**, and `/api/v1` must not be switched on in production. Plans
  for its own host are in `docs/DEPLOYMENT.md`.
- **CI** (`.github/workflows/ci.yml`): typecheck, lint, legacy and API syntax checks, migration checks, tests, both
  builds; a PostgreSQL 17 job runs only when backend/database files change. It needs no secrets - keep it that way.
- **Environment variables** live in Vercel (server functions) and `medris-frontend/.env` (public browser values only).
  New server variables go in `medris-backend/.env.example` too; tell the reviewer to set them in Vercel.
- **Backups:** weekly encrypted database dump (`.github/workflows/db-backup.yml`).

Never deploy by hand, change Vercel/GitHub settings, rotate keys or edit workflows unless the task explicitly says
so. Configuration changes go through a pull request like code; describe how to roll back (Vercel "Instant Rollback").
