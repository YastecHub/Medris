-- =============================================================================
-- 0016  Replies to suggestions, and a notification when a shop gets one
-- Why:        A shop (or Levromart's admins) could read a suggestion but not answer it, so the person who wrote it was
--             left without a word. Anonymous suggestions must stay anonymous: the answer is stored on the suggestion and
--             delivered to the sender as a notification by the server; the shop never learns who the sender is.
-- Changes:    suggestions: + reply_message, replied_at, replied_by;
--             get_vendor_suggestions() and get_platform_suggestions(): also return reply_message and replied_at;
--             reply_to_suggestion(suggestion, message): only the shop the suggestion was sent to (or an admin, for
--               suggestions to Levromart) can reply, once; marks it read and notifies the sender;
--             trigger: a shop is notified when a suggestion arrives ("New suggestion", link to the inbox, no sender name
--               when anonymous).
-- Roll back:  drop trigger if exists trg_notify_vendor_suggestion on public.suggestions;
--             drop function if exists public.notify_vendor_suggestion(); drop function if exists public.reply_to_suggestion(uuid, text);
--             (restore the two get_* functions from src/database/baseline/01-public-schema.sql; the columns can stay)
-- Approved:   NOT YET. Needs the founder's approval. The backend and frontend of this change expect it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0016).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter table public.suggestions
  add column if not exists reply_message text,
  add column if not exists replied_at timestamptz,
  add column if not exists replied_by uuid references public.users (id) on delete set null;

drop function if exists public.get_vendor_suggestions();
create function public.get_vendor_suggestions() returns table(id uuid, sender_name text, is_anonymous boolean, message text, status text, created_at timestamptz, reply_message text, replied_at timestamptz)
  language plpgsql security definer set search_path = public as $$
declare v_vendor_id uuid;
begin
  select vendors.id into v_vendor_id from vendors where user_id = auth.uid() and deleted_at is null;
  if v_vendor_id is null then raise exception 'No vendor profile found.'; end if;
  return query
    select s.id, case when s.is_anonymous then null else u.name end, s.is_anonymous, s.message, s.status, s.created_at, s.reply_message, s.replied_at
    from suggestions s left join users u on u.id = s.sender_id
    where s.target_type = 'vendor' and s.target_vendor_id = v_vendor_id
    order by s.created_at desc;
end;
$$;
grant all on function public.get_vendor_suggestions() to anon, authenticated, service_role;

drop function if exists public.get_platform_suggestions();
create function public.get_platform_suggestions() returns table(id uuid, sender_name text, is_anonymous boolean, message text, status text, created_at timestamptz, reply_message text, replied_at timestamptz)
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  return query
    select s.id, case when s.is_anonymous then null else u.name end, s.is_anonymous, s.message, s.status, s.created_at, s.reply_message, s.replied_at
    from suggestions s left join users u on u.id = s.sender_id
    where s.target_type = 'platform'
    order by s.created_at desc;
end;
$$;
grant all on function public.get_platform_suggestions() to anon, authenticated, service_role;

create or replace function public.reply_to_suggestion(p_suggestion_id uuid, p_message text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); s public.suggestions%rowtype; v_name text; v_msg text := trim(coalesce(p_message, ''));
begin
  if v_uid is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if v_msg = '' then raise exception 'Write your reply first.'; end if;
  if length(v_msg) > 2000 then raise exception 'That reply is too long.'; end if;
  select * into s from public.suggestions where id = p_suggestion_id for update;
  if not found then raise exception 'Not found.'; end if;
  if s.target_type = 'platform' then
    if not public.is_admin() then raise exception 'Not allowed.' using errcode = '42501'; end if;
    v_name := 'Levromart';
  else
    if not public.owns_vendor(s.target_vendor_id) then raise exception 'Not allowed.' using errcode = '42501'; end if;
    select business_name into v_name from public.vendors where id = s.target_vendor_id;
  end if;
  if s.reply_message is not null then raise exception 'You have already replied to this suggestion.'; end if;
  update public.suggestions set reply_message = v_msg, replied_at = now(), replied_by = v_uid, status = 'read' where id = s.id;
  if s.sender_id is not null then
    perform public.create_notification(s.sender_id, 'suggestion_reply', coalesce(v_name, 'A shop') || ' replied to your suggestion',
      'You wrote: "' || left(s.message, 140) || case when length(s.message) > 140 then '...' else '' end || '"' || E'\n' || 'Reply: ' || v_msg,
      case when s.target_type = 'vendor' then 'storefront' else null end,
      case when s.target_type = 'vendor' then jsonb_build_object('vendorId', s.target_vendor_id) else '{}'::jsonb end,
      null);
  end if;
  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.reply_to_suggestion(uuid, text) from public, anon;
grant execute on function public.reply_to_suggestion(uuid, text) to authenticated, service_role;

create or replace function public.notify_vendor_suggestion() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if new.target_type = 'vendor' and new.target_vendor_id is not null then
    select user_id into v_owner from public.vendors where id = new.target_vendor_id;
    if v_owner is not null then
      begin
        perform public.create_notification(v_owner, 'suggestion_received', 'New suggestion for your shop',
          left(new.message, 140) || case when length(new.message) > 140 then '...' else '' end, 'vendorSuggestionsInbox', '{}'::jsonb, null);
      exception when others then null; end;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_notify_vendor_suggestion on public.suggestions;
create trigger trg_notify_vendor_suggestion after insert on public.suggestions for each row execute function public.notify_vendor_suggestion();
