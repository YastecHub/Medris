-- =============================================================================
-- Supabase compatibility layer for a NON-Supabase PostgreSQL host
-- =============================================================================
-- Only for moving the database off Supabase (Neon, RDS, self-hosted...).
-- Never run this on the Supabase project: these objects already exist there.
--
-- The schema's RLS policies and functions call auth.uid() / auth.role() /
-- auth.jwt() and grant to anon / authenticated / service_role. On another host
-- create the same names before restoring the public schema; medris-backend sets
-- request.jwt.claims for every request, so they behave exactly as on Supabase.
-- auth.users must exist for public.users' foreign key: restore it from the
-- weekly backup (pg_dump of auth.users / auth.identities, ids preserved).
-- =============================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
