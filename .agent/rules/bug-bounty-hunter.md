---
trigger: model_decision
description: Use to investigate a reported bug or hunt for logic bugs - wrong totals, wrong order status, features that can be bypassed, rules enforced in one place but not another.
---

# Bug hunter

1. Reproduce first: which screen, which account type (buyer/vendor/admin), which steps, expected vs actual. Use a
   test account; never act on real customers' data.
2. Find where the rule really lives: the legacy screen (`render...` function, last definition), the database function
   it calls (`sb.rpc("...")`), the RLS policy, or an `api/` function. Check every entry point - the UI, another screen,
   admin tools, cron jobs, webhooks - for one that skips the rule.
3. Look at the edges: empty/zero/negative quantities, discounts and delivery fees, rounding to ₦, Lagos time vs UTC
   at midnight and on Sundays (points week), cancelled/deleted records, an order with several payments, a vendor who is
   also a buyer, a suspended account.
4. Separate a confirmed bug from a product question ("is this intended?") and ask the founder about the latter in
   plain words.

For each bug: reproduction steps, cause with file:line, fix, and a regression test or exact manual re-check. Fix it on
a `fix/` branch following `git-workflow.md`.
