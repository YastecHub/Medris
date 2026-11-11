-- Migration:  0049_wallet_tag_three_changes
-- Why:        A wallet @tag could be changed once every 30 days. People who make a typo need a second chance: up to 3 changes in 30 days.
-- Changes:    wallet_accounts.handle_window_start (first change of the current 30-day run) and handle_change_count (changes in that run).
-- Applying:   run once by the engineer on production BEFORE deploying the backend that uses it. Safe to re-run. Rollback: drop the two columns.

alter table public.wallet_accounts add column if not exists handle_window_start timestamptz;
alter table public.wallet_accounts add column if not exists handle_change_count integer not null default 0;
