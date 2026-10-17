-- =============================================================================
-- TEST FIXTURE ONLY. Tables/columns that exist in the live database but are
-- newer than supabase/01_tables.sql (definitions from the Backend Build
-- Manual, section 3).
-- =============================================================================
create table if not exists public.app_presence (
  user_id uuid primary key,
  seen_at timestamptz not null default now()
);
alter table public.products add column if not exists track_quantity boolean not null default false;
