---
trigger: always_on
---

# Levromart: project context

Facts about this repository that every task relies on. They were checked against the code; if something here turns
out to be wrong, say so in your report instead of working around it silently.

## What the product is

Levromart (repository name **Medris**) is a Nigerian marketplace web app (a PWA: it installs on phones, works partly
offline and sends push notifications). Anyone can **buy**; verified **vendors** also sell products, services and
packages (bundles); **admins** verify vendors, resolve disputes and manage content. Buyers usually pay the vendor
directly (bank transfer reported in the app and confirmed by the vendor); Levromart earns commission or monthly
listing fees. Money is Nigerian naira (₦), stored as `numeric` naira (not kobo).

The founder is not a developer. Explain what you did in plain words, show where to look, and never assume they can
fix a technical problem by hand.

## Where things live

| Path | What it is | Deployed? |
|---|---|---|
| `medris-frontend/` | The web app people use. Vite build; the app itself is the **legacy runtime** in `src/legacy/` | Yes - Vercel |
| `medris-frontend/src/legacy/assets/js/` | The app's JavaScript, split into files. `01-app/` holds the main app by section (e.g. `46-cart-...js`) | Yes |
| `medris-frontend/src/legacy/assets/css/` | Styles, in order `01-base` ... `05-overrides` (later wins) | Yes |
| `medris-frontend/src/legacy/markup/`, `scripts/`, `styles/` | The pieces of the page (`index.html`), assembled in the order listed in `src/legacy/document.json` | Yes |
| `medris-frontend/src/service-worker/sw.js` | Offline cache and push notifications | Yes |
| `medris-frontend/public/` | Icons, images, fonts, `lib/compress-image.js` | Yes |
| `medris-frontend/src/` (outside `legacy/`) | Small React/TypeScript entry and the data gateway (`window.levroData`) | Yes |
| `api/*.js` | The 12 live server functions on Vercel (payments, notifications, sign-up, Levi AI, uploads, link previews, daily cron). Plain CommonJS. | Yes - Vercel |
| `medris-backend/` | New Express + TypeScript backend (Swagger at `/api/v1/docs`). **Live on Heroku**: the app's `sb.rpc()` calls and the data gateway go there | Yes - Heroku |
| `medris-backend/src/database/migrations/` | Every database change, as numbered SQL files | Applied by hand after approval |
| `supabase/` | Database history (`01`-`14`, already applied - never re-run) and the export script | - |
| `docs/` | Engineering docs: `ARCHITECTURE.md`, `DATABASE.md`, `DEPLOYMENT.md`, `CLEANUP.md`, the build manuals (PDF) | - |
| `.agent/` | These instructions | - |

Never edit generated output: `medris-frontend/dist/`, `medris-backend/dist/`, `node_modules/`,
`medris-frontend/tests/legacy-baseline.json` (regenerate it with the command below, never by hand), `package-lock.json`
(only through `npm install`).

## How the app talks to the database

- The database is **Supabase PostgreSQL**, live project `ovklnoroyxobijgvsyfp`. The browser talks to it directly with
  the public key (`supabase-js`, global `sb`): table reads/writes protected by Row Level Security, and `sb.rpc(...)`
  calls to database functions for every business action (orders, payments, follows, admin). The rules live in those
  functions, not in the browser.
- Anything needing a secret (Paystack, email, push, Gemini AI, image uploads to Cloudflare R2) goes through
  `fetch("/api/...")` to the functions in `api/`.
- Hiding a button is never security. Who may do what is enforced in the database (RLS + functions).

## The legacy runtime: rules that save hours

The app was built as one huge HTML file and later split into files without changing how it works. So:

1. **Later wins.** All functions are global; several are defined more than once and the **last** definition is the
   live one. Search the whole `src/legacy/` folder for a function name and edit the last occurrence. The same for CSS:
   a later rule beats an earlier one, so add new CSS at the end of `05-overrides.css`, with higher specificity if
   needed.
2. **Find a screen** by its render function: `navigate(view)` calls `renderX()` - e.g. `renderCart`,
   `renderProductDetail`, `renderVendorDashboard`, `renderOrderDetail`. Search for `function renderCart` /
   `renderCart =`.
