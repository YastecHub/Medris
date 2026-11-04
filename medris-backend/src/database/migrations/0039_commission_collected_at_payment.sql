-- =============================================================================
-- 0039  Levromart's 3% commission is collected the moment an order is paid
-- Why:        The 3% used to reach Levromart's wallet only when the buyer confirmed the order, so a shop's "waiting" money
--             still showed the full ₦100 and the 3% could be affected by what happens after payment. Now the 3% is Levromart's
--             the moment the payment arrives, and only the shop's 97% waits for the buyer's confirmation (and the 24-hour
--             check). A refund comes out of the shop's 97%, never out of Levromart's 3%.
-- Changes:    public.collect_commission_at_payment()   a trigger on payments: when a Levromart payment (card or wallet,
--                                                       reference lvm_ord_...) becomes paid, 3% of its amount is recorded as an
--                                                       already-collected commission charge (the existing charge trigger then
--                                                       adds the line to Levromart's wallet). A refundable deposit earns none.
--             public.record_order_completion_commission()  an order that already has its commission collected at payment is
--                                                       only topped up if something is still missing; nothing is replaced.
--             public.queue_paystack_refunds()          a cancelled order is refunded what was paid minus the commission that
--                                                       was collected on that payment (the 97%).
--             Existing paid orders that are not completed yet get their 3% recorded now (one charge each, once).
-- Needs:      0035 (Levromart's commission wallet).
-- Roll back:  drop trigger trg_payments_collect_commission on public.payments; drop function public.collect_commission_at_payment();
--             restore the previous bodies of record_order_completion_commission() (0024) and queue_paystack_refunds() (0008).
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0039).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.collect_commission_at_payment() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_vendor uuid;
  v_exempt boolean;
  v_amount numeric(12,2);
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid')
     and new.method = 'card' and new.provider_reference like 'lvm\_ord\_%'
     and new.payment_type::text <> 'deposit' and coalesce(new.amount, 0) > 0 then
    select o.vendor_id, coalesce(o.commission_exempt, false) into v_vendor, v_exempt from public.orders o where o.id = new.order_id;
    if v_vendor is not null and not v_exempt
       and not exists (select 1 from public.commission_charges c where c.payment_id = new.id) then
      v_amount := round(new.amount * 0.03, 2);
      if v_amount > 0 then
        insert into public.commission_charges (vendor_id, payment_id, order_id, amount, status, paid_at, due_at)
        values (v_vendor, new.id, new.order_id, v_amount, 'paid', now(), null);
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_payments_collect_commission on public.payments;
create trigger trg_payments_collect_commission after insert or update of status on public.payments
  for each row execute function public.collect_commission_at_payment();

create or replace function public.record_order_completion_commission() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare
  v_amount numeric(12,2);
  v_card_payment uuid;
  v_have numeric(12,2);
begin
  if NEW.status = 'completed' and OLD.status is distinct from 'completed' and coalesce(NEW.commission_exempt, false) = false then
    v_amount := round(greatest(0, coalesce(NEW.total_amount, 0)) * 0.03, 2);
    select p.id into v_card_payment from public.payments p
     where p.order_id = NEW.id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
     order by p.created_at desc limit 1;
    if v_card_payment is not null then
      -- the commission was collected when the payments arrived: keep it, and only add what is still missing
      delete from public.commission_charges c where c.order_id = NEW.id and c.status = 'owed';
      select coalesce(sum(c.amount), 0) into v_have from public.commission_charges c
       where c.order_id = NEW.id and c.status = 'paid' and c.payment_id is not null;
      if v_amount - v_have >= 0.01 then
        insert into public.commission_charges (vendor_id, payment_id, order_id, amount, status, paid_at, due_at)
        values (NEW.vendor_id, v_card_payment, NEW.id, v_amount - v_have, 'paid', now(), null);
      end if;
    else
      delete from public.commission_charges c where c.order_id = NEW.id and c.status = 'owed';
      if v_amount > 0 then
        insert into public.commission_charges (vendor_id, payment_id, order_id, amount, status, due_at)
        values (NEW.vendor_id, null, NEW.id, v_amount, 'owed', coalesce(NEW.completed_at, now()) + interval '7 days');
      end if;
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.queue_paystack_refunds() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.paystack_refunds (transaction_reference, order_id, attempt, amount_kobo, reason, source)
    select p.provider_reference, new.id,
           coalesce((select max(r.attempt) from public.paystack_refunds r where r.order_id = new.id), 0) + row_number() over (order by p.created_at, p.id),
           round(p.amount * 100)::bigint
             - round(coalesce((select sum(c.amount) from public.commission_charges c where c.payment_id = p.id and c.status = 'paid'), 0) * 100)::bigint,
           'Order cancelled', 'cancellation'
    from public.payments p
    join public.paystack_transactions t on t.reference = p.provider_reference and t.status = 'success'
    where p.order_id = new.id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
      and p.amount > 0
      and round(p.amount * 100)::bigint
            - round(coalesce((select sum(c.amount) from public.commission_charges c where c.payment_id = p.id and c.status = 'paid'), 0) * 100)::bigint > 0
      and not exists (select 1 from public.paystack_refunds r where r.order_id = new.id and r.transaction_reference = p.provider_reference and r.status <> 'failed')
    on conflict (order_id, attempt) do nothing;
  end if;
  return new;
end $$;

-- orders already paid and not completed yet: their 3% is recorded now, once
insert into public.commission_charges (vendor_id, payment_id, order_id, amount, status, paid_at, due_at)
select o.vendor_id, p.id, p.order_id, round(p.amount * 0.03, 2), 'paid', now(), null
  from public.payments p
  join public.orders o on o.id = p.order_id
 where p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
   and p.payment_type::text <> 'deposit' and coalesce(p.amount, 0) > 0
   and o.status not in ('completed', 'cancelled') and coalesce(o.commission_exempt, false) = false
   and round(p.amount * 0.03, 2) > 0
   and not exists (select 1 from public.commission_charges c where c.payment_id = p.id);
