# Levromart – Build Manual

> **Code layout changed (Oct 2026):** the web app now lives in `medris-frontend/` (the old `index.html`, `assets/`, `sw.js` and static files are under `src/legacy/`, `src/service-worker/` and `public/`) and the API in `medris-backend/` (Hono + TypeScript). Paths below such as `index.html`, `api/*.js` and `lib/` refer to the old layout; see [`ARCHITECTURE.md`](ARCHITECTURE.md) for where everything is now.

> **Current manuals (7 Oct 2026):** [`LEVROMART_FRONTEND_BUILD_MANUAL.pdf`](LEVROMART_FRONTEND_BUILD_MANUAL.pdf) and [`LEVROMART_BACKEND_BUILD_MANUAL.pdf`](LEVROMART_BACKEND_BUILD_MANUAL.pdf), each with a table of contents. They replace this text file, which is kept only for history and has older numbers.


Handover guide for the Levromart marketplace PWA (Nigeria). It explains how the system is put
together, where to find things, how to run and deploy it, and what was built or changed in the latest
work sessions. Read this first, then use the **CODE MAP** comment at the top of `index.html`.

---

## 1. What Levromart is

A mobile-first marketplace where **everyone can buy** and verified **vendors can also sell** products,
services and packages (bundles). Customers browse, follow vendors, chat, call, order and pay the vendor
directly; Levromart takes a commission from vendors. Admins verify vendors, resolve disputes and manage the platform.
Roles: `buyer`, `vendor` (also a buyer), `admin`.

## 2. Architecture at a glance

```
Browser (PWA)                     Vercel (serverless)                 Supabase
index.html  ── fetch /api/* ──►  api/*.js  ── service role ──►  Postgres (RLS, RPCs, triggers, cron)
sw.js (offline + push)            Paystack, Resend (email),         Auth, Realtime, Storage
                                  Gemini (Levi), Web Push           Cloudflare R2 (public images)
```

* **Frontend** – `index.html` (HTML shell) plus `assets/css/*.css` and `assets/js/*.js` (split from the former single file; numbered in load order, `?v=` ties them to the service-worker cache version — run `tools/bump-version.sh <n>` on every deploy). Contents: the styles and the script blocks of
  plain JavaScript (no framework, no build step). A hand-written router (`navigate()`) swaps the HTML inside `#app`.
* **Backend** – 12 Vercel serverless functions in `api/` (the Vercel Hobby plan caps this at 12; related actions are
  merged into one file with an `action` field).
* **Database** – Supabase Postgres. Business rules live in SECURITY DEFINER SQL functions and triggers; the browser
  talks to tables under Row Level Security and calls RPCs. See `supabase/README.md` and `supabase/01_tables.sql`.
* **Images** – public product/avatar/logo images go to Cloudflare R2 via `api/_util.js`; private files (chat attachments,
  vendor verification documents, receipts) stay in Supabase Storage with signed URLs.
* **Realtime** – Supabase Realtime for notifications, messages and call signalling (WebRTC voice calls).
* **Push** – Web Push (VAPID). A DB trigger posts every new notification to `/api/notify`, which sends email + push.

## 3. Repository map

| Path | Purpose |
|---|---|
| `index.html` | Entire frontend (see §5) |
| `sw.js` | Service worker: shell caching, push display, notification actions (decline call), offline fallback |
| `manifest.json`, icons, `notif-icons/` | PWA manifest and notification icons |
| `api/_util.js` | Shared helpers: env, body parsing, R2 upload |
| `api/auth-otp.js` | Admin email-OTP login verification |
| `api/chat.js` | **Levi** AI assistant (Gemini) – tool-calling over the user's own data |
| `api/daily-cron.js` | Vercel cron (03:00): listing billing reminders, old notification cleanup |
| `api/delete-account.js` | Account deletion + `/api/register`, `/api/account-exists`, share-preview pages (rewrites in `vercel.json`) |
| `api/initiate-payment.js`, `verify-payment.js`, `paystack-webhook.js` | Paystack payment start / verify / webhook |
| `api/notify.js` | Email + push sender (called by the DB trigger). Also: test push, call ring-again, decline-call action |
| `api/order-notify.js`, `order-reminders.js`, `order-payout-action.js` | Order e-mails, reminder sweep, payout release/refund/cancel |
| `api/vendor-payments.js` | Vendor payments router: listing activation, commission settlement, drafts, subaccounts |
| `lib/compress-image*.{js,ts}` | Client-side image compression (`.js` is the one used; the `.ts` files are typed reference versions) |
| `supabase/` | Database documentation and exports (see its README) |
| `docs/NATIVE_CALLS_PLAN.md` | Plan for native iOS/Android call alerts (not built) |
| `.github/workflows/` | Weekly encrypted DB backup; optional 30-minute order reminder trigger |
| `vercel.json` | Rewrites, cron, function settings |

