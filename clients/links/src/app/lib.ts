/* Adeyy app — pure helpers, ported from the Manus export's data.js. */
import type { RouterOutputs } from '@server/trpc/router';
import { redirectorHost } from '@shared/lib/origins';

export type ShortLink = RouterOutputs['shortLinks']['list']['items'][number];
export type Entitlement = RouterOutputs['shortLinks']['entitlement'];
/** A campaign = a scheduled short link, with its windows + live resolution. */
export type Campaign = RouterOutputs['linkCampaigns']['list']['items'][number];
export type CampaignDetail = RouterOutputs['linkCampaigns']['byId'];
export type CampaignWindow = CampaignDetail['windows'][number];
export type LinkInvoice = RouterOutputs['shortLinks']['invoices'][number];
export type LinkCard = RouterOutputs['shortLinks']['paymentMethod'];

/** Stripe publishable (client) key for the Billing card form (re-exported from
 * the central env module so app code has one import path). */
export { STRIPE_PUBLISHABLE_KEY } from '@shared/lib/env';

/**
 * The redirector origin short links resolve against (e.g. "www.adeyy.com") —
 * always the canonical host from `redirectorHost()`, never the host this app
 * happens to be served from, so a brand subdomain can't end up in a short link.
 */
export const REDIRECTOR_BASE_NO_PROTOCOL: string =
  redirectorHost() ?? 'www.adeyy.com';
export const REDIRECTOR_BASE = `https://${REDIRECTOR_BASE_NO_PROTOCOL}`;

/** "adeyy.com/winter-menu" — the display form of a slug (omits leading www.). */
export function shortDisplay(slug: string): string {
  const host = REDIRECTOR_BASE_NO_PROTOCOL.replace(/^www\./i, '');
  return slug ? `${host}/${slug}` : `${host}/`;
}
/** Full, copyable URL for a slug. */
export function shortUrl(slug: string): string {
  return `${REDIRECTOR_BASE}/${slug}`;
}
/**
 * URL to encode inside a QR code. The `?qr=1` marker lets the redirector record
 * the hit as a scan (source='qr') so QR traffic is distinguishable from clicks.
 */
export function qrUrl(slug: string): string {
  return `${REDIRECTOR_BASE}/${slug}?qr=1`;
}

const RESERVED = [
  'pricing', 'features', 'login', 'signup', 'about', 'terms', 'privacy', 'app',
  'api', 'admin', 'dashboard', 'qr', 'link', 'links', 's', 'health', 'status',
  'help', 'support', 'blog', 'docs',
];
const BASE32 = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A random 6-char slug that doesn't collide with the caller's existing set. */
export function autoSlug(existing: string[]): string {
  let s = '';
  do {
    s = '';
    for (let i = 0; i < 6; i++)
      s += BASE32[Math.floor(Math.random() * BASE32.length)];
  } while (existing.indexOf(s) > -1);
  return s;
}

/** Fast client-side slug validation. Returns an error string, or null if OK. */
export function slugProblem(slug: string, existing: string[]): string | null {
  if (!slug) return 'Type an ending to check it.';
  if (!/^[a-z0-9-]+$/.test(slug))
    return 'Lowercase letters, numbers and hyphens only.';
  if (slug.length < 3) return 'Too short. Three characters minimum.';
  if (slug.length > 60) return 'Too long. Sixty characters maximum.';
  if (RESERVED.indexOf(slug) > -1) return 'That ending is reserved.';
  if (existing.indexOf(slug) > -1) return 'Taken by one of your links.';
  return null;
}

/** Validate a destination URL. Returns an error string, or null if OK. */
export function validDest(url: string): string | null {
  if (!/^https?:\/\//i.test(url))
    return 'Destinations must start with http:// or https://';
  if (!/^https?:\/\/.+\..+/i.test(url))
    return 'That does not look like a full address.';
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
export function fmtDateTime(iso: string | Date): string {
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? 'am' : 'pm';
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(iso)} · ${hh}:${mm} ${ap}`;
}
export function num(n: number): string {
  return (n ?? 0).toLocaleString('en-AU');
}

/** "May 26" — compact month + 2-digit year, for the invoices list. */
export function monthYear(iso: string | Date): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

export const PARKING_DAYS = 30;

export function daysUntilDeletion(disabledAt?: string | Date | null, createdAt?: string | Date | null): number {
  const base = disabledAt ? new Date(disabledAt) : createdAt ? new Date(createdAt) : new Date();
  const deleteDate = new Date(base.getTime() + PARKING_DAYS * 24 * 60 * 60 * 1000);
  const diffMs = deleteDate.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

export function deletionDateFormatted(disabledAt?: string | Date | null, createdAt?: string | Date | null): string {
  const base = disabledAt ? new Date(disabledAt) : createdAt ? new Date(createdAt) : new Date();
  const deleteDate = new Date(base.getTime() + PARKING_DAYS * 24 * 60 * 60 * 1000);
  return fmtDate(deleteDate);
}


/** Money formatter for the billing meta line. */
export function money(amount: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
  }).format(amount);
}
