# Paystack test run (issue #102)

A checklist for the person running the end-to-end test in Paystack **test mode**, before any real money moves.
Nothing here uses real money, real customers or real bank details. Do not paste keys, full card numbers or bank
details into screenshots, chat or the issue.

Who does what: a **tester** (founder or a developer) taps through the app; the **Paystack login holder** checks the
Paystack dashboard (test mode switch on) and creates the test keys. Write PASS or FAIL for each step. Any FAIL gets its
own bug issue, linked from #102.

## A. Before you start (an engineer does this once)

1. Merge the open Paystack pull requests, in order, then use "Sync fork" so Heroku deploys the backend. Check that the
   Vercel preview or production shows the same version.
2. Apply the database changes **0005 to 0010** to the **staging/test** database first (`docs/DATABASE.md`, section 3, one
   at a time with `--only`). Production only after the founder approves. Each file says in its header how to roll back.
   Test after each one that the app still opens.
3. On Heroku set (test values only, never the live key):
   - `PAYSTACK_SECRET_KEY` = the **test** secret key (starts `sk_test_`)
   - `PAYSTACK_CHECKOUT_ENABLED` = `true`
   - `CRON_SECRET` = any long random value (kept private)
4. In the Paystack dashboard (test mode) set the webhook URL to
   `https://<the backend address>/api/v1/payments/paystack/webhook`.
5. In Heroku Scheduler add these jobs, calling `POST /api/v1/jobs/<name>` with the header `x-cron-secret`
   (or the equivalent Scheduler command): `vendor-payouts` every minute, `paystack-refunds` every minute,
   `paystack-reconcile` every 10 minutes, `paystack-daily-check` once a day.
6. Make three **test accounts**: a buyer, a vendor (with one product, and one product on monthly billing), and an admin
   (super admin, to see the Payments screen). The vendor saves a payout account in Edit profile, Payout details, using a
   Paystack **test** bank account (see Paystack's test-payments page) and sees "Account verified".
7. Paystack's test cards and test banks: https://paystack.com/docs/payments/test-payments/

## B. The steps

For each step write down: result (PASS/FAIL), a screenshot of the app, a screenshot of the Paystack dashboard
(Transactions / Transfers / Refunds), and the reference.

| # | What to do | What you should see |
|---|---|---|
| 1 | Buyer orders from the vendor; vendor confirms; buyer taps **Pay now** and pays with a successful test card | Order shows paid (teal "Payment confirmed"); vendor is notified; dashboard shows one successful transaction with the same reference. The amount is the order amount **plus** Paystack's fee, and the order page shows the order amount only |
| 2 | Pay with a **declined** test card | Order stays unpaid with a clear message; trying again works |
| 3 | Pay with a test card that asks for an **OTP / 3-D Secure** | Completes after the OTP |
| 4 | Pay using the **bank transfer** channel (test) | Completes |
| 5 | Open the payment, then close the Paystack page without paying | "Payment not completed"; no charge in the dashboard |
| 6 | Tap **Pay now** twice quickly | Only one transaction in the dashboard |
| 7 | Pay, come back to the app and refresh while the webhook is slow. Then in the dashboard use "resend webhook" on that payment | Ends paid, once. The resend changes nothing (Admin, Payments shows one payment) |
| 8 | A **pay-after-delivery** order: pay the deposit, vendor hands over, pay the balance | Deposit confirms the order; balance after delivery completes it / starts the buyer's 24 hours |
| 9 | Buyer taps **I've received it** (completes the order) | A payout appears within a minute in Admin, Payments, then "Sent"; vendor gets "Payout sent"; vendor's Earnings shows it under "Your payouts"; dashboard Transfers shows it. Amount = order amount minus commission |
| 10 | Make a transfer fail (Paystack's test transfer-failure scenario, or temporarily give the vendor a bad test recipient) | Payout shows Failed, retries after 10 min, then 1 hour; after the third failure it is On hold and the admin was notified |
| 11 | Buyer opens a dispute before completing; admin refunds the order in Payments (Refund) | Payout is held; buyer gets "Refund started"; the refund shows in the dashboard and later "Done" when `refund.processed` arrives |
| 12 | Pay an order, refund part of it (Payments, Refund, amount), then complete it | Payout = amount paid minus the refund minus commission (check to the kobo) |
| 13 | Vendor pays the **₦999** monthly fee for a listing (needs the listing switched on, see note) and pays **commission** | Listing becomes active once; commission charges are marked paid and the shop unlocks. Paying again for an active listing is refused |
| 14 | Next day, Admin, Payments, **Daily checks** | Yesterday's check shows "All matched", or each item is explained |
| 15 | Turn `PAYSTACK_CHECKOUT_ENABLED` off | The "Pay now" choice disappears; orders already paid are unaffected |
| 16 | Cancel a paid order before the vendor hands over | A refund starts by itself (Payments, Refunds) |

Note for step 13: the app's monthly **listing** screen still asks for a manual bank transfer (OPay). Test the listing
fee through the API (`POST /api/v1/listings/product/<id>/paystack/initialize` in Swagger at `/api/v1/docs`) unless the
founder decides to switch that screen to card.

## C. Things to check on the side

- The Paystack **balance** (test) must be topped up for payouts to work; if payouts wait with "balance too low", admins
  get one alert a day.
- Admin, Payments shows the "needs attention" banner; it should be green at the end of the test.
- Nobody except admins can open Payments or call the admin endpoints (try as the buyer).
- Open a payment in two browser tabs and pay in one: the other should end paid too, not twice.

## D. Report

Post a table on #102 with: step, PASS/FAIL, reference, links to screenshots, and the bug issue for each FAIL. The test
is done when every step passes or every failure has its own issue.

## E. Known gaps to keep in mind (not bugs in the test)

- Fees assumed (1.5% + ₦100, ₦100 waived under ₦2,500, capped at ₦2,000) are **not confirmed** against Paystack's price
  page: compare with the dashboard in step 1 (issue #103).
- The buyer's Paystack fee is not refunded (Paystack does not return fees).
- Rental-deposit refunds on return and the "Refund via Paystack" button on the dispute screen are not built; use the
  Payments screen.
