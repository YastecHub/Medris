# Database changes waiting to be applied (0014 to 0023)

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

## How (engineer)

```bash
npm run db:status  -w medris-backend                      # shows which are pending
npm run db:migrate -w medris-backend                      # dry run
npm run db:migrate -w medris-backend -- --apply --confirm <database host>
```

Apply them in order, then deploy the backend (Heroku). Nothing else is needed: no new settings or keys.

## Why customers need their own tables

Vendors keep their payout account on their shop's row, which already exists. A customer has no shop row, and the
`users` table has nowhere to keep a bank account, a refunds balance or a withdrawal. Migration 0019 adds exactly
that (`buyer_payout_accounts`, `refund_credits`, `refund_withdrawals`). It uses the same database and the same
Paystack account as the vendors.
