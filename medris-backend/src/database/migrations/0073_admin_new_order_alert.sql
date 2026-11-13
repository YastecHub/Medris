-- Migration:  0073_admin_new_order_alert
-- Why:        Admins should know the moment an order is placed, so that when a shop has not answered they can nudge it (new Orders page for admins).
-- Changes:    AFTER INSERT trigger on public.orders adds one 'admin_new_order' notification for every admin account (the page it opens is the
--             admin Orders page). It can never stop an order from being placed: any problem inside it is ignored.
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop trigger trg_admin_new_order_alert on public.orders
--             and function public.admin_new_order_alert().

create or replace function public.admin_new_order_alert() returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare v_shop text; v_buyer text;
begin
  begin
    if new.status::text <> 'pending' then return new; end if;
    select business_name into v_shop from public.vendors where id = new.vendor_id;
    select name into v_buyer from public.users where id = new.buyer_id;
    insert into public.notifications (user_id, type, title, body, target_view, target_params, vendor_id, notification_category, group_key)
    select u.id, 'admin_new_order', 'New order for ' || coalesce(v_shop, 'a shop'),
           coalesce(nullif(trim(v_buyer), ''), 'A customer') || ' ordered (N' || to_char(coalesce(new.total_amount, 0), 'FM999G999G990') || '). Waiting for the shop to accept.',
           'adminOrders', jsonb_build_object('orderId', new.id), new.vendor_id, 'admin', 'admin_order:' || new.id::text
      from public.users u where u.role::text = 'admin' and u.id is distinct from new.buyer_id;
  exception when others then
    null;
  end;
  return new;
end;
$$;
drop trigger if exists trg_admin_new_order_alert on public.orders;
create trigger trg_admin_new_order_alert after insert on public.orders for each row execute function public.admin_new_order_alert();
