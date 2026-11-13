-- Migration:  0067_admin_alert_any_number_in_chat
-- Why:        Admins must be told straight away whenever someone types a phone or account number in a chat, however it is written
--             (0803 123 4567, 0803-123-4567, +234 803 123 4567, 8031234567, a 10-digit account number, spaced or dotted digits).
--             0053 only caught 10 digits in a row or a few phone shapes, and warned at most once per 10 minutes per chat.
-- Changes:    notify_admins_number_in_chat() now looks at every run of digits and separators and alerts when a run holds 7 or more
--             digits; at most one alert per chat every minute. The trigger from 0053 is re-created in case it was never applied.
-- Applying:   run once by the engineer on production after review (it also works when 0053 was never applied). Safe to re-run.
--             Rollback: re-run 0053.

create or replace function public.notify_admins_number_in_chat() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  m text[];
  v_name text;
  v_hit boolean := false;
begin
  if new.body is null then return new; end if;
  for m in select regexp_matches(new.body, '(\+?[0-9][0-9 ().\-]{4,}[0-9])', 'g') loop
    if length(regexp_replace(m[1], '[^0-9]', '', 'g')) >= 7 then v_hit := true; exit; end if;
  end loop;
  if not v_hit then return new; end if;
  select u.name into v_name from public.users u where u.id = new.sender_id;
  for r in select id from public.users where role = 'admin' loop
    if not exists (
      select 1 from public.notifications n
      where n.user_id = r.id and n.type = 'sensitive_number' and n.created_at > now() - interval '1 minute'
        and n.target_params->>'conversationId' = new.conversation_id::text
    ) then
      begin
        perform create_notification(r.id, 'sensitive_number', 'Number shared in a chat',
          coalesce(v_name, 'Someone') || ' tried to send a phone or account number. Tap to check the chat.',
          'messages', jsonb_build_object('conversationId', new.conversation_id), new.sender_id);
      exception when others then
        null;   -- an alert problem must never stop a message
      end;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_notify_admins_number_in_chat on public.messages;
create trigger trg_notify_admins_number_in_chat
  after insert on public.messages
  for each row execute function public.notify_admins_number_in_chat();
