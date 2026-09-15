import { formatCurrency } from '../../lib/utils';

export interface PriceParts {
  amount?: number | null;
  interval?: 'week' | 'month' | null;
  currency?: string | null;
}

/** Human price label like "$299/mo" / "$22.99/wk". Null when no amount is set. */
export function priceLabel(p: PriceParts): string | null {
  if (p.amount == null) return null;
  const suffix = p.interval ? (p.interval === 'week' ? '/wk' : '/mo') : '';
  return `${formatCurrency(p.amount, p.currency ?? 'AUD')}${suffix}`;
}

/**
 * Fill template tokens in admin-editable card copy (title, subtitle, description
 * and button label all support the same tokens). Supported tokens: `{price}` —
 * the live Feature Subscription price, so the amount shown always tracks the
 * configured price instead of a hardcoded value.
 *
 * When the price is unknown, the token — and a leading connector ("for ", "·",
 * "—") — is stripped so the copy still reads cleanly.
 */
export function fillCardCopy(text: string | null | undefined, vars: { price: string | null }): string {
  if (!text) return '';
  if (vars.price != null) return text.replace(/\{price\}/g, vars.price);
  return text.replace(/\s*(?:for\s+|·\s*|—\s*)?\{price\}/gi, '').trim();
}
