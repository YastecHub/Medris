# Deploying

## Production today: Vercel deploys the frontend only

Vercel serves the web app and the **original** 12 functions in `api/`, exactly as before the frontend/backend
restructure. `medris-backend` is not built or deployed there.

| | |
|---|---|
| Install | `npm ci` |
| Build | `npm run build -w medris-frontend` (the frontend only) |
| Output | `medris-frontend/dist` |
| Functions | `api/*.js`: auth-otp, chat, daily-cron, delete-account (+ register, account-exists, turn, notif-icon, link previews), initiate-payment, notify, order-notify, order-payout-action, order-reminders, paystack-webhook, vendor-payments (+ listing-payments), verify-payment |
| Cron | `/api/daily-cron` at 03:00 UTC |
| Environment | the variables the original functions always used: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `VAPID_PRIVATE_KEY`, `GEMINI_API_KEY`, `R2_*`, `CRON_SECRET`, `EMAIL_WEBHOOK_SECRET`, and the TURN providers for calls (`CF_TURN_KEY_ID`/`CF_TURN_API_TOKEN` or `METERED_API_KEY`/`METERED_DOMAIN`). **No `DATABASE_URL`.** |

The browser talks to Supabase directly (tables, RPCs, Auth, Realtime, Storage) with the public key in
`medris-frontend/.env`; anything needing a secret goes to `/api/*` on the same domain, as before.

What changed compared with the old single-file app, and nothing else:

- the app is built by Vite from `medris-frontend/` (the output is checked byte-for-byte against the original by
  `medris-frontend/tests/legacy-baseline.json`);
- `api/delete-account.js` reads the built page, icons and fonts from `medris-frontend/dist` instead of the repository
  root (`STATIC_ROOT`; `vercel.json` `includeFiles` ships them with the function);
- the root `package.json` lists the functions' dependencies again (`web-push`, `@aws-sdk/*`, `sharp`, `opentype.js`)
  and is CommonJS again (the functions use `require`); `eslint.config.mjs` was renamed accordingly.

**Keep the new-backend switches off on Vercel.** `/api/v1` does not exist there, so leave `VITE_BACKEND_FEATURES`
empty and do not run `levroData.useBackend(...)` on the production site.

Checks before merging (CI runs them): `npm run api:check` (syntax of every function), `npm run build -w medris-frontend`
(the exact Vercel build), `npm test`. After a deploy: open the site, sign in, open a shared link (`/s/<shop id>`) and
look at its preview, and watch the function logs for errors.

Roll back: Vercel → Deployments → the previous deployment → *Instant Rollback*.

**The repository is public** (since 12 Oct 2026), so Vercel's Hobby plan deploys commits from any author. Before it
was made public, the whole git history (1,313 commits) was scanned for secrets: it holds no service-role, Paystack,
Resend or Gemini keys, database passwords or webhook secrets - only the public Supabase anon key, which every visitor
receives anyway. Keep it that way: secrets live in Vercel environment variables and git-ignored `.env` files only.

---

## The backend on Heroku

The backend (`medris-backend`) runs on Heroku as one web dyno. The repository is ready for it: `Procfile` starts
`npm start -w medris-backend`, and `heroku-postbuild` in the root `package.json` builds only the backend (the frontend
stays on Vercel). Deploying it changes nothing for users: the app does not call it until an area is switched over
(`VITE_BACKEND_FEATURES`), and it runs no scheduled jobs and applies no migrations on its own.

**First deploy (once):**

1. Heroku dashboard -> **New** -> **Create new app** (e.g. `levromart-api`, region Europe).
2. **Resources** -> dyno type **Basic** (an Eco dyno falls asleep, which drops live connections).
3. **Settings** -> **Config Vars** -> add the variables below. Copy the values from Vercel / Supabase; never paste
   them into chat, code or a pull request.
4. **Deploy** -> Deployment method **GitHub** -> connect `kenniskalu18-prog/Medris` -> branch `main` ->
   **Deploy Branch**. (Turn on Automatic Deploys later, once a manual deploy has worked.)
5. Open `https://<app>.herokuapp.com/api/v1/health/ready`: it should say `"status":"ok"`.
   Swagger: `https://<app>.herokuapp.com/api/v1/docs` (needs `API_DOCS_ENABLED=true`).

| Config var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **transaction pooler** URL (port 6543) - required |
| `DATABASE_POOL_MAX` | `5` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | as on Vercel - required |
| `SUPABASE_JWT_SECRET` | the project's legacy JWT secret, if it signs with HS256 (recommended) |
| `APP_ORIGIN` | `https://levromart.vercel.app` (or the live domain) |
| `CORS_ALLOWED_ORIGINS` | the app's origins, comma separated (e.g. `https://levromart.vercel.app,https://levromart.com`) |
| `API_DOCS_ENABLED` | `true` to show Swagger |
| `CRON_SECRET`, `EMAIL_WEBHOOK_SECRET`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `VAPID_PRIVATE_KEY`, `GEMINI_API_KEY`, `R2_*` | as on Vercel (needed by the areas that use them) |
| `LIVE_DATABASE_URL` | later, with migration 0004: the **session** pooler URL (port 5432) |

Heroku sets `PORT`. A missing required variable stops the dyno at start-up with a clear message in the logs
(**More** -> **View logs**), so a misconfigured deploy never runs half-configured. Roll back: **Activity** ->
**Roll back to here** on the previous release.

## Earlier plan: the backend as Vercel functions

