/* Verdiict app — shared types + pure helpers. tRPC output types are inferred
 * from the server router so pages stay end-to-end typed. */
import type { RouterOutputs } from '@server/trpc/router';
import { badgeBox, badgeThemeQuery, type ReviewBadgeTheme } from '@server/modules/reviews/badge-theme';
import { API_URL } from '@shared/lib/env';
import { redirectorUrl } from '@shared/lib/origins';

export type ReviewLocation = RouterOutputs['reviews']['locations']['list'][number];
export type LocationDetail = RouterOutputs['reviews']['locations']['get'];
export type Entitlement = RouterOutputs['reviews']['entitlement'];
export type ReviewRow = RouterOutputs['reviews']['dashboard']['reviews'][number];
export type ReviewRequestRow = RouterOutputs['reviews']['reviewRequests']['listForBrand'][number];
export type CollectionRow = RouterOutputs['reviews']['collections']['list']['items'][number];
export type RewardRow = RouterOutputs['reviews']['rewards']['list']['rewards'][number];
export type Industry = RouterOutputs['reviews']['industries']['list'][number];
export type DirectoryListing = RouterOutputs['reviews']['directory']['search'][number];
export type DirectoryProfileData = RouterOutputs['reviews']['directory']['profile'];

/** Review-platform display metadata (frontend-only; the slugs match the enum). */
export type PlatformSlug = 'google' | 'facebook' | 'trustpilot' | 'yelp' | 'tripadvisor';
export const PLATFORMS: Array<{
  slug: PlatformSlug;
  label: string;
  letter: string;
  placeholder: string;
}> = [
  { slug: 'google', label: 'Google', letter: 'G', placeholder: 'https://g.page/r/YOUR_PLACE_ID/review' },
  { slug: 'facebook', label: 'Facebook', letter: 'F', placeholder: 'https://www.facebook.com/YOUR_PAGE/reviews' },
  { slug: 'trustpilot', label: 'Trustpilot', letter: 'T', placeholder: 'https://www.trustpilot.com/evaluate/yourbusiness.com' },
  { slug: 'yelp', label: 'Yelp', letter: 'Y', placeholder: 'https://www.yelp.com/writeareview/biz/YOUR_BIZ_ID' },
  { slug: 'tripadvisor', label: 'Tripadvisor', letter: 'TA', placeholder: 'https://www.tripadvisor.com/UserReviewEdit-g-d-YOUR_ID' },
];

/** Lifetime cap on review-link (slug) renames — mirrors the server's
 * MAX_SLUG_CHANGES (routers/reviews.ts); the server enforces it. */
export const MAX_SLUG_CHANGES = 5;

/** The API origin (where the public embed iframe is served from). */
export const API_BASE: string = API_URL || window.location.origin;

/** Public review-capture link for a location slug (this frontend's origin). */
export function reviewLink(slug: string): string {
  return `${window.location.origin}/r/${slug}`;
}

/**
 * The URL encoded into printed QR codes: a redirector hop keyed by the
 * location's immutable id, so a printed code survives review-link (slug)
 * renames — each scan 302s to the location's CURRENT /r/:slug page.
 *
 * Always the canonical redirector host — never the host this app is served from,
 * which can be a brand subdomain (`noize.adeyy.com`) the redirector doesn't
 * answer on, and a printed code can't be corrected after the fact.
 */
export function qrLink(locationId: string): string {
  return redirectorUrl(`/v/${locationId}`) ?? '';
}

/** The iframe embed install snippet for a location. */
export function embedSnippet(slug: string): string {
  const src = `${API_BASE}/embed/loc/${slug}`;
  return `<iframe src="${src}" style="width:100%;border:0;" loading="lazy" title="Reviews"></iframe>
<script>addEventListener('message',function(e){if(e.data&&e.data.type==='pm:resize'){var f=document.querySelector('iframe[src^="${src}"]');if(f)f.style.height=e.data.height+'px';}});</script>`;
}

