---
name: ship-frontend-fix
description: Ship a front-end-only fix straight to main (founder's standing instruction, 21 Nov 2026). Make the fix, run every check, push to main, report in plain words. No pull request and no waiting for the founder to merge.
---

# Ship a front-end fix directly to `main`

**Standing instruction from the founder (21 Nov 2026):** for front-end fixes, do not open a pull request and do not
ask the founder to merge. Do the whole job yourself: fix, check, push to `main`. Cloudflare Pages builds `main`
automatically (`docs/HOSTING.md`). The founder does not test or merge anything by hand.

## Only for front-end-only changes

Allowed in one push: `medris-frontend/src/legacy/`, `medris-frontend/public/`, `medris-frontend/src/` (outside
`legacy/`), `sw.js`, and the matching `asset version` / `legacy-baseline.json` files.

**Still a pull request, reviewed by the engineer, never direct to `main`:** anything in `api/`, `medris-backend/`,
`functions/`, database migrations (`medris-backend/src/database/migrations/`), payments / Paystack / commission /
payout / refund code, `.github/workflows/`, `package.json` / `package-lock.json`, hosting config. If a task mixes
both kinds, split it: ship the front-end part directly, open a pull request for the rest.

## Steps

1. `git status` must be clean. `git fetch origin && git switch -C <short-branch> origin/main`.
2. Make the fix. Keep it small and on-topic. Look at it for real (build, open it in the browser at phone width, light
   and dark) before pushing. Never use a real account, real money or real users' data.
3. If `src/legacy/` or `sw.js` changed: read `assetVersion` in `document.json` on `origin/main`, run
   `npm run bump-version -w medris-frontend -- <that + 1>`, then `npm run legacy:rebaseline -w medris-frontend`.
4. Run all of: `npm run legacy:check -w medris-frontend`, `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run build -w medris-frontend`. **Every one must pass.** Never skip, weaken or delete a test, never use
   `--no-verify`. If a check fails and the cause is not your change, do not push: report it.
5. Commit in the usual format (see `git-workflow.md`), staging files by name.
6. `git fetch origin && git rebase origin/main` (if anything came in, re-run step 4), then
   `git push origin HEAD:main`. A normal push only: **never `--force`** to `main`.
7. If the push is refused (branch protection, or `main` moved): rebase and try once more. If it is still refused, fall
   back to a normal pull request and tell the founder plainly.
8. **Report in plain words:** what changed, that it is on `main`, and that Cloudflare Pages is building it (installed
   phones may need the app closed and reopened twice to show it). Say what you could not check. If the change touches
   data, money, accounts, messages or notifications, update the legal pages as `AGENTS.md` says and say a lawyer
   should review the wording.
9. If it turns out to be wrong after it is live: fix forward quickly, or revert with a new commit
   (`git revert <sha>`, then follow these steps). Tell the founder and the engineer.

The hard limits in `project-context.md` still apply: no secrets, no live database changes, no real payments.
