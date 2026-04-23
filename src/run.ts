/**
 * Manual entry point for the redflag-analysis workflow — mirrors the cron
 * (check-nasdaq-news.ts) but runs end-to-end in a single Node process with
 * no Trigger.dev involvement.
 *
 * Run: npx tsx src/run.ts
 *
 * The LLM call is made via the local Claude Code CLI (`claude -p`), so this
 * workflow bills against the signed-in Claude Code subscription. No
 * ANTHROPIC_API_KEY is required. See src/utils/generate-analysis.ts.
 *
 * Flow:
 *   1. Pull the Nasdaq Copenhagen news feed.
 *   2. Filter for earnings/guidance keywords within the last 25h.
 *   3. For each match: resolve the CPH ticker, then run processAnalysis()
 *      end-to-end (stock data → consensus → release fetch → LLM → PNG/TXT/HTML).
 *   4. Write output/YYYY-MM-DD/_run.md with the full run tally — always, even
 *      on zero matches or errors, so silent failures are impossible.
 */

import "dotenv/config";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { processAnalysis } from "./process-analysis.js";
import { getOutputDir } from "./utils/paths.js";

const EARNINGS_KEYWORDS = [
  "årsrapport",
  "kvartalsrapport",
  "delårsrapport",
  "regnskab",
  "guidance",
  "forventninger",
  "opjustering",
  "nedjustering",
  "halvårsrapport",
  "interim report",
  "annual report",
  "outlook",
  "financial statement",
  "year-end report",
  "first-quarter",
  "second-quarter",
  "third-quarter",
  "fourth-quarter",
  "quarterly results",
  "half-year",
];

const NASDAQ_NEWS_API =
  "https://api.news.eu.nasdaq.com/news/query.action?type=json&showAttachments=true&freeText=&market=Main+Market%2C+Copenhagen&cnscategory=&company=&fromDate=&toDate=&globalGroup=exchangeNotice&globalName=NordicMainMarkets&displayLanguage=en&language=&timeZone=CET&dateMask=yyyy-MM-dd+HH%3Amm%3Ass&limit=50&start=0&dir=DESC";

interface NasdaqNewsItem {
  headline: string;
  messageUrl: string;
  company: string;
  published: string;
}

interface Success {
  ticker: string;
  company: string;
  reportPeriod: string;
  pngPath: string;
}

interface Failure {
  company: string;
  ticker?: string;
  reason: string;
}

interface Skipped {
  headline: string;
  company: string;
  reason: string;
}