3. **New class names get a prefix** for their area (`cart-`, `od-` order details, `vl-` my listings, `vd-` vendors,
   `vh-` seller hub, `msg-` messages, `admin-`, `lv-` shared) so they cannot collide with old styles.
4. **Always escape database text** with `esc(...)` before putting it into HTML.
5. **ids and `data-*` attributes are used by code** - search before renaming.
6. **Check light and dark mode** (dark mode uses `:root[data-theme="dark"]` overrides) and phone width.
7. **Nothing hard-coded:** names, counts and prices come from the database.
8. **Do not "modernise" by accident.** No framework rewrites, no moving code between files, no reformatting files you
   did not need to change: it breaks the regression check and makes review impossible.

## Commands (run from the repository root; Node 20.12+, npm)

| Do | Command |
|---|---|
| Install | `npm ci` |
| Run the app locally | `npm run dev:frontend` -> http://localhost:5173 (talks to the live Supabase: use a test account; `/api` calls need `npm run dev:backend` too) |
| Syntax-check the legacy scripts | `npm run legacy:check -w medris-frontend` |
| Bump the asset version (after changing anything in `src/legacy/` or `sw.js`) | `npm run bump-version -w medris-frontend -- <current + 1>` (current: `assetVersion` in `src/legacy/document.json`) |
| Record intentional legacy changes for the regression test | `npm run legacy:rebaseline -w medris-frontend` |
| Syntax-check the server functions | `npm run api:check` |
| Tests | `npm test` (all) or `npm test -w medris-frontend` |
| Typecheck / lint | `npm run typecheck` / `npm run lint` |
| Exactly what Vercel builds | `npm run build -w medris-frontend` |

After any change in `src/legacy/`: `legacy:check` -> `bump-version` -> `legacy:rebaseline` -> `npm test` ->
`npm run build -w medris-frontend`. CI runs the same checks on every pull request.

## Deployment

- **Vercel** builds the frontend only and deploys the `api/` functions. Every pushed branch gets a **preview link**
  (Vercel posts it on the pull request); `main` is production. Nobody deploys by hand.
- **Database changes are never deployed automatically.** They are migration files reviewed in a pull request and
  applied to production by the engineer after approval (`docs/DATABASE.md`, section 3).
- The backend is switched on for everyone: production builds send `sb.rpc()` calls to `https://levromart-5212f03a7e44.herokuapp.com`
  (`POST /api/v1/rpc/{name}`). `VITE_BACKEND_FEATURES=none` turns it off; see `docs/DEPLOYMENT.md`.

## Hard limits (no task overrides these)

- Never push to `main`, never merge a pull request, never force-push to someone else's branch. Follow
  `.agent/rules/git-workflow.md`.
- Never run SQL against the live database, never use the Supabase dashboard/SQL editor or an "apply migration" tool on
  production. Write a migration file instead.
- Never put secrets (service-role key, Paystack/Resend/Gemini/R2 keys, passwords, `.env` contents) into code, commits,
  pull requests, logs or chat. The repository is **public**. Only the public Supabase anon key and VAPID public key
  are allowed in the frontend.
- Never make real payments, send real emails/pushes to real users, or delete real data while testing.
- Do not change `vercel.json`, `.github/workflows/`, `api/_util.js`, payment code or database functions unless the task
  is explicitly about them; flag the risk in the pull request when you do.

## Domain words

- **Order states:** `pending` -> `confirmed` -> `handed_over` -> `completed`; side branches `cancelled`, `disputed`,
  `payment_unresolved`, `returned` (rentals). Status changes go through database functions such as
  `transition_order_status`, `buyer_confirm_received`; never update `orders.status` directly.
- **Pay-after-delivery** orders: a deposit (`payment_deposit_percent`, default 20%) first, the rest after delivery.
- **24-hour auto-complete:** after the final payment is confirmed the buyer has 24 h to confirm or dispute.
- **Commission vs monthly billing:** how a vendor pays Levromart; overdue commission locks vendor tools.
- **Levi:** the in-app AI assistant (`api/chat.js`).
- **Phone sign-in** uses a hidden email alias `p<digits>@accounts.levromart.app`: never show it, never change its format.

Deeper references: `docs/ARCHITECTURE.md`, `docs/BUILD_MANUAL.md`, `docs/DATABASE.md`, and the two build manuals in
`docs/*.pdf`.
