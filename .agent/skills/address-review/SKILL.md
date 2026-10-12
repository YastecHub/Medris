---
name: address-review
description: Respond to review comments or failed checks on an open Levromart pull request - make the requested changes on the same branch, push, and reply to each comment.
---

# Address review comments

1. Open the pull request (`gh pr view <number> --comments` and `gh pr checks <number>` if the GitHub CLI is available;
   otherwise ask the person to paste the comments). List every comment and every failing check.
2. Switch to the pull request's branch and update it: `git switch <branch> && git pull`.
3. Handle each comment: make the change, or - if you disagree or something is unclear - explain why in plain words
   and ask, instead of guessing. Do not make unrelated changes.
4. Add new commits (`fix(<scope>): address review - <what>`); do not squash or rewrite what was already reviewed.
   Re-run the checks from `finish-task` step 4, and re-bump the asset version only if `main` has moved past it.
5. Push (`git push`), reply to each comment with what changed (or the question), and re-request review.
6. Report to the person: what changed per comment, check results, and that the PR is waiting for review again. Never
   merge, never resolve the reviewer's comments yourself unless they asked you to.
