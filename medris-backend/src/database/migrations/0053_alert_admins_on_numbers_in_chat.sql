-- Migration:  0053_alert_admins_on_numbers_in_chat
-- Why:        Phone and account numbers in chat are hidden from the other person, but admins did not know who was trying to share them.
--             Admins are now told straight away, with a link that opens that chat.
-- Changes:    An AFTER INSERT trigger on public.messages: when a message contains a phone-shaped number (like 0803 123 4567 or +234...)
--             or any run of 10 digits (an account number), every admin gets a 'sensitive_number' notification that opens the conversation. At most one
--             notification per conversation every 10 minutes.
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop the trigger and function.

create or replace function public.notify_admins_number_in_chat() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  r record;
  v_name text;
begin
  if new.body is null or not (new.body ~ '[0-9]{10}' or new.body ~ '(\+?234|0)[0-9 ().-]{8,14}[0-9]') then
    return new;
  end if;
  select u.name into v_name from public.users u where u.id = new.sender_id;
  for r in select id from public.users where role = 'admin' loop
    if not exists (
      select 1 from public.notifications n
      where n.user_id = r.id and n.type = 'sensitive_number' and n.created_at > now() - interval '10 minutes'
        and n.target_params->>'conversationId' = new.conversation_id::text
    ) then
      perform create_notification(r.id, 'sensitive_number', 'Number shared in a chat',
        coalesce(v_name, 'Someone') || ' tried to send a phone or account number. Tap to check the chat.',
        'messages', jsonb_build_object('conversationId', new.conversation_id), new.sender_id);
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_notify_admins_number_in_chat on public.messages;
create trigger trg_notify_admins_number_in_chat
  after insert on public.messages
  for each row execute function public.notify_admins_number_in_chat();
