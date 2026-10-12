---
trigger: always_on
---

# Git workflow: branch, commit, pull request, review

Every change reaches the live app the same way: **branch -> commits -> pull request -> checks -> review -> merge by a
reviewer**. You (the agent) do everything up to opening the pull request; a person reviews and merges. Follow this for
every task that changes files, however small.

Repository: `https://github.com/kenniskalu18-prog/Medris`, default branch `main` (= production on Vercel).
The commands below call it `origin`. Check with `git remote -v`: in a fork, the main repository is usually `upstream`
and your fork `origin` - then pull `main` from `upstream`, push your branch to `origin`, and open the pull request
from the fork into `kenniskalu18-prog/Medris:main`.

## Never

- commit or push to `main`; merge any pull request (yours included); approve your own work;
- `git push --force` to a branch that is not yours, or to any branch that has an open review you have not addressed;
- rewrite history others may have (`rebase`/`reset --hard` on shared branches), delete branches you did not create;
- commit secrets, `.env` files, `node_modules/`, `dist/`, editor/OS files, or unrelated changes;
- use `--no-verify`, disable CI, or delete/skip a failing test to make checks pass.

## 1. Start every task on a fresh branch from the latest `main`

```bash
git status                      # must be clean; if not, stop and ask what to do with the existing changes
git switch main
git pull --ff-only origin main  # if this fails, stop and report - never "fix" main
git switch -c <type>/<short-description>
```

Branch names: lowercase, words joined with `-`, at most ~50 characters, starting with the change type:

| Type | For | Example |
|---|---|---|
| `feat/` | something new users can do | `feat/vendor-delivery-zones` |
| `fix/` | a bug | `fix/cart-total-rounding` |
| `ui/` | look and layout only, no behaviour change | `ui/order-tracker-dark-mode` |
| `copy/` | wording only | `copy/checkout-help-text` |
| `refactor/` | restructure without behaviour change | `refactor/cart-render` |
| `db/` | a database migration | `db/add-order-notes-index` |
| `docs/`, `chore/`, `ci/` | documentation, maintenance, CI | `docs/agent-guide` |

If the task has a GitHub issue, put its number after the type: `fix/142-cart-total-rounding`.

One branch = one task. Do not mix an unrelated fix into it; mention it in the pull request as a follow-up instead.

## 2. Commit in small, meaningful steps

Format (Conventional Commits):

```
<type>(<scope>): <what changed, imperative, lower case, no full stop, max ~72 characters>

<why the change was needed and anything a reviewer must know - wrap at ~72 characters>

Refs #<issue number>        (if there is one)
```

- **type:** `feat`, `fix`, `ui`, `copy`, `refactor`, `perf`, `test`, `docs`, `db`, `chore`, `ci`.
- **scope:** the area - `cart`, `checkout`, `orders`, `vendor`, `admin`, `messages`, `levi`, `auth`, `search`,
  `notifications`, `payments`, `api`, `backend`, `db`, `pwa`, `ci`, `docs`.
- Examples:
  - `fix(cart): keep the checkout button above the bottom navigation on small phones`
  - `feat(vendor): let vendors set a delivery fee per kilometre`
  - `db(orders): add index for vendor order lists`
  - `chore(pwa): bump asset version to 128`
- Stage files by name (`git add path/to/file`), not `git add -A`, and check `git diff --staged` before every commit.
- Each commit should leave the app working. Do not commit half-done work "to save progress" on `main`; on your own
  branch a `wip:` commit is fine if you squash or replace it before opening the pull request.

## 3. Before opening the pull request

Run the checks that apply (see `project-context.md`), and fix what fails:

```bash
npm ci                                   # if dependencies changed or node_modules is missing
npm run legacy:check -w medris-frontend  # if src/legacy changed
npm run api:check                        # if api/ changed
npm run lint && npm run typecheck
npm test
npm run build -w medris-frontend
```

If you changed anything in `medris-frontend/src/legacy/` or `sw.js`: bump the asset version once for the branch
(`npm run bump-version -w medris-frontend -- <main's assetVersion + 1>`), then `npm run legacy:rebaseline -w
medris-frontend`, and commit both with the change.

Then bring the branch up to date and push it:

```bash
git fetch origin
git rebase origin/main                   # your own branch only; resolve conflicts, re-run the checks
git push -u origin <branch>              # first push; later pushes: git push
                                         # after a rebase of an already-pushed branch: git push --force-with-lease
```

Conflicts in `document.json` or `legacy-baseline.json` mean someone else bumped the asset version: take theirs, bump to
their version + 1, run `legacy:rebaseline` again. Never hand-edit `legacy-baseline.json`.

## 4. Open the pull request

Title: same format as a commit (`fix(cart): ...`). Base: `main`. The body follows `.github/pull_request_template.md`
(GitHub fills it in automatically) - fill every section in plain language:

- **What changed** and **why**, for a non-technical reader.
- **How to check it:** numbered steps someone can follow on the Vercel preview link, with the account type to use
  (buyer / vendor / admin) and what they should see.
- **Screenshots** before/after for anything visual (phone width, light and dark).
- **Risk:** what could break, and anything that needs a person to do something (e.g. "apply migration 0007 after
  approval", "set a Vercel variable").
- The checklist, ticked honestly - leave a box unticked and say why rather than ticking something you did not run.

With the GitHub CLI: `gh pr create --base main --title "<title>" --body-file <file>` (open it as a draft with `--draft`
if the work is not finished). Without it: push the branch and give the person this link to open it in the browser:
`https://github.com/kenniskalu18-prog/Medris/compare/main...<branch>?expand=1`.

## 5. Wait for checks and review - do not merge

- Report the pull request link, the CI result and the Vercel preview link, then **stop**. Merging is the reviewer's
  decision.
- If CI fails: open the failing job, fix the cause on the same branch, push again. Do not open a second pull request
  for the same task.
- If the reviewer asks for changes: make them on the same branch as new commits (do not squash away the history they
  reviewed), push, and reply to each comment saying what changed. Re-request review.
- While waiting, start any new task on a **new** branch from `main` - never stack it on the unmerged one unless asked.

## 6. After the merge

```bash
git switch main
git pull --ff-only origin main
git branch -d <branch>                   # the merged local branch
```

The production deploy happens on its own when `main` changes; check the live site for the change. If something is
wrong, tell the reviewer immediately - rolling back is a one-click Vercel action they can do.
