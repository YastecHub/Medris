# Architecture (after the frontend/backend restructure)

Based on commit `42c4105`. This replaces the "shell `index.html` + `assets/` + 13 files in `api/`" layout described in
`BUILD_MANUAL.md`. The product, its look and its behaviour are unchanged; only where the code lives and how it is
built changed (plus one bug fix, listed below).

```
medris/
├── api/*.js                      12 Vercel functions (same names/URLs as before), each re-exports the Hono app
├── vercel.json                   build + output settings, the original rewrites, daily cron
├── package.json                  npm workspaces + root scripts
├── eslint.config.js
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
│   │   ├── services/api/         typed API client + endpoint wrappers
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
├── medris-backend/
│   ├── src/
│   │   ├── app.ts                builds the Hono app, mounts every module under /api
│   │   ├── server.ts             local Node server (reads .env)
│   │   ├── vercel.ts             Vercel handler
│   │   ├── config/               typed env access, static-file lookup
│   │   ├── contracts/api.ts      request/response types shared with the frontend
│   │   ├── integrations/         Supabase, Paystack, Resend e-mail, Web Push, R2, Gemini
│   │   ├── middleware/           cron/webhook secret checks
│   │   ├── lib/, types/
│   │   └── modules/              one folder per area: routes (HTTP) + services (logic)
│   │       ├── accounts/         register, account-exists, ensure-profile, delete, link previews, TURN
│   │       ├── share-images/     share cards (1200x630) and notification pictures (256x256)
│   │       ├── auth-otp/         admin login codes, set password
│   │       ├── levi/             AI assistant: prompt, tool declarations, tools, service
│   │       ├── payments/         Paystack initiate/verify/webhook, settlement, payouts/refunds
│   │       ├── vendor-payments/  subaccounts, commission, monthly billing, ₦999 listings, R2 uploads
│   │       ├── orders/           payout actions, 30-minute reminders, order-notify
│   │       ├── notify/           notification → e-mail + push, call decline, test push
│   │       └── cron/             daily job
│   └── tests/                    route + unit tests with stubbed upstreams (no network)
├── supabase/                     database docs, SQL migrations and export script (unchanged)
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
   identical. Read data with the same Supabase calls through `getLegacySupabase()` (never create a second client) or
   with `api.*` from `src/services/api/endpoints.ts`.
2. Mount it from the legacy router for that view (the view's `renderX` returns an empty container that an exported
   `mountX(el)` fills with `createRoot`), and delete the legacy renderer once the React one is live.
3. Compare before/after screenshots (430×900 and desktop, light and dark) the way this refactor was checked, then
   rebaseline.

No screen has been migrated yet: React currently renders nothing visible and publishes `window.medris`
(`config`, `api`).

## Backend

- Every previous URL is served with the same request/response shapes: `/api/auth-otp`, `/api/chat`,
  `/api/daily-cron`, `/api/delete-account` (+ `/api/register`, `/api/account-exists`, `/api/turn`,
  `/api/notif-icon`), `/api/initiate-payment`, `/api/verify-payment`, `/api/paystack-webhook`, `/api/notify`,
  `/api/order-notify`, `/api/order-payout-action`, `/api/order-reminders`, `/api/vendor-payments`
  (+ `/api/listing-payments`), link previews for `/?storefront=|product=|package=` and `/s/`, `/p/`, `/k/`, and share
  cards (`?ogstore=|ogprod=|ogpkg=`). The routes answer both the rewritten URL (`/api/delete-account?turn=1`) and
  the original one (`/api/turn`), so they behave the same whichever URL Vercel hands the function.
- Routes parse the request and call a module service; services return `{ status, body }`; integrations wrap
  third-party HTTP APIs. Authorisation is unchanged: the user's Supabase access token in the JSON body is verified
  with Supabase Auth; user-scoped writes still go through Postgres RPCs with the user's own token (RLS and `auth.uid()`
  still apply); the service-role key is used only after the code has authorised the caller.
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
