-- Migration:  0061_shop_team_chat
-- Why:        Team members (migration 0057-0060) can also answer the shop's chats. The customer always sees the shop (name and
--             logo), never the staff member; team members get the shop's new-message alerts like the owner.
-- Changes:    notify_new_message(): a team member writes as the shop; copy_shop_notification_to_team(): also copies the
--             shop's "new message" alerts. Behaviour for shops without a team is unchanged.
-- Applying:   after 0060. Safe to re-run. Rollback: re-create both functions from 0060 / the baseline.

create or replace function public.notify_new_message() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_buyer_id uuid; v_vendor_id uuid; v_vendor_user_id uuid; v_vendor_name text; v_vendor_logo text;
  v_recipient_id uuid; v_sender_name text; v_sender_avatar text; v_preview text; v_shop_side boolean;
begin
  select c.buyer_id, v.id, v.user_id, v.business_name, v.logo_url
    into v_buyer_id, v_vendor_id, v_vendor_user_id, v_vendor_name, v_vendor_logo
  from conversations c join vendors v on v.id = c.vendor_id
  where c.id = new.conversation_id;

  v_recipient_id := case when new.sender_id = v_buyer_id then v_vendor_user_id else v_buyer_id end;
  v_shop_side := new.sender_id = v_vendor_user_id
    or exists (select 1 from public.vendor_members m where m.vendor_id = v_vendor_id and m.user_id = new.sender_id);
  if v_shop_side then
    -- the owner or a team member writes as the shop: shop name and logo
    v_sender_name := v_vendor_name;
    v_sender_avatar := coalesce(v_vendor_logo, (select avatar_url from users where id = v_vendor_user_id));
  else
    select coalesce(name, email), avatar_url into v_sender_name, v_sender_avatar from users where id = new.sender_id;
  end if;
  v_preview := left(new.body, 80);

  perform create_notification(v_recipient_id, 'new_message', 'New message from ' || coalesce(v_sender_name, 'someone'),
    v_preview, 'messages',
    jsonb_build_object('conversationId', new.conversation_id, 'senderName', v_sender_name, 'senderAvatar', v_sender_avatar), new.sender_id);
  return new;
end;
$$;

create or replace function public.copy_shop_notification_to_team() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_vendor uuid;
  v_ref text;
begin
  if new.notification_category is distinct from 'order' and new.type is distinct from 'new_order' and new.type is distinct from 'new_message' then return new; end if;
  v_vendor := new.vendor_id;
  if v_vendor is null and new.type = 'new_message' then
    v_ref := new.target_params ->> 'conversationId';
    if v_ref ~ '^[0-9a-f-]{36}$' then select c.vendor_id into v_vendor from public.conversations c where c.id = v_ref::uuid; end if;
  elsif v_vendor is null then
    v_ref := new.target_params ->> 'orderId';
    if v_ref ~ '^[0-9a-f-]{36}$' then select o.vendor_id into v_vendor from public.orders o where o.id = v_ref::uuid; end if;
  end if;
  if v_vendor is null then return new; end if;
  -- only the owner's own notification is copied (a copy goes to someone else, so this can never loop)
  if not exists (select 1 from public.vendors v where v.id = v_vendor and v.user_id = new.user_id) then return new; end if;
  insert into public.notifications (user_id, type, title, body, target_view, target_params, vendor_id, notification_category)
  select m.user_id, new.type, new.title, new.body, new.target_view, new.target_params, v_vendor, new.notification_category
    from public.vendor_members m where m.vendor_id = v_vendor;
  return new;
end;
$$;
