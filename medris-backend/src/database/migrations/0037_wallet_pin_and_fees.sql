-- =============================================================================
-- 0037  Wallet PIN (6 digits) and a fee on every wallet payment, transfer and withdrawal
-- Why:        Every movement of wallet money (pay, send, withdraw, add money) now needs the person's own 6-digit PIN,
--             like a bank app. Paying with the wallet, sending to someone and withdrawing to a bank each carry Paystack's
--             local fee (1.5% + ₦100 from ₦2,500, at most ₦2,000), which belongs to Levromart.
-- Changes:    wallet_pins                a person's PIN (only a salted hash is kept), wrong-try counter and lock time.
--                                        Readable by nobody but the backend.
--             wallet_withdrawals         fee_kobo: the fee charged on that withdrawal (given back if the bank transfer fails)
--             wallet_entries             new kinds 'fee' and 'fee_return'
--             platform_wallet_entries    new kinds 'transaction_fee' and 'transaction_fee_return'
-- Needs:      0033 and 0035 (and 0036 for its constraint name). Apply them first.
-- Roll back:  drop table public.wallet_pins; alter table public.wallet_withdrawals drop column fee_kobo;
--             delete from public.wallet_entries where kind in ('fee', 'fee_return');
--             delete from public.platform_wallet_entries where kind in ('transaction_fee', 'transaction_fee_return');
--             then put the two kind checks back without the new kinds.
-- Approved:   NOT YET. Needs the founder's approval and the backend deployed together with it
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0037).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.wallet_pins (
  user_id         uuid primary key references public.users (id) on delete cascade,
  pin_hash        text not null,
  failed_attempts int not null default 0,
  locked_until    timestamptz,
  set_at          timestamptz not null default now(),
  changed_at      timestamptz not null default now()
);
alter table public.wallet_pins enable row level security;
revoke all on public.wallet_pins from anon, authenticated;
grant all on public.wallet_pins to service_role;

alter table public.wallet_withdrawals add column if not exists fee_kobo bigint not null default 0 check (fee_kobo >= 0);

alter table public.wallet_entries drop constraint if exists wallet_entries_kind_check;
alter table public.wallet_entries add constraint wallet_entries_kind_check
  check (kind in ('topup', 'transfer_in', 'transfer_out', 'order_payment', 'refund_in', 'refund_out', 'earnings_in', 'withdrawal', 'withdrawal_return', 'fee', 'fee_return'));

alter table public.platform_wallet_entries drop constraint if exists platform_wallet_entries_kind_check;
alter table public.platform_wallet_entries add constraint platform_wallet_entries_kind_check
  check (kind in ('commission', 'commission_reversed', 'withdrawal', 'withdrawal_return', 'listing_fee', 'transaction_fee', 'transaction_fee_return'));