## 4. Configuration

### Vercel environment variables
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`,
`EMAIL_FROM`, `EMAIL_WEBHOOK_SECRET` (must equal the secret inside the DB trigger functions), `VAPID_PRIVATE_KEY`,
`GEMINI_API_KEY`, `CRON_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`.

### Values that live in the code (public by design)
In `index.html`, section `SUPABASE`: project URL and the publishable anon key. In `PUSH NOTIFICATIONS`: the VAPID **public**
key. Never put the service-role key, Paystack secret or webhook secret in client code.

### Database
Run the contents of `supabase/` against a fresh project, or use `supabase/export.sh` against the live one. pg_cron jobs are in
`supabase/02_cron_jobs.sql`.

## 5. Working in `index.html`

**Find a section:** every JavaScript area starts with `// ---------- NAME ----------`. The full list is in the CODE MAP comment
at the top of the file; press Ctrl+F and paste the name. CSS areas use `/* ===== NAME ===== */` or `/* ---- name ---- */`.

**Important rules**

1. *CSS later in the file wins.* The file grew by adding override blocks; many older rules use `!important`. New styling is placed in
   the **last** `<style>` region (just above the comment `/* Order history page + its search / tabs. */`) and uses new, prefixed class
   names (`vl-` listings, `vd-` vendors directory, `od-` order details, `sr-` search rows, `cart-`, `vh-` seller hub, `msg-`, `earn-`).
2. *Do not change an element's `id` or `data-*` hooks* without searching for them – some JS finds elements by id.
3. *Everything dynamic comes from Supabase.* Never hard-code counts or names.
4. After editing, syntax-check every script block (see §9) before deploying.
5. A `<style>` block sits before `<!DOCTYPE html>` (line 1). It works today; moving it into `<head>` is a recommended future
   clean-up but must be visually re-tested because it changes the page's rendering mode.

### Where to find the main screens

| Screen | Search for |
|---|---|
| Router / navigation | `// ---------- NAVIGATION ----------`, `async function navigate(` |
| Home (trending, featured vendors, Browse everything) | `// ---------- HOME (marketplace browse)`, `BROWSE EVERYTHING DATA` |
| Category rail & carousel on Home | `HOMEPAGE PROMOTIONAL CAROUSEL`, `AUTO-SLIDING CAROUSELS` |
| Search page | `DEDICATED SEARCH PAGE`, `function searchProductRowHtml` |
| Vendors page and cards | `VENDORS DIRECTORY`, `function vendorDirectoryCardHtml` |
| Storefront (public vendor page) | `STOREFRONT (public vendor page)` |
| Product / package detail | `PRODUCT DETAIL`, `PACKAGE DETAIL` |
| Cart & checkout | `CART (buy-and-sale items`, `function openClearCartSheet` |
| Orders list / history | `VENDOR / BUYER ORDERS`, `ORDER HISTORY PAGE` |
| Order details (customer / vendor) | `CUSTOMER ORDER DETAILS`, `VENDOR ORDER DETAILS`, `async function renderOrderDetail` |
| Messages inbox, chat, call log rows | `IN-APP MESSAGING`, `CHAT SNAPSHOTS`, `CALL LOG ROWS IN THE CHAT`, `function msgSelectionHeaderHtml` |
| Voice calls (WebRTC overlay) | `levroCallOverlay`, `async function endCall` |
| Vendor profile / seller hub | `VENDOR DASHBOARD` |
| My Listings | `MY LISTINGS (vendor catalogue page)`, `async function renderVendorProducts` |
| Earnings | `VENDOR: EARNINGS` |
| Vendor application & profile edit | `VENDOR APPLICATION`, `VENDOR: EDIT PROFILE` |
| Notifications | `NOTIFICATIONS (real, persisted, realtime)` |
| Settings | `DEDICATED LEVROMART SETTINGS PAGE` |
| Admin | `// ---------- ADMIN`, `ADMIN: MANAGE ADMINS` |
| Levi AI chat | `FLOATING AI CHAT`, `LEVI VOICE` |
| First-visit tour | `FIRST-VISIT APP TOUR` |
| Legal pages | `LEGAL PAGES` |
| Theme / toasts / dialogs | `THEME`, `TOASTS + CONFIRM DIALOG` |
| Review pop-up after an order completes | `levromart-review-prompt` script, `window.maybePromptLevromartReview` |

## 6. Key behaviours (how things work)

* **Orders** – statuses: `pending → confirmed → handed_over → (returned) → completed`, plus `cancelled`, `disputed`,
  `payment_unresolved`. Status changes go through `transition_order_status`. Customers stay anonymous to the vendor until the
  vendor accepts; vendors never see phone numbers. Payments are made directly to the vendor and *reported* by the buyer;
  the vendor confirms or disputes; unresolved ones escalate to admin after a timer (cron).
