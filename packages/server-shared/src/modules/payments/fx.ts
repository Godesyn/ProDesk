/**
 * Payments (EziQuotes) — live FX rate fetching utility, ported 1:1 from the
 * export's server/fx.ts.
 * Uses the free Open Exchange Rates compatible API (exchangerate-api.com,
 * fallback to hardcoded rates). Rates are cached in-memory for 1 hour to avoid
 * excessive API calls.
 */

interface FxCache {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

let _cache: FxCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const FALLBACK_RATES: Record<string, number> = {
  AUD: 1.0,
  USD: 0.6450,
  GBP: 0.5100,
  EUR: 0.5950,
  NZD: 1.0850,
  CAD: 0.8850,
  SGD: 0.8700,
  JPY: 97.50,
  HKD: 5.04,
};

/**
 * Fetch live FX rates with AUD as base currency.
 * Falls back to hardcoded rates if the API is unavailable.
 */
export async function getFxRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.rates;
  }

  try {
    // Use exchangerate-api (free tier, no key required for basic usage)
    const res = await fetch('https://api.exchangerate-api.com/v4/latest/AUD', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { base: string; rates: Record<string, number> };
    _cache = { base: 'AUD', rates: data.rates, fetchedAt: now };
    console.log('[FX] Rates refreshed from exchangerate-api.com');
    return data.rates;
  } catch (err) {
    console.warn('[FX] Rate fetch failed, using fallback rates:', (err as Error).message);
    // Return fallback rates but don't cache them (retry next time)
    return FALLBACK_RATES;
  }
}

/**
 * Get the exchange rate from AUD to the target currency.
 * Returns 1.0 if the target is AUD.
 */
export async function getAudToRate(targetCurrency: string): Promise<number> {
  if (targetCurrency === 'AUD') return 1.0;
  const rates = await getFxRates();
  return rates[targetCurrency.toUpperCase()] ?? 1.0;
}

/**
 * Convert an amount in AUD cents to the target currency cents.
 * Returns the converted amount and the rate used.
 */
export async function convertFromAud(
  audCents: number,
  targetCurrency: string
): Promise<{ convertedCents: number; rate: number }> {
  const rate = await getAudToRate(targetCurrency);
  return {
    convertedCents: Math.round(audCents * rate),
    rate,
  };
}

/**
 * Convert an amount in a foreign currency cents to AUD cents.
 */
export async function convertToAud(
  foreignCents: number,
  fromCurrency: string
): Promise<{ audCents: number; rate: number }> {
  const rate = await getAudToRate(fromCurrency);
  return {
    audCents: Math.round(foreignCents / rate),
    rate,
  };
}

/**
 * Calculate tax breakdown for a set of line items.
 * Returns { subtotalCents, taxCents, totalCents } in the proposal's currency.
 *
 * Tax logic:
 * - "inclusive": price already includes tax. subtotal = total / (1 + rate). tax = total - subtotal.
 * - "exclusive": tax is added on top. subtotal = price. tax = price * rate. total = price + tax.
 * - "exempt": no tax. subtotal = price. tax = 0. total = price.
 */
export function calculateTaxBreakdown(
  lineItems: Array<{
    type: string;
    quantity: number;
    unitPriceCents: number;
    taxBehaviour: 'inclusive' | 'exclusive' | 'exempt';
    taxRate?: number; // percentage, e.g. 10 for 10%
  }>,
  defaultTaxRate: number = 10
): { subtotalCents: number; taxCents: number; totalCents: number } {
  let subtotalCents = 0;
  let taxCents = 0;
  let totalCents = 0;

  for (const li of lineItems) {
    if (li.type === 'break') continue;

    const lineTotalCents = Math.round(li.quantity * li.unitPriceCents);
    const rate = (li.taxRate ?? defaultTaxRate) / 100;
    const behaviour = li.taxBehaviour ?? 'inclusive';

    if (behaviour === 'inclusive') {
      // Price includes tax — extract it
      const lineSubtotal = Math.round(lineTotalCents / (1 + rate));
      const lineTax = lineTotalCents - lineSubtotal;
      subtotalCents += lineSubtotal;
      taxCents += lineTax;
      totalCents += lineTotalCents;
    } else if (behaviour === 'exclusive') {
      // Tax added on top
      const lineTax = Math.round(lineTotalCents * rate);
      subtotalCents += lineTotalCents;
      taxCents += lineTax;
      totalCents += lineTotalCents + lineTax;
    } else {
      // Exempt — no tax
      subtotalCents += lineTotalCents;
      taxCents += 0;
      totalCents += lineTotalCents;
    }
  }

  return { subtotalCents, taxCents, totalCents };
}
