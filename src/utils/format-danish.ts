/**
 * Danish number and currency formatting utilities.
 * Port of the formatting logic from archive/tools/fetch_stock_data.py
 */

/**
 * Format a number using Danish conventions (period as thousands separator, comma as decimal).
 * Example: 1234567.89 → "1.234.567,89"
 */
function formatDanishNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decPart ? `${withThousands},${decPart}` : withThousands;
}

/**
 * Format market cap as a Danish-style string with "mio." or "mia." suffix.
 *
 * Examples:
 *   formatMarketCapDanish(45_000_000_000, "DKK") → "DKK 45,0 mia."
 *   formatMarketCapDanish(320_000_000, "DKK")    → "DKK 320,0 mio."
 *   formatMarketCapDanish(50_000, "DKK")          → "DKK 50.000"
 */
export function formatMarketCapDanish(value: number, currency: string): string {
  if (value >= 1_000_000_000) {
    return `${currency} ${formatDanishNumber(value / 1_000_000_000, 1)} mia.`;
  }
  if (value >= 1_000_000) {
    return `${currency} ${formatDanishNumber(value / 1_000_000, 1)} mio.`;
  }
  return `${currency} ${formatDanishNumber(value, 0)}`;
}

/**
 * Format a share price in Danish style.
 * Example: formatPriceDanish(387.50) → "387,50"
 */
export function formatPriceDanish(price: number): string {
  return formatDanishNumber(price, 2);
}
