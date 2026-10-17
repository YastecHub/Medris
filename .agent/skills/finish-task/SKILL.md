---
name: finish-task
description: Finish a Levromart task - run the checks, bump the asset version if the legacy app changed, rebase on main, push the branch and open a pull request for review. Never merges.
---

# Finish a task and open the pull request

Follow `.agent/rules/git-workflow.md`, sections 3-5.

1. **Confirm you are on the task branch**, not `main` (`git branch --show-current`). If you are on `main`, stop:
   create a branch first and move the changes to it.
2. **Review your own diff:** `git diff origin/main...HEAD` plus uncommitted changes. Remove anything unrelated,
   any debug code, any secret. Commit what is left with a proper message.
3. **If `medris-frontend/src/legacy/` or `sw.js` changed:** read `assetVersion` in
   `medris-frontend/src/legacy/document.json` on `origin/main`, run
   `npm run bump-version -w medris-frontend -- <that + 1>`, then `npm run legacy:rebaseline -w medris-frontend`, and
   commit as `chore(pwa): bump asset version to <n>`.
4. **Run the checks** that apply and fix failures (never skip or weaken a test):
   `npm run legacy:check -w medris-frontend`, `npm run api:check`, `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run build -w medris-frontend`.
5. **Update and push:** `git fetch origin && git rebase origin/main` (re-run the checks if anything came in), then
   `git push -u origin <branch>` (or `git push --force-with-lease` if you rebased an already-pushed branch).
6. **Open the pull request** into `main` with a title in commit format and the body from
   `.github/pull_request_template.md`, written for a non-technical reader: what changed and why, numbered steps to
   check it on the Vercel preview (which account type, what they should see), before/after screenshots for visual
   changes, risks and any manual step (e.g. a database migration to apply). Use `gh pr create` if available;
   otherwise give the person
   `https://github.com/kenniskalu18-prog/Medris/compare/main...<branch>?expand=1`.
7. **Report and stop:** the PR link, the check results, where the preview link will appear, and what the reviewer
   needs to do. Do **not** merge. If CI fails after pushing, fix it on the same branch.
