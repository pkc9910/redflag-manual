/**
 * One-off: run redflag analysis for Nordea Bank Abp's Q1 2026 release
 * (published 2026-04-22 06:30 CET on Nasdaq Copenhagen).
 *
 * The standard run.ts keyword filter doesn't match "First-quarter results",
 * so we invoke processAnalysis directly with the resolved parameters.
 */

import "dotenv/config";
import { processAnalysis } from "./process-analysis.js";

async function main() {
  const out = await processAnalysis({
    ticker: "NDA-DK.CO",
    companyName: "Nordea Bank Abp",
    releaseUrl:
      "https://view.news.eu.nasdaq.com/view?id=b154e80d76d71b2c6e512a7331be5440b&lang=en&src=listed",
    reportPeriod: "Q1 2026",
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
