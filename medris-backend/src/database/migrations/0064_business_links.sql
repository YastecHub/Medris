-- Migration:  0064_business_links
-- Why:        One person can run several businesses from one login. Each extra business is its own Levromart account (so its earnings,
--             bank details, verification and billing stay separate and nothing in the app has to change), created and linked by
--             the app: "Add business" in the profile menu. The owner switches between them without logging in again.
-- Changes:    public.business_links (owner account -> business account). Written only by the server (service key).
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop the table (the business accounts stay).

create table if not exists public.business_links (
  business_user_id uuid primary key references public.users(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);
create index if not exists business_links_owner_idx on public.business_links (owner_id);
alter table public.business_links enable row level security;

drop policy if exists business_links_read_own on public.business_links;
create policy business_links_read_own on public.business_links for select
  using (owner_id = auth.uid() or business_user_id = auth.uid());
