-- =============================================================================
-- 0019  Buyers get a refunds wallet
-- Why:        A buyer who saved a bank account for refunds gets refunds into a wallet instead of back onto the card, and
--             withdraws them to that account whenever they like. Buyers without an account keep getting card refunds.
-- Changes:    buyer_payout_accounts (the buyer's verified bank account: bank, name, last 4 digits and Paystack recipient -
--               the full account number is never stored);
--             refund_credits (money put in the wallet, one per refund, so a refund can never be credited twice);
--             refund_withdrawals (one bank transfer out of the wallet, with Paystack's reference and outcome).
-- Roll back:  drop table public.refund_withdrawals, public.refund_credits, public.buyer_payout_accounts (only while empty).
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0019).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.buyer_payout_accounts (
  user_id                uuid primary key references public.users (id) on delete cascade,
  bank_code              text not null,
  bank_name              text not null,
  account_name           text not null,
  account_last4          text not null,
  transfer_recipient_code text not null,
  verified_at            timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

create table if not exists public.refund_withdrawals (
  id                 uuid primary key default gen_random_uuid(),
  buyer_id           uuid not null references public.users (id) on delete cascade,
  amount_kobo        bigint not null check (amount_kobo > 0),
  status             text not null default 'processing' check (status in ('processing', 'success', 'failed', 'reversed')),
  transfer_reference text not null unique,
  transfer_code      text,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists refund_withdrawals_buyer_idx on public.refund_withdrawals (buyer_id, created_at desc);

create table if not exists public.refund_credits (
  id            uuid primary key default gen_random_uuid(),
  buyer_id      uuid not null references public.users (id) on delete cascade,
  order_id      uuid references public.orders (id) on delete set null,
  refund_id     uuid not null unique references public.paystack_refunds (id) on delete restrict,
  amount_kobo   bigint not null check (amount_kobo > 0),
  status        text not null default 'available' check (status in ('available', 'processing', 'sent')),
  withdrawal_id uuid references public.refund_withdrawals (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists refund_credits_buyer_idx on public.refund_credits (buyer_id, status);

alter table public.buyer_payout_accounts enable row level security;
alter table public.refund_withdrawals enable row level security;
alter table public.refund_credits enable row level security;

drop policy if exists buyer_payout_accounts_select on public.buyer_payout_accounts;
create policy buyer_payout_accounts_select on public.buyer_payout_accounts for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists refund_withdrawals_select on public.refund_withdrawals;
create policy refund_withdrawals_select on public.refund_withdrawals for select to authenticated using (buyer_id = (select auth.uid()) or (select public.is_admin()));
drop policy if exists refund_credits_select on public.refund_credits;
create policy refund_credits_select on public.refund_credits for select to authenticated using (buyer_id = (select auth.uid()) or (select public.is_admin()));

-- every write goes through the backend (service role)
revoke insert, update, delete on public.buyer_payout_accounts, public.refund_withdrawals, public.refund_credits from anon, authenticated;
grant select on public.buyer_payout_accounts, public.refund_withdrawals, public.refund_credits to authenticated;
grant all on public.buyer_payout_accounts, public.refund_withdrawals, public.refund_credits to service_role;

do $$
begin
  execute 'drop trigger if exists trg_refund_withdrawals_updated_at on public.refund_withdrawals';
  execute 'create trigger trg_refund_withdrawals_updated_at before update on public.refund_withdrawals for each row execute function public.set_updated_at_timestamp()';
end $$;
