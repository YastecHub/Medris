# Database

The data lives in PostgreSQL 17, hosted by Supabase (project `ovklnoroyxobijgvsyfp`). The backend connects to it
directly with a standard connection string and nothing Supabase-specific in the code path. Schema reference: the
Backend Build Manual (`docs/LEVROMART_BACKEND_BUILD_MANUAL.pdf`) and `supabase/`.

## 1. Connecting

`DATABASE_URL` (server only) is a normal PostgreSQL URL. On Vercel use Supabase's **transaction pooler**:

```
Supabase dashboard → Project Settings → Database → Connection pooling → Transaction (port 6543)
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_POOL_MAX=3          # per function instance
DATABASE_SSL_MODE=require    # or verify-full with DATABASE_SSL_CA (Supabase's CA certificate)
```

For a long-running Node server the session pooler (port 5432) or a direct connection also works.

Check a deployment with `GET /api/v1/health/ready`: it reports whether the database answers and whether the login
role can switch to `anon`, `authenticated` and `service_role` (all three must be `true`).

## 2. How row-level security is preserved

Supabase's REST API never connected as the user; it connected as one role and, per request, ran
`set local role authenticated` and set `request.jwt.claims` to the verified JWT. `auth.uid()` reads that setting.
`DataContext` (`medris-backend/src/database/context.ts`) does exactly the same inside each transaction, so:

- all 149 RLS policies apply unchanged to `/api/v1` and to every user-initiated call in the original endpoints;
- every `SECURITY DEFINER` function sees the same `auth.uid()` and refuses the same callers;
- `service_role` (bypasses RLS) is used only for jobs, webhooks and code that has already authorised the caller -
  the same places the old code used the service-role key.

This was **not assumed**: `tests/v1/data-context.test.ts` shows that a query missing its own filter still only returns
the caller's rows, that the identity does not survive the transaction on a pooled connection, and that a failed
request rolls back. The suite passes on PGlite and on PostgreSQL 16.

### Least-privilege login role (migration 0001, not applied)

Today `DATABASE_URL` can use the `postgres` user. `src/database/migrations/0001_backend_api_role.sql` creates
`medris_api`: a login role with no table privileges of its own that can only switch to the three API roles, plus
read access to the few `auth.users` / `auth.identities` columns needed by backend sign-in. Tested in
`tests/v1/least-privilege.test.ts`. If Supabase refuses one of its grants (it manages those roles), keep `postgres`.

## 3. Schema changes and migrations

- The production schema is owned by the existing SQL workflow (`supabase/`, manual section 13). **The backend never
  creates, alters or drops anything on its own**; there is no automatic migration on start-up or deploy.
- New SQL the backend needs is a reviewed file in `medris-backend/src/database/migrations/` with a header stating
  status, effect and roll-back. Apply it by hand (Supabase SQL editor) **only after approval**:

| File | Effect | Needed for | Status |
|---|---|---|---|
| `0001_backend_api_role.sql` | adds role `medris_api` | least-privilege connections | not applied |
| `0002_backend_auth_sessions.sql` | adds empty table `backend_sessions` (RLS on, no policies) | `AUTH_BACKEND_SESSIONS=true` | not applied |

- Drizzle table definitions (`src/database/schema/`) list only the columns the code uses. To see the full live schema
  as Drizzle code: `DATABASE_URL=… npm run db:introspect -w medris-backend` (read-only; writes
  `drizzle/introspected/`). `drizzle-kit push`/`migrate` are deliberately not used.

## 4. Local development database

```bash
docker compose up -d db                          # PostgreSQL 17 on localhost:5432 (medris_dev + medris_test)
# medris-backend/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medris_dev
DATABASE_SSL_MODE=disable
npm run db:dev -w medris-backend -- --seed       # development schema + a buyer, a vendor and a product
npm run dev:backend
```

`db:dev` refuses any host that is not local. Its schema is the test approximation (snapshot tables, policies copied
from the manual, simplified function stand-ins). **A faithful local copy:** with read access to production, run
`supabase/export.sh` (schema only; replace the webhook secret in the function dump, as its header says) and restore
`00_full_schema.sql` plus `database/portability/supabase-compat.sql` into a local database. Never copy production
data to a laptop.

Tests: `npm test` (PGlite, nothing to install) or `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/medris_test
npm run test:postgres -w medris-backend`.

## 5. Moving PostgreSQL to another provider

The application code needs only `DATABASE_URL`. What the *database* needs on the new host:

1. **PostgreSQL 17** with `pg_trgm`, `btree_gist`, `pgcrypto`, `uuid-ossp`; ideally `pg_cron` and `pg_net`
   (otherwise see step 6).
2. **The Supabase compatibility layer**: `medris-backend/src/database/portability/supabase-compat.sql` - roles `anon`,
   `authenticated`, `service_role` and `auth.uid()/role()/jwt()` defined exactly as Supabase defines them. With this,
   every policy and function works unchanged because the backend sets the same session settings.
3. **auth.users / auth.identities** with the same ids (from the weekly backup), because `public.users.id` references
   them. Password hashes are bcrypt and portable (AUTH.md).
4. Restore the `public` schema (structure, then data) from a fresh `supabase/export.sh` + `pg_dump`.
5. Point `DATABASE_URL` at the new host; check `/api/v1/health/ready`.
6. Things that are Supabase services rather than PostgreSQL - plan them separately: Auth (AUTH.md), Realtime (still
   used by the browser), Storage (STORAGE.md), `pg_net` webhooks (keep `pg_net`, or an outbox table polled by a
   worker), `pg_cron` (keep, or a scheduler calling the same SQL functions).

| Target | Notes |
|---|---|
| **Neon** | PostgreSQL 17, `pg_trgm`/`btree_gist`/`pgcrypto` available; use the pooled connection string; no `pg_cron`/`pg_net` → step 6 |
| **AWS RDS / Aurora PostgreSQL** | `pg_cron` available; `pg_net` not → outbox/worker; `DATABASE_SSL_MODE=verify-full` with the RDS CA bundle; RDS Proxy for serverless |
| **Self-hosted** | install the extensions you need (including `pg_cron`, `pg_net`); put PgBouncer (transaction mode) in front for serverless |

Rehearse on a copy first (manual section 12): restore, run the backend against it, compare table counts and spot-check
order totals before switching.
