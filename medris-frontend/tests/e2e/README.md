# Browser tests (Playwright)

Safety net for the React migration (see `docs/REACT_MIGRATION.md`, section 6). They load the
**built** app and take reference screenshots of the screens planned for the first migration wave,
as a guest and as a signed-in buyer, at 390px and 1280px, in light and dark mode.

## Nothing live is ever called

- The app is built with fake public config (`playwright.config.ts`): the Supabase URL is
  `https://e2e-fixture.supabase.co`, so even a bug in a test cannot reach the real project.
- `support/network.ts` answers **every** request: Supabase REST/auth/realtime, `/api/*`, the
  Supabase client script (served from `node_modules`), fonts and images. Anything else is blocked
  and the test fails ("requests to unknown hosts").
- The fake signed-in buyer is a session written to `localStorage` before the app starts.
- All rows are invented (`fixtures/data.ts`). Reads of tables without a fixture return an empty list.

## Running

```
npm ci
npx playwright install chromium          # once
npm run test:e2e -w medris-frontend      # builds into dist-e2e/ and runs everything
npm run test:e2e -w medris-frontend -- -g "guest / light / 390px"   # a subset
npm run test:e2e -w medris-frontend -- --update-snapshots           # refresh pictures on purpose
```

Pictures live in `tests/e2e/__screenshots__/`. They are only refreshed deliberately, in a pull
request that says why the look changed.

## Matching the CI machine locally

The reference pictures are checked on GitHub's runner, which has no Inter font installed. If your machine has Inter installed
system-wide, a few text-heavy pictures differ by tiny amounts. Hide it for the run:

```
FONTCONFIG_FILE=$PWD/tests/e2e/support/no-system-inter.conf npm run test:e2e -w medris-frontend
```

When a screen is converted to React, make its reference pictures from the LEGACY screen only
(`-g "legacy looks like the reference" --update-snapshots`), then run everything without updating: the React version must match them.

## What the tests hold constant

Inter is served from bundled copies (`fixtures/fonts/`), so text is drawn the same on every machine. Frozen clock (2 March 2026), reduced motion, no animations, service worker off, first-visit
welcome screens / app tour / permission reminders switched off, notifications
reported as granted. The map library (Leaflet) and the icon font are not loaded, so the
pictures show text without icons; this is the same for the legacy and the React version of a screen.

## Files

- `first-wave.spec.ts`: reference screenshots of the first-wave screens (legacy app, all React switches off).
- `registry.spec.ts`: the view registry and the hook in `navigate()`, exercised with a stand-in React host
  (OFF by default, ON draws into a placeholder, unmount on leaving, no stale snapshot, fallback to legacy).
