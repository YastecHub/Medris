# Database changes waiting to be applied

These are written, tested and merged, but a migration only changes the live database when an engineer applies it
(`docs/DATABASE.md`, section 3). Until then the matching feature shows "being set up" or does nothing.
The Admin → Payments page shows an orange box listing exactly which of these are still missing.

| Number | What it switches on |
|---|---|
| 0014 | Paying for an order in the app marks the order as paid |
| 0015 | Out for delivery, and the 48-hour automatic receipt |
| 0016 | Replies to suggestions |
| 0017 | Vendor withdrawals and the approval queue |
| 0018 | Cancel requests for paid orders; pay-after-delivery switched off |
| 0019 | **Customers' refund bank account and refunds wallet** (new tables) |
| 0020 | Verifying a student without a matric number; who asked for a new school |
| 0021 | Admins suspending products |
| 0022 | Open orders that were "pay after delivery" become "pay in full first" |
| 0023 | Shops can change their own referral code |
| 0024 | Commission on card orders is taken from the payout only: never asked of the shop, never charged twice, no shop paused for it |
| 0025 | Points for a completed sale by size: 20 under ₦1,000, 50 from ₦1,000 to ₦5,000, 100 above ₦5,000 |
| 0026 | Points for comments: 5 points when someone else leaves a real comment on a shop's product (10 a day, same person 3 a week) |

0014 to 0023 were applied to the live database on 27 October 2026 (the founder ran them). 0024, 0025 and 0026 are the ones waiting.

## How (engineer)

```bash
npm run db:status  -w medris-backend                      # shows which are pending
npm run db:migrate -w medris-backend                      # dry run
npm run db:migrate -w medris-backend -- --apply --confirm <database host> --only 0024
```

Always name the numbers with `--only`. Without it the command applies **every** pending file, including 0001 to 0003,
which are not approved and must not be applied.

Apply them in order, then deploy the backend (Heroku). Nothing else is needed: no new settings or keys.

## Why customers need their own tables

Vendors keep their payout account on their shop's row, which already exists. A customer has no shop row, and the
`users` table has nowhere to keep a bank account, a refunds balance or a withdrawal. Migration 0019 adds exactly
that (`buyer_payout_accounts`, `refund_credits`, `refund_withdrawals`). It uses the same database and the same
Paystack account as the vendors.
