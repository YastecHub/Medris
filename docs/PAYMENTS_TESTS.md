# Payment tests: how they work and how to run them

No test ever moves real money. Nothing here uses a live Paystack key.

| Layer | What | Where | When it runs |
|---|---|---|---|
| A | Every money flow end to end against a **fake Paystack** (a small local server that answers like Paystack and records every call) | `medris-backend/tests/payments-e2e/` and `tests/support/fake-paystack.ts` | every pull request, on PGlite and on PostgreSQL 17 (CI jobs "Payments end-to-end" and "Payments end-to-end (PostgreSQL 17)"); also part of `npm test` |
| B | The buyer's, vendor's and admin's screens, in a browser, with fixtures only | `medris-frontend/tests/e2e/payments.spec.ts` | every pull request (job "Frontend browser tests") |
| C | A real Paystack **test-mode** run on **staging**: pay with a test card, check, refund | `scripts/paystack-smoke.mjs`, `.github/workflows/paystack-smoke.yml` | by hand and nightly; never on pull requests; refuses live keys and production |
| D | After a deploy: backend up, payment routes mounted and refusing unsigned calls, key mode right (live in production) | `scripts/payments-health.mjs`, `.github/workflows/payments-health.yml` | by hand, after a deploy (`backend-deployed` event) and hourly |

## Run them

```
npm ci
npm run test:payments -w medris-backend            # layer A on the in-memory database (about 30 seconds)
TEST_DATABASE_URL=postgresql://... npm run test:payments:postgres -w medris-backend   # layer A on real PostgreSQL 17, with the concurrency tests
npm run test:e2e -w medris-frontend -- payments.spec.ts   # layer B (see medris-frontend/tests/e2e/README.md)
node scripts/payments-health.mjs --url https://<backend> --expect live   # layer D, safe to run any time
```
Layer C needs staging secrets (below), so it is run from GitHub Actions.

## How layer A works

The backend's own Paystack client is pointed at the fake with `PAYSTACK_BASE_URL` (unset in every real deployment, so the real
API is used) and a short `PAYSTACK_TIMEOUT_MS`, so a "Paystack never answers" fault ends in half a second. Each test seeds its
own order, drives the real HTTP routes as the buyer, vendor or admin, signs webhooks the way Paystack does (HMAC-SHA512 of the
raw body), and then checks the database and the calls the fake recorded ("exactly one transfer for this reference"). Faults:
no answer, answer lost after the work was done, 500 / 400, wrong amount, wrong currency, transfer failed or reversed,
insufficient balance. No sleeping: time passing is simulated by ageing rows in the database.

## Human steps still needed

- **Layer C:** the Paystack account holder adds these GitHub Actions secrets (Settings, Secrets and variables, Actions):
  `PAYSTACK_TEST_SECRET_KEY` (a `sk_test_` key), `STAGING_BACKEND_URL`, `SMOKE_BUYER_TOKEN`, `SMOKE_ADMIN_TOKEN`, `SMOKE_ORDER_ID`
  (a confirmed, unpaid order of the test buyer, recreated before each run). A **staging backend** (its own Heroku app with the test key and
  `PAYSTACK_CHECKOUT_ENABLED=true`) must exist; until then the workflow says the secrets are not set and skips. The hosted-checkout
  step uses Paystack's page and may need adjusting if Paystack changes it.
- **Layer D:** call the `backend-deployed` dispatch from the Heroku deploy hook (or run the workflow by hand after a deploy), and
  watch the repository so the failure email reaches you. Optionally set the repository variable `PAYMENTS_HEALTH_URL`.
- **Required checks on `main`** (GitHub: Settings, Branches): Checks, Frontend browser tests, Payments end-to-end,
  PostgreSQL 17, Payments end-to-end (PostgreSQL 17).
