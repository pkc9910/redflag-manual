# redflag run 2026-05-15T06:20:43.740Z

- Status: FAILED
- Started: 2026-05-15T06:20:43.740Z
- Finished: 2026-05-15T06:21:18.250Z
- News items fetched: 0
- Earnings matches (≤25h, keywords): 0
- Successful tickers: 0
- Failed tickers: 0

## Successes
(none)

## Failures
(none)

## Scanned but skipped
(none)

## Error
```
TypeError: fetch failed
    at node:internal/deps/undici/undici:14976:13
    at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
    at async fetchWithRetry (/home/user/redflag-manual/src/utils/fetch-with-retry.ts:15:19)
    at async main (/home/user/redflag-manual/src/run.ts:213:22)
```
