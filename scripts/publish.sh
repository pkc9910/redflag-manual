#!/usr/bin/env bash
set -euo pipefail

npm run

git add output/
if git diff --cached --quiet; then
  echo "No new output — nothing to commit."
  exit 0
fi

N=$(git diff --cached --name-only | grep -c '\.png$' || true)
git commit -m "redflag: $(date +%F) (${N} releases)"
git push origin main
