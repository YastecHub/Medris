-- =============================================================================
-- 0032  Clear the commission owed by "Joyful snacks and beverages"
-- Why:        The founder asked for the ₦130.50 commission owed by this one shop (41 days overdue) to be cleared. The app has no
--             "forgive commission" button, so this is done as a one-off data change.
-- Changes:    commission_charges rows of that shop that are still 'owed' become 'waived' (the status the app already understands:
--             a waived charge is not counted as owed). If the shop was locked only because of overdue commission, the lock is lifted.
--             Only a shop whose business name is exactly "Joyful snacks and beverages" (any capitals) is touched, and nothing
--             happens if there is not exactly one such shop.
-- Roll back:  update public.commission_charges set status = 'owed'
--               where status = 'waived' and paid_at is null
--                 and vendor_id = (select id from public.vendors where lower(business_name) = 'joyful snacks and beverages');
-- Approved:   by the founder in the chat on 2026-11-02 (apply: docs/DATABASE.md section 3, --only 0032). Review the amount first:
--             select sum(amount) from public.commission_charges where status = 'owed' and vendor_id = (<the shop's id>).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

do $$
declare vid uuid; n int;
begin
  select count(*) into n from public.vendors where lower(business_name) = 'joyful snacks and beverages' and deleted_at is null;
  if n <> 1 then
    raise notice 'Skipped: found % shops named "Joyful snacks and beverages" (expected exactly 1).', n;
    return;
  end if;
  select id into vid from public.vendors where lower(business_name) = 'joyful snacks and beverages' and deleted_at is null;

  update public.commission_charges set status = 'waived' where vendor_id = vid and status = 'owed';
  get diagnostics n = row_count;
  raise notice 'Waived % commission charge(s) for the shop.', n;

  update public.vendors
     set commission_paused = false, commission_pause_reason = null
   where id = vid and commission_paused = true and coalesce(commission_pause_reason, '') like 'commission%';
end $$;
