-- Migration:  0068_vendor_statuses
-- Why:        Vendors can post a status (one of their products, shown for 24 hours) that everyone sees in a strip on the Vendors page,
--             like WhatsApp or Instagram. A vendor may have several. People opening a status are counted (once each).
-- Changes:    public.vendor_statuses (the post, expires 24 hours after it is made), public.vendor_status_views (who saw it),
--             row-level security (everyone reads live statuses; a shop and its managers write their own; a shop sees who viewed),
--             at most 10 live statuses per shop, and purge_expired_vendor_statuses() to clear old rows.
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop the two tables and the function.

create table if not exists public.vendor_statuses (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  caption text check (caption is null or char_length(caption) <= 140),
  show_price boolean not null default true,
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists vendor_statuses_live_idx on public.vendor_statuses (expires_at desc, vendor_id);
alter table public.vendor_statuses enable row level security;

create table if not exists public.vendor_status_views (
  status_id uuid not null references public.vendor_statuses(id) on delete cascade,
  viewer_id uuid not null references public.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);
alter table public.vendor_status_views enable row level security;

drop policy if exists vendor_statuses_read_live on public.vendor_statuses;
create policy vendor_statuses_read_live on public.vendor_statuses for select
  using (expires_at > now() or public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists vendor_statuses_write_shop on public.vendor_statuses;
create policy vendor_statuses_write_shop on public.vendor_statuses for insert
  with check (public.can_act_for_vendor(vendor_id, 'listings'));
drop policy if exists vendor_statuses_delete_shop on public.vendor_statuses;
create policy vendor_statuses_delete_shop on public.vendor_statuses for delete
  using (public.can_act_for_vendor(vendor_id, 'listings'));

drop policy if exists vendor_status_views_add_own on public.vendor_status_views;
create policy vendor_status_views_add_own on public.vendor_status_views for insert
  with check (viewer_id = auth.uid());
drop policy if exists vendor_status_views_read on public.vendor_status_views;
create policy vendor_status_views_read on public.vendor_status_views for select
  using (viewer_id = auth.uid() or exists (select 1 from public.vendor_statuses s where s.id = status_id and public.can_act_for_vendor(s.vendor_id, 'listings')));

grant select on public.vendor_statuses to anon, authenticated;
grant insert, delete on public.vendor_statuses to authenticated;
grant select, insert on public.vendor_status_views to authenticated;

-- a shop can have at most 10 live statuses; the product must belong to the shop
create or replace function public.vendor_status_guard() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.product_id is not null and not exists (select 1 from public.products p where p.id = new.product_id and p.vendor_id = new.vendor_id) then
    raise exception 'That product does not belong to this shop.';
  end if;
  if (select count(*) from public.vendor_statuses s where s.vendor_id = new.vendor_id and s.expires_at > now()) >= 10 then
    raise exception 'You can have at most 10 statuses at a time. Delete one or wait for it to expire.';
  end if;
  new.expires_at := now() + interval '24 hours';
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists trg_vendor_status_guard on public.vendor_statuses;
create trigger trg_vendor_status_guard before insert on public.vendor_statuses for each row execute function public.vendor_status_guard();

create or replace function public.purge_expired_vendor_statuses() returns integer
language sql security definer
set search_path to 'public'
as $$
  with d as (delete from public.vendor_statuses where expires_at < now() - interval '2 days' returning 1) select count(*)::int from d;
$$;
revoke all on function public.purge_expired_vendor_statuses() from public;
