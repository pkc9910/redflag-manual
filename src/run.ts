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
 *   4. Print a summary of successes and failures.
 */

import "dotenv/config";
import { processAnalysis } from "./process-analysis.js";

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

async function main() {
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

  console.log(`Fetched ${items.length} news items from Nasdaq Copenhagen`);

  const cutoff = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const earningsItems = items.filter((item) => {
    if (item.published && new Date(item.published) < cutoff) return false;
    const lower = item.headline.toLowerCase();
    return EARNINGS_KEYWORDS.some((kw) => lower.includes(kw));
  });

  console.log(`Found ${earningsItems.length} earnings-related releases\n`);

  const successes: string[] = [];
  const failures: Array<{ company: string; reason: string }> = [];

  for (const item of earningsItems) {
    const ticker = await lookupTicker(item.company);
    if (!ticker) {
      console.log(
        `Skipping "${item.headline}" — no CPH ticker for "${item.company}"`
      );
      failures.push({ company: item.company, reason: "no CPH ticker" });
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
      successes.push(`${out.ticker} → ${out.pngPath}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`Failed for ${item.company}: ${reason}`);
      failures.push({ company: item.company, reason });
    }
  }

  console.log("\n========== SUMMARY ==========");
  console.log(`Earnings releases scanned: ${earningsItems.length}`);
  console.log(`Successful: ${successes.length}`);
  successes.forEach((s) => console.log(`  ✓ ${s}`));
  console.log(`Failed: ${failures.length}`);
  failures.forEach((f) => console.log(`  ✗ ${f.company}: ${f.reason}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
