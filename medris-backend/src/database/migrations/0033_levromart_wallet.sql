-- =============================================================================
-- 0033  One Levromart wallet for everyone
-- Why:        Every person (buyer or shop) gets ONE wallet with a balance and an @tag. Money comes in by top-up (Paystack),
--             by a transfer from another person, by a refund, or (for shops) by moving their earnings in. Money goes out by
--             a transfer to someone's @tag, by paying for an order (no Paystack fee, Levromart's 3% is kept as for a card
--             payment), or by withdrawing to the bank. The money itself stays in Levromart's Paystack balance; these tables
--             are the ledger of who owns how much of it. The old "refunds wallet" becomes part of this wallet.
-- Changes:    wallet_accounts    one row per user: @tag (handle), balance, frozen flag (a trigger creates it for new users;
--                                every existing user gets one below).
--             wallet_entries     the ledger: every credit and debit with the balance after it. (user, kind, reference) is
--                                unique, so a top-up, refund, order payment or earnings move can never happen twice.
--             wallet_transfers   one row per person-to-person transfer (with the sender's idempotency key).
--             wallet_withdrawals bank withdrawals; 'requested' ones wait for an admin (first withdrawal after a bank account
--                                change, or money that arrived by top-up/transfer in the last 24 hours).
--             withdrawal_requests.destination  'bank' (as before) or 'wallet' (a shop moving earnings into its wallet).
--             vendor_payouts.status            + 'to_wallet' (earnings moved into the shop's wallet).
--             paystack_transactions.purpose    + 'wallet_topup'.
--             refund_credits.status            + 'moved'. Refund money that was waiting in the old refunds wallet is moved
--                                              into the new wallet now (one ledger line per refund).
-- Roll back:  ONLY before any money has moved through the wallet: drop table public.wallet_withdrawals,
--             public.wallet_entries, public.wallet_transfers, public.wallet_accounts; drop trigger trg_users_wallet_account;
--             drop function public.create_wallet_account(), public.wallet_make_handle(text, uuid);
--             update public.refund_credits set status = 'available' where status = 'moved'; put the four check
--             constraints and withdrawal_requests (drop column destination) back.
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it. Holding customers' money in a
--             wallet may need a licence or a partner bank: get legal advice before switching it on
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0033).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.wallet_accounts (
  user_id           uuid primary key references public.users (id) on delete cascade,
  handle            text not null check (handle ~ '^[a-z0-9_]{3,24}$'),
  balance_kobo      bigint not null default 0 check (balance_kobo >= 0),
  frozen            boolean not null default false,
  frozen_reason     text,
  handle_changed_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists wallet_accounts_handle_idx on public.wallet_accounts (handle);

create table if not exists public.wallet_transfers (
  id              uuid primary key default gen_random_uuid(),
  from_user       uuid not null,
  to_user         uuid not null,
  amount_kobo     bigint not null check (amount_kobo > 0),
  note            text check (note is null or char_length(note) <= 140),
  idempotency_key text,
  created_at      timestamptz not null default now(),
  check (from_user <> to_user)
);
create unique index if not exists wallet_transfers_key_idx on public.wallet_transfers (from_user, idempotency_key) where idempotency_key is not null;
create index if not exists wallet_transfers_from_idx on public.wallet_transfers (from_user, created_at desc);
create index if not exists wallet_transfers_to_idx on public.wallet_transfers (to_user, created_at desc);

create table if not exists public.wallet_withdrawals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  amount_kobo        bigint not null check (amount_kobo > 0),
  status             text not null default 'processing'
                       check (status in ('requested', 'processing', 'success', 'failed', 'reversed', 'rejected')),
  review_reason      text,                -- why it waits for an admin
  transfer_reference text not null unique,
  transfer_code      text,
  recipient_code     text,
  bank_name          text,
  account_name       text,
  account_last4      text,
  last_error         text,
  decided_by         uuid references public.users (id) on delete set null,
  decided_at         timestamptz,
  reject_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists wallet_withdrawals_user_idx on public.wallet_withdrawals (user_id, created_at desc);
create index if not exists wallet_withdrawals_requested_idx on public.wallet_withdrawals (created_at) where status = 'requested';

create table if not exists public.wallet_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users (id) on delete cascade,
  kind               text not null check (kind in ('topup', 'transfer_in', 'transfer_out', 'order_payment', 'refund_in',
                                                   'refund_out', 'earnings_in', 'withdrawal', 'withdrawal_return')),
  amount_kobo        bigint not null check (amount_kobo <> 0),
  balance_after_kobo bigint not null check (balance_after_kobo >= 0),
  transfer_id        uuid references public.wallet_transfers (id) on delete set null,
  withdrawal_id      uuid references public.wallet_withdrawals (id) on delete set null,
  order_id           uuid references public.orders (id) on delete set null,
  counterparty_id    uuid,
  reference          text,
  note               text,
  created_at         timestamptz not null default now()
);
create unique index if not exists wallet_entries_once_idx on public.wallet_entries (user_id, kind, reference) where reference is not null;
create index if not exists wallet_entries_user_idx on public.wallet_entries (user_id, created_at desc);

-- ------------------------------------------------------------------- @tags
create or replace function public.wallet_make_handle(p_name text, p_id uuid) returns text
  language plpgsql set search_path = public as $$
declare
  base text;
  cand text;
  tries int := 0;
begin
  base := lower(regexp_replace(coalesce(p_name, ''), '[^a-zA-Z0-9]+', '', 'g'));
  if char_length(base) < 3 then base := 'user' || base; end if;
  base := left(base, 16);
  cand := base;
  while exists (select 1 from public.wallet_accounts where handle = cand) loop
    tries := tries + 1;
    cand := base || (1000 + floor(random() * 9000))::int::text;
    if tries > 25 then cand := left(base, 12) || replace(p_id::text, '-', '')::text; cand := left(cand, 24); exit; end if;
  end loop;
  return cand;
end $$;

create or replace function public.create_wallet_account() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.wallet_accounts (user_id, handle) values (new.id, public.wallet_make_handle(new.name, new.id)) on conflict do nothing;
  return new;
exception when unique_violation then
  return new;   -- the app creates the wallet on first use instead; signing up must never fail because of it
end $$;

drop trigger if exists trg_users_wallet_account on public.users;
create trigger trg_users_wallet_account after insert on public.users for each row execute function public.create_wallet_account();

-- a wallet for everyone already here (one statement per person, so two people never get the same @tag)
do $$
declare r record;
begin
  for r in select id, name from public.users u where not exists (select 1 from public.wallet_accounts w where w.user_id = u.id) loop
    insert into public.wallet_accounts (user_id, handle) values (r.id, public.wallet_make_handle(r.name, r.id)) on conflict do nothing;
  end loop;
end $$;

-- ---------------------------------------- lists that gain one value each
do $$
declare c text;
begin
  select conname into c from pg_constraint where conrelid = 'public.paystack_transactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%order_payment%';
  if c is not null then execute format('alter table public.paystack_transactions drop constraint %I', c); end if;
  alter table public.paystack_transactions add constraint paystack_transactions_purpose_check
    check (purpose in ('order_payment', 'order_balance', 'listing_fee', 'commission', 'wallet_topup'));

  select conname into c from pg_constraint where conrelid = 'public.refund_credits'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%available%';
  if c is not null then execute format('alter table public.refund_credits drop constraint %I', c); end if;
  alter table public.refund_credits add constraint refund_credits_status_check check (status in ('available', 'processing', 'sent', 'moved'));
end $$;

alter table public.vendor_payouts drop constraint if exists vendor_payouts_status_check;
alter table public.vendor_payouts add constraint vendor_payouts_status_check
  check (status in ('pending', 'processing', 'success', 'failed', 'reversed', 'on_hold', 'paid_manually', 'to_wallet'));

alter table public.withdrawal_requests add column if not exists destination text not null default 'bank';
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_destination_check;
alter table public.withdrawal_requests add constraint withdrawal_requests_destination_check check (destination in ('bank', 'wallet'));
-- one open request per shop and destination
drop index if exists public.withdrawal_requests_one_open_idx;
create unique index if not exists withdrawal_requests_one_open_idx on public.withdrawal_requests (vendor_id, destination) where status = 'requested';

-- -------------------- refund money waiting in the old refunds wallet moves into the new wallet
do $$
declare r record; bal bigint;
begin
  for r in select id, buyer_id, order_id, amount_kobo from public.refund_credits where status = 'available' order by created_at loop
    insert into public.wallet_accounts (user_id, handle)
      select r.buyer_id, public.wallet_make_handle(u.name, u.id) from public.users u where u.id = r.buyer_id on conflict do nothing;
    update public.wallet_accounts set balance_kobo = balance_kobo + r.amount_kobo where user_id = r.buyer_id returning balance_kobo into bal;
    insert into public.wallet_entries (user_id, kind, amount_kobo, balance_after_kobo, order_id, reference, note)
      values (r.buyer_id, 'refund_in', r.amount_kobo, bal, r.order_id, 'credit:' || r.id::text, 'Refund (moved from the refunds wallet)');
    update public.refund_credits set status = 'moved' where id = r.id;
  end loop;
end $$;

-- ------------------------------------------------ security: reads only from the app
alter table public.wallet_accounts enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.wallet_transfers enable row level security;
alter table public.wallet_withdrawals enable row level security;

drop policy if exists wallet_accounts_select on public.wallet_accounts;
create policy wallet_accounts_select on public.wallet_accounts for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists wallet_entries_select on public.wallet_entries;
create policy wallet_entries_select on public.wallet_entries for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists wallet_transfers_select on public.wallet_transfers;
create policy wallet_transfers_select on public.wallet_transfers for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()) or (select public.is_admin()));
drop policy if exists wallet_withdrawals_select on public.wallet_withdrawals;
create policy wallet_withdrawals_select on public.wallet_withdrawals for select to authenticated using (user_id = (select auth.uid()) or (select public.is_admin()));

-- every write goes through the backend (service role): nobody can change a balance from the browser
revoke insert, update, delete on public.wallet_accounts, public.wallet_entries, public.wallet_transfers, public.wallet_withdrawals from anon, authenticated;
grant select on public.wallet_accounts, public.wallet_entries, public.wallet_transfers, public.wallet_withdrawals to authenticated;
grant all on public.wallet_accounts, public.wallet_entries, public.wallet_transfers, public.wallet_withdrawals to service_role;

do $$
begin
  execute 'drop trigger if exists trg_wallet_accounts_updated_at on public.wallet_accounts';
  execute 'create trigger trg_wallet_accounts_updated_at before update on public.wallet_accounts for each row execute function public.set_updated_at_timestamp()';
  execute 'drop trigger if exists trg_wallet_withdrawals_updated_at on public.wallet_withdrawals';
  execute 'create trigger trg_wallet_withdrawals_updated_at before update on public.wallet_withdrawals for each row execute function public.set_updated_at_timestamp()';
end $$;