async function lookupTicker(companyName: string): Promise<string | null> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(companyName)}&quotesCount=10&newsCount=0`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RedflagAnalysis/1.0)" },
  });
  if (!res.ok) {
    console.log(`Yahoo search failed (${res.status}) for "${companyName}"`);
    return null;
  }
  const data = (await res.json()) as {
    quotes?: Array<{ symbol?: string; exchange?: string; quoteType?: string }>;
  };
  const cph = data.quotes?.find(
    (q) => q.exchange === "CPH" && q.quoteType === "EQUITY"
  );
  return cph?.symbol ?? null;
}

function guessReportPeriod(headline: string): string {
  const lower = headline.toLowerCase();
  const yearMatch = headline.match(/20\d{2}/);
  const year = yearMatch ? yearMatch[0] : new Date().getFullYear().toString();

  if (
    lower.includes("årsrapport") ||
    lower.includes("annual report") ||
    lower.includes("year-end")
  ) {
    return `Årsrapport ${year}`;
  }
  const qMatch = lower.match(/q([1-4])/);
  if (qMatch) return `Q${qMatch[1]} ${year}`;
  if (lower.includes("halvår") || lower.includes("h1") || lower.includes("interim")) {
    return `H1 ${year}`;
  }
  return `Regnskab ${year}`;
}

interface RunSummary {
  status: "OK" | "FAILED";
  startedAt: string;
  finishedAt: string;
  itemsFetched: number;
  earningsMatches: number;
  successes: Success[];
  failures: Failure[];
  skipped: Skipped[];
  error?: string;
}

async function writeRunSummary(date: string, summary: RunSummary): Promise<void> {
  const outDir = getOutputDir(date);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, "_run.md");

  const lines: string[] = [];
  lines.push(`# redflag run ${summary.startedAt}`);
  lines.push("");
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Started: ${summary.startedAt}`);
  lines.push(`- Finished: ${summary.finishedAt}`);
  lines.push(`- News items fetched: ${summary.itemsFetched}`);
  lines.push(`- Earnings matches (≤25h, keywords): ${summary.earningsMatches}`);
  lines.push(`- Successful tickers: ${summary.successes.length}`);
  lines.push(`- Failed tickers: ${summary.failures.length}`);
  lines.push("");
  lines.push("## Successes");
  if (summary.successes.length === 0) {
    lines.push("(none)");
  } else {
    for (const s of summary.successes) {
      lines.push(`- ${s.ticker} — ${s.company} (${s.reportPeriod}) → ${s.pngPath}`);
    }
  }
  lines.push("");
  lines.push("## Failures");
  if (summary.failures.length === 0) {
    lines.push("(none)");
  } else {
    for (const f of summary.failures) {
      const t = f.ticker ? ` (${f.ticker})` : "";
      lines.push(`- ${f.company}${t}: ${f.reason}`);
    }
  }
  lines.push("");
  lines.push("## Scanned but skipped");
  if (summary.skipped.length === 0) {
    lines.push("(none)");
  } else {
    for (const s of summary.skipped) {
      lines.push(`- "${s.headline}" — ${s.company}: ${s.reason}`);
    }
  }
  if (summary.error) {
    lines.push("");
    lines.push("## Error");
    lines.push("```");
    lines.push(summary.error);
    lines.push("```");
  }
  lines.push("");

  await writeFile(path, lines.join("\n"), "utf8");
  console.log(`Wrote ${path}`);
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const startedAt = new Date().toISOString();

  const summary: RunSummary = {
    status: "OK",
    startedAt,
    finishedAt: startedAt,
    itemsFetched: 0,
    earningsMatches: 0,
    successes: [],
    failures: [],
    skipped: [],
  };

  try {
    console.log("Scanning Nasdaq Copenhagen for new earnings releases...");

    const response = await fetch(NASDAQ_NEWS_API);
    if (!response.ok) {
      throw new Error(`Nasdaq news API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      results?: {
        item?: Array<{
          headline?: string;
          messageUrl?: string;
          company?: string;
          published?: string;
        }>;
      };
    };

    const items: NasdaqNewsItem[] = (data.results?.item ?? [])
      .filter((i) => i.headline && i.messageUrl && i.company)
      .map((i) => ({
        headline: i.headline!,
        messageUrl: i.messageUrl!,
        company: i.company!,
        published: i.published ?? "",
      }));

    summary.itemsFetched = items.length;
    console.log(`Fetched ${items.length} news items from Nasdaq Copenhagen`);

    const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const earningsItems: NasdaqNewsItem[] = [];
    for (const item of items) {
      if (item.published && new Date(item.published) < cutoff) {
        summary.skipped.push({
          headline: item.headline,
          company: item.company,
          reason: "outside 25h lookback",
        });
        continue;
      }
      const lower = item.headline.toLowerCase();
      if (!EARNINGS_KEYWORDS.some((kw) => lower.includes(kw))) {
        summary.skipped.push({
          headline: item.headline,
          company: item.company,
          reason: "no keyword match",
        });
        continue;
      }
      earningsItems.push(item);
    }

    summary.earningsMatches = earningsItems.length;
    console.log(`Found ${earningsItems.length} earnings-related releases\n`);

    for (const item of earningsItems) {
      const ticker = await lookupTicker(item.company);
      if (!ticker) {
        console.log(
          `Skipping "${item.headline}" — no CPH ticker for "${item.company}"`
        );
        summary.failures.push({ company: item.company, reason: "no CPH ticker" });
        continue;
      }

      const reportPeriod = guessReportPeriod(item.headline);
      console.log(`\n── ${item.company} (${ticker}) — ${reportPeriod} ──`);

      try {
        const out = await processAnalysis({
          ticker,
          companyName: item.company,
          releaseUrl: item.messageUrl,
          reportPeriod,
        });
        summary.successes.push({
          ticker: out.ticker,
          company: out.companyName,
          reportPeriod,
          pngPath: out.pngPath,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`Failed for ${item.company}: ${reason}`);
        summary.failures.push({ company: item.company, ticker, reason });
      }
    }

    console.log("\n========== SUMMARY ==========");
    console.log(`Earnings releases scanned: ${earningsItems.length}`);
    console.log(`Successful: ${summary.successes.length}`);
    summary.successes.forEach((s) => console.log(`  ✓ ${s.ticker} → ${s.pngPath}`));
    console.log(`Failed: ${summary.failures.length}`);
    summary.failures.forEach((f) => console.log(`  ✗ ${f.company}: ${f.reason}`));
  } catch (err) {
    summary.status = "FAILED";
    summary.error = err instanceof Error ? (err.stack ?? err.message) : String(err);
    throw err;
  } finally {
    summary.finishedAt = new Date().toISOString();
    try {
      await writeRunSummary(date, summary);
    } catch (writeErr) {
      console.error("Failed to write _run.md:", writeErr);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
