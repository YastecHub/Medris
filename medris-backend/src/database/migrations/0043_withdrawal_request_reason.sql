-- The words a shop writes when it asks to move earnings that are less than 24 hours old (an admin reads them before deciding).
-- The app keeps working without this column: the reason is simply not stored until the migration is applied.
alter table public.withdrawal_requests add column if not exists request_reason text;
