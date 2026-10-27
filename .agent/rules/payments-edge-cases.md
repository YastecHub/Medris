---
trigger: model_decision
description: Use when money is involved - orders and payment reporting/confirmation, Paystack (initiate/verify/webhook), commission and monthly listing billing, payouts, refunds, disputes.
---

# Payments and money flows

## How money moves in Levromart

- **Direct transfer (most orders):** the buyer pays the vendor outside the app and taps "I've paid"
  (`buyer_report_manual_payment`); the vendor confirms or disputes (`vendor_confirm_reported_payment`,
  `vendor_dispute_reported_payment`); admins can confirm/reject; unanswered reports escalate by cron
  (`escalate_unresolved_payment_orders`). Pay-after-delivery orders have a deposit (`delivery_deposit_20`, percentage
  in `payment_deposit_percent`) and a balance.
- **Completion:** after the final payment is confirmed the buyer confirms receipt or it auto-completes after 24 h
  (`auto_complete_eligible_orders`); completion records commission (`commission_charges`).
- **Paystack** is used for ₦999 listing fees, commission settlement and older card orders: `api/vendor-payments.js`,
  payouts in `api/order-payout-action.js`. Every Paystack payment is settled by the backend's `PaystackWebhookService`;
  `api/verify-payment.js` and `api/paystack-webhook.js` only pass requests on to it (never add settling code there).
- Amounts are `numeric` naira in the database; Paystack works in kobo - convert only at the Paystack call.

## Rules

1. The browser never decides amounts or payment status. Totals, fees and status changes happen in database functions
   or server code; a redirect back from Paystack is not proof of payment - verify with Paystack's API.
2. Every webhook: verify the `x-paystack-signature` HMAC over the raw body before using it; handle duplicate and
   out-of-order deliveries; settling the same reference twice must not credit twice.
3. A timeout is an unknown outcome, not a failure: look the transaction up before retrying; never create a second
   charge for the same intent.
4. Refunds, disputes and cancellations are separate, idempotent operations; respect what was actually paid.
5. Only Paystack **test** keys and test cards when trying anything; never real money, never real customer data in
   tests or screenshots.
6. Any change here gets a pull-request section "Money impact" describing the before/after flow and the duplicate /
   lost-payment cases you checked.

## Review checklist (answer each: handled / gap / not checked / N/A, with file:line)

Duplicate initiation · duplicate or reordered webhooks · timeout with unknown outcome · amount/currency checked
against Paystack · signature verification · refund vs dispute · concurrent confirmations of the same order ·
commission recorded exactly once · payout/transfer identity and failure recovery · client retry storms ·
sensitive data in logs or responses · reconciliation when a webhook never arrives.
