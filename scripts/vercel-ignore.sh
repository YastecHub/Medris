#!/bin/bash
# Vercel "Ignored Build Step": exit 0 = skip this deployment, exit 1 = build it.
# Only build when something that changes the website or the api/ functions changed since the last deployment that
# built. Backend-only, database-migration, test and documentation changes do not need a new Vercel deployment, and
# every deployment uses up the free plan's daily deployment limit and its function storage.
PREV="$VERCEL_GIT_PREVIOUS_SHA"
CUR="$VERCEL_GIT_COMMIT_SHA"
# when unsure, build
[ -z "$PREV" ] || [ -z "$CUR" ] && exit 1
git cat-file -e "$PREV^{commit}" 2>/dev/null || exit 1
git cat-file -e "$CUR^{commit}" 2>/dev/null || exit 1
if git diff --quiet "$PREV" "$CUR" -- medris-frontend api scripts vercel.json package.json package-lock.json \
  ':(exclude)medris-frontend/tests' ':(exclude)*.md'; then
  echo "Nothing that affects the site changed since $PREV - skipping this deployment."
  exit 0
fi
exit 1
