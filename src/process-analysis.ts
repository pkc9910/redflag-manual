/**
 * Plain-function version of the redflag analysis processor — no Trigger.dev wrapper.
 *
 * Mirrors src/trigger/redflag-analysis/process-analysis.ts step-for-step but
 * runs synchronously inside a normal Node process and writes PNG/TXT/HTML to
 * disk instead of returning to a task runner.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fetchStockData } from "./utils/fetch-stock-data.js";
import { fetchConsensusEstimates } from "./utils/fetch-consensus-estimates.js";
import { generateAnalysis } from "./utils/generate-analysis.js";
import { buildHtmlCard, buildTextContent } from "./utils/html-template.js";
import { renderHtmlToImage } from "./utils/render-html.js";
import type { AnalysisData } from "./utils/html-template.js";
import type { ConsensusData } from "./utils/fetch-consensus-estimates.js";

export interface ProcessInput {
  ticker: string;
  companyName: string;
  releaseUrl: string;
  reportPeriod: string;
}

export interface ProcessOutput {
  ticker: string;
  companyName: string;
  pngPath: string;
  txtPath: string;
  htmlPath: string;
  pngBytes: number;
  status: "completed";
}

const OUT_DIR = ".tmp";

function safeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Returns true when reportPeriod clearly describes a full fiscal year
 * (e.g. "Årsrapport 2024/25", "Annual 2025", "FY 2025"). Quarterly and
 * semi-annual interim reports return false — we don't have a free source
 * for per-quarter consensus, so we skip the section in those cases to
 * avoid fabricating an FY-vs-Q1 comparison.
 */
function isAnnualPeriod(reportPeriod: string): boolean {
  const p = reportPeriod.toLowerCase();
  if (/q[1-4]\b|h[12]\b|halvår|interim|kvartals|delårs/i.test(p)) return false;
  return /årsrapport|annual|year-end|fy\s*\d|full[- ]?year/i.test(p);
}

export async function processAnalysis(input: ProcessInput): Promise<ProcessOutput> {
  console.log(`Processing analysis for ${input.companyName} (${input.ticker})`);

  // ── Step 2: Fetch market data ──────────────────────────────────────
  const stockData = await fetchStockData(input.ticker);
  console.log(`Market data: ${stockData.name}, ${stockData.marketCap}`);

  // ── Step 2.5: Fetch analyst consensus (annual reports only) ────────
  // Free sources (MarketScreener, company IR pages) publish FY consensus only,
  // not quarterly. Skip for Q1/Q2/Q3/H1 to avoid apples-to-oranges comparisons.
  let consensus: ConsensusData | null = null;
  if (!isAnnualPeriod(input.reportPeriod)) {
    console.log(
      `Skipping consensus fetch for interim period "${input.reportPeriod}" (quarterly consensus not freely available)`
    );
  } else {
    try {
      consensus = await fetchConsensusEstimates(input.ticker, input.companyName);
      if (consensus) {
        console.log(
          `Consensus: ${consensus.metrics.length} metrics from ${consensus.sourceUrl}`
        );
      } else {
        console.warn(`No consensus available for ${input.ticker} — proceeding without`);
      }
    } catch (err) {
      console.warn(`Consensus fetch failed for ${input.ticker}:`, err);
      consensus = null;
    }
  }

  // ── Step 3: Fetch earnings data from press release ─────────────────
  const releaseResponse = await fetch(input.releaseUrl);
  if (!releaseResponse.ok) {
    throw new Error(
      `Failed to fetch release (${releaseResponse.status}): ${input.releaseUrl}`
    );
  }
  const releaseHtml = await releaseResponse.text();

  const earningsText = releaseHtml
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30_000);

  console.log(`Earnings text extracted: ${earningsText.length} chars`);

  // ── Step 4: Generate analysis content via Claude Code CLI ──────────
  const analysis = await generateAnalysis(
    stockData.name,
    input.ticker,
    input.reportPeriod,
    earningsText,
    consensus
  );
  console.log("Analysis generated via Claude Code CLI");

  const analysisData: AnalysisData = {
    companyName: stockData.name,
    ticker: input.ticker,
    exchange: stockData.exchange,
    price: stockData.price?.toString() ?? "N/A",
    marketCap: stockData.marketCap,
    reportPeriod: input.reportPeriod,
    positive: analysis.positive,
    negative: analysis.negative,
    consensus: analysis.consensus,
    consensusSourceUrl: consensus?.sourceUrl,
  };

  // ── Step 5-6: Build HTML and render PNG ────────────────────────────
  const html = buildHtmlCard(analysisData);
  const pngBuffer = await renderHtmlToImage(html);
  console.log(`PNG rendered: ${pngBuffer.length} bytes`);

  // ── Step 7: Generate text content ──────────────────────────────────
  const textContent = buildTextContent(analysisData);

  // ── Step 8: Persist outputs ────────────────────────────────────────
  await mkdir(OUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const slug = safeSlug(input.ticker);
  const pngPath = join(OUT_DIR, `${slug}_redflag_${date}.png`);
  const txtPath = join(OUT_DIR, `${slug}_redflag_${date}.txt`);
  const htmlPath = join(OUT_DIR, `${slug}_redflag_card.html`);

  await writeFile(pngPath, pngBuffer);
  await writeFile(txtPath, textContent, "utf8");
  await writeFile(htmlPath, html, "utf8");

  console.log(`Wrote ${pngPath}, ${txtPath}, ${htmlPath}`);

  return {
    ticker: input.ticker,
    companyName: stockData.name,
    pngPath,
    txtPath,
    htmlPath,
    pngBytes: pngBuffer.length,
    status: "completed",
  };
}
