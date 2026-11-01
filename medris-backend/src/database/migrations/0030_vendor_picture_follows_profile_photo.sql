-- =============================================================================
-- 0030  One picture for a vendor everywhere: the shop picture falls back to the profile photo,
--       and notifications follow the sender's current photo
-- Why:        A vendor's account photo (users.avatar_url) and shop picture (vendors.logo_url) could differ: removing the
--             "business logo" left the shop picture empty while the account photo stayed, so notifications (which show
--             the account photo) had a picture and the storefront, vendor cards and order pages did not. Notifications
--             also keep a copy of the sender's photo from when they were sent, so a changed or removed photo stayed on
--             old notifications.
--             (users -> vendors copying already exists: trg_sync_vendor_avatar_from_user / trg_sync_vendor_profile_avatar
--             set vendors.logo_url = users.avatar_url whenever the account photo changes.)
-- Changes:    trigger vendors_logo_falls_back_to_avatar (BEFORE INSERT OR UPDATE OF logo_url ON vendors): an empty shop
--             picture becomes the owner's account photo (empty only when the owner has none either).
--             trigger users_avatar_to_notifications (AFTER UPDATE OF avatar_url ON users): the sender's photo on their
--             notifications becomes the new one (or none).
--             index notifications_actor_idx on notifications (actor_id) for that update.
--             Existing data: shops with no picture whose owner has an account photo get it; notifications of the last
--             60 days get their sender's current photo.
-- Roll back:  drop trigger vendors_logo_falls_back_to_avatar on public.vendors;
--             drop trigger users_avatar_to_notifications on public.users;
--             drop function public.vendors_logo_falls_back_to_avatar(); drop function public.users_avatar_to_notifications();
--             drop index if exists public.notifications_actor_idx;
--             (the filled-in pictures can stay: they are the owners' own photos).
-- Approved:   by the founder, 2026-11-01 (apply: docs/DATABASE.md section 3, --only 0030).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.vendors_logo_falls_back_to_avatar() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if nullif(trim(coalesce(new.logo_url, '')), '') is null and new.user_id is not null then
    select u.avatar_url into new.logo_url from public.users u where u.id = new.user_id;
  end if;
  return new;
end $$;

drop trigger if exists vendors_logo_falls_back_to_avatar on public.vendors;
create trigger vendors_logo_falls_back_to_avatar
  before insert or update of logo_url on public.vendors
  for each row execute function public.vendors_logo_falls_back_to_avatar();

create index if not exists notifications_actor_idx on public.notifications (actor_id);

create or replace function public.users_avatar_to_notifications() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if new.avatar_url is distinct from old.avatar_url then
    update public.notifications
       set actor_avatar_url = new.avatar_url
     where actor_id = new.id
       and actor_avatar_url is distinct from new.avatar_url;
  end if;
  return new;
end $$;

drop trigger if exists users_avatar_to_notifications on public.users;
create trigger users_avatar_to_notifications
  after update of avatar_url on public.users
  for each row execute function public.users_avatar_to_notifications();

revoke all on function public.vendors_logo_falls_back_to_avatar() from public;
revoke all on function public.users_avatar_to_notifications() from public;

-- Existing data
update public.vendors v
   set logo_url = u.avatar_url
  from public.users u
 where u.id = v.user_id
   and nullif(trim(coalesce(v.logo_url, '')), '') is null
   and u.avatar_url is not null;

-- (the last 60 days only: older notifications are rarely opened, and each changed row sends a live-update message)
update public.notifications n
   set actor_avatar_url = u.avatar_url
  from public.users u
 where u.id = n.actor_id
   and n.created_at > now() - interval '60 days'
   and n.actor_avatar_url is distinct from u.avatar_url;
