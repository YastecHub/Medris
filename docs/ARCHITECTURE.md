# Architecture (after the frontend/backend restructure)

> **Independent backend (Oct 2026):** the backend now owns its data access (PostgreSQL through Drizzle, no Supabase
> REST calls), verifies tokens itself and serves a new `/api/v1`; the frontend reaches it through the `levroData`
> gateway. Details: [BACKEND.md](BACKEND.md), [DATABASE.md](DATABASE.md), [AUTH.md](AUTH.md),
> [STORAGE.md](STORAGE.md), [DEPLOYMENT.md](DEPLOYMENT.md), [SUPABASE_AUDIT.md](SUPABASE_AUDIT.md). The sections
> below describe the restructure that preceded it and remain accurate except where they point to those documents.

Based on commit `42c4105`. This replaces the "shell `index.html` + `assets/` + 13 files in `api/`" layout described in
`BUILD_MANUAL.md`. The product, its look and its behaviour are unchanged; only where the code lives and how it is
built changed (plus one bug fix, listed below).

```
medris/
├── api/*.js                      the original 12 Vercel functions, restored as before the restructure (CommonJS)
├── vercel.json                   frontend-only build + output, the original rewrites, daily cron
├── package.json                  npm workspaces + root scripts
├── eslint.config.mjs
├── medris-frontend/
│   ├── index.html                minimal Vite template (React entry only)
│   ├── build/legacy-document.ts  Vite plugin: assembles the legacy document, /assets files and /sw.js
│   ├── scripts/                  version bump, legacy syntax check, regression baseline
│   ├── public/                   served as-is at the site root: icons, manifest.json, notif-icons, campus-logos,
│   │                             campuses.json, fonts, og-*.png, social-*, lib/compress-image.js
│   ├── src/
│   │   ├── main.tsx              React entry (mounts into #medris-root)
│   │   ├── app/                  App component, window.medris runtime
│   │   ├── config/env.ts         typed public config (VITE_*)
│   │   ├── services/api/         typed API clients: original endpoints (client/endpoints) and /api/v1 (v1-*)
│   │   ├── services/backend-features.ts  which features go through /api/v1 (VITE_BACKEND_FEATURES)
│   │   ├── bridge/data-gateway.ts  window.levroData: the legacy code's data gateway (inlined as a classic script)
│   │   ├── lib/legacy-runtime.ts typed access to the legacy Supabase client/session
│   │   ├── types/
│   │   ├── assets/inline/        images the legacy markup/code embeds as data: URIs
│   │   ├── service-worker/sw.js  source of /sw.js
│   │   └── legacy/               the existing app, split into ordered source files
│   │       ├── document.json     manifest: document pieces in order, /assets outputs, assetVersion
│   │       ├── markup/           HTML fragments of index.html (head, splash, header, modals, onboarding…)
│   │       ├── styles/           inline <style> block(s) of index.html
│   │       ├── scripts/          inline <script> blocks of index.html
│   │       └── assets/           sources of /assets/css/*.css and /assets/js/*.js
│   │           └── js/01-app/    the main runtime (01-app.js) split into 88 files at its section banners
│   └── tests/                    legacy regression + API client tests
├── medris-backend/               full layout and conventions: docs/BACKEND.md
│   ├── src/
│   │   ├── app.ts                builds the Express app: /api/v1, the original /api routes, link previews
│   │   ├── server.ts             Node server (config validation, JSON logs, graceful shutdown)
│   │   ├── vercel.ts             Vercel handler
│   │   ├── container.ts          the services every request gets (config, logger, database, auth)
│   │   ├── config/               validated configuration, database/CORS settings, static-file lookup
│   │   ├── database/             Drizzle client, DataContext (RLS identity), schema, repositories, migrations
│   │   ├── contracts/            request/response types shared with the frontend (api.ts, v1.ts)
│   │   ├── integrations/         Paystack, Resend, Web Push, Gemini, R2, Supabase Auth admin, storage adapters
│   │   ├── middleware/           request context, auth/roles/CSRF, rate limits, cron/webhook secrets
│   │   ├── routes/               v1.ts, legacy.ts, docs.ts (Swagger UI at /api/v1/docs)
│   │   ├── shared/, lib/, types/
│   │   └── modules/              one folder per area: controller (HTTP) -> service (rules) -> repository (SQL),
│   │                             plus routes (OpenAPI contract) and schemas (Zod)
│   │       ├── auth/ users/ catalogue/ cart/ favorites/ follows/ notifications/ health/   (/api/v1)
│   │       ├── accounts/         register, account-exists, ensure-profile, delete, link previews, TURN
│   │       ├── share-images/     share cards (1200x630) and notification pictures (256x256)
│   │       ├── auth-otp/         admin login codes, set password
│   │       ├── levi/             AI assistant: prompt, tool declarations, tools, service
│   │       ├── payments/         Paystack initiate/verify/webhook, settlement, payouts/refunds
│   │       ├── vendor-payments/  subaccounts, commission, monthly billing, ₦999 listings, R2 uploads
│   │       ├── orders/           payout actions, 30-minute reminders, order-notify
│   │       ├── notify/           notification → e-mail + push, call decline, test push
│   │       └── cron/             daily job
│   └── tests/                    v1/ + legacy/ tests on a disposable PostgreSQL (PGlite or TEST_DATABASE_URL)
├── scripts/                      supabase-audit.mjs (dependency scan), check-deploy-env.mjs (production build guard)
├── docker-compose.yml            local PostgreSQL for development and tests
├── supabase/                     database docs, history SQL from before the migration process, export script
├── docs/                         manuals (the PDFs are the database/feature reference)
└── .github/workflows/            weekly DB backup, optional order-reminder trigger (unchanged)
```