* **Commission** – charged to the vendor on completed orders; 7-day window; reminders at 5/3/2/1 days and on the due day; an overdue
  balance pauses the storefront.
* **Chats** – never deleted. They close (hidden) 24 h after an order completes and re-open on the next order.
  The chat view merges `voice_calls` into the thread as call-log rows (outgoing/incoming with duration, missed, declined).
* **Calls** – WebRTC audio, Realtime broadcast signalling, push when the app is closed (`api/notify.js`). Android may hold pushes
  back because of battery optimisation (Settings has a test alert and help text).
* **Reviews** – one per completed order. A pop-up asks for the star rating as soon as an order completes (and at next app
  open, snoozed 12 h up to 3 times).
* **Search** – RPC `search_products_full_v2` (products + services), `vendors` and `vendor_packages` queries; debounced, aborts stale
  requests, caches results for 60 s.
* **Browse index** – a light catalogue index is cached, with infinite scroll in 24-item pages and a deterministic 10-minute rotation.

## 7. Performance and egress (Supabase bandwidth)

Measures in place: cached order/notification/chat/conversation snapshots, order badge counts cached 15 s, notification owner
lookups cached per session, follower counts served from memory for 10 min, notification refresh coalescing, light browse index,
lazy images, IntersectionObserver for infinite scroll. When egress rises, check the busiest endpoints in the Supabase log explorer and
whether old app versions are still open on test devices. A spend cap (Supabase → Billing) is the only hard stop.

## 8. Deploying

1. Push to `main`; Vercel builds automatically (no build step). 2. After deploy, reload devices (the service worker updates).
3. Apply any new SQL to **both** Supabase projects. 4. For a new Vercel project set the variables in §4 and add the
Paystack webhook URL `https://<domain>/api/paystack-webhook`.

## 9. Testing and checks

* Syntax: extract each inline `<script>` from `index.html` and run `node --check` (all blocks must pass). Backend: `node --check api/*.js`.
* Visual / functional smoke tests were run with Playwright in a mobile viewport against a stubbed `window.supabase`; keep this approach
  for regressions (render a page function with fake rows, assert no console errors, no horizontal overflow).
* Lint (backend): ESLint `no-unused-vars` / `no-undef`.

## 10. What was built in the latest sessions (changelog)

**Customer experience** – auto-advancing centred carousel; real-category rail with live category filtering; infinite scroll
browse; All/Products/Vendors/Services/Packages search; order-history page; redesigned **Order Details** (status card, tracker,
real items, summary, delivery, vendor card); in-app **View on Map**; review pop-up per completed order; **Cart** redesign with a
Clear Cart confirmation sheet and live total; **Messages** inbox redesign; call-log rows in chats; vendor cards (compact on Home,
two-column on Vendors) with working Follow and WhatsApp-style tinted initials; search results as compact rows with cart button.

**Vendor experience** – redesigned **vendor Order Details** (Confirm/Decline up top, privacy-aware customer card);
**My Listings** (tabs with counts, search, filter, sort, horizontal cards with views/orders, Edit/View/Delete, ⋮ menu,
discarded-items notice); **seller hub** on the profile page; **Earnings** with sales totals and charts per period; Settings
button on the profile; commission card and reminders; order reminders every 3 minutes.

**Platform** – Android push diagnostics; ring-again push for calls; caller photo/shop name on calls; chat instant-open snapshots;
legal text/version 2026-10-02; tour that glides without flicker and resets the bottom bar; egress reductions (§7); profile pages
keep their scroll position.

**Code clean-up (handover)** – removed ~40 unused functions and dead blocks, trailing whitespace, unused backend helpers;
added the CODE MAP and section banners; database documented in `supabase/`.

## 11. Known limits / suggestions for the next developer

* The frontend is a single large file with layered CSS overrides. The safest long-term direction is to split it into modules
  (router, pages, CSS) and remove superseded CSS blocks page by page with visual tests.
* Native iOS/Android shell (reliable closed-app call alerts) is planned in `docs/NATIVE_CALLS_PLAN.md` but not built.
* Packages have no "duplicate" action; services have no bookings counter.
* Keep the standby Supabase project in step by applying every migration to both.
* `search_products_full` (old) is still in the database next to `_v2`; it can be dropped once all clients are updated.

## 12. Quick recipes

* *Change the Trending Now section*: search `Trending now` in the HOME section.
* *Add a field to vendor cards*: edit `vendorDirectoryCardHtml`; style it in the `vd-` CSS block.
* *Add a notification type*: write a SQL trigger that inserts into `notifications`; add the icon rule in `api/notify.js` (`pickNotificationIcon`).
* *New RPC*: create it SECURITY DEFINER with an `auth.uid()` check, grant execute to `authenticated`, call with `sb.rpc(...)`.
* *Change terms / privacy text*: `LEGAL PAGES`; bump the version string in `accept_legal_terms` / `get_legal_terms_consent` to force re-acceptance.
