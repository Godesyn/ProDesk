/** Coerce a JS number to the string form drizzle expects for `numeric` columns. */
export const toMoney = (v: number | null | undefined): string | undefined =>
  v === null || v === undefined ? undefined : v.toFixed(2);

/* ── Directional money rounding (invariant: we never spend more than we hold) ──
 * Every amount the platform COLLECTS rounds UP to whole cents; every amount the
 * platform PAYS OUT (commission payouts, provider transfers, refunds) rounds
 * DOWN. So for any line, collected ≥ Σ disbursed — a few cents may stay unspent
 * with the platform, but disbursements can never exceed what was charged.
 * The `* 100` is normalised with toFixed(6) before ceil/floor so float artefacts
 * (e.g. 105.07 * 100 = 10506.999999) don't push a value across a cent boundary. */
const cents100 = (n: number): number => Number((n * 100).toFixed(6));
/** Round a dollar amount UP to whole cents — money we CHARGE / collect. */
export const roundChargeUp = (n: number): number => Math.ceil(cents100(n)) / 100;
/** Round a dollar amount DOWN to whole cents — money we PAY OUT / refund. */
export const roundPayoutDown = (n: number): number => Math.floor(cents100(n)) / 100;
/** Whole-cent integer (for Stripe `unit_amount`/`amount`), rounding UP — a charge. */
export const chargeCents = (n: number): number => Math.ceil(cents100(n));
/** Whole-cent integer (for Stripe transfers/refunds), rounding DOWN — a payout. */
export const payoutCents = (n: number): number => Math.floor(cents100(n));

export const toPct = (v: number | null | undefined): string | undefined =>
  v === null || v === undefined ? undefined : String(v);

/* ── display formatters (server mirror of client `lib/utils.ts`) ──────────────
 * A whole number renders without decimals (`$1,000`, not `$1,000.00`); a
 * fractional value keeps the full decimals (`$1,234.50`). Use these for every
 * price/number/percentage shown to a user in emails, PDFs and error messages.
 * The `toMoney`/`toPct` helpers above are for DB storage and must NOT change. */
function displayDigits(n: number, maxDecimals: number): number {
  const f = 10 ** maxDecimals;
  return Number.isInteger(Math.round(n * f) / f) ? 0 : maxDecimals;
}

const coerce = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isNaN(n) ? null : n;
};

/** Money: `$1,234`, `$1,234.50`, `$1,000` — null/blank collapses to `$0`. */
export function formatPrice(value: string | number | null | undefined): string {
  const n = coerce(value) ?? 0;
  const digits = displayDigits(n, 2);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Plain number with trailing zeros dropped: `10`, `10.5`, `1,234.25`. */
export function formatNumber(value: string | number | null | undefined, maxDecimals = 2): string {
  const n = coerce(value);
  if (n === null) return '0';
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
}

/** Percentage — `formatNumber` + `%`: `10%`, `7.5%`. */
export function formatPercent(value: string | number | null | undefined, maxDecimals = 2): string {
  return `${formatNumber(value, maxDecimals)}%`;
}
