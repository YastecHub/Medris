-- =============================================================================
-- 0024  Commission on an order paid through Paystack is taken from the payout, never asked of the shop
-- Why:        When an order paid by card through Paystack was completed, its 3% commission was recorded as "owed" by the
--             shop (due in 7 days), although Levromart already holds that money and takes the commission out of the
--             shop's payout. So the shop was asked to pay it (and charged twice if it did), and a shop that had not
--             withdrawn within 7 days had its storefront paused for commission Levromart already had.
-- Changes:    record_order_completion_commission(): for an order with a paid Paystack card payment (the same orders that
--             get a payout, migration 0017), the charge is recorded as already collected - status 'paid', paid_at now,
--             payment_id = that card payment, no due date - so it is never counted as owed, reminded about or paused
--             for. The payout still takes it (the backend counts charges linked to the order's card payment).
--             Other orders are unchanged.
--             Existing data: "owed" charges on such orders whose payout has not left yet get the same treatment.
--             Charges a shop already paid itself are left alone (the backend no longer takes those from the payout).
--             A storefront paused for overdue commission that is no longer overdue reopens at once, by the same rule the
--             deadline check uses (enforce_commission_deadlines), instead of waiting for that check to run.
-- Roll back:  restore the previous body of public.record_order_completion_commission() (baseline 01-public-schema.sql).
--             The data change does not need undoing: those charges are taken from the payout either way.
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0024).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create or replace function public.record_order_completion_commission() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
declare
  v_amount numeric(12,2);
  v_card_payment uuid;
begin
  if NEW.status = 'completed' and OLD.status is distinct from 'completed' and coalesce(NEW.commission_exempt, false) = false then
    v_amount := round(greatest(0, coalesce(NEW.total_amount, 0)) * 0.03, 2);
    -- paid by card through Paystack: Levromart holds the money and takes the commission from the payout
    select p.id into v_card_payment from public.payments p
     where p.order_id = NEW.id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
     order by p.created_at desc limit 1;
    -- a charge from an earlier completion of this order is replaced (one the shop paid itself is kept)
    delete from public.commission_charges c
     where c.order_id = NEW.id
       and (c.status = 'owed'
            or (c.status = 'paid' and c.payment_id in (select p.id from public.payments p where p.order_id = NEW.id and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%')));
    if v_amount > 0 then
      if v_card_payment is not null then
        insert into public.commission_charges (vendor_id, payment_id, order_id, amount, status, paid_at, due_at)
        values (NEW.vendor_id, v_card_payment, NEW.id, v_amount, 'paid', now(), null);
      else
        insert into public.commission_charges (vendor_id, payment_id, order_id, amount, status, due_at)
        values (NEW.vendor_id, null, NEW.id, v_amount, 'owed', coalesce(NEW.completed_at, now()) + interval '7 days');
      end if;
    end if;
  end if;
  return NEW;
end $$;

-- Existing charges: "owed" on an order whose payout Levromart still holds -> collected from that payout.
update public.commission_charges c
   set status = 'paid', paid_at = now(), due_at = null,
       payment_id = (select p.id from public.payments p
                      where p.order_id = c.order_id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%'
                      order by p.created_at desc limit 1)
 where c.status = 'owed'
   and exists (select 1 from public.vendor_payouts vp where vp.order_id = c.order_id and vp.status in ('on_hold', 'pending', 'failed'))
   and exists (select 1 from public.payments p
                where p.order_id = c.order_id and p.status = 'paid' and p.method = 'card' and p.provider_reference like 'lvm\_ord\_%');

-- Storefronts paused only because of that commission reopen now (the same rule as enforce_commission_deadlines).
update public.vendors v set is_active = true, commission_paused = false, commission_pause_reason = null
 where v.deleted_at is null and v.verification_status = 'verified' and coalesce(v.admin_paused, false) = false
   and coalesce(v.commission_paused, false) = true and v.commission_pause_reason in ('commission_owed', 'commission_overdue')
   and not (exists (select 1 from public.commission_charges c join public.orders o on o.id = c.order_id
                     where c.vendor_id = v.id and c.status = 'owed' and o.status = 'completed' and c.due_at <= now())
            and coalesce((select sum(c.amount) from public.commission_charges c join public.orders o on o.id = c.order_id
                           where c.vendor_id = v.id and c.status = 'owed' and o.status = 'completed'), 0) >= 100);
