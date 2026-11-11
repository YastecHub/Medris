-- Migration:  0051_chat_30_minutes_after_cancel
-- Why:        When an order is cancelled the customer and the shop could no longer message each other at once, so they could not
--             sort out a mix-up (wrong cancel, a question about a refund). They now keep chatting for 30 minutes after a cancel.
-- Changes:    public.buyer_can_message_vendor() also allows a conversation while the customer's latest order with the shop was
--             cancelled less than 30 minutes ago. (The chat list and the other places that ask the same question use this function.)
-- Applying:   run once by the engineer on production after review. Safe to re-run. Rollback: re-create the function without the cancelled branch.

create or replace function public.buyer_can_message_vendor(p_buyer uuid, p_vendor uuid) returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.orders o
    where o.buyer_id = p_buyer and o.vendor_id = p_vendor
      and (
        o.status in ('confirmed','handed_over','returned','payment_unresolved','disputed')
        or (o.status = 'completed' and coalesce(o.completed_at, o.status_changed_at, o.created_at) > now() - interval '24 hours')
        or (o.status = 'cancelled' and coalesce(o.cancelled_at, o.status_changed_at, o.created_at) > now() - interval '30 minutes')
      )
  );
$$;
