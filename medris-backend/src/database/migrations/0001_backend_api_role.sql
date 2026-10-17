-- =============================================================================
-- 0001  Least-privilege login role for medris-backend          NOT YET APPLIED
-- =============================================================================
-- Status: written for review. Do not run against production without approval.
-- Effect: adds one login role. Changes no table, row, policy or function.
--
-- The backend connects as `medris_api` instead of the all-powerful `postgres`
-- user. The role owns nothing and has no table privileges of its own; for each
-- request the backend switches (SET LOCAL ROLE) to one of Supabase's existing
-- API roles, exactly as PostgREST does:
--   authenticated  signed-in users  -> every RLS policy applies unchanged
--   anon           signed-out users -> every RLS policy applies unchanged
--   service_role   server jobs, webhooks and code that authorised the caller
--
-- Apply (Supabase SQL editor, as postgres):
--   1. run this file;
--   2. set a password:  alter role medris_api with password '<generate 32+ random chars>';
--   3. DATABASE_URL = postgresql://medris_api.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
--      (transaction pooler; the user name carries the project ref)
--   4. check https://<app>/api/v1/health/ready reports all three roles as available.
-- Roll back: drop role medris_api;  (after pointing DATABASE_URL elsewhere)
--
-- If a GRANT below is refused (Supabase manages these roles), keep using the
-- postgres user in DATABASE_URL: the API works the same, with broader rights.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'medris_api') then
    create role medris_api login noinherit nocreatedb nocreaterole nobypassrls connection limit 60;
  end if;
end $$;

grant anon, authenticated, service_role to medris_api;
grant usage on schema public to medris_api;

-- Read-only access to the Supabase Auth columns needed to check existing
-- passwords and link Google sign-ins when backend sessions are switched on.
grant usage on schema auth to medris_api;
grant select (id, email, phone, encrypted_password, email_confirmed_at, banned_until, deleted_at) on auth.users to medris_api;
grant select (user_id, provider, provider_id) on auth.identities to medris_api;

comment on role medris_api is 'medris-backend API connections: switches to anon / authenticated / service_role per request.';