The sections below were written when the plan was to run the new backend as the Vercel functions; that plan was
dropped for Heroku (above). The variables, approval steps and behaviour changes still apply.

### 1. Before the first deploy (required)

| Vercel variable (Production + Preview) | Value | Why |
|---|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** URL (DATABASE.md §1) | every original endpoint now reads/writes the database directly |
| `DATABASE_POOL_MAX` | `3` | connections per function instance |
| `DATABASE_SSL_MODE` | `require` (default) or `verify-full` + `DATABASE_SSL_CA` | TLS to the database |
| `SUPABASE_JWT_SECRET` *(recommended)* | legacy JWT secret, if the project signs with HS256 | removes the last per-request call to Supabase Auth |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the other existing variables stay as they are.

A **production** build refuses to complete when `DATABASE_URL` or another required variable is missing or invalid
(`scripts/check-deploy-env.mjs`), so a misconfigured deployment never replaces the live one. Preview builds only warn.

Leave `VITE_BACKEND_FEATURES` empty for the first deploy: the app then behaves exactly as today.

### 2. Rollout

1. **Preview deployment.** Check `https://<preview>/api/v1/health/ready` → `"status":"ok"`, all three roles `true`.
   Sign in on the preview with a test account and use the app normally (cart, wishlist, follow, notifications, Levi,
   a ₦999 listing payment in Paystack test mode if available). Watch the function logs (JSON lines with `requestId`).
2. **Production deploy, features off.** The original endpoints now use the data layer; the browser still calls
   Supabase directly. Watch logs for a day: `"level":"error"` lines, `status` ≥ 500 on `/api/*`.
3. **Try the backend path on production for yourself only:** in the browser console run
   `levroData.useBackend("all")` (or a list such as `"catalogue,notifications"`), reload, use the app, then
   `levroData.useBackend(null)`. Only your browser is affected.
4. **Turn features on for everyone**, one or two at a time, by setting `VITE_BACKEND_FEATURES`
   (e.g. `catalogue,notifications`, later `cart,favorites,follows`, finally `all`) and redeploying.
5. **Later:** delete the Supabase fallback queries in `src/bridge/data-gateway.ts` for features that have run cleanly
   for a few weeks.

The gateway falls back to Supabase on its own for reads and idempotent writes when the backend is unreachable
(network error, 502/503/504), so an outage of the new path degrades to today's behaviour rather than an error.

### 3. Rolling back

| What | How |
|---|---|
| A feature misbehaves | remove it from `VITE_BACKEND_FEATURES` and redeploy (browser goes back to Supabase for it) |
| The backend misbehaves | Vercel → Deployments → previous deployment → *Instant Rollback* |
| Per-browser test | `levroData.useBackend(null)` |

No database change is part of this branch, so there is nothing to roll back in the database.

### 4. Manual production steps that need your approval

| # | Step | Effect | Reversible |
|---|---|---|---|
| 1 | Add `DATABASE_URL` (+ pool/TLS settings) to Vercel | required by this branch | yes |
| 2 | Add `SUPABASE_JWT_SECRET` | local verification of HS256 tokens | yes |
| 3 | Apply `0001_backend_api_role.sql` with the migration tool (DATABASE.md §3), set a password, switch `DATABASE_URL` to `medris_api` | least-privilege connections | `drop role medris_api` after switching back |
| 4 | Apply `0002_backend_auth_sessions.sql` with the migration tool (DATABASE.md §3) | creates the empty sessions table | `drop table public.backend_sessions` |
| 5 | Create a Google OAuth client for the backend; set `GOOGLE_*` | backend Google sign-in (preview first) | yes |
| 6 | `AUTH_BACKEND_SESSIONS=true` (preview, then production) | backend sign-in available | yes |
| 7 | Cloudinary credentials + `IMAGE_STORAGE=cloudinary` | new images to Cloudinary | yes (existing images untouched) |
| 8 | Any data/file migration (Storage, Auth identity store) | see STORAGE.md / AUTH.md | needs its own plan |

### Behaviour changes

Everything else behaves as before (same URLs, bodies, statuses, messages). Intentional differences:

1. **Token checks are local.** Tokens are verified with the project's signing keys instead of a call to Supabase. A
   token of an account deleted within its last hour of validity is no longer rejected by that call (PostgREST never
   rejected it either).
2. **Levi sees orders.** Levi's "my orders" and "vendor orders" tools asked Supabase for `orders.updated_at`, a column
   that does not exist, so they always answered "no orders". They now return the orders, with the last status change
   as `updated_at`.
3. **Listing payment records are written.** Starting a ₦999 listing payment inserted a reconciliation row without the
   required `user_id`; the insert always failed silently. It now includes the user and succeeds.
4. **Atomic settlements and reminders.** A commission settlement and the charges it pays, and an order reminder and its
   "last reminded" stamp, are now written in one transaction each (before: separate requests that could half-fail).
5. **Malformed ids** sent to the original endpoints are treated as "not found" instead of surfacing a database error.
6. **Daily cron** reports `notificationsTrimmed: false` when the clean-up fails (before: the REST status), and
   `sessionsPurged` once backend sessions are enabled.
7. **Shared secrets** (cron, webhook, call-decline tokens) are compared in constant time.
8. **Frontend:** a ~10 KB inline script (the data gateway) is added before the app's scripts; 58 call sites now go
   through it - with features off they run the identical Supabase queries (tested). Asset version 126 (main was at 125).
9. **Saving to the wishlist through the backend is idempotent** (a repeated save does not create a duplicate row).
