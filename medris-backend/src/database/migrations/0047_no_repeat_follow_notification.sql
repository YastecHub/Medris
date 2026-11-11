-- Migration:  0047_no_repeat_follow_notification
-- Why:        Someone who unfollows a shop and follows it again notified the shop owner every time ("X followed your shop").
--             One notification per follower per shop is enough.
-- Changes:    A BEFORE INSERT trigger on public.notifications drops a 'vendor_follow' notification when the same follower already
--             caused one for the same shop and owner (a notification the owner has read, archived or removed from view still counts
--             while its row exists).
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop the trigger and function below.

create or replace function public.skip_repeat_vendor_follow_notification() returns trigger
language plpgsql as $$
begin
  if new.type = 'vendor_follow' and new.actor_id is not null and new.vendor_id is not null and exists (
    select 1 from public.notifications n
    where n.type = 'vendor_follow' and n.user_id = new.user_id and n.actor_id = new.actor_id and n.vendor_id = new.vendor_id
  ) then
    return null; -- skip this row; the follow itself is unaffected
  end if;
  return new;
end $$;

drop trigger if exists trg_skip_repeat_vendor_follow_notification on public.notifications;
create trigger trg_skip_repeat_vendor_follow_notification
  before insert on public.notifications
  for each row execute function public.skip_repeat_vendor_follow_notification();
