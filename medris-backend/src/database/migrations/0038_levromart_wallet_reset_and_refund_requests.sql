-- =============================================================================
-- 0038  Levromart's wallet shows the real commission; buyers ask for a refund instead of being refunded at once
-- Why:        1. The Levromart wallet (0035) showed about ₦3,180 although the admin dashboard's commission figure
--                (commission paid through Levromart in the last 30 days) was about ₦52. The opening lines copied in by 0035
--                counted older commission and shop-paid settlements that never went through Levromart's Paystack balance.
--             2. A buyer who cancels a paid order before it is out for delivery now asks for a refund: the shop and the admins
--                are told at once, the shop can refund or decline, and an admin can refund the buyer whatever the shop says.
-- Changes:    platform_wallet_entries   the opening lines ('opening:charge:*' and 'settlement:*') are replaced by one line for
--                                       each commission charge paid through Levromart in the last 30 days (the dashboard's
--                                       number). Lines added later by the triggers are kept.
--             cancellation_requests     requester_role ('vendor' | 'buyer'), vendor_decision ('declined' once the shop says
--                                       no), vendor_reason.
-- Roll back:  alter table public.cancellation_requests drop column requester_role, drop column vendor_decision, drop column vendor_reason;
--             (the wallet's old opening lines are not brought back: run the two inserts of 0035 again if needed).
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0038).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

delete from public.platform_wallet_entries where reference like 'opening:charge:%' or reference like 'settlement:%';

insert into public.platform_wallet_entries (kind, amount_kobo, charge_id, order_id, vendor_id, reference, note, created_at)
select 'commission', round(c.amount * 100), c.id, (select o.id from public.orders o where o.id = c.order_id), c.vendor_id,
       'opening:charge:' || c.id::text, '3% commission', coalesce(c.paid_at, now())
  from public.commission_charges c
 where c.status = 'paid' and c.payment_id is not null and round(c.amount * 100) <> 0
   and c.paid_at >= now() - interval '30 days'
   and not exists (select 1 from public.platform_wallet_entries e where e.charge_id = c.id)
on conflict do nothing;

alter table public.cancellation_requests add column if not exists requester_role text not null default 'vendor' check (requester_role in ('vendor', 'buyer'));
alter table public.cancellation_requests add column if not exists vendor_decision text check (vendor_decision in ('declined'));
alter table public.cancellation_requests add column if not exists vendor_reason text;
