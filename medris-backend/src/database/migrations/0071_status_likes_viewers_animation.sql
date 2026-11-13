-- Migration:  0071_status_likes_viewers_animation
-- Why:        Updates (shop statuses) get WhatsApp-style extras: people can like an update, the shop sees who viewed it (name and
--             picture) and who liked it, the shop can edit its caption, and can pick an animation style for it.
-- Changes:    vendor_statuses.animation (none/zoom/pan/advert/random); vendor_status_views.viewer_name / viewer_avatar (filled by a
--             trigger from the viewer's account); public.vendor_status_likes (+ RLS); an UPDATE policy so the shop can edit its own
--             update (a trigger keeps everything except caption, show_price and animation fixed).
-- Applying:   run once by the engineer on production after review (after 0068 and 0069). Safe to re-run.
--             Rollback: drop table public.vendor_status_likes, the two columns on vendor_status_views, the trigger/policy below, and the animation column.

alter table public.vendor_statuses add column if not exists animation text not null default 'none';
alter table public.vendor_statuses drop constraint if exists vendor_statuses_animation_check;
alter table public.vendor_statuses add constraint vendor_statuses_animation_check check (animation in ('none', 'zoom', 'pan', 'advert', 'random'));

-- the shop may change the caption, the price switch and the animation of its own update, nothing else
create or replace function public.vendor_status_edit_guard() returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;   -- only people editing through the app are restricted (maintenance jobs are not)
  new.id := old.id; new.vendor_id := old.vendor_id; new.product_id := old.product_id;
  new.created_by := old.created_by; new.created_at := old.created_at; new.expires_at := old.expires_at;
  return new;
end;
$$;
drop trigger if exists trg_vendor_status_edit_guard on public.vendor_statuses;
create trigger trg_vendor_status_edit_guard before update on public.vendor_statuses for each row execute function public.vendor_status_edit_guard();

drop policy if exists vendor_statuses_update_shop on public.vendor_statuses;
create policy vendor_statuses_update_shop on public.vendor_statuses for update
  using (public.can_act_for_vendor(vendor_id, 'listings')) with check (public.can_act_for_vendor(vendor_id, 'listings'));
grant update on public.vendor_statuses to authenticated;

-- who looked: the name and picture are copied in when the view is recorded
alter table public.vendor_status_views add column if not exists viewer_name text;
alter table public.vendor_status_views add column if not exists viewer_avatar text;
create or replace function public.vendor_status_view_fill() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  select u.name, u.avatar_url into new.viewer_name, new.viewer_avatar from public.users u where u.id = new.viewer_id;
  return new;
exception when others then
  return new;
end;
$$;
drop trigger if exists trg_vendor_status_view_fill on public.vendor_status_views;
create trigger trg_vendor_status_view_fill before insert on public.vendor_status_views for each row execute function public.vendor_status_view_fill();

create table if not exists public.vendor_status_likes (
  status_id uuid not null references public.vendor_statuses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);
alter table public.vendor_status_likes enable row level security;
drop policy if exists vendor_status_likes_add_own on public.vendor_status_likes;
create policy vendor_status_likes_add_own on public.vendor_status_likes for insert with check (user_id = auth.uid());
drop policy if exists vendor_status_likes_remove_own on public.vendor_status_likes;
create policy vendor_status_likes_remove_own on public.vendor_status_likes for delete using (user_id = auth.uid());
drop policy if exists vendor_status_likes_read on public.vendor_status_likes;
create policy vendor_status_likes_read on public.vendor_status_likes for select
  using (user_id = auth.uid() or exists (select 1 from public.vendor_statuses s where s.id = status_id and public.can_act_for_vendor(s.vendor_id, 'listings')));
grant select, insert, delete on public.vendor_status_likes to authenticated;