## Frontend

### Why the legacy code is assembled, not bundled

The current app is classic scripts and stylesheets shared through globals. It depends on things a bundler would
change:

- **Load order.** Scripts run while the page parses and share globals (`sb`, `session`, `navigate`, …); later CSS
  rules and later function definitions win.
- **Quirks rendering mode.** A stylesheet `<link>` precedes `<!DOCTYPE html>`, so browsers render in quirks mode.
  Moving it changes layout.
- **Inline `onclick="…"` handlers** calling global functions, and **URLs** (`/assets/js/…?v=119`, `/sw.js`) that
  the service worker and installed apps already know.

So `build/legacy-document.ts` re-emits everything unchanged: the document from the ordered pieces in
`src/legacy/document.json`, each `/assets/css|js/*` file at its old URL (`01-app.js` concatenated from
`src/legacy/assets/js/01-app/`), and `/sw.js`. The output is **byte-for-byte the files of `42c4105`**; `index.html`
additionally gets the React module script before `</head>` and `<div id="medris-root"></div>` at the end.
`tests/legacy-document.test.ts` checks every file against recorded SHA-256 hashes (`tests/legacy-baseline.json`).

Placeholders resolved while assembling:

| Placeholder | Source |
|---|---|
| `{{env:VITE_SUPABASE_URL}}`, `{{env:VITE_SUPABASE_ANON_KEY}}`, `{{env:VITE_VAPID_PUBLIC_KEY}}` | `medris-frontend/.env` (public values) |
| `{{asset-version}}` | `assetVersion` in `document.json` (the `?v=` cache-buster and the service-worker shell cache name) |
| `{{inline-asset:<file>}}` | `src/assets/inline/<file>`, embedded as a `data:` URI, as before |

If `VITE_API_BASE_URL` is set (API on another origin), a 3-line script is added right after `<head>` that prefixes the
legacy `fetch("/api/…")` calls. Left empty (production), nothing is added. The service worker's call-decline request
stays same-origin.

### Editing legacy code

- Find a screen in `src/legacy/assets/js/01-app/` (files are named after the `// ---------- NAME ----------`
  banners, e.g. `54-product-detail.js`) or the later patch files `02-…js` to `14-motion.js`. The old rules still
  apply: the **last** definition of a function wins, and new CSS goes at the end of the cascade with a prefixed class.
- After editing: `npm run legacy:check -w medris-frontend`, look at the screen in light and dark mode, then
  `npm run bump-version -w medris-frontend -- <n>` so phones fetch the new files.