/** The iframe embed install snippet for a multi-location collection. */
export function collectionEmbedSnippet(slug: string): string {
  const src = `${API_BASE}/embed/col/${slug}`;
  return `<iframe src="${src}" style="width:100%;border:0;" loading="lazy" title="Reviews"></iframe>
<script>addEventListener('message',function(e){if(e.data&&e.data.type==='pm:resize'){var f=document.querySelector('iframe[src^="${src}"]');if(f)f.style.height=e.data.height+'px';}});</script>`;
}

/**
 * The "Verdiict Verified" badge iframe URL for one directory LISTING.
 *
 * A listing is a location, so the badge is addressed the same way the public
 * profile is: `/badge/<brandSlug>?location=<locationSlug>`. The location rides
 * in the query string rather than the path so the existing `/badge/:slug` and
 * `/badge/:slug.json` routes (and every badge already installed on a customer
 * site) keep matching.
 *
 * `o` tells the API which frontend origin hosts the directory (the badge's
 * click-through target); the server validates it against its origin allow-list.
 * The design travels in the same query string — see badge-theme.ts.
 */
export function badgeUrl(
  brandSlug: string,
  locationSlug: string,
  theme: ReviewBadgeTheme,
): string {
  const query = badgeThemeQuery(theme);
  const origin = `o=${encodeURIComponent(window.location.origin)}`;
  const loc = locationSlug ? `&location=${encodeURIComponent(locationSlug)}` : '';
  return `${API_BASE}/badge/${encodeURIComponent(brandSlug)}?${origin}${loc}${query ? `&${query}` : ''}`;
}

/**
 * Install snippet for the badge. Width is fluid up to the variant's intrinsic
 * size and the height is corrected by the badge's own `pm:resize` message, so
 * the badge never clips and never leaves a gap on a narrow page.
 */
export function badgeEmbedSnippet(
  brandSlug: string,
  locationSlug: string,
  theme: ReviewBadgeTheme,
): string {
  const src = badgeUrl(brandSlug, locationSlug, theme);
  const box = badgeBox(theme);
  return `<iframe src="${src}" title="Verdiict Verified" loading="lazy" scrolling="no" style="width:100%;max-width:${box.width}px;height:${box.height}px;border:0;overflow:hidden;display:block${theme.align === 'center' ? ';margin:0 auto' : ''}"></iframe>
<script>addEventListener('message',function(e){if(e.data&&e.data.type==='pm:resize'){var f=document.querySelector('iframe[src^="${API_BASE}/badge/${encodeURIComponent(brandSlug)}"]');if(f)f.style.height=e.data.height+'px';}});</script>`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso: string | Date | number): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
export function fmtDateTime(iso: string | Date | number): string {
  const d = new Date(iso);
  const hh = d.getHours() % 12 || 12;
  const ap = d.getHours() < 12 ? 'am' : 'pm';
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(iso)} · ${hh}:${mm} ${ap}`;
}
export function num(n: number): string {
  return (n ?? 0).toLocaleString('en-AU');
}
export function money(amount: number, currency = 'AUD'): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(amount);
}

/** Page-prop contract passed by ReviewsApp to every workspace page. */
export type Page =
  | 'locations'
  | 'location'
  | 'reviewsLog'
  | 'requests'
  | 'embed'
  | 'embedDetail'
  | 'collection'
  | 'progress'
  | 'directory'
  | 'team'
  | 'billing'
  | 'trash'
  | 'support';

export type RouteParams = { id?: string };

export type PageProps = {
  brandId: string;
  entitlement: Entitlement | undefined;
  /** Whether the current user may write (brand owner or `reviews` permission);
   * `reviewsViewer`-only staff get a read-only UI. Mirrors the server gate. */
  canEdit: boolean;
  /** Whether the current user may SEND review requests. Broader than `canEdit`:
   * read-only viewers (`reviewsViewer`) can invite customers to leave a review
   * without gaining edit rights. Mirrors the server's requireLocationSend gate. */
  canSendRequests: boolean;
  go: (page: Page, params?: RouteParams) => void;
  params: RouteParams;
};
