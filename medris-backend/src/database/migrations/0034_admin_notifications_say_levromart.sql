-- =============================================================================
-- 0034  Notifications from an admin's action say "Levromart", never the admin's name
-- Why:        When an admin approves, rejects, refunds, messages or resolves something, the person's notification showed the
--             admin's own name and photo. Customers and shops should only see "Levromart", so nobody knows which admin did
--             what (privacy and safety for the team).
-- Changes:    trigger zz_notifications_hide_admin (runs after the other insert triggers): when the actor is an admin, the
--             notification's actor becomes empty and its name "Levromart". Existing notifications are changed the same way.
-- Roll back:  drop trigger zz_notifications_hide_admin on public.notifications; drop function public.notifications_hide_admin();
--             (the names already replaced are not brought back).
-- Approved:   NOT YET. Needs the founder's approval
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0034).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.notifications_hide_admin() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.actor_id is not null and exists (select 1 from public.users u where u.id = new.actor_id and u.role = 'admin') then
    new.actor_id := null;
    new.actor_name := 'Levromart';
    new.actor_avatar_url := null;
  end if;
  return new;
end $$;

drop trigger if exists zz_notifications_hide_admin on public.notifications;
create trigger zz_notifications_hide_admin before insert on public.notifications for each row execute function public.notifications_hide_admin();

update public.notifications n set actor_id = null, actor_name = 'Levromart', actor_avatar_url = null
 where n.actor_id is not null and exists (select 1 from public.users u where u.id = n.actor_id and u.role = 'admin');
