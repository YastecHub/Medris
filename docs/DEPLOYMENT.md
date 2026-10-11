# Deploying the independent backend

Nothing here has been deployed. These are the steps for when you approve the branch.

## 1. Before the first deploy (required)

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

## 2. Rollout

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

## 3. Rolling back

| What | How |
|---|---|
| A feature misbehaves | remove it from `VITE_BACKEND_FEATURES` and redeploy (browser goes back to Supabase for it) |
| The backend misbehaves | Vercel → Deployments → previous deployment → *Instant Rollback* |
| Per-browser test | `levroData.useBackend(null)` |

No database change is part of this branch, so there is nothing to roll back in the database.

## 4. Manual production steps that need your approval

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

## Behaviour changes

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
