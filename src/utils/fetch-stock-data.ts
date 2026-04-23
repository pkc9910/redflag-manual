/**
 * Fetch current share price and market cap for a Nasdaq Copenhagen stock.
 *
 * Uses two data sources:
 * - Yahoo Finance v8 chart API for price, name, exchange (no auth required)
 * - Alpha Vantage OVERVIEW endpoint for market cap (free tier: 25 req/day)
 */

import { formatMarketCapDanish } from "./format-danish.js";

export interface StockData {
  ticker: string;
  name: string;
  price: number | null;
  currency: string;
  marketCap: string;
  marketCapRaw: number;
  exchange: string;
}

const EXCHANGE_MAP: Record<string, string> = {
  CSE: "Nasdaq Copenhagen",
  CPH: "Nasdaq Copenhagen",
  NMS: "Nasdaq",
  NGM: "Nasdaq",
};

async function fetchPriceFromYahoo(ticker: string) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; RedflagAnalysis/1.0)" },
  });

  if (!response.ok) {
    throw new Error(`Yahoo Finance chart API error (${response.status}) for ${ticker}`);
  }

  const data = (await response.json()) as {
    chart?: {
      result?: Array<{
        meta?: {
          regularMarketPrice?: number;
          currency?: string;
          exchangeName?: string;
          shortName?: string;
          longName?: string;
        };
      }>;
    };
  };

  const meta = data.chart?.result?.[0]?.meta;
  if (!meta) {
    throw new Error(`No chart data found for ticker ${ticker}`);
  }

  return {
    price: meta.regularMarketPrice ?? null,
    currency: meta.currency ?? "DKK",
    exchange: meta.exchangeName ?? "CPH",
    name: meta.shortName ?? meta.longName ?? ticker.replace(".CO", ""),
  };
}

async function fetchMarketCapFromAlphaVantage(ticker: string): Promise<number> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.log("ALPHA_VANTAGE_API_KEY not set — skipping market cap lookup");
    return 0;
  }

  // Alpha Vantage uses the ticker without the .CO suffix for Copenhagen stocks
  // e.g. "NORTHM.CO" → "NORTHM.CPH" or just the symbol directly
  const avSymbol = ticker.replace(".CO", ".CPH");
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(avSymbol)}&apikey=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) {
    console.log(`Alpha Vantage API error (${response.status}) for ${avSymbol}`);
    return 0;
  }

  const data = (await response.json()) as { MarketCapitalization?: string };
  const raw = data.MarketCapitalization;
  if (!raw || raw === "None") return 0;

  return parseInt(raw, 10) || 0;
}

export async function fetchStockData(ticker: string): Promise<StockData> {
  // Fetch price and market cap in parallel
  const [yahoo, marketCapRaw] = await Promise.all([
    fetchPriceFromYahoo(ticker),
    fetchMarketCapFromAlphaVantage(ticker),
  ]);

  const exchange = EXCHANGE_MAP[yahoo.exchange] ?? yahoo.exchange;
  const marketCap = marketCapRaw
    ? formatMarketCapDanish(marketCapRaw, yahoo.currency)
    : "Ikke tilgængelig";

  return {
    ticker,
    name: yahoo.name,
    price: yahoo.price !== null ? Math.round(yahoo.price * 100) / 100 : null,
    currency: yahoo.currency,
    marketCap,
    marketCapRaw,
    exchange,
  };
}
