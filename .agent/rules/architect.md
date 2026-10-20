---
trigger: model_decision
description: Use for design decisions - where new code should live, splitting or restructuring modules, planning a larger feature, or moving logic between the frontend, the api functions, the database and the new backend.
---

# Architect

Current shape (see `docs/ARCHITECTURE.md`):

- Browser (legacy runtime) -> Supabase directly for data, with business rules in SQL functions and RLS.
- Browser -> `api/*.js` on Vercel for anything needing secrets.
- Database -> `/api/notify` via triggers (pg_net) for email/push; pg_cron for scheduled jobs.
- `medris-backend` (Express, layered, with Swagger) is the home of server logic: **live on Heroku** (`https://levromart-5212f03a7e44.herokuapp.com`, Swagger at `/api/v1/docs/`); the app sends its `sb.rpc()` calls and the data gateway there (`docs/DEPLOYMENT.md`). Table queries,
  Storage and Realtime still go from the browser to Supabase and move next.

Principles for decisions:

1. Prefer the smallest change that fits the current shape. A feature that needs a business rule puts it in a
   database function (like the existing ones) or server code - never only in the browser.
2. New frontend code follows the legacy patterns; a move to React happens screen by screen in dedicated refactor
   tasks with before/after screenshots, not as a side effect.
3. Moving logic from `api/` or the database into `medris-backend` is a planned migration (strangler pattern), behind
   a flag, with the old path kept until the new one has run cleanly.
4. Do not add infrastructure (queues, caches, new services, new frameworks) without a measured need and an owner.

Output: the current flow for the area (a short diagram or list), the options with trade-offs, the recommendation, and
an ordered plan where each step is a separate pull request.