- The baseline test fails after any legacy edit. That is intended: once checked, run
  `npm run legacy:rebaseline -w medris-frontend` and commit the new baseline with the change.

### Migrating a screen to React

1. Build the component under `src/features/<area>/` (or `src/pages/`), reusing the existing CSS classes so it looks
   identical. Read data through the backend with `v1.*` from `src/services/api/v1-endpoints.ts` (add an endpoint if
   needed, see BACKEND.md §7); only where no endpoint exists yet use `getLegacySupabase()` (never a second client).
2. Mount it from the legacy router for that view (the view's `renderX` returns an empty container that an exported
   `mountX(el)` fills with `createRoot`), and delete the legacy renderer once the React one is live.
3. Compare before/after screenshots (430×900 and desktop, light and dark) the way this refactor was checked, then
   rebaseline.

No screen has been migrated yet: React currently renders nothing visible and publishes `window.medris`
(`config`, `api`, `v1`).

### Frontend ↔ backend

```text
legacy call site ──► window.levroData.<area>.<method>()           (src/bridge/data-gateway.ts, inline classic script)
                       │ feature on  ──► v1 client ──HTTPS──► /api/v1 ──► backend ──► PostgreSQL (RLS as the user)
                       │ feature off ──► the exact Supabase query the call site used before
React component ───► v1.<area>.<method>()  (typed with @medris/contracts)
```

- `levroData` returns the `{ data, error, count }` shape supabase-js returned, so each call site changed by one line.
- Features (`catalogue`, `cart`, `favorites`, `follows`, `notifications`, `rpc`) are switched by `VITE_BACKEND_FEATURES`
  at build time, or per browser with `levroData.useBackend("…")`. Default: all when the build knows the backend's
  address (production: the Heroku app), else none.
- `rpc`: `sb.rpc(name, args)` is wrapped once (`src/bridge/rpc-shim.ts`) and sends the 153 functions the backend
  answers to `POST /api/v1/rpc/{name}`, which returns what the original returned.
- The client sends `Authorization: Bearer <Supabase access token>`; errors come back as `{ message, code, status }`.
- Reads and idempotent writes fall back to Supabase when the backend is unreachable; other writes only when the
  request never left the browser, so nothing runs twice.
- Still direct to Supabase from the browser: sign-in/session (Auth), Realtime channels, Storage uploads/signed URLs,
  and the call sites not yet moved (SUPABASE_AUDIT.md).

## Backend

- Every previous URL is served with the same request/response shapes: `/api/auth-otp`, `/api/chat`,
  `/api/daily-cron`, `/api/delete-account` (+ `/api/register`, `/api/account-exists`, `/api/turn`,
  `/api/notif-icon`), `/api/initiate-payment`, `/api/verify-payment`, `/api/paystack-webhook`, `/api/notify`,
  `/api/order-notify`, `/api/order-payout-action`, `/api/order-reminders`, `/api/vendor-payments`
  (+ `/api/listing-payments`), link previews for `/?storefront=|product=|package=` and `/s/`, `/p/`, `/k/`, and share
  cards (`?ogstore=|ogprod=|ogpkg=`). The routes answer both the rewritten URL (`/api/delete-account?turn=1`) and
  the original one (`/api/turn`), so they behave the same whichever URL Vercel hands the function.
- Routes parse the request and call a module service; services return `{ status, body }`; integrations wrap
  third-party HTTP APIs. The user's access token in the JSON body is verified by the backend (AUTH.md); database
  access goes through repositories inside `DataContext` - as the user where the old code used the user's token (RLS and
  `auth.uid()` still apply), as `service_role` only after the code has authorised the caller (BACKEND.md).
- Secrets come only from the environment (`medris-backend/.env.example`); the browser never receives them.
- CORS: production is same-origin, so no CORS headers are sent. `CORS_ALLOWED_ORIGINS` allows a separately hosted
  frontend.
- Static files the API needs (built `index.html`, fonts, `og-frame.png`, icons) are read from
  `medris-frontend/dist` (bundled into `api/delete-account.js` by `includeFiles`), or `STATIC_ASSETS_DIR`.

