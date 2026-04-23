# redflag-manual

Automated Danish-language redflag analysis for Nasdaq Copenhagen earnings releases. Produces a two-column PNG card (3 positive / 3 negative triggers + bottom-line) per release.

## How it runs

A scheduled [Claude Code routine](https://claude.ai/code/routines) runs the pipeline every weekday at **08:20 CET (06:20 UTC)**, cron `20 6 * * 1-5`.

Each run:
1. `git pull --rebase origin main`
2. `npm install`
3. `npm run publish` — scans the Nasdaq Copenhagen news feed, filters earnings keywords from the last 25h, fetches stock data and analyst consensus, calls `claude -p` for the LLM analysis, renders a PNG via Puppeteer, writes artifacts to `output/YYYY-MM-DD/`, then commits and pushes if anything new exists.

On days with no earnings releases, the publish script exits cleanly without a commit.

## Local use

- `npm run` — run the pipeline once and write to `output/YYYY-MM-DD/` without committing.
- `npm run publish` — run + commit + push. Only intended for the routine; avoid running manually unless you want to push.

## Environment

See `.env.example`. The routine's cloud environment has `ALPHA_VANTAGE_API_KEY` set; the local `.env` is gitignored.

## Files

- `src/run.ts` — entry point: scans the Nasdaq CPH feed, iterates matches.
- `src/process-analysis.ts` — per-ticker pipeline.
- `src/utils/*` — data fetchers (stock, consensus, press release), HTML template, Puppeteer renderer, Claude CLI wrapper.
- `scripts/publish.sh` — routine wrapper: `npm run` → git add/commit/push.
- `output/YYYY-MM-DD/` — committed artifacts (PNG/TXT/HTML per ticker).
