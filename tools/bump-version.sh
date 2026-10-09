#!/bin/sh
# Usage: tools/bump-version.sh 77
# Run this on every deploy. It makes the service worker cache name and every /assets/... URL in index.html carry the
# same number, so phones never mix a new index.html with old cached CSS/JS.
set -e
N="$1"
[ -n "$N" ] || { echo "usage: $0 <number>"; exit 1; }
cd "$(dirname "$0")/.."
sed -i -E "s/levromart-shell-v[0-9]+/levromart-shell-v$N/" sw.js
sed -i -E "s#(/assets/(css|js)/[A-Za-z0-9_.-]+)\?v=[0-9]+#\1?v=$N#g" index.html
echo "bumped to v$N"
