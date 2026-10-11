# Authentication and authorisation

## 1. Today (unchanged for users)

- **Identity provider: Supabase Auth.** Accounts live in `auth.users` (bcrypt password hashes) and
  `auth.identities` (Google). `public.users` mirrors each account with the **same id**; every table that belongs to a
  person points at that id.
- **Browser:** supabase-js signs in (`signInWithPassword` - e-mail, or the private alias
  `p<phone>@accounts.levromart.app` for phone-only accounts - and `signInWithOAuth` for Google), keeps the session in
  local storage and refreshes it. Admins additionally confirm an e-mailed one-time code every 7 days
  (`/api/auth-otp`). Password recovery is Supabase's e-mail reset or the admin-approved manual reset.
- **Authorisation:** the database. RLS policies and `SECURITY DEFINER` functions check `auth.uid()`,
  `is_admin()`, `owns_vendor()`; roles come from `public.users.role` (+ `is_super_admin`).

## 2. What the backend does now (phase 1 - live with this branch)

**The backend verifies every access token itself and owns authorisation for its endpoints.**

| | Before | Now |
|---|---|---|
| Verify a token | `GET <supabase>/auth/v1/user` on every request | local JWT check (`modules/auth/access-token.ts`, `jose`): signature, expiry, issuer, audience, `role = authenticated`, UUID subject |
| Signing keys | - | asymmetric keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (cached), or the legacy HS256 secret `SUPABASE_JWT_SECRET` |
| Neither configured (HS256 project, secret not set yet) | - | falls back to `/auth/v1/user` exactly as before |
| Anon key / service-role key presented as a user token | rejected by Supabase | rejected (`role` must be `authenticated`) |
| Database access for the user | user's JWT → PostgREST → RLS | verified claims → `DataContext.asUser` → same RLS |
| Role checks | in each handler | `requireRole()` middleware + the same database checks |

Nothing changes for users: they keep their sessions, sign in the same way and the app sends the same token.
For the original endpoints the token still arrives in the JSON body (`accessToken`); `/api/v1` uses
`Authorization: Bearer`.

One subtle difference: Supabase's `/auth/v1/user` also failed for an account deleted in the last hour; a locally
verified token stays valid until it expires (at most one hour). This is the same trust PostgREST already gave the
token for every table query, and deleted accounts have no data left to reach.

**To do in Vercel:** set `SUPABASE_JWT_SECRET` (Supabase dashboard, JWT settings: the legacy JWT secret) if the project still signs with
the legacy secret, so no request needs Supabase's `/auth/v1/user` any more. Projects on asymmetric signing keys need
nothing (JWKS).

## 3. Backend-managed sessions (built and tested; OFF)

Everything below is implemented and covered by `tests/v1/auth-sessions.test.ts`, but disabled
(`AUTH_BACKEND_SESSIONS=false`) and its table does not exist in production yet (migration 0002).

| Piece | Implementation |
|---|---|
| Session token | 256-bit random, base64url; only its SHA-256 is stored (`public.backend_sessions`, RLS on, service-role only) |
| Cookie | `__Host-medris_session`: HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age = TTL |
| Lifetime | absolute `AUTH_SESSION_TTL_DAYS` (30), idle `AUTH_SESSION_IDLE_DAYS` (14), activity refresh at most hourly |
| Logout | `POST /api/v1/auth/logout` (this browser), `/logout-all` (every session of the account) |
| CSRF | cookie-authenticated writes must come from the app's origin or `AUTH_TRUSTED_ORIGINS` |
| Password sign-in | `POST /api/v1/auth/login { identifier, password }`: e-mail or phone (mapped to the same alias), checked with bcrypt against the **existing** `auth.users.encrypted_password` - no reset, no re-hashing; constant-time on unknown accounts; refuses banned/unconfirmed accounts; rate-limited per IP and per account |
| Google sign-in | `GET /api/v1/auth/google/start` → Google → `/callback`: OpenID Connect code flow with PKCE (arctic), state checked, ID token verified against Google's keys (issuer, audience, expiry) |
| Account linking | 1) the Google identity Supabase already linked (`auth.identities`, provider_id = Google `sub`); 2) otherwise the account with the same **verified** e-mail; 3) otherwise a new account created through Supabase Auth's admin API so the existing sign-up trigger builds the profile. User ids never change. |
| Identity in the database | the session's user id + claims go through `DataContext.asUser`, so RLS works exactly as with a Supabase token |
| Housekeeping | the daily cron deletes sessions that ended over 30 days ago (only when enabled) |

## 4. Migration plan (each step needs your approval)

| Phase | What | User impact | Approval / manual steps |
|---|---|---|---|
| **1** (this branch) | backend verifies tokens, owns authorisation, `/api/v1` | none | set `DATABASE_URL`; optionally `SUPABASE_JWT_SECRET` |
| **2** | apply migration 0002; `AUTH_BACKEND_SESSIONS=true` on a **preview** deployment; Google OAuth client with redirect `https://<preview>/api/v1/auth/google/callback` | none on production | apply SQL; create Google OAuth client; set env on preview only |
| **3** | the app signs in through the backend **and** Supabase in parallel: the backend session for `/api/v1`, the Supabase session still for the screens that call Supabase directly | sign-in screen unchanged; one extra cookie | frontend change + production rollout |
| **4** | once no screen calls Supabase directly: the backend becomes the identity store (copy `auth.users` hashes and identities into backend tables with the same ids, move sign-up / password reset / admin OTP / manual reset to the backend), Supabase Auth switched off | users keep passwords and Google sign-in; everyone signs in once more | data migration with rollback plan; Google OAuth redirect change |

Until phase 4, password changes, e-mail resets and sign-up stay with Supabase Auth (the backend reads the same hashes,
so a password changed in Supabase works for backend sign-in immediately).

Do not enable `AUTH_BACKEND_SESSIONS` in production before migration 0002 is applied; the configuration check refuses
it without `DATABASE_URL`, and sign-in would fail without the table.
