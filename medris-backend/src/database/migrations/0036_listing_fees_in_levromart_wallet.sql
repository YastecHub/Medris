-- =============================================================================
-- 0036  Monthly listing fees count as Levromart's own money, next to (and separate from) the commission
-- Why:        Shops on monthly billing pay ₦999 per listing through Paystack. That money is Levromart's revenue, but
--             Levromart's wallet (migration 0035) only counted the 3% commission. The admins need to see both, apart:
--             "this much from commission, this much from monthly listing fees".
-- Changes:    platform_wallet_entries   a new kind 'listing_fee'. A trigger adds one line when a listing-fee payment
--                                       succeeds (paystack_transactions, purpose 'listing_fee'), for the amount after
--                                       Paystack's own fee (1.5%, plus ₦100 from ₦2,500, at most ₦2,000), because that
--                                       is what actually reaches the Paystack balance. Each payment counts once.
--                                       Listing fees already paid are copied in now (one line each).
-- Needs:      0035 (Levromart's wallet). Apply 0035 first.
-- Roll back:  drop trigger trg_paystack_transactions_platform_fee on public.paystack_transactions;
--             drop function public.platform_listing_fee_from_payment();
--             delete from public.platform_wallet_entries where kind = 'listing_fee';
--             alter table public.platform_wallet_entries drop constraint platform_wallet_entries_kind_check;
--             alter table public.platform_wallet_entries add constraint platform_wallet_entries_kind_check
--               check (kind in ('commission', 'commission_reversed', 'withdrawal', 'withdrawal_return'));
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0036).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter table public.platform_wallet_entries drop constraint if exists platform_wallet_entries_kind_check;
alter table public.platform_wallet_entries add constraint platform_wallet_entries_kind_check
  check (kind in ('commission', 'commission_reversed', 'withdrawal', 'withdrawal_return', 'listing_fee'));

-- What a payment leaves in the Paystack balance after Paystack's local card fee.
create or replace function public.platform_after_paystack_fee(p_kobo bigint) returns bigint
  language sql immutable as $$
  select p_kobo - least(200000, ceil(p_kobo * 0.015)::bigint + case when p_kobo >= 250000 then 10000 else 0 end)
$$;

create or replace function public.platform_listing_fee_from_payment() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  net bigint;
begin
  if new.purpose = 'listing_fee' and new.status = 'success' and (tg_op = 'INSERT' or old.status is distinct from 'success') then
    net := public.platform_after_paystack_fee(new.amount_kobo);
    if net > 0 then
      insert into public.platform_wallet_entries (kind, amount_kobo, vendor_id, reference, note, created_at)
        values ('listing_fee', net, new.vendor_id, 'listing:' || new.reference, 'Monthly listing fee', coalesce(new.paid_at, now()))
        on conflict do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_paystack_transactions_platform_fee on public.paystack_transactions;
create trigger trg_paystack_transactions_platform_fee after insert or update of status on public.paystack_transactions
  for each row execute function public.platform_listing_fee_from_payment();

-- the listing fees already paid (one line each)
insert into public.platform_wallet_entries (kind, amount_kobo, vendor_id, reference, note, created_at)
select 'listing_fee', public.platform_after_paystack_fee(t.amount_kobo), t.vendor_id, 'listing:' || t.reference, 'Monthly listing fee', coalesce(t.paid_at, t.created_at)
  from public.paystack_transactions t
 where t.purpose = 'listing_fee' and t.status = 'success' and public.platform_after_paystack_fee(t.amount_kobo) > 0
on conflict do nothing;
