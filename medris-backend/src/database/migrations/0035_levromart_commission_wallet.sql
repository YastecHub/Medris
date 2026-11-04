-- =============================================================================
-- 0035  Levromart's own wallet: the commission, with its history, withdrawn to Levromart's bank account
-- Why:        Levromart's 3% commission stays in the Paystack balance together with everyone else's money. The admins need to
--             see exactly how much of that balance is Levromart's own, line by line as orders complete, and to send it to
--             Levromart's bank account without touching anybody else's money.
-- Changes:    platform_wallet_entries   the commission ledger. A trigger adds a line whenever commission is collected:
--                                       - a commission charge taken from an order paid through Levromart (card or wallet),
--                                       - a shop paying the commission it owed through Paystack (commission_settlements);
--                                       and a minus line when a collected charge is taken back (for example a refund).
--                                       Withdrawals and returned withdrawals are lines too. The balance is the sum.
--                                       Every commission already collected is copied in now (one line each), so the history
--                                       is complete from the start.
--             platform_payout_account   Levromart's bank account for commission withdrawals (one row).
--             platform_withdrawals      each commission withdrawal to that bank account.
--             (A shop deleting its account removes its commission rows; the ledger keeps the money it already received:
--             the backend sets levromart.account_deletion = 'on' for that transaction.)
-- Roll back:  drop trigger trg_commission_charges_platform on public.commission_charges;
--             drop trigger trg_commission_settlements_platform on public.commission_settlements;
--             drop function public.platform_commission_from_charge(), public.platform_commission_from_settlement();
--             drop table public.platform_wallet_entries, public.platform_withdrawals, public.platform_payout_account;
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0035).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.platform_payout_account (
  id             boolean primary key default true check (id),
  bank_code      text not null,
  bank_name      text,
  account_name   text not null,
  account_last4  text not null,
  recipient_code text not null,
  set_by         uuid references public.users (id) on delete set null,
  changed_at     timestamptz not null default now()
);

create table if not exists public.platform_withdrawals (
  id                 uuid primary key default gen_random_uuid(),
  amount_kobo        bigint not null check (amount_kobo > 0),
  status             text not null default 'processing' check (status in ('processing', 'success', 'failed', 'reversed')),
  transfer_reference text not null unique,
  transfer_code      text,
  recipient_code     text not null,
  bank_name          text,
  account_name       text,
  account_last4      text,
  requested_by       uuid references public.users (id) on delete set null,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists platform_withdrawals_created_idx on public.platform_withdrawals (created_at desc);

create table if not exists public.platform_wallet_entries (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('commission', 'commission_reversed', 'withdrawal', 'withdrawal_return')),
  amount_kobo    bigint not null check (amount_kobo <> 0),
  charge_id      uuid,
  settlement_id  uuid,
  order_id       uuid references public.orders (id) on delete set null,
  vendor_id      uuid,
  withdrawal_id  uuid references public.platform_withdrawals (id) on delete set null,
  reference      text,
  note           text,
  created_at     timestamptz not null default now()
);
create unique index if not exists platform_wallet_entries_once_idx on public.platform_wallet_entries (kind, reference) where reference is not null;
create index if not exists platform_wallet_entries_created_idx on public.platform_wallet_entries (created_at desc);

-- ------------------------------------------------- commission comes in as it is collected
-- A charge counts once it is 'paid' AND linked to the order's payment through Levromart (the money is in the Paystack balance).
create or replace function public.platform_commission_from_charge() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  was bigint := 0;
  now_k bigint := 0;
  r record;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'paid' and old.payment_id is not null then was := round(old.amount * 100); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'paid' and new.payment_id is not null then now_k := round(new.amount * 100); end if;
  if now_k = was then return coalesce(new, old); end if;
  -- a shop deleting its account removes its records, not Levromart's money: collected commission stays in the ledger
  if tg_op = 'DELETE' and current_setting('levromart.account_deletion', true) = 'on' then return old; end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  insert into public.platform_wallet_entries (kind, amount_kobo, charge_id, order_id, vendor_id, note)
    values (case when now_k > was then 'commission' else 'commission_reversed' end, now_k - was, r.id,
            (select o.id from public.orders o where o.id = r.order_id), r.vendor_id,
            case when now_k > was then '3% commission' else 'Commission taken back' end);
  return coalesce(new, old);
end $$;

drop trigger if exists trg_commission_charges_platform on public.commission_charges;
create trigger trg_commission_charges_platform after insert or update or delete on public.commission_charges
  for each row execute function public.platform_commission_from_charge();

-- A shop paying the commission it owed, through Paystack.
create or replace function public.platform_commission_from_settlement() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' and new.provider_reference is not null and (tg_op = 'INSERT' or old.status is distinct from 'paid') and new.amount > 0 then
    insert into public.platform_wallet_entries (kind, amount_kobo, settlement_id, vendor_id, reference, note)
      values ('commission', round(new.amount * 100), new.id, new.vendor_id, 'settlement:' || new.id::text, 'Commission paid by the shop')
      on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_commission_settlements_platform on public.commission_settlements;
create trigger trg_commission_settlements_platform after insert or update on public.commission_settlements
  for each row execute function public.platform_commission_from_settlement();

-- -------------------------------------------------- the history so far (one line per commission already collected)
insert into public.platform_wallet_entries (kind, amount_kobo, charge_id, order_id, vendor_id, reference, note, created_at)
select 'commission', round(c.amount * 100), c.id, (select o.id from public.orders o where o.id = c.order_id), c.vendor_id,
       'opening:charge:' || c.id::text, '3% commission', coalesce(c.paid_at, now())
  from public.commission_charges c
 where c.status = 'paid' and c.payment_id is not null and round(c.amount * 100) <> 0
on conflict do nothing;

insert into public.platform_wallet_entries (kind, amount_kobo, settlement_id, vendor_id, reference, note, created_at)
select 'commission', round(s.amount * 100), s.id, s.vendor_id, 'settlement:' || s.id::text, 'Commission paid by the shop', coalesce(s.paid_at, now())
  from public.commission_settlements s
 where s.status = 'paid' and s.provider_reference is not null and s.amount > 0
on conflict do nothing;

-- ------------------------------------------------ security: admins read, only the backend writes
alter table public.platform_wallet_entries enable row level security;
alter table public.platform_withdrawals enable row level security;
alter table public.platform_payout_account enable row level security;

drop policy if exists platform_wallet_entries_select on public.platform_wallet_entries;
create policy platform_wallet_entries_select on public.platform_wallet_entries for select to authenticated using ((select public.is_admin()));
drop policy if exists platform_withdrawals_select on public.platform_withdrawals;
create policy platform_withdrawals_select on public.platform_withdrawals for select to authenticated using ((select public.is_admin()));
drop policy if exists platform_payout_account_select on public.platform_payout_account;
create policy platform_payout_account_select on public.platform_payout_account for select to authenticated using ((select public.is_admin()));

revoke all on public.platform_wallet_entries, public.platform_withdrawals, public.platform_payout_account from anon;
revoke insert, update, delete on public.platform_wallet_entries, public.platform_withdrawals, public.platform_payout_account from authenticated;
grant select on public.platform_wallet_entries, public.platform_withdrawals, public.platform_payout_account to authenticated;
grant all on public.platform_wallet_entries, public.platform_withdrawals, public.platform_payout_account to service_role;

do $$
begin
  execute 'drop trigger if exists trg_platform_withdrawals_updated_at on public.platform_withdrawals';
  execute 'create trigger trg_platform_withdrawals_updated_at before update on public.platform_withdrawals for each row execute function public.set_updated_at_timestamp()';
end $$;
