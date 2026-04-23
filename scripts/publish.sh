#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root relative to this script so the routine's CWD doesn't matter.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Preflight: claude CLI must be resolvable. The pipeline will fail without it.
if ! command -v claude >/dev/null 2>&1 && [ ! -x "${CLAUDE_CLI_PATH:-}" ] && [ ! -x "$HOME/.local/bin/claude" ]; then
  echo "ERROR: claude CLI not found on PATH, in CLAUDE_CLI_PATH, or at ~/.local/bin/claude" >&2
  exit 2
fi

# Preflight: typecheck. Cheap; catches type errors before the routine ships them.
npm run typecheck

# Run the pipeline. (Was: `npm run` with no script name — the silent-failure bug.)
npm run run

git add output/

if git diff --cached --quiet; then
  echo "ERROR: pipeline wrote nothing to output/ — _run.md should always exist. Investigate." >&2
  exit 1
fi

N=$(git diff --cached --name-only | grep -c '\.png$' || true)
git commit -m "redflag: $(date +%F) (${N} releases)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1 — skipping git push. Local commit created on $(git rev-parse --abbrev-ref HEAD)."
  exit 0
fi

git push origin main
