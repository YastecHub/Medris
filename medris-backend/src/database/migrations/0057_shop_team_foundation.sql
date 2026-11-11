-- Migration:  0057_shop_team_foundation
-- Why:        Step 1 of docs/MULTI_BUSINESS.md. A shop owner will be able to add team members (manager / staff).
--             This only lays the groundwork: the table that records who belongs to which shop, and ONE helper that every
--             shop screen will use later to ask "may this person act for this shop?". Nothing in the app uses it yet, so
--             existing shops behave exactly as before.
-- Changes:    public.vendor_members + public.can_act_for_vendor(vendor_id, permission).
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop the function and the table.

create table if not exists public.vendor_members (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('manager', 'staff')),
  invited_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (vendor_id, user_id)
);
create index if not exists vendor_members_user_idx on public.vendor_members (user_id);
alter table public.vendor_members enable row level security;

-- Who may do what (the owner may do everything):
--   manager: orders, chat, listings          staff: orders, chat
--   bank details, billing, wallet and deleting the shop stay with the owner only.
create or replace function public.can_act_for_vendor(p_vendor uuid, p_permission text) returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.vendors v where v.id = p_vendor and v.user_id = auth.uid() and v.deleted_at is null)
      or exists (
        select 1 from public.vendor_members m
         where m.vendor_id = p_vendor and m.user_id = auth.uid()
           and ((m.role = 'manager' and p_permission in ('orders', 'chat', 'listings'))
             or (m.role = 'staff' and p_permission in ('orders', 'chat')))
      );
$$;

-- The owner sees and manages the team; a member sees their own membership.
drop policy if exists vendor_members_owner on public.vendor_members;
create policy vendor_members_owner on public.vendor_members for all
  using (exists (select 1 from public.vendors v where v.id = vendor_members.vendor_id and v.user_id = auth.uid()))
  with check (exists (select 1 from public.vendors v where v.id = vendor_members.vendor_id and v.user_id = auth.uid()));
drop policy if exists vendor_members_self on public.vendor_members;
create policy vendor_members_self on public.vendor_members for select using (user_id = auth.uid());
