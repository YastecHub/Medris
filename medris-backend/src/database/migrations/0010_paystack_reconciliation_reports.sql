-- =============================================================================
-- 0010  Daily Paystack reconciliation reports (issue #101)
-- Why:        Once a day the backend compares Paystack's successful payments for the previous day with the Levromart
--             ledger and keeps the result here, so admins can see what did not match and when it was last checked.
-- Changes:    new table public.paystack_reconciliation_reports (service role only; no browser policies).
-- Roll back:  drop table if exists public.paystack_reconciliation_reports;   (only while it holds nothing you need)
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0010).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

create table if not exists public.paystack_reconciliation_reports (
  id           uuid primary key default gen_random_uuid(),
  window_start timestamptz not null,
  window_end   timestamptz not null,
  problems     integer not null default 0 check (problems >= 0),
  report       jsonb not null,
  created_at   timestamptz not null default now(),
  unique (window_start, window_end)
);
alter table public.paystack_reconciliation_reports enable row level security;
-- no policies: only the backend's service role reads or writes it
