/**
 * Manual backfill entry point: run processAnalysis directly with CLI-provided
 * ticker/url/period/company. Used when the standard run.ts keyword filter
 * misses a release (e.g. "First-quarter results" not matching earnings keywords).
 *
 * Usage:
 *   npm run manual -- \
 *     --ticker NDA-DK.CO \
 *     --url "https://view.news.eu.nasdaq.com/view?id=..." \
 *     --company "Nordea Bank Abp" \
 *     --period "Q1 2026"
 */

import "dotenv/config";
import { processAnalysis } from "./process-analysis.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("--")) {
        throw new Error(`Missing value for --${key}`);
      }
      out[key] = val;
      i++;
    }
  }
  return out;
}

function requireArg(args: Record<string, string>, name: string): string {
  const v = args[name];
  if (!v) throw new Error(`Required argument --${name} missing`);
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const ticker = requireArg(args, "ticker");
  const url = requireArg(args, "url");
  const company = requireArg(args, "company");
  const period = requireArg(args, "period");

  console.log(`── Manual run: ${company} (${ticker}) — ${period} ──`);

  const out = await processAnalysis({
    ticker,
    companyName: company,
    releaseUrl: url,
    reportPeriod: period,
  });

  console.log("\n========== DONE ==========");
  console.log(`Company:  ${out.companyName} (${out.ticker})`);
  console.log(`PNG:      ${out.pngPath} (${out.pngBytes} bytes)`);
  console.log(`TXT:      ${out.txtPath}`);
  console.log(`HTML:     ${out.htmlPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
