-- =============================================================================
-- 0074  The database's notification calls go to the backend on Heroku, not the old Vercel site
-- Why:        Three database functions send each new notification (push + e-mail), a call's second ring and the
--             background reminders to https://levromart.vercel.app/api/notify. Vercel was suspended on 17 Nov 2026 and
--             the site no longer runs there, so those calls failed and nobody got pushes or e-mails. The backend on
--             Heroku answers /api/notify the same way (same body, same secret header).
-- Changes:    public.notify_email_on_notification(), public.ring_callee_again(uuid), public.send_background_reminders():
--             only the address inside each function changes. The functions are rewritten from their own current
--             source in the database, so the webhook secret they carry never appears in this (public) repository.
--             Functions that do not contain the old address are left alone.
-- Roll back:  the same statement with the two addresses swapped.
-- Approved:   by the founder, 2026-11-19 (site moved to Cloudflare, backend on Heroku).
--
-- Runs in one transaction with its tracking row. Do not add BEGIN/COMMIT.
-- Once merged, never edit this file: put further changes in a new migration.
-- =============================================================================

do $$
declare
  f regprocedure;
  src text;
  old_url constant text := 'https://levromart.vercel.app/api/notify';
  new_url constant text := 'https://levromart-5212f03a7e44.herokuapp.com/api/notify';
begin
  foreach f in array array[
    to_regprocedure('public.notify_email_on_notification()'),
    to_regprocedure('public.ring_callee_again(uuid)'),
    to_regprocedure('public.send_background_reminders()')
  ] loop
    continue when f is null;
    src := pg_get_functiondef(f);
    continue when position(old_url in src) = 0;
    execute replace(src, old_url, new_url);
  end loop;
end $$;
