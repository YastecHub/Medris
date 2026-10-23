-- =============================================================================
-- 0009  One open Paystack attempt per vendor fee (issue #100)
-- Why:        Levromart's own fees (the ₦999 monthly listing fee and owed commission) are now recorded in the Paystack
--             ledger like order payments. Orders already have "at most one open attempt per order and purpose"; this adds
--             the same guard for a listing fee (per listing) and for commission (per vendor), so a double tap can never
--             start two payments for the same thing.
-- Changes:    two partial unique indexes on public.paystack_transactions.
-- Roll back:  drop index if exists public.paystack_transactions_one_open_listing_fee_idx,
--                                  public.paystack_transactions_one_open_commission_idx;
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0009).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create unique index if not exists paystack_transactions_one_open_listing_fee_idx
  on public.paystack_transactions (listing_id)
  where status = 'initialized' and purpose = 'listing_fee' and listing_id is not null;

create unique index if not exists paystack_transactions_one_open_commission_idx
  on public.paystack_transactions (vendor_id)
  where status = 'initialized' and purpose = 'commission' and vendor_id is not null;
