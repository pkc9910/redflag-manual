/**
 * Fetch analyst consensus estimates from MarketScreener for a Copenhagen-listed ticker.
 *
 * Strategy:
 *   1. Resolve the Yahoo-style ticker (e.g. "DANSKE.CO") to a MarketScreener slug
 *      via the public search page, validated against ticker/company-name tokens.
 *   2. Fetch the per-quote /financials/ page (the /consensus/ page no longer
 *      embeds the estimates table).
 *   3. Parse the structured estimates <table>: thead for year columns, tbody rows
 *      for Net sales / Net income / EBITDA / EBIT / EPS. Raw full-precision values
 *      live in <span title="..."> attributes; currency is the visible efd_XXX class.
 *
 * Returns null on any failure so the caller can degrade gracefully.
 */

export type ConsensusMetricName =
  | "Revenue"
  | "EBITDA"
  | "EBIT"
  | "NetIncome"
  | "EPS";

export interface ConsensusMetric {
  metric: ConsensusMetricName;
  period: string;
  value: number;
  unit: string;
  analystCount?: number;
}

export interface ConsensusData {
  source: "MarketScreener";
  sourceUrl: string;
  retrievedAt: string;
  metrics: ConsensusMetric[];
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function userAgent(): string {
  return process.env.MARKETSCREENER_USER_AGENT || DEFAULT_USER_AGENT;
}

/**
 * Build the tokens a valid slug must contain at least one of. We tokenise
 * the company name (minus generic suffixes like "A/S", "Bank", "Abp") and
 * the ticker base, lowercase everything, and drop 1–2-character tokens.
 */
function slugMatchTokens(ticker: string, companyName?: string): string[] {
  const tokens = new Set<string>();
  const tickerBase = ticker.replace(/\.CO$/i, "").split(/[-.]/)[0];
  if (tickerBase) tokens.add(tickerBase.toLowerCase());

  if (companyName) {
    const STOP = new Set([
      "a", "s", "as", "a/s", "abp", "ab", "oyj", "plc", "inc", "corp",
      "holding", "holdings", "group", "the", "and", "&", "co", "bank",
    ]);
    for (const raw of companyName.split(/\s+/)) {
      const t = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (t.length >= 3 && !STOP.has(t)) tokens.add(t);
    }
  }
  return [...tokens];
}

/**
 * Try to resolve a Yahoo ticker to a MarketScreener quote URL fragment like
 * "/quote/stock/DANSKE-BANK-A-S-1412871/". Uses the company name (if given)
 * as the primary search query, then the ticker variants as fallbacks. The
 * resolved slug is validated against ticker/company-name tokens so we don't
 * silently return an unrelated top-of-page result (sidebar, trending stocks).
 */
async function resolveQuoteSlug(
  ticker: string,
  companyName?: string
): Promise<string | null> {
  const candidates = [
    companyName,
    ticker,
    ticker.replace(/\.CO$/i, ""),
    ticker.split(".")[0],
  ].filter((q): q is string => !!q);

  const tokens = slugMatchTokens(ticker, companyName);
  const seen = new Set<string>();

  for (const q of candidates) {
    if (seen.has(q)) continue;
    seen.add(q);

    const searchUrl = `https://www.marketscreener.com/search/?q=${encodeURIComponent(q)}`;
    let html: string;
    try {
      const res = await fetch(searchUrl, { headers: { "User-Agent": userAgent() } });
      if (!res.ok) {
        console.log(`MarketScreener search HTTP ${res.status} for "${q}"`);
        continue;
      }
      html = await res.text();
    } catch (err) {
      console.log(`MarketScreener search fetch failed for "${q}":`, err);
      continue;
    }

    const slugMatches = Array.from(
      html.matchAll(/href="(\/quote\/stock\/([A-Za-z0-9\-]+)\/)/g)
    );

    for (const m of slugMatches) {
      const slug = m[1];
      const slugTokens = m[2].toLowerCase();
      if (tokens.some((t) => slugTokens.includes(t))) {
        return slug;
      }
    }

    if (tokens.length === 0 && slugMatches.length > 0) {
      return slugMatches[0][1];
    }
  }

  return null;
}

/**
 * Parse a localized number string like "1,234.5", "1.234,5", "1 234,5",
 * "11,983,030,090" (US thousands, no decimal) into a JS number.
 * Returns NaN if we can't make sense of it.
 */
function parseLocalizedNumber(raw: string): number {
  let s = raw.replace(/\s/g, "").replace(/[^\d,.\-]/g, "");
  if (!s) return NaN;

  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;

  if (commas >= 2 && dots === 0) {
    // "11,983,030,090" — US thousands, no decimal
    s = s.replace(/,/g, "");
  } else if (dots >= 2 && commas === 0) {
    // "11.983.030.090" — European thousands, no decimal
    s = s.replace(/\./g, "");
  } else {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) {
      // European: "1.234,5" — dots are thousands, comma is decimal
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      // US: "1,234.5" — commas are thousands, dot is decimal
      s = s.replace(/,/g, "");
    }
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Classify a MarketScreener row label (e.g. "Net sales", "EBITDA",
 * "Operating income", "Earnings per Share") into our canonical metric name.
 * Returns null for rows we don't care about (e.g. "Net Debt").
 */
function classifyLabel(label: string): ConsensusMetricName | null {
  const l = label.toLowerCase().trim();
  if (/^(net sales|sales|revenue|net banking product)$/.test(l)) return "Revenue";
  if (/^ebitda$/.test(l)) return "EBITDA";
  if (/^(ebit|operating (income|profit))$/.test(l) && !/ebitda/.test(l)) return "EBIT";
  if (/^net (income|profit|result)$/.test(l)) return "NetIncome";
  if (/^(eps|earnings per share)$/.test(l)) return "EPS";
  return null;
}

/**
 * Extract the full-precision raw value for the visible (non-`c-none`) currency
 * span inside a <th> cell. MarketScreener emits every currency in parallel and
 * hides all but the default one with `c-none`. The value lives in a nested
 * <span title="12,345,678"> attribute.
 *
 * Returns { raw, currency } or null if the cell doesn't match the shape.
 */
function extractCellValue(cellHtml: string): { raw: number; currency: string } | null {
  // Find all efd_XXX currency spans; pick the first without c-none.
  const currencyMatches = Array.from(
    cellHtml.matchAll(
      /<span\s+class="efd_([A-Z]{3})\s*([^"]*)"[^>]*>\s*<span\s+title="([^"]+)"/g
    )
  );
  for (const m of currencyMatches) {
    const [, currency, classes, title] = m;
    if (!/\bc-none\b/.test(classes)) {
      const raw = parseLocalizedNumber(title);
      if (Number.isFinite(raw)) {
        return { raw, currency };
      }
    }
  }
  return null;
}

/**
 * Parse the financial estimates <table> on a MarketScreener /financials/ page.
 * Expected shape:
 *   <thead><tr><th></th><th>2026 *</th><th>2027 *</th></tr></thead>
 *   <tbody>
 *     <tr><td class="table-child--nowrap">Net sales</td><th>...</th><th>...</th></tr>
 *     ...
 *   </tbody>
 */
function parseConsensusTable(html: string): ConsensusMetric[] {
  // Find every <table> and pick the first one whose <thead> exposes year
  // columns like "2026 *" / "2027 *" (the asterisk marks estimate).
  const tables = Array.from(html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g));

  for (const tMatch of tables) {
    const tableHtml = tMatch[1];
    const thead = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/);
    if (!thead) continue;
    const yearHeaders = Array.from(
      thead[1].matchAll(/<th[^>]*>\s*(20\d{2})\s*\*?\s*<\/th>/g)
    ).map((m) => m[1]);
    if (yearHeaders.length < 1) continue;

    const tbody = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!tbody) continue;

    const metrics: ConsensusMetric[] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    for (const rMatch of tbody[1].matchAll(rowRegex)) {
      const rowHtml = rMatch[1];
      const labelMatch = rowHtml.match(
        /<td[^>]*class="[^"]*table-child--nowrap[^"]*"[^>]*>([^<]+)<\/td>/
      );
      if (!labelMatch) continue;
      const canonical = classifyLabel(labelMatch[1]);
      if (!canonical) continue;

      const cells = Array.from(rowHtml.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g));
      cells.slice(0, yearHeaders.length).forEach((cell, i) => {
        const value = extractCellValue(cell[1]);
        const period = yearHeaders[i];
        if (!value || !period) return;
        const isEps = canonical === "EPS";
        metrics.push({
          metric: canonical,
          period: `FY${period}`,
          value: isEps ? value.raw : value.raw / 1_000_000,
          unit: isEps ? value.currency : `${value.currency} mio.`,
        });
      });
    }

    if (metrics.length > 0) return metrics;
  }

  return [];
}

export async function fetchConsensusEstimates(
  ticker: string,
  companyName?: string
): Promise<ConsensusData | null> {
  const slug = await resolveQuoteSlug(ticker, companyName);
  if (!slug) {
    console.log(`MarketScreener: could not resolve slug for ${ticker}`);
    return null;
  }

  const sourceUrl = `https://www.marketscreener.com${slug}financials/`;
  let html: string;
  try {
    const res = await fetch(sourceUrl, { headers: { "User-Agent": userAgent() } });
    if (!res.ok) {
      console.log(`MarketScreener consensus HTTP ${res.status} for ${ticker} (${sourceUrl})`);
      return null;
    }
    html = await res.text();
  } catch (err) {
    console.log(`MarketScreener consensus fetch failed for ${ticker}:`, err);
    return null;
  }

  const metrics = parseConsensusTable(html);
  if (metrics.length === 0) {
    console.log(`MarketScreener: no parseable consensus rows for ${ticker} (${sourceUrl})`);
    return null;
  }

  return {
    source: "MarketScreener",
    sourceUrl,
    retrievedAt: new Date().toISOString(),
    metrics,
  };
}
