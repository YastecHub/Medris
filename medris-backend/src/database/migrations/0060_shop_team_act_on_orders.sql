-- Migration:  0060_shop_team_act_on_orders
-- Why:        Step 2b of docs/MULTI_BUSINESS.md. A shop's team members can act on its orders (accept, decline, hand over,
--             note, suggest a quantity) according to their role, and get the shop's new-order / order-update alerts.
--             Money, bank details, billing and settings stay owner-only.
-- Changes:    public.team_can(user, vendor, permission); can_act_for_vendor() now uses it; an UPDATE policy on orders for
--             team members; a trigger that copies the shop's order notifications to the team members allowed to see orders.
-- Applying:   after 0057 and 0059. Safe to re-run. Rollback: drop the trigger, the policy and the function.

create or replace function public.team_can(p_user uuid, p_vendor uuid, p_permission text) returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.vendors v where v.id = p_vendor and v.user_id = p_user and v.deleted_at is null)
      or exists (
        select 1 from public.vendor_members m
         where m.vendor_id = p_vendor and m.user_id = p_user
           and ((m.role = 'manager' and p_permission in ('orders', 'chat', 'listings'))
             or (m.role = 'staff' and p_permission in ('orders', 'chat')))
      );
$$;

create or replace function public.can_act_for_vendor(p_vendor uuid, p_permission text) returns boolean
language sql stable security definer
set search_path to 'public'
as $$ select public.team_can(auth.uid(), p_vendor, p_permission); $$;

-- Team members may update the shop's orders (the existing order triggers still decide which changes are allowed).
drop policy if exists orders_update_team on public.orders;
create policy orders_update_team on public.orders for update
  using (public.can_act_for_vendor(vendor_id, 'orders'))
  with check (public.can_act_for_vendor(vendor_id, 'orders'));

-- The shop's order alerts also reach its team members (each copy is an ordinary notification, so it also becomes a push).
create or replace function public.copy_shop_notification_to_team() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_vendor uuid;
  v_order text;
begin
  if new.notification_category is distinct from 'order' and new.type is distinct from 'new_order' then return new; end if;
  v_vendor := new.vendor_id;
  if v_vendor is null then
    v_order := new.target_params ->> 'orderId';
    if v_order ~ '^[0-9a-f-]{36}$' then select o.vendor_id into v_vendor from public.orders o where o.id = v_order::uuid; end if;
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

drop trigger if exists trg_copy_shop_notification_to_team on public.notifications;
create trigger trg_copy_shop_notification_to_team after insert on public.notifications
  for each row execute function public.copy_shop_notification_to_team();