### Behaviour changes (intentional)

| Change | Why |
|---|---|
| `/api/delete-account` with `action: "ensure-profile"` now re-creates a missing profile row (as a buyer) instead of deleting the account; unknown actions get 400. Deletion still happens for a request with no action (the Delete account screen) or `action: "delete"`. | The old router sent every unrecognised action, including the app's own `ensure-profile` request (made on every app open when the profile lookup comes back empty, e.g. on a network blip), to account deletion. |
| `POST /api/turn` returns 405 (GET unchanged). | Via the old rewrite it reached the account-deletion handler. |
| Paystack webhook signature compared in constant time; admin OTP codes from `crypto.randomInt`. | Same results, safer implementation. |
| Unknown `/api/*` paths return JSON 404. | Previously Vercel's HTML 404. |

## Validation done for the independent backend (Oct 2026)

- Backend: 121 tests on PGlite, and the same suite on PostgreSQL 16 (`TEST_DATABASE_URL`): RLS identity context,
  least-privilege role, every /api/v1 endpoint (validation, authorisation, errors, rate limits), backend sessions and
  Google sign-in, and every original endpoint end to end against the database (payments, payouts, listings, billing,
  notify, cron, reminders, admin OTP, accounts, link previews, every Levi query).
- Frontend: gateway tests assert that with features off each method runs the identical Supabase query chain; with
  features on, the shipped gateway was run against the real backend server and PostgreSQL (cart, favourites,
  follows, notifications, catalogue, refusals, bad tokens).
- Screens: 15 scenarios pixel-identical to the pre-change build both with features off and with all features on
  (the latter served by the backend: 31 catalogue requests, all 200).
- Not verifiable here: the live Supabase database (no connection was made), signed-in browser flows against real
  data, Paystack, push, calls, and a Vercel deployment - see DEPLOYMENT.md.

## Validation done for this restructure

- Frontend: every emitted legacy file (`index.html` + 19 `/assets` files + `sw.js`) is byte-identical to `42c4105`
  (the document additionally carries the two React tags), and every static file in `dist/` matches the original.
  Screenshots of 15 screens/states (first-visit onboarding, sign-in, guest home, search, vendors, legal pages,
  settings drawer, dark mode, desktop) were pixel-identical to the original under the same stubbed network, with no
  console error that the original does not also produce.
- Backend: 40 route/unit tests, and a side-by-side run of the `42c4105` `api/*.js` handlers against the new app on
  44 scenarios with identical stubbed upstreams (including the generated share-card and notification PNGs): identical
  status codes, bodies and outbound requests.
- Not verifiable in this environment: signed-in flows against real data, payments, push delivery, calls, and a real
  Vercel deployment. Deploy a **preview** first (see the checklist in the handover notes).

## Known issues carried over (not changed by this refactor)

Listed so they are not mistaken for regressions; each needs its own change:

- `esc()` in the legacy code does not escape quotes but is used inside HTML attributes and inline `onclick` strings.
- Row-level update policies on `vendors`, `products`, `orders` and `users` are not column-restricted (verify which
  columns triggers protect).
- Verified vendors' rows (phone, bank details) are readable through the public select policy; Levi's `get_vendor`
  tool also returns phone and address.
- R2 presigned uploads accept any key inside the public folders for any signed-in user.
- Cached page snapshots (`levromart-route-html-v2:*`) are not cleared on logout.
- Levi's suggestion and transcription modes are not counted against the daily limit.
- The browser still sends `list-banks`, `list-listing-drafts`, `save-listing-draft` and `delete-listing-draft` to
  `/api/vendor-payments`, which never implemented them (400 "Unknown payment action"); `/api/order-notify` ends in a
  500 because order e-mails were never built.
- `.github/workflows/order-reminders.yml` still calls `https://YOUR-DEPLOYED-DOMAIN/...`.
- supabase-js is loaded from unpkg as `@supabase/supabase-js@2` (unpinned minor/patch).
- Push-notification pictures use `https://levromart.com` (`ICON_ORIGIN`) while e-mail links use
  `https://levromart.vercel.app` (`APP_ORIGIN`).
