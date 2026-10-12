---
trigger: model_decision
description: Use when two things can happen at the same time or twice - double taps, retries, two devices, vendor and buyer acting together, webhooks arriving twice, cron overlapping a user action.
---

# Edge cases and concurrency

Typical Levromart races: a buyer double-taps "I've paid"; vendor confirms while the buyer cancels; two devices
accept the same offer; the 24 h auto-complete fires while the buyer raises a dispute; a Paystack webhook and the
verify call settle the same reference; stock decremented by two orders for the last item.

1. Write the rule that must always hold (e.g. "an order completes once", "commission is recorded once").
2. Write the dangerous timeline: A does X, B does Y, then...
3. Fix it in the database where possible: a unique constraint, a conditional update
   (`update ... where id = $1 and status = 'confirmed'` and check the affected row count), `select ... for update` in
   the same function, or an idempotency key. A disabled button or a JavaScript flag is never enough.
4. Remember the business functions are `security definer` SQL: the fix usually belongs in a new migration that
   replaces the function (`create or replace`), keeping its name and arguments.
5. External calls (Paystack, email) cannot be rolled back: record intent first, make the call idempotent, reconcile.

Verify with a test that runs both actions on separate database connections (`medris-backend/tests/`), not with
sleeps.
