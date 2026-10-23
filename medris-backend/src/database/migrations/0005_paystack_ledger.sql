-- =============================================================================
-- 0005  paystack ledger                                          NOT YET APPLIED
-- =============================================================================
-- Why:        Every Paystack money movement must be traceable and impossible to apply twice, even when Paystack
--             sends the same event several times or out of order (issue #93, epic #89). Today only `payments`
--             records anything, and a payout's transfer reference changes on every try (docs/PAYSTACK.md).
-- Effect:     Adds four EMPTY tables and nothing else. Changes no existing table, row, policy or function.
--               paystack_transactions  one row per payment attempt (unique reference; at most one open attempt
--                                      per order and purpose)
--               paystack_events        one row per webhook event received (unique key), so a repeat is harmless
--               vendor_payouts         one row per payout to a vendor (unique per order, unique transfer reference)
--               paystack_refunds       one row per refund attempt (unique per order and attempt number)
--             Row-level security is on for all four. Buyers read their own transactions, vendors their own payouts,
--             admins everything. The browser roles (anon, authenticated) can only SELECT, and only what a policy
--             allows; every write goes through the backend's service role. `listing_id` has no foreign key because
--             a listing is either a product or a package (listing_kind says which).
-- Roll back:  drop table if exists public.paystack_refunds, public.vendor_payouts, public.paystack_events,
--               public.paystack_transactions;      (only while empty; once real money is recorded, keep the tables)
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0005).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

-- ---------------------------------------------------------------- transactions
create table if not exists public.paystack_transactions (
  id                      uuid primary key default gen_random_uuid(),
  reference               text not null unique,
  purpose                 text not null check (purpose in ('order_payment', 'order_balance', 'listing_fee', 'commission')),
  order_id                uuid references public.orders (id) on delete restrict,
  vendor_id               uuid references public.vendors (id) on delete restrict,
  listing_id              uuid,
  listing_kind            text check (listing_kind in ('product', 'package')),
  payer_user_id           uuid references public.users (id) on delete restrict,
  amount_kobo             bigint not null check (amount_kobo > 0),
  currency                text not null default 'NGN' check (currency = 'NGN'),
  status                  text not null default 'initialized'
                            check (status in ('initialized', 'success', 'failed', 'abandoned', 'refunded', 'partially_refunded')),
  paystack_transaction_id bigint,
  channel                 text,
  paid_at                 timestamptz,
  raw_last_event          jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (listing_id is null or listing_kind is not null)
);

-- at most one open attempt per order and purpose
create unique index if not exists paystack_transactions_one_open_per_order_idx
  on public.paystack_transactions (order_id, purpose)
  where status = 'initialized' and order_id is not null;
create index if not exists paystack_transactions_order_idx on public.paystack_transactions (order_id);
create index if not exists paystack_transactions_payer_idx on public.paystack_transactions (payer_user_id);
create index if not exists paystack_transactions_open_idx on public.paystack_transactions (created_at) where status = 'initialized';

-- ---------------------------------------------------------------------- events
create table if not exists public.paystack_events (
  id           uuid primary key default gen_random_uuid(),
  event_key    text not null unique,          -- Paystack's event id, or a hash of the payload
  event        text not null,
  reference    text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  result       text,
  error        text
);
create index if not exists paystack_events_reference_idx on public.paystack_events (reference);
create index if not exists paystack_events_unprocessed_idx on public.paystack_events (received_at) where processed_at is null;

-- --------------------------------------------------------------------- payouts
create table if not exists public.vendor_payouts (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete restrict,
  payout_purpose     text not null default 'order',
  vendor_id          uuid not null references public.vendors (id) on delete restrict,
  amount_kobo        bigint not null check (amount_kobo >= 0),
  commission_kobo    bigint not null default 0 check (commission_kobo >= 0),
  fees_kobo          bigint not null default 0 check (fees_kobo >= 0),
  recipient_code     text,
  transfer_reference text not null unique,
  status             text not null default 'pending'
                       check (status in ('pending', 'processing', 'success', 'failed', 'reversed', 'on_hold')),
  hold_reason        text,
  attempts           integer not null default 0 check (attempts >= 0),
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (order_id, payout_purpose)
);
create index if not exists vendor_payouts_vendor_idx on public.vendor_payouts (vendor_id);
create index if not exists vendor_payouts_work_idx on public.vendor_payouts (status, updated_at) where status in ('pending', 'processing');

-- --------------------------------------------------------------------- refunds
create table if not exists public.paystack_refunds (
  id                    uuid primary key default gen_random_uuid(),
  transaction_reference text not null references public.paystack_transactions (reference) on delete restrict,
  order_id              uuid not null references public.orders (id) on delete restrict,
  attempt               integer not null default 1 check (attempt >= 1),
  amount_kobo           bigint not null check (amount_kobo > 0),
  reason                text,
  requested_by          uuid references public.users (id) on delete set null,
  status                text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  paystack_refund_id    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (order_id, attempt)
);
create index if not exists paystack_refunds_reference_idx on public.paystack_refunds (transaction_reference);

-- ------------------------------------------------------------------ updated_at
do $$
declare t text;
begin
  foreach t in array array['paystack_transactions', 'vendor_payouts', 'paystack_refunds'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at_timestamp()', t, t);
  end loop;
end $$;

-- ------------------------------------------------------------------------ RLS
alter table public.paystack_transactions enable row level security;
alter table public.paystack_events       enable row level security;
alter table public.vendor_payouts        enable row level security;
alter table public.paystack_refunds      enable row level security;

drop policy if exists paystack_transactions_select_own_or_admin on public.paystack_transactions;
create policy paystack_transactions_select_own_or_admin on public.paystack_transactions
  for select using (payer_user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists paystack_events_select_admin on public.paystack_events;
create policy paystack_events_select_admin on public.paystack_events
  for select using ((select public.is_admin()));

drop policy if exists vendor_payouts_select_owner_or_admin on public.vendor_payouts;
create policy vendor_payouts_select_owner_or_admin on public.vendor_payouts
  for select using (public.owns_vendor(vendor_id) or (select public.is_admin()));

drop policy if exists paystack_refunds_select_party_or_admin on public.paystack_refunds;
create policy paystack_refunds_select_party_or_admin on public.paystack_refunds
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = paystack_refunds.order_id
        and (o.buyer_id = (select auth.uid()) or public.owns_vendor(o.vendor_id) or (select public.is_admin()))
    )
  );

-- ---------------------------------------------------------------------- grants
revoke all on public.paystack_transactions, public.paystack_events, public.vendor_payouts, public.paystack_refunds from anon, authenticated;
grant select on public.paystack_transactions, public.paystack_events, public.vendor_payouts, public.paystack_refunds to authenticated;
grant select, insert, update, delete on public.paystack_transactions, public.paystack_events, public.vendor_payouts, public.paystack_refunds to service_role;

comment on table public.paystack_transactions is 'One row per Paystack payment attempt. Written only by the backend (service role).';
comment on table public.paystack_events is 'One row per Paystack webhook event received; the unique event_key makes a repeat harmless.';
comment on table public.vendor_payouts is 'One payout per order and purpose; transfer_reference is stable so a retry can never send twice.';
comment on table public.paystack_refunds is 'One row per refund attempt; unique per order and attempt number.';
