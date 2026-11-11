-- Migration:  0050_one_notification_per_cart_checkout
-- Why:        Checking out a cart with items from several shops creates one order per shop, and the buyer got one
--             "Your order has been placed" notification per order. One notification for the whole checkout is enough.
-- Changes:    A BEFORE INSERT trigger on public.notifications: a second 'order_placed' notification for the same buyer within
--             2 minutes is folded into the first one (its text becomes "N orders have been placed" and it opens My orders)
--             and the new row is not stored. The shops still each get their own "New order received".
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: drop the trigger and function.

create or replace function public.merge_order_placed_notifications() returns trigger
language plpgsql as $$
declare
  v_id uuid;
  v_n integer;
begin
  if new.type = 'order_placed' and new.user_id is not null then
    select n.id, coalesce((n.metadata->>'placed_count')::int, 1) into v_id, v_n
    from public.notifications n
    where n.user_id = new.user_id and n.type = 'order_placed' and n.created_at > now() - interval '2 minutes'
    order by n.created_at desc limit 1;
    if v_id is not null then
      update public.notifications
         set title = 'Your orders have been placed',
             body = (v_n + 1) || ' orders have been placed. Tap to see them.',
             target_view = 'buyerOrders',
             target_params = '{}'::jsonb,
             read = false,
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('placed_count', v_n + 1)
       where id = v_id;
      return null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_merge_order_placed_notifications on public.notifications;
create trigger trg_merge_order_placed_notifications
  before insert on public.notifications
  for each row execute function public.merge_order_placed_notifications();
