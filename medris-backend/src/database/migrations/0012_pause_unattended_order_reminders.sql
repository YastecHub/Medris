-- =============================================================================
-- 0012  Pause the "order is still waiting" reminders
-- Why:        Every 3 minutes the database job remind_unattended_orders() adds an in-app reminder for every pending
--             order, and each one calls the Vercel notify function. This was overloading Vercel. (The push itself is
--             already switched off in api/notify.js; this stops the reminders being created at all.)
-- Changes:    removes the pg_cron job 'remind-unattended-orders'. The function itself is left in place.
-- Roll back:  select cron.schedule('remind-unattended-orders', '*/3 * * * *', 'select public.remind_unattended_orders();');
-- Approved:   NOT YET. Needs the founder's approval before it is applied to production
--             (docs/DATABASE.md section 3: npm run db:migrate -w medris-backend -- --apply --confirm <host> --only 0012).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

do $$
begin
  if to_regprocedure('cron.unschedule(text)') is not null
     and exists (select 1 from cron.job where jobname = 'remind-unattended-orders') then
    perform cron.unschedule('remind-unattended-orders');
  end if;
end $$;
