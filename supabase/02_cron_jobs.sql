-- =============================================================================
-- LEVROMART  ·  DATABASE  ·  02 SCHEDULED JOBS (pg_cron, live project)
-- =============================================================================
-- Re-create with: run this file in the Supabase SQL editor (pg_cron must be enabled).
-- The functions called here are SECURITY DEFINER functions listed in supabase/README.md.

-- Service-offer expiry / reminders (every 5 minutes)
select cron.schedule('levromart-service-offer-deadlines', '*/5 * * * *', 'select public.process_service_offer_deadlines();');

-- Orders whose buyer reported a payment but the vendor never answered -> admin escalation (every 5 minutes)
select cron.schedule('levromart-payment-unresolved-escalation', '*/5 * * * *', 'select public.escalate_unresolved_payment_orders();');

-- Vendor commission reminders at 5 / 3 / 2 / 1 days and on the due day (daily 07:00 UTC)
select cron.schedule('commission-deadline-reminders', '0 7 * * *', 'select public.process_commission_deadline_reminders();');

-- Reminders to vendors and customers about orders nobody has answered:
-- every 3 minutes during the first hour, then every 30 minutes (the function decides)
select cron.schedule('remind-unattended-orders', '*/3 * * * *', 'select public.remind_unattended_orders();');

-- Not in pg_cron (runs from the app / Vercel instead):
--   /api/daily-cron       (Vercel cron, once a day)   -> listing billing reminders, old notification cleanup
--   /api/order-reminders  (GitHub Actions, optional)  -> 30-minute order reminder sweep

-- Pending orders the vendor has not confirmed within 30 minutes are cancelled automatically and both sides are notified (every minute)
select cron.schedule('auto-cancel-unconfirmed-orders', '* * * * *', 'select public.auto_cancel_unconfirmed_orders();');
