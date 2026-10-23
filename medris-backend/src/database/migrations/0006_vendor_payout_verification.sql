-- =============================================================================
-- 0006  vendor payout verification                              NOT YET APPLIED
-- =============================================================================
-- Why:        Before Levromart can send a vendor money (issue #98), the vendor's bank account must have been checked
--             by Paystack and saved as a transfer recipient (issue #97, epic #89). Today a bank number typed into a
--             form is trusted as it is, and there is no way to tell a checked account from an unchecked one.
-- Effect:     Adds two nullable columns to public.vendors and nothing else. Changes no row, policy or function.
--               payout_verified_at     when Paystack last confirmed the account name and the recipient was created
--                                      (null = never verified, which is every vendor today)
--               payout_account_last4   the last four digits, for showing the account without the full number
--             The existing columns are reused: bank_code, bank_name, account_number, account_name,
--             transfer_recipient_code. account_number stays (today's payout code still reads it) until payouts use
--             the verified recipient (#98); the new API never sends it back to the browser.
-- Roll back:  alter table public.vendors drop column if exists payout_verified_at, drop column if exists payout_account_last4;
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0006).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

alter table public.vendors
  add column if not exists payout_verified_at timestamptz,
  add column if not exists payout_account_last4 text;

comment on column public.vendors.payout_verified_at is 'When Paystack confirmed the payout account and the transfer recipient was created; null = not verified.';
comment on column public.vendors.payout_account_last4 is 'Last four digits of the verified payout account, for display.';
