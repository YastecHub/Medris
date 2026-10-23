-- =============================================================================
-- 0007  Queue a vendor payout when a Paystack-paid order is completed (issue #98)
-- Why:        When a buyer confirms receipt (or the order auto-completes), the money Levromart holds must reach the
--             vendor exactly once. This migration writes a `pending` row into `vendor_payouts` (the queue) in the SAME
--             transaction as the completion, whichever code path completed the order. A worker (backend job
--             `vendor-payouts`) later does the Paystack transfer; Paystack is never called inside this transaction.
--             It also adds the bookkeeping columns the worker and the admin actions need, and the status
--             `paid_manually` for payouts an admin settled outside Paystack.
-- Changes:    vendor_payouts: + next_attempt_at, settled_by, note, paystack_transfer_code; status check + 'paid_manually';
--             trigger orders_queue_vendor_payout (after the status changes to 'completed').
-- Roll back:  drop trigger if exists orders_queue_vendor_payout on public.orders;
--             drop function if exists public.queue_vendor_payout();
--             (the added columns can stay; once payouts exist keep the table)
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0007).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter table public.vendor_payouts
  add column if not exists next_attempt_at timestamptz,
  add column if not exists settled_by uuid references public.users (id) on delete set null,
  add column if not exists note text,
  add column if not exists paystack_transfer_code text;

alter table public.vendor_payouts drop constraint if exists vendor_payouts_status_check;
alter table public.vendor_payouts add constraint vendor_payouts_status_check
  check (status in ('pending', 'processing', 'success', 'failed', 'reversed', 'on_hold', 'paid_manually'));

-- One queue row per completed order that was paid through Paystack. The amount is worked out by the worker at transfer
-- time (what was paid, minus commission, minus refunds), so it starts at 0. The unique (order_id, payout_purpose)
-- constraint means completing an order twice, or two workers, can never queue it twice.
create or replace function public.queue_vendor_payout() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from public.payments p
                 where p.order_id = new.id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%') then
    insert into public.vendor_payouts (order_id, vendor_id, amount_kobo, transfer_reference, status)
    values (new.id, new.vendor_id, 0, 'lvm_po_' || replace(new.id::text, '-', ''), 'pending')
    on conflict (order_id, payout_purpose) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists orders_queue_vendor_payout on public.orders;
create trigger orders_queue_vendor_payout after update of status on public.orders
  for each row execute function public.queue_vendor_payout();
