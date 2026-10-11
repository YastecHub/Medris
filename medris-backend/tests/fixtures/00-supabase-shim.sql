-- =============================================================================
-- TEST FIXTURE ONLY - never run against a real database.
-- The pieces of a Supabase project the schema relies on: the API roles, the
-- auth schema (users, identities) and auth.uid()/auth.role()/auth.jwt(),
-- defined the way Supabase defines them.
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists extensions;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text default 'authenticated',
  role text default 'authenticated',
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  phone text,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  banned_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_id text not null,
  identity_data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  unique (provider_id, provider)
);

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

-- Enum types used by public tables (values from the Backend Build Manual, section 4).
create type public.delivery_method as enum ('pickup', 'delivery');
create type public.dispute_raised_by as enum ('buyer', 'vendor');
create type public.dispute_status as enum ('open', 'resolved');
create type public.listing_type as enum ('rent', 'sale', 'both');
create type public.order_status as enum ('pending', 'confirmed', 'handed_over', 'returned', 'completed', 'cancelled', 'disputed', 'payment_unresolved');
create type public.order_type as enum ('rental', 'sale');
create type public.payment_method as enum ('card', 'transfer', 'cash');
create type public.payment_status as enum ('pending', 'paid', 'refunded');
create type public.payment_type as enum ('sale_price', 'rental_fee', 'deposit', 'delivery_deposit_20');
create type public.product_condition as enum ('new', 'used-good', 'used-fair');
create type public.product_status as enum ('active', 'paused', 'removed');
create type public.user_role as enum ('buyer', 'vendor', 'admin');
create type public.vendor_verification_status as enum ('pending', 'verified', 'rejected');
