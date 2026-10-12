---
trigger: model_decision
description: Use for scheduled or background work - pg_cron jobs, the daily Vercel cron, reminders, auto-complete, notification/push sending, database triggers calling /api/notify.
---

# Background jobs

What runs on its own today:

- **pg_cron in the database:** service-offer deadlines and payment escalation (every 5 min), commission reminders
  (07:00 UTC), unattended-order reminders (every 3 min), points week finalisation (Sun 23:05), points reconcile (every
  10 min), background push reminders (every minute), auto-complete orders (every 10 min).
- **Vercel cron:** `/api/daily-cron` at 03:00 UTC (listing billing reminders, deleting read notifications older than
  60 days). Protected by `CRON_SECRET`.
- **Database -> outside world:** the `notifications` trigger and a few functions call `/api/notify` with `pg_net` and
  a shared webhook secret (currently written inside three database functions).
- **GitHub Actions:** weekly database backup; optional order-reminder trigger.

Rules: every job must be safe to run twice (use existing de-duplication tables such as
`commission_deadline_reminders`, `listing_billing_reminders`), bounded in batch size and time, and must recheck
eligibility at run time. Changing a cron schedule or job is a database migration (`database-specialist.md`). Never
trigger jobs against production to "test" them.

Report for each step: what happens if it crashes there, if it runs twice, and if it never runs.
