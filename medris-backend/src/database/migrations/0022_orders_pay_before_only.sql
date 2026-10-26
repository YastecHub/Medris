-- =============================================================================
-- 0022  Open orders that were "pay after delivery" become "pay in full first"
-- Why:        Pay-after-delivery is gone: everything is paid through Paystack before delivery. Orders that were already
--             placed under the old plan, but nothing was paid on yet, now follow the same plan as every new order.
-- Changes:    sale orders that are pending or confirmed, have no payment at all (paid or reported), and were set to pay
--             after delivery: payment_timing = pay_before, no deposit percentage, the whole amount is due first.
--             (Orders with a deposit already paid are left alone and finish under the terms they were made.)
-- Roll back:  not needed; the old plan cannot be offered again.
-- Approved:   NOT YET. Needs the founder's approval
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0022).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

update public.orders o
   set payment_timing = 'pay_before', payment_deposit_percent = null, deposit_amount = o.total_amount
 where o.payment_timing = 'pay_after'
   and o.order_type = 'sale'
   and o.status in ('pending', 'confirmed')
   and not exists (select 1 from public.payments p where p.order_id = o.id and p.status in ('paid', 'pending'));

update public.products set payment_timing = 'pay_before', payment_deposit_percent = null where payment_timing = 'pay_after';
