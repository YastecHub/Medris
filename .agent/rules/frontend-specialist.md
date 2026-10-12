---
trigger: model_decision
description: Use for any change people can see or click in the web app - screens, buttons, forms, text, layout, styles, dark mode, navigation, the service worker - anything in medris-frontend/.
---

# Frontend specialist (medris-frontend)

The app is the **legacy runtime** in `medris-frontend/src/legacy/`: plain JavaScript and CSS, global functions,
screens built as HTML strings. A thin React/TypeScript entry (`src/main.tsx`, `src/bridge/`, `src/services/`) loads it.
Work **with** this structure; do not rewrite screens in React or reorganise files as part of a normal task.

## Research first (proportionate to the task)

1. Turn the request into what the user will see and do, including on a phone, in dark mode, signed out, and as a
   buyer / vendor / admin where relevant. Ask only if a product decision is genuinely missing.
2. Find the screen: `navigate(view)` in `assets/js/01-app/30-navigation.js` maps a view name to `renderX()`. Search
   all of `src/legacy/` for the function and **use the last definition** (later wins). Note who calls it and which
   `id`/`data-*` attributes other code reads.
3. Find how the data is loaded: `sb.from(...)` (table read, RLS decides rows), `sb.rpc("name", ...)` (business action in
   the database - do not reimplement its rules in the browser), `levroData.*` (the data gateway), or `fetch("/api/...")`.
4. Look at a similar, recently changed screen and copy its patterns (skeleton first then data, `showToast`,
   `showConfirmDialog`, `esc()`, bottom sheets via `openDrawer`).

## Implement

- Smallest change that does the job, in the file that owns the behaviour. New CSS at the end of
  `assets/css/05-overrides.css`, with an area prefix (`cart-`, `od-`, `vl-`, `vd-`, `vh-`, `msg-`, `admin-`, `lv-`).
  If an old rule wins, raise specificity at the end of the file rather than editing many old rules; re-check dark mode.
- Escape every database value with `esc()`. Never build HTML from user text without it.
- Handle loading, empty, error (show `error.message` from Supabase - many are written for users) and success states.
- Disable a button while its request runs, but remember the server/database is what prevents duplicates.
- Keep accessibility: real `<button>`s, labels on inputs, visible focus, no information by colour alone.
- No new libraries, frameworks or global stores. No secrets in the browser (only the public Supabase key and VAPID
  public key exist there).
- Cleaning up messy code is a separate task (`refactor/` branch) with before/after screenshots.

## Verify

`npm run legacy:check -w medris-frontend`; bump the asset version and `npm run legacy:rebaseline -w medris-frontend`;
`npm test -w medris-frontend`; `npm run build -w medris-frontend`. If you can run a browser, open the screen at phone
width (about 390 px) in light and dark mode and take before/after screenshots for the pull request. Otherwise give the
reviewer exact steps for the Vercel preview. Never claim a visual check you did not do.
