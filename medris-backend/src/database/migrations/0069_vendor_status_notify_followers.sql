-- Migration:  0069_vendor_status_notify_followers
-- Why:        People who follow a shop should hear when it posts a status. They can switch this off per shop with the
--             existing "new listing" setting in the shop's Follow menu (or mute the shop).
-- Changes:    AFTER INSERT trigger on public.vendor_statuses adds one 'vendor_status' notification per follower
--             (one per shop per hour, so posting several statuses does not spam). Skips muted followers and
--             followers who turned off new-listing alerts. Never blocks posting a status.
-- Applying:   run once by the engineer on production after review (after 0068). Safe to re-run.
--             Rollback: drop trigger trg_vendor_status_notify on public.vendor_statuses and function public.vendor_status_notify().

create or replace function public.vendor_status_notify() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare v_name text; v_logo text;
begin
  begin
    select business_name, logo_url into v_name, v_logo from public.vendors where id = new.vendor_id;
    insert into public.notifications (user_id, type, title, body, target_view, target_params, actor_name, actor_avatar_url, vendor_id, notification_category, group_key)
    select f.follower_id, 'vendor_status', coalesce(v_name, 'A shop') || ' posted a status',
           coalesce(nullif(new.caption, ''), 'Tap to see what is new today.'),
           'vendors', jsonb_build_object('status', new.vendor_id), v_name, v_logo, new.vendor_id, 'social',
           'vendor_status:' || new.vendor_id::text || ':' || to_char(now(), 'YYYYMMDDHH24')
    from public.vendor_follows f
    left join public.vendor_follow_preferences p on p.follower_id = f.follower_id and p.vendor_id = f.vendor_id
    where f.vendor_id = new.vendor_id
      and f.follower_id is distinct from new.created_by
      and coalesce(p.notify_new_listing, true)
      and (p.muted_until is null or p.muted_until < now())
      and coalesce(p.mute_mode, 'none') <> 'always'
      and not exists (select 1 from public.notifications n where n.user_id = f.follower_id and n.group_key = 'vendor_status:' || new.vendor_id::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
  exception when others then
    null; -- a notification problem must never stop a status from being posted
  end;
  return null;
end;
$$;
drop trigger if exists trg_vendor_status_notify on public.vendor_statuses;
create trigger trg_vendor_status_notify after insert on public.vendor_statuses for each row execute function public.vendor_status_notify();
