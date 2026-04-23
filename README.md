# redflag-manual

Automated Danish-language redflag analysis for Nasdaq Copenhagen earnings releases. Produces a two-column PNG card (3 positive / 3 negative triggers + bottom-line) per release.

## How it runs

A scheduled [Claude Code routine](https://claude.ai/code/routines) runs the pipeline every weekday at **08:20 CET (06:20 UTC)**, cron `20 6 * * 1-5`.

Each run:
1. `git pull --rebase origin main`
2. `npm install`
3. `npm run publish` — scans the Nasdaq Copenhagen news feed, filters earnings keywords from the last 25h, fetches stock data and analyst consensus, calls `claude -p` for the LLM analysis, renders a PNG via Puppeteer, writes artifacts to `output/YYYY-MM-DD/`, then commits and pushes.

Every run — matches or not — writes a `_run.md` summary into `output/YYYY-MM-DD/`, so silent failures are impossible: a zero-match day still produces a commit documenting what was scanned.

## Local use

- `npm run run` — run the pipeline once and write to `output/YYYY-MM-DD/` without committing.
- `npm run publish` — run + commit + push. Only intended for the routine; use `DRY_RUN=1` locally (see below).
- `npm run manual -- --ticker <SYM> --url <release-url> --company "<Name>" --period "<Period>"` — manually backfill a single release that the keyword filter missed.
- `npm run typecheck` — type-check only.

## Local verification

Before trusting a routine change, run the publish script end-to-end without pushing:

    DRY_RUN=1 npm run publish

This exercises the `claude` CLI preflight, typecheck, the full pipeline, and the git add/commit path, then stops before `git push`. Inspect the local commit with `git show HEAD --stat`, then roll back with:

    git reset --soft HEAD~1 && git restore --staged output/ && git clean -fd output/

## Manual backfill

If the keyword filter misses a release (e.g. "First-quarter results" not matching any Danish/English earnings keyword), run:

    npm run manual -- \
      --ticker NDA-DK.CO \
      --url "https://view.news.eu.nasdaq.com/view?id=..." \
      --company "Nordea Bank Abp" \
      --period "Q1 2026"

This writes to `output/YYYY-MM-DD/` exactly like the scheduled run. Follow with `npm run publish` (or `DRY_RUN=1 npm run publish`) to commit.

## Environment

See `.env.example`. The routine's cloud environment has `ALPHA_VANTAGE_API_KEY` set; the local `.env` is gitignored.

## Files

- `src/run.ts` — entry point: scans the Nasdaq CPH feed, iterates matches, writes `_run.md`.
- `src/run-manual.ts` — CLI backfill for a single release.
- `src/process-analysis.ts` — per-ticker pipeline.
- `src/utils/paths.ts` — repo-root-relative output directory resolver.
- `src/utils/*` — data fetchers (stock, consensus, press release), HTML template, Puppeteer renderer, Claude CLI wrapper.
- `scripts/publish.sh` — routine wrapper: preflight → `npm run run` → git add/commit/push (supports `DRY_RUN=1`).
- `output/YYYY-MM-DD/` — committed artifacts: `_run.md` + per-ticker PNG/TXT/HTML.
