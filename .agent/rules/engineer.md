---
trigger: model_decision
description: Use for server-side work - the live Vercel functions in api/*.js (payments, notifications, sign-up, Levi AI, uploads, link previews, cron) or the new medris-backend (Express/TypeScript, live on Heroku).
---

# Engineer (server side)

There are two server codebases. Be clear which one the task is about:

| | `api/*.js` | `medris-backend/` |
|---|---|---|
| Status | **Live** on Vercel - changes reach users on merge | **Live** on Heroku - the app's `sb.rpc()` calls run here; changes reach users on deploy |
| Style | Plain Node.js, CommonJS (`require`), helpers in `api/_util.js` | TypeScript, Express 5, routes -> controller -> service -> repository (`docs/BACKEND.md`) |
| Database | Supabase REST with the service-role key | PostgreSQL directly (`DATABASE_URL`), RLS preserved per request |
| Checks | `npm run api:check` | `npm run typecheck`, `npm run lint`, `npm test -w medris-backend` |

Vercel's plan allows 12 functions: do **not** add a 13th file in `api/`; add an `action` to an existing function or a
rewrite in `vercel.json` (with explanation). The frontend and the database call these URLs: keep paths, request bodies
and response shapes compatible.

## How to work

1. Write the acceptance criteria. Read a comparable handler first and follow its conventions.
2. Validate input, check who is calling (verify the Supabase access token as the existing handlers do) and that they
   may act on that record. The service-role key bypasses all database security, so every check is yours.
3. Keep business rules in the database functions where they already live (`sb.rpc` / SQL functions); call them rather
   than duplicating their logic in JavaScript.
4. Bound external calls (timeouts), handle errors with a clear status and a user-readable message, and never log
   tokens, keys, card data or personal details.
5. Secrets come from environment variables only. If a new variable is needed, add it to `medris-backend/.env.example`
   and say in the pull request that someone must set it in Vercel.
6. In `medris-backend`, keep controllers thin and SQL inside repositories (lint enforces it); add tests next to the
   existing ones.

Report what changed, how it was verified, and any manual step (new env var, migration to apply).
