-- =============================================================================
-- 0008  Refunds for Paystack-paid orders (issue #99)
-- Why:        When an order that was paid through Paystack is cancelled, the buyer must get the order amount back, once.
--             This migration queues a `pending` refund row in the SAME transaction as the cancellation (whichever code
--             path cancelled it); a backend worker (job `paystack-refunds`) later asks Paystack to refund it. Admin-started
--             refunds (disputes) use the same table through the backend. Paystack is never called inside this transaction.
-- Changes:    paystack_refunds: + last_error, source; trigger orders_queue_paystack_refunds (after status becomes 'cancelled').
-- Roll back:  drop trigger if exists orders_queue_paystack_refunds on public.orders;
--             drop function if exists public.queue_paystack_refunds();
--             (the added columns can stay; once refunds exist keep the table)
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0008).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter table public.paystack_refunds
  add column if not exists last_error text,
  add column if not exists source text not null default 'admin' check (source in ('admin', 'cancellation'));

-- The order amount (what `payments.amount` records: Paystack's fee, paid by the buyer on top, is not refunded) of each
-- Paystack card payment on the cancelled order, one refund row per payment. (order_id, attempt) is unique, so a repeat is harmless.
create or replace function public.queue_paystack_refunds() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.paystack_refunds (transaction_reference, order_id, attempt, amount_kobo, reason, source)
    select p.provider_reference, new.id,
           coalesce((select max(r.attempt) from public.paystack_refunds r where r.order_id = new.id), 0) + row_number() over (order by p.created_at, p.id),
           round(p.amount * 100)::bigint, 'Order cancelled', 'cancellation'
    from public.payments p
    join public.paystack_transactions t on t.reference = p.provider_reference and t.status = 'success'
    where p.order_id = new.id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
      and p.amount > 0
      and not exists (select 1 from public.paystack_refunds r where r.order_id = new.id and r.transaction_reference = p.provider_reference and r.status <> 'failed')
    on conflict (order_id, attempt) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists orders_queue_paystack_refunds on public.orders;
create trigger orders_queue_paystack_refunds after update of status on public.orders
  for each row execute function public.queue_paystack_refunds();
