import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Round to `maxDecimals` and decide how many fraction digits to show: a whole
 * number shows none (so `$1,000`, not `$1,000.00`); a fractional value keeps the
 * full `maxDecimals` (so `$1,234.50`). This is the single rule behind every price,
 * number, percentage and editable-field formatter below.
 */
function fractionDigitsFor(n: number, maxDecimals: number): number {
  const f = 10 ** maxDecimals;
  return Number.isInteger(Math.round(n * f) / f) ? 0 : maxDecimals;
}

const toNum = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isNaN(n) ? null : n;
};

/**
 * Canonical money formatter — `$`-prefixed, thousands-separated, and no trailing
 * `.00` on whole numbers: `$1,234`, `$1,234.50`, `$1,000`. Use this (or
 * {@link formatCurrency}, its alias) for every price shown to a user.
 * Drizzle returns numeric columns as strings, so strings are accepted.
 */
export function formatPrice(value: string | number | null | undefined, currency = 'AUD') {
  const n = toNum(value);
  if (n === null) return '—';
  const digits = fractionDigitsFor(n, 2);
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** Back-compat alias — every existing caller keeps working, now without trailing `.00`. */
export const formatCurrency = formatPrice;

/**
 * Plain number — thousands-separated with trailing zeros dropped: `10`, `10.5`,
 * `1,234.25`. Use for any non-money quantity (counts, durations, weeks, rates).
 */
export function formatNumber(value: string | number | null | undefined, maxDecimals = 2) {
  const n = toNum(value);
  if (n === null) return '—';
  return new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(n);
}

/** Percentage — `formatNumber` plus a `%` suffix: `10%`, `7.5%`, `12.25%`. */
export function formatPercent(value: string | number | null | undefined, maxDecimals = 2) {
  const n = toNum(value);
  if (n === null) return '—';
  return `${formatNumber(n, maxDecimals)}%`;
}

/**
 * Normalize a stored numeric value into a clean editable input string: a DB
 * `"100.00"` becomes `"100"`, `"100.50"` becomes `"100.5"`, empty stays empty.
 * Seed every price/fee/commission/quantity text field with this so reopening an
 * edit form never resurrects a `.00` the user never typed.
 */
export function toNumberInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return typeof value === 'string' ? value : '';
  return String(n);
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(value));
}

/**
 * Round a dollar amount UP to whole cents — mirrors
 * `server/src/lib/num.ts#roundChargeUp`. Use this for every price shown to the
 * user that represents what Stripe will actually charge (the "collect"
 * direction). The `toFixed(6)` normalisation prevents float artefacts (e.g.
 * `105.07 * 100 = 10506.999…`) from pushing a value across a cent boundary.
 */
export function roundChargeUp(n: number): number {
  return Math.ceil(Number((n * 100).toFixed(6))) / 100;
}

export function initialsOf(name?: string | null, fallback = '?') {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || fallback;
}
