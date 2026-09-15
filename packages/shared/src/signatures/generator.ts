/**
 * SIGKITT — HTML Generator
 * - Inline SVG social icons (email-safe base64 approach via img tags)
 * - Logo width control
 * - Clickable banner image
 * - All 8 templates
 * - Redirector-based click tracking (TrackingContext)
 */

import type { SignatureData } from './types';

/**
 * When provided, every clickable URL in the signature HTML is wrapped through
 * the redirector service for server-side click tracking.
 * When absent (preview mode), links are left as-is.
 */
export interface TrackingContext {
  /** Redirector base URL, e.g. "https://url.prodesk.com" */
  redirectorBase: string;
  /** The Prodesk brand id that owns this signature. */
  brandId: string;
  /** The signature brand id (optional). */
  signatureBrandId?: string;
  /** The member id whose signature this is (optional). */
  memberId?: string;
  /** The campaign id for banner campaigns (optional). */
  campaignId?: string;
}

/**
 * Wrap a destination URL through the redirector's `/s/` route for click tracking.
 * If no TrackingContext is provided (preview mode), returns the raw destination.
 * Skips wrapping for tel: and mailto: links (can't HTTP-redirect those).
 */
export function wrapTrackingUrl(
  destination: string,
  eventType: string,
  ctx?: TrackingContext,
  label?: string,
): string {
  if (!ctx) return destination;
  // tel: and mailto: links can't go through an HTTP redirect
  if (/^(tel|mailto):/i.test(destination)) return destination;

  const params = new URLSearchParams();
  params.set('url', destination);
  params.set('brand', ctx.brandId);
  params.set('event', eventType);
  if (ctx.signatureBrandId) params.set('sb', ctx.signatureBrandId);
  if (ctx.memberId) params.set('member', ctx.memberId);
  if (ctx.campaignId) params.set('campaign', ctx.campaignId);
  if (label) params.set('label', label);
  return `${ctx.redirectorBase}/s/?${params.toString()}`;
}
/**
 * Wrap an address in a Google Maps hyperlink (email-safe inline style).
 */
/**
 * Ensure a URL has an absolute protocol so it never resolves as a relative path
 * on the email client's domain. Leaves mailto:, tel:, https://, http:// unchanged.
 */
function ensureAbsoluteUrl(url: string): string {
  if (!url) return url;
  if (/^(https?|mailto|tel):/i.test(url)) return url;
  return `https://${url}`;
}

function addressLink(address: string, style: string, tracking?: TrackingContext): string {
  const encoded = encodeURIComponent(address);
  const href = wrapTrackingUrl(`https://maps.google.com/?q=${encoded}`, 'website_click', tracking, 'address');
  return `<a href="${href}" style="${style};text-decoration:none;">${address}</a>`;
}

/**
 * Strip non-digit/plus chars from a phone number and wrap in a tel: link.
 */
function telLink(phone: string, style: string): string {
  const stripped = phone.replace(/[^+\d]/g, '');
  return `<a href="tel:${stripped}" style="${style};text-decoration:none;">${phone}</a>`;
}



// ─── SVG Social Icons (inline, email-safe) ────────────────────────────────────
// These are rendered as colored square icon buttons using HTML tables + SVG data URIs

export const SOCIAL_ICON_KEYS = ['linkedin','twitter','instagram','github','youtube','facebook','spotify','pinterest','tiktok','googleMaps','googleReviews','trustpilot','tripadvisor','uberEats','deliveroo','expedia','rss','amazon','websiteLink'] as const;
export type SocialIconKey = typeof SOCIAL_ICON_KEYS[number];

// ─── Inline SVG sources for client-side icon colouring ──────────────────────
// Icons are coloured client-side via SVG fill replacement + base64 data URI.
// This ensures the preview always shows the exact brand colour with no server
// dependency. The server-side PNG approach (batchColorize) is still used when
// available (better email client compatibility), but this is the reliable fallback.
const SVG_SOURCES: Record<string, string> = {
  amazon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.315-.14c.138-.06.234-.1.293-.13.226-.088.39-.046.493.13.12.174.09.336-.09.48-.286.22-.612.44-.98.658-1.45.874-3.044 1.56-4.78 2.06-1.738.5-3.476.75-5.213.75-2.44 0-4.72-.457-6.84-1.37-2.12-.914-3.984-2.19-5.592-3.83-.15-.15-.18-.3-.09-.45zm7.97-8.06c0-1.058.37-1.98 1.11-2.77.74-.79 1.67-1.18 2.79-1.18.78 0 1.47.2 2.08.6.61.4 1.06.96 1.35 1.68l.12.3c.04.11.06.22.06.33 0 .31-.14.56-.42.75-.28.19-.6.28-.96.28-.3 0-.56-.08-.78-.24-.22-.16-.38-.38-.48-.66l-.06-.18c-.12-.36-.3-.64-.54-.84-.24-.2-.52-.3-.84-.3-.44 0-.8.16-1.08.48-.28.32-.42.72-.42 1.2v4.8c0 .48.14.88.42 1.2.28.32.64.48 1.08.48.32 0 .6-.1.84-.3.24-.2.42-.48.54-.84l.06-.18c.1-.28.26-.5.48-.66.22-.16.48-.24.78-.24.36 0 .68.09.96.28.28.19.42.44.42.75 0 .11-.02.22-.06.33l-.12.3c-.29.72-.74 1.28-1.35 1.68-.61.4-1.3.6-2.08.6-1.12 0-2.05-.39-2.79-1.18-.74-.79-1.11-1.71-1.11-2.77V9.96z"/></svg>`,
  deliveroo: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M13.2 0C9.6 0 7.2 2.4 7.2 6v.6H6v2.4h1.2V24h2.4V9h6V6.6H9.6V6c0-2.1 1.5-3.6 3.6-3.6 2.1 0 3.6 1.5 3.6 3.6v.6h2.4V6C19.2 2.4 16.8 0 13.2 0zm-1.8 12a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`,
  expedia: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm1 17H7v-2h4v-2H7v-2h4V9H7V7h6v10zm4-4h-2V7h2v6z"/></svg>`,
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`,
  github: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`,
  googleMaps: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 0C7.802 0 4 3.403 4 7.602 4 11.8 7.469 16.812 12 24c4.531-7.188 8-12.2 8-16.398C20 3.403 16.199 0 12 0zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>`,
  googleReviews: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>`,
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
  pinterest: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738a.36.36 0 0 1 .083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.632-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>`,
  rss: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M6.18 15.64a2.18 2.18 0 0 1 2.18 2.18C8.36 19.01 7.38 20 6.18 20C4.98 20 4 19.01 4 17.82a2.18 2.18 0 0 1 2.18-2.18M4 4.44A15.56 15.56 0 0 1 19.56 20h-2.83A12.73 12.73 0 0 0 4 7.27V4.44m0 5.66a9.9 9.9 0 0 1 9.9 9.9h-2.83A7.07 7.07 0 0 0 4 12.93V10.1z"/></svg>`,
  spotify: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>`,
  tiktok: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>`,
  tripadvisor: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 2.163c-5.48 0-9.837 4.357-9.837 9.837S6.52 21.837 12 21.837s9.837-4.357 9.837-9.837S17.48 2.163 12 2.163zM7.5 15.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm4.5-1.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm4.5 1.5a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM12 8.5c-1.5 0-2.9.5-4 1.3.4-.8 1-1.5 1.8-2 .7-.4 1.4-.6 2.2-.6s1.5.2 2.2.6c.8.5 1.4 1.2 1.8 2-1.1-.8-2.5-1.3-4-1.3z"/></svg>`,
  trustpilot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 0l2.545 7.826H22.18l-6.363 4.62 2.545 7.827L12 15.652l-6.362 4.621 2.545-7.827L1.82 7.826h7.635zm0 3.236L10.27 8.9H4.9l4.545 3.302-1.818 5.59L12 14.49l4.373 3.302-1.818-5.59L19.1 8.9h-5.37z"/></svg>`,
  twitter: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`,
  uberEats: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 14.5c0 1.933-1.567 3.5-3.5 3.5H6v-12h7.5c1.657 0 3 1.343 3 3 0 .95-.444 1.793-1.135 2.344C16.617 11.82 17.5 13.057 17.5 14.5zM8.5 9v2.5H13c.69 0 1.25-.56 1.25-1.25S13.69 9 13 9H8.5zm5 5.5c0-.69-.56-1.25-1.25-1.25H8.5V15H13.25c.69 0 1.25-.56 1.25-1.25v-.25z"/></svg>`,
  websiteLink: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
  youtube: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="#374151"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>`,
};

/**
 * Generate a base64 SVG data URI with the fill colour replaced.
 * Works in all modern browsers and the sandboxed iframe preview.
 */
function coloredSvgDataUri(key: string, color: string): string {
  const src = SVG_SOURCES[key];
  if (!src) return '';
  const normColor = color.startsWith('#') ? color : '#' + color;
  const recoloured = src
    .replace(/fill="#[0-9a-fA-F]{3,6}"/g, `fill="${normColor}"`)
    .replace(/fill='#[0-9a-fA-F]{3,6}'/g, `fill='${normColor}'`);
  // btoa with UTF-8 support
  const encoded = btoa(unescape(encodeURIComponent(recoloured)));
  return `data:image/svg+xml;base64,${encoded}`;
}

/**
 * Map of "iconKey_hexcolour" -> absolute hosted PNG URL.
 * When provided to generateSignatureHtml, icons use brand-coloured PNGs
 * (generated server-side). When absent, falls back to inline SVG data URIs.
 */
export type IconUrlMap = Record<string, string>;

/**
 * Resolve an icon URL for PREVIEW (browser iframe):
 * 1. If iconUrlMap has a brand-coloured PNG for this key+colour, use it.
 * 2. Otherwise fall back to inline SVG data URI (fine for preview, not for email).
 */
function resolveIconUrl(
  key: string,
  iconColor: string,
  iconUrlMap?: IconUrlMap,
): string {
  if (iconUrlMap) {
    const normColor = iconColor.replace('#', '').toLowerCase();
    const mapped = iconUrlMap[`${key}_${normColor}`];
    if (mapped) return mapped;
  }
  // Preview fallback: inline SVG with exact fill colour
  const dataUri = coloredSvgDataUri(key, iconColor);
  if (dataUri) return dataUri;
  return '';
}

/**
 * Resolve an icon URL for EMAIL EXPORT (Gmail/Outlook):
 * ONLY returns hosted PNG URLs. Returns empty string if no PNG is available.
 * NEVER returns SVG data URIs — Gmail blocks them.
 */
function resolveIconUrlForExport(
  key: string,
  iconColor: string,
  iconUrlMap: IconUrlMap,
): string {
  const normColor = iconColor.replace('#', '').toLowerCase();
  const mapped = iconUrlMap[`${key}_${normColor}`];
  return mapped ?? '';
}

function socialIconsHtml(data: SignatureData, iconSize = 20, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const socials: Array<{ key: keyof typeof SVG_SOURCES; url: string; label: string }> = [
    { key: 'linkedin', url: data.linkedin, label: 'LinkedIn' },
    { key: 'twitter', url: data.twitter, label: 'X / Twitter' },
    { key: 'instagram', url: data.instagram, label: 'Instagram' },
    { key: 'github', url: data.github, label: 'GitHub' },
    { key: 'youtube', url: data.youtube, label: 'YouTube' },
    { key: 'facebook', url: data.facebook, label: 'Facebook' },
    { key: 'spotify', url: data.spotify, label: 'Spotify' },
    { key: 'pinterest', url: data.pinterest, label: 'Pinterest' },
    { key: 'tiktok', url: data.tiktok, label: 'TikTok' },
    { key: 'googleMaps', url: data.googleMaps, label: 'Google Maps' },
    { key: 'googleReviews', url: data.googleReviews, label: 'Google Reviews' },
    { key: 'trustpilot', url: data.trustpilot, label: 'Trustpilot' },
    { key: 'tripadvisor', url: data.tripadvisor, label: 'TripAdvisor' },
    { key: 'uberEats', url: data.uberEats, label: 'Uber Eats' },
    { key: 'deliveroo', url: data.deliveroo, label: 'Deliveroo' },
    { key: 'expedia', url: data.expedia, label: 'Expedia' },
    { key: 'rss', url: data.rss, label: 'RSS' },
    { key: 'amazon', url: data.amazon, label: 'Amazon' },
    { key: 'websiteLink', url: data.websiteLink, label: 'Website' },
  ].filter(s => s.url);

  if (!socials.length) return '';

  const icons = socials.map(s => {
    const iconUri = forExport
      ? resolveIconUrlForExport(s.key, data.primaryColor, iconUrlMap ?? {})
      : resolveIconUrl(s.key, data.primaryColor, iconUrlMap);
    if (!iconUri) return ''; // skip icons with no PNG in export mode
    const href = wrapTrackingUrl(ensureAbsoluteUrl(s.url), 'social_click', tracking, s.key);
    return `<a href="${href}" title="${s.label}" style="display:inline-block;margin-right:6px;text-decoration:none;"><img src="${iconUri}" width="${iconSize}" height="${iconSize}" alt="${s.label}" style="display:block;width:${iconSize}px;height:${iconSize}px;" /></a>`;
  }).join('');

  return `<div style="margin-top:8px;line-height:1;">${icons}</div>`;
}

function photoHtml(data: SignatureData, size = 72, tracking?: TrackingContext): string {
  if (!data.showPhoto || !data.photoUrl) return '';
  const borderRadius = data.photoShape === 'circle' ? '50%' : data.photoShape === 'rounded' ? '8px' : '0';
  // Use width-only so portrait photos scale naturally without squashing.
  // Wrap in overflow:hidden div at fixed size to crop to the desired square.
  const img = `<div style="width:${size}px;height:${size}px;overflow:hidden;border-radius:${borderRadius};line-height:0;font-size:0;display:inline-block;"><img src="${data.photoUrl}" width="${size}" height="${size}" alt="${data.fullName}" style="display:block;width:${size}px;height:${size}px;object-fit:cover;border:0;" /></div>`;
  // Note: the outer div handles the border-radius crop, so img itself has no border-radius.
  if (data.photoLinkUrl) {
    const href = wrapTrackingUrl(ensureAbsoluteUrl(data.photoLinkUrl), 'website_click', tracking, 'photo');
    return `<a href="${href}" style="display:inline-block;text-decoration:none;">${img}</a>`;
  }
  return img;
}

function logoHtml(data: SignatureData, tracking?: TrackingContext): string {
  if (!data.showLogo || !data.logoUrl) return '';
  const w = data.logoWidth || 120;
  // Cap BOTH dimensions and keep BOTH auto so the logo can only ever scale to fit
  // its box — never force-stretched. A fixed width/height + a binding max-* is what
  // squashes the aspect ratio in Chromium-engine clients (new Outlook / Outlook web)
  // that sanitize away object-fit. The width attr keeps classic Outlook sized.
  const img = `<img src="${data.logoUrl}" width="${w}" alt="${data.company || 'Logo'}" style="width:auto;height:auto;max-width:${w}px;max-height:50px;display:block;border:0;" />`;
  if (data.logoLinkUrl) {
    const href = wrapTrackingUrl(ensureAbsoluteUrl(data.logoLinkUrl), 'website_click', tracking, 'logo');
    return `<a href="${href}" style="display:inline-block;text-decoration:none;">${img}</a>`;
  }
  return img;
}

function bannerHtml(data: SignatureData, tracking?: TrackingContext, fullWidth = false): string {
  if (!data.showBanner || !data.bannerUrl) return '';
  // fullWidth: banner fills its container so it matches the signature width
  // (used by templates whose layout width differs from the fixed bannerWidth).
  const w = data.bannerWidth || 400;
  const img = fullWidth
    ? `<img src="${data.bannerUrl}" width="100%" alt="Banner" style="width:100%;max-width:100%;height:auto;display:block;border:0;" />`
    : `<img src="${data.bannerUrl}" width="${w}" alt="Banner" style="width:${w}px;max-width:100%;height:auto;display:block;border:0;" />`;
  if (data.bannerLinkUrl) {
    const href = wrapTrackingUrl(ensureAbsoluteUrl(data.bannerLinkUrl), 'banner_click', tracking);
    return `<div style="margin-top:12px;"><a href="${href}" style="display:${fullWidth ? 'block' : 'inline-block'};text-decoration:none;">${img}</a></div>`;
  }
  return `<div style="margin-top:12px;">${img}</div>`;
}

function ctaHtml(data: SignatureData, tracking?: TrackingContext): string {
  if (!data.customCta) return '';
  const url = data.customCtaUrl || '#';
  const font = data.fontFamily || 'Arial, Helvetica, sans-serif';
  const href = wrapTrackingUrl(ensureAbsoluteUrl(url), 'cta_click', tracking);
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;border-collapse:collapse;">
  <tr>
    <td bgcolor="${data.primaryColor}" style="padding:6px 14px;border-radius:4px;background-color:${data.primaryColor};text-align:center;">
      <a href="${href}" style="font-size:11px;font-family:${font};font-weight:600;color:#ffffff;text-decoration:none;display:inline-block;line-height:1.2;">
        ${data.customCta}
      </a>
    </td>
  </tr>
</table>`;
}

function disclaimerHtml(data: SignatureData): string {
  if (!data.disclaimer) return '';
  return `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;font-family:${data.fontFamily};line-height:1.4;">${data.disclaimer}</div>`;
}

function verdiictHtml(data: SignatureData, tracking?: TrackingContext): string {
  const hasGetReview = !!data.verdiictUrl;
  const hasSeeReviews = !!data.verdiictReviewsUrl;
  if (!hasGetReview && !hasSeeReviews) return '';

  // Verdiict favicon as inline PNG data URI
  const vdLogoUri = 'data:image/png;base64,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FAEAAKUIAAAoRQAAQCkCAABKEQAAUIoAAIBSBAAAlCIAAKAUAQAApQgAAChFAABAKQIAAEoRAABQigAAgFIEAACUIgAAoBQBAAClCAAAKEUAAEApAgAAShEAAFCKAACAUgQAAJQiAACgFAEAAKUIAAAoRQAAQCkCAABKEQAAUIoAAIBSBAAAlCIAAKAUAQAApQgAAChFAABAKQIAAEoRAABQigAAgFIEAACUIgAAoBQBAAClCAAAKEUAAEApAgAAShEAAFCKAACAUgQAAJQiAACgFAEAAKUIAAAoRQAAQCkCAABKEQAAUIoAAIBSBAAAlCIAAKAUAQAApQgAAChFAABAKQIAAEoRAABQigAAgFIEAACUIgAAoBQBAAClCAAAKEUAAEApAgAAShEAAFCKAACAUgQAAJQiAACgFAEAAKUIAAAoRQAAQCkCAABKEQAAUIoAAIBSBAAAlCIAAKAUAQAApQgAAChFAABAKQIAAEoRAABQigAAgFIEAACUIgAAoBQBAAClCAAAKEUAAEApAgAAShEAAFCKAACAUgQAAJQiAACgFAEAAKUIAAAoRQAAQCkCAABKEQAAUOr/AgAA//+UdbrwMazCFgAAAABJRU5ErkJggg==';

  const font = data.fontFamily || 'Arial, Helvetica, sans-serif';

  let html = `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;padding-top:10px;border-top:1px solid #e5e7eb;border-collapse:collapse;">
  <tr>
    <td style="vertical-align:top;">`;

  if (hasGetReview) {
    const reviewHref = wrapTrackingUrl(ensureAbsoluteUrl(data.verdiictUrl), 'verdiict_review_click', tracking);
    html += `<table cellpadding="0" cellspacing="0" border="0" style="display:inline-block;margin-right:8px;margin-bottom:6px;border-collapse:collapse;">
      <tr>
        <td style="border:1px solid #e2e8f0;border-radius:6px;background-color:#ffffff;padding:5px 10px;vertical-align:middle;">
          <a href="${reviewHref}" style="text-decoration:none;display:inline-block;line-height:1;">
            <img src="${vdLogoUri}" width="18" height="18" alt="verdiict" style="display:inline-block;vertical-align:middle;border:0;margin-right:6px;" />
            <span style="font-size:11px;font-family:${font};font-weight:600;color:#374151;vertical-align:middle;white-space:nowrap;">Get a Review</span>
          </a>
        </td>
      </tr>
    </table>`;
  }

  if (hasSeeReviews) {
    const reviewsHref = wrapTrackingUrl(ensureAbsoluteUrl(data.verdiictReviewsUrl), 'verdiict_reviews_click', tracking);
    html += `<table cellpadding="0" cellspacing="0" border="0" style="display:inline-block;margin-bottom:6px;border-collapse:collapse;">
      <tr>
        <td style="border:1px solid #e2e8f0;border-radius:6px;background-color:#ffffff;padding:5px 10px;vertical-align:middle;">
          <a href="${reviewsHref}" style="text-decoration:none;display:inline-block;line-height:1;">
            <img src="${vdLogoUri}" width="18" height="18" alt="verdiict" style="display:inline-block;vertical-align:middle;border:0;margin-right:6px;" />
            <span style="font-size:11px;font-family:${font};font-weight:600;color:#374151;vertical-align:middle;white-space:nowrap;">See reviews</span>
          </a>
        </td>
      </tr>
    </table>`;
  }

  html += `</td>
  </tr>
</table>`;
  return html;
}


// ─── Template: Classic ────────────────────────────────────────────────────────
function generateClassic(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const photo = photoHtml(data, 72, tracking);
  const logo = logoHtml(data, tracking);
  const socials = socialIconsHtml(data, 20, iconUrlMap, forExport, tracking);
  const cta = ctaHtml(data, tracking);
  const banner = bannerHtml(data, tracking);
  const disclaimer = disclaimerHtml(data);
  const verdiict = verdiictHtml(data, tracking);

  const photoCell = photo ? `<td style="padding-right:18px;vertical-align:top;">${photo}</td>` : '';

  const contactLines: string[] = [];
  if (data.email) contactLines.push(`<a href="mailto:${data.email}" style="color:${data.primaryColor};text-decoration:none;font-weight:500;">${data.email}</a>`);
  if (data.phone) contactLines.push(telLink(data.phone, 'color:#4b5563;text-decoration:none;'));
  if (data.mobile) contactLines.push(`M: ${telLink(data.mobile, 'color:#4b5563;text-decoration:none;')}`);
  if (data.website) contactLines.push(`<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="color:${data.primaryColor};text-decoration:none;font-weight:500;">${data.website.replace(/^https?:\/\//, '')}</a>`);
  if (data.address) contactLines.push(addressLink(data.address, 'color:#6b7280;text-decoration:none;', tracking));

  const nameHtml = data.fullName
    ? `<div style="font-size:18px;font-weight:700;color:#111827;line-height:1.2;letter-spacing:-0.2px;margin-bottom:2px;">${data.fullName}</div>`
    : '';

  const jobTitlePart = data.jobTitle || '';
  const deptPart = data.department || '';
  const companyPart = data.company || '';

  const jobDept = [jobTitlePart, deptPart].filter(Boolean).join(' · ');
  const jobHtml = jobDept 
    ? `<div style="font-size:12px;color:${data.primaryColor};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">${jobDept}</div>` 
    : '';
  const companyHtml = companyPart 
    ? `<div style="font-size:13px;color:#4b5563;font-weight:500;margin-bottom:8px;">${companyPart}</div>` 
    : '';

  const rightCellPaddingAndBorder = photo 
    ? `border-left:2px solid ${data.primaryColor};padding-left:18px;` 
    : '';

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${data.fontFamily || 'Arial, sans-serif'};font-size:${data.fontSize || '14px'};line-height:1.4;max-width:520px;border-collapse:collapse;">
  <tr>
    ${photoCell}
    <td style="vertical-align:top;${rightCellPaddingAndBorder}">
      ${nameHtml}
      ${jobHtml}
      ${companyHtml}
      ${logo ? `<div style="margin-top:10px;margin-bottom:10px;">${logo}</div>` : ''}
      ${contactLines.length > 0 ? `
      <div style="margin-top:10px;font-size:12px;line-height:1.6;color:#4b5563;">
        ${contactLines.map(l => `<div style="margin-bottom:2px;">${l}</div>`).join('')}
      </div>
      ` : ''}
      ${socials ? `<div style="margin-top:10px;">${socials}</div>` : ''}
      ${cta}
      ${banner}
      ${disclaimer}
      ${verdiict}
    </td>
  </tr>
</table>`;
}

// ─── Template: Modern ─────────────────────────────────────────────────────────
function generateModern(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const photo = photoHtml(data, 80, tracking);
  const logo = logoHtml(data, tracking);
  const socials = socialIconsHtml(data, 20, iconUrlMap, forExport, tracking);
  const cta = ctaHtml(data, tracking);
  const banner = bannerHtml(data, tracking);
  const disclaimer = disclaimerHtml(data);
  const verdiict = verdiictHtml(data, tracking);

  const contactLines: string[] = [];
  const labelStyle = `color:${data.primaryColor};font-weight:700;margin-right:6px;font-size:11px;text-transform:uppercase;display:inline-block;width:16px;`;
  
  if (data.email) contactLines.push(`<span style="${labelStyle}">e:</span><a href="mailto:${data.email}" style="color:${data.primaryColor};text-decoration:none;font-weight:600;">${data.email}</a>`);
  if (data.phone) contactLines.push(`<span style="${labelStyle}">p:</span>${telLink(data.phone, 'color:#374151;text-decoration:none;')}`);
  if (data.mobile) contactLines.push(`<span style="${labelStyle}">m:</span>${telLink(data.mobile, 'color:#374151;text-decoration:none;')}`);
  if (data.website) contactLines.push(`<span style="${labelStyle}">w:</span><a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="color:${data.primaryColor};text-decoration:none;font-weight:600;">${data.website.replace(/^https?:\/\//, '')}</a>`);

  const nameHtml = data.fullName
    ? `<div style="font-size:19px;font-weight:800;color:#111827;letter-spacing:-0.3px;line-height:1.2;margin-bottom:2px;">${data.fullName}</div>`
    : '';

  const jobTitlePart = data.jobTitle || '';
  const deptPart = data.department || '';
  const companyPart = data.company || '';

  const jobDept = [jobTitlePart, deptPart].filter(Boolean).join(' · ');
  const jobHtml = jobDept
    ? `<div style="font-size:12px;color:${data.primaryColor};font-weight:600;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:2px;">${jobDept}</div>`
    : '';
  const companyHtml = companyPart
    ? `<div style="font-size:12px;color:#4b5563;font-weight:500;margin-bottom:10px;">${companyPart}</div>`
    : '';

  const hasLeft = !!(photo || logo);
  const rightCellBorderAndPadding = hasLeft
    ? `border-left:2px solid ${data.primaryColor};padding-left:18px;`
    : '';

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${data.fontFamily || 'Arial, sans-serif'};font-size:${data.fontSize || '14px'};line-height:1.4;max-width:520px;border-collapse:collapse;">
  <tr>
    ${hasLeft ? `<td style="vertical-align:top;padding-right:18px;">${photo || ''}${logo ? `<div style="margin-top:${photo ? '12px' : '0'};">${logo}</div>` : ''}</td>` : ''}
    <td style="vertical-align:top;${rightCellBorderAndPadding}">
      ${nameHtml}
      ${jobHtml}
      ${companyHtml}
      ${contactLines.length > 0 ? `
      <div style="font-size:12px;line-height:1.7;color:#374151;">
        ${contactLines.map(l => `<div style="margin-bottom:3px;">${l}</div>`).join('')}
      </div>
      ` : ''}
      ${data.address ? `<div style="font-size:11px;margin-top:6px;color:#6b7280;">${addressLink(data.address, 'color:#6b7280;text-decoration:none;', tracking)}</div>` : ''}
      ${socials ? `<div style="margin-top:10px;">${socials}</div>` : ''}
      ${cta}
      ${banner}
      ${disclaimer}
      ${verdiict}
    </td>
  </tr>
</table>`;
}

// ─── Template: Minimal ────────────────────────────────────────────────────────
function generateMinimal(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const socials = socialIconsHtml(data, 18, iconUrlMap, forExport, tracking);
  const cta = ctaHtml(data, tracking);
  const banner = bannerHtml(data, tracking);
  const disclaimer = disclaimerHtml(data);
  const verdiict = verdiictHtml(data, tracking);
  const logo = logoHtml(data, tracking);

  const contactParts: string[] = [];
  if (data.email) contactParts.push(`<a href="mailto:${data.email}" style="color:${data.primaryColor};text-decoration:none;font-weight:500;">${data.email}</a>`);
  if (data.phone) contactParts.push(telLink(data.phone, 'color:#4b5563;text-decoration:none;'));
  if (data.mobile) contactParts.push(telLink(data.mobile, 'color:#4b5563;text-decoration:none;'));
  if (data.website) contactParts.push(`<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="color:${data.primaryColor};text-decoration:none;font-weight:500;">${data.website.replace(/^https?:\/\//, '')}</a>`);

  const photo = photoHtml(data, 56, tracking);
  const separator = `&nbsp;<span style="color:${data.primaryColor};font-weight:700;">·</span>&nbsp;`;

  const nameHtml = data.fullName
    ? `<div style="font-size:16px;font-weight:700;color:#111827;line-height:1.2;">${data.fullName}</div>`
    : '';

  const jobTitlePart = data.jobTitle || '';
  const deptPart = data.department || '';
  const companyPart = data.company || '';

  const jobDept = [jobTitlePart, deptPart].filter(Boolean).join(' - ');
  const metaString = [jobDept, companyPart].filter(Boolean).join(' at ');
  const metaHtml = metaString
    ? `<div style="font-size:12px;color:#4b5563;margin-top:2px;margin-bottom:6px;font-weight:500;">${metaString}</div>`
    : '';

  const hasContactInfo = contactParts.length > 0 || !!data.address;
  const contactHtml = hasContactInfo
    ? `<div style="border-top:1px solid ${data.primaryColor};padding-top:8px;margin-top:6px;">
        ${contactParts.length > 0 ? `<div style="font-size:11px;color:#6b7280;line-height:1.5;">${contactParts.join(separator)}</div>` : ''}
        ${data.address ? `<div style="font-size:11px;margin-top:4px;color:#9ca3af;">${addressLink(data.address, 'color:#9ca3af;text-decoration:none;', tracking)}</div>` : ''}
      </div>`
    : '';

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${data.fontFamily || 'Arial, sans-serif'};font-size:${data.fontSize || '13px'};line-height:1.4;max-width:480px;border-collapse:collapse;">
  <tr>
    ${photo ? `<td style="padding-right:14px;vertical-align:middle;">${photo}</td>` : ''}
    <td style="vertical-align:top;">
      ${nameHtml}
      ${metaHtml}
      ${logo ? `<div style="margin-bottom:8px;">${logo}</div>` : ''}
      ${contactHtml}
      ${socials ? `<div style="margin-top:8px;">${socials}</div>` : ''}
      ${cta}
      ${banner}
      ${disclaimer}
      ${verdiict}
    </td>
  </tr>
</table>`;
}

// ─── Template: Bold ───────────────────────────────────────────────────────────
function generateBold(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const photo = photoHtml(data, 80, tracking);
  const logo = logoHtml(data, tracking);
  const cta = ctaHtml(data, tracking);
  const banner = bannerHtml(data, tracking);
  const disclaimer = disclaimerHtml(data);

  const contactLines: string[] = [];
  if (data.email) contactLines.push(`<a href="mailto:${data.email}" style="color:#ffffff;text-decoration:none;font-weight:500;">${data.email}</a>`);
  if (data.phone) contactLines.push(telLink(data.phone, 'color:rgba(255,255,255,0.85);text-decoration:none;'));
  if (data.mobile) contactLines.push(`M: ${telLink(data.mobile, 'color:rgba(255,255,255,0.85);text-decoration:none;')}`);
  if (data.website) contactLines.push(`<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="color:#ffffff;text-decoration:none;font-weight:500;">${data.website.replace(/^https?:\/\//, '')}</a>`);

  // For bold template, white icons on the colored background
  const whiteSocials = (() => {
    const icons: string[] = [];
    const socialList = [
      { key: 'linkedin' as const, url: data.linkedin, label: 'LinkedIn' },
      { key: 'twitter' as const, url: data.twitter, label: 'X' },
      { key: 'instagram' as const, url: data.instagram, label: 'Instagram' },
      { key: 'github' as const, url: data.github, label: 'GitHub' },
      { key: 'youtube' as const, url: data.youtube, label: 'YouTube' },
      { key: 'facebook' as const, url: data.facebook, label: 'Facebook' },
      { key: 'spotify' as const, url: data.spotify, label: 'Spotify' },
      { key: 'pinterest' as const, url: data.pinterest, label: 'Pinterest' },
      { key: 'tiktok' as const, url: data.tiktok, label: 'TikTok' },
      { key: 'googleMaps' as const, url: data.googleMaps, label: 'Google Maps' },
      { key: 'googleReviews' as const, url: data.googleReviews, label: 'Google Reviews' },
      { key: 'trustpilot' as const, url: data.trustpilot, label: 'Trustpilot' },
      { key: 'tripadvisor' as const, url: data.tripadvisor, label: 'TripAdvisor' },
      { key: 'uberEats' as const, url: data.uberEats, label: 'Uber Eats' },
      { key: 'deliveroo' as const, url: data.deliveroo, label: 'Deliveroo' },
      { key: 'expedia' as const, url: data.expedia, label: 'Expedia' },
      { key: 'rss' as const, url: data.rss, label: 'RSS' },
      { key: 'amazon' as const, url: data.amazon, label: 'Amazon' },
      { key: 'websiteLink' as const, url: data.websiteLink, label: 'Website' },
    ].filter(s => s.url);
    if (!socialList.length) return '';
    socialList.forEach(item => {
      const iconUri = forExport
        ? resolveIconUrlForExport(item.key, '#ffffff', iconUrlMap ?? {})
        : resolveIconUrl(item.key, '#ffffff', iconUrlMap);
      if (!iconUri) return; // skip in export mode if no PNG available
      icons.push(`<a href="${wrapTrackingUrl(ensureAbsoluteUrl(item.url), 'social_click', tracking, item.key)}" title="${item.label}" style="display:inline-block;margin-right:8px;text-decoration:none;"><img src="${iconUri}" width="18" height="18" alt="${item.label}" style="display:block;width:18px;height:18px;border:0;" /></a>`);
    });
    return `<div style="margin-top:12px;line-height:1;">${icons.join('')}</div>`;
  })();

  const radius = 8;
  const showRight = !!(logo || cta);

  const nameHtml = data.fullName
    ? `<div style="font-size:20px;font-weight:800;color:#ffffff;line-height:1.2;letter-spacing:-0.3px;margin-bottom:2px;">${data.fullName}</div>`
    : '';

  const jobTitlePart = data.jobTitle || '';
  const deptPart = data.department || '';
  const companyPart = data.company || '';

  const jobDept = [jobTitlePart, deptPart].filter(Boolean).join(' - ');
  const jobHtml = jobDept
    ? `<div style="font-size:11px;color:rgba(255,255,255,0.9);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:2px;">${jobDept}</div>`
    : '';
  const companyHtml = companyPart
    ? `<div style="font-size:12px;color:rgba(255,255,255,0.7);font-weight:500;margin-bottom:12px;">${companyPart}</div>`
    : '';

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${data.fontFamily || 'Arial, sans-serif'};font-size:${data.fontSize || '13px'};max-width:520px;border-radius:${radius}px;border:1px solid #e5e7eb;border-collapse:separate;overflow:hidden;table-layout:fixed;">
  <tr>
    <td style="background-color:${data.primaryColor};padding:24px 28px;vertical-align:top;border-radius:${radius}px ${showRight ? '0 0' : `0 0 ${radius}px`};">
      ${photo ? `<div style="margin-bottom:12px;">${photo}</div>` : ''}
      ${nameHtml}
      ${jobHtml}
      ${companyHtml}
      ${contactLines.length > 0 ? `
      <div style="font-size:12px;line-height:1.8;color:rgba(255,255,255,0.85);">
        ${contactLines.map(l => `<div style="margin-bottom:2px;">${l}</div>`).join('')}
      </div>
      ` : ''}
      ${data.address ? `<div style="font-size:11px;margin-top:6px;color:rgba(255,255,255,0.65);">${addressLink(data.address, 'color:rgba(255,255,255,0.65);text-decoration:none;', tracking)}</div>` : ''}
      ${whiteSocials}
    </td>
    ${showRight ? `<td width="160" style="width:160px;background-color:#ffffff;padding:24px;vertical-align:top;border-left:1px solid #e5e7eb;border-radius:0 ${radius}px ${radius}px 0;">
      ${logo ? `<div style="margin-bottom:14px;">${logo}</div>` : ''}
      ${cta}
    </td>` : ''}
  </tr>
  ${banner || disclaimer ? `<tr><td colspan="${showRight ? 2 : 1}" style="padding:16px 24px 8px;background-color:#ffffff;border-top:1px solid #e5e7eb;border-radius:0 0 ${radius}px ${radius}px;">${banner}${disclaimer}</td></tr>` : ''}
</table>`;
}

// ─── Template: Corporate ──────────────────────────────────────────────────────
function generateCorporate(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const photo = photoHtml(data, 68, tracking);
  const logo = logoHtml(data, tracking);
  const socials = socialIconsHtml(data, 20, iconUrlMap, forExport, tracking);
  const cta = ctaHtml(data, tracking);
  const banner = bannerHtml(data, tracking);
  const disclaimer = disclaimerHtml(data);
  const verdiict = verdiictHtml(data, tracking);

  const contactLines: string[] = [];
  if (data.email) contactLines.push(`<tr><td style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding-right:12px;padding-bottom:5px;vertical-align:middle;">Email</td><td style="font-size:12px;padding-bottom:5px;vertical-align:middle;"><a href="mailto:${data.email}" style="color:${data.primaryColor};text-decoration:none;font-weight:500;">${data.email}</a></td></tr>`);
  if (data.phone) contactLines.push(`<tr><td style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding-right:12px;padding-bottom:5px;vertical-align:middle;">Phone</td><td style="font-size:12px;color:#374151;padding-bottom:5px;vertical-align:middle;">${telLink(data.phone, 'color:#374151;text-decoration:none;')}</td></tr>`);
  if (data.mobile) contactLines.push(`<tr><td style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding-right:12px;padding-bottom:5px;vertical-align:middle;">Mobile</td><td style="font-size:12px;color:#374151;padding-bottom:5px;vertical-align:middle;">${telLink(data.mobile, 'color:#374151;text-decoration:none;')}</td></tr>`);
  if (data.website) contactLines.push(`<tr><td style="color:#9ca3af;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;padding-right:12px;padding-bottom:5px;vertical-align:middle;">Web</td><td style="font-size:12px;padding-bottom:5px;vertical-align:middle;"><a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="color:${data.primaryColor};text-decoration:none;font-weight:500;">${data.website.replace(/^https?:\/\//, '')}</a></td></tr>`);

  const nameHtml = data.fullName
    ? `<div style="font-size:18px;font-weight:700;color:#111827;line-height:1.2;letter-spacing:-0.2px;margin-bottom:2px;">${data.fullName}</div>`
    : '';

  const jobTitlePart = data.jobTitle || '';
  const deptPart = data.department || '';
  const companyPart = data.company || '';

  const jobDept = [jobTitlePart, deptPart].filter(Boolean).join(' - ');
  const jobHtml = jobDept
    ? `<div style="font-size:12px;color:${data.primaryColor};font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;">${jobDept}</div>`
    : '';
  const companyHtml = companyPart
    ? `<div style="font-size:12px;color:#4b5563;font-weight:500;margin-bottom:12px;">${companyPart}</div>`
    : '';

  const hasLeft = !!(photo || logo);

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${data.fontFamily || 'Arial, sans-serif'};font-size:${data.fontSize || '13px'};max-width:560px;border-top:3px solid ${data.primaryColor};border-collapse:collapse;">
  <tr>
    ${hasLeft ? `
    <td style="padding:18px 20px 18px 0;vertical-align:top;border-right:1px solid #e5e7eb;">
      ${photo ? `<div style="margin-bottom:12px;">${photo}</div>` : ''}
      ${logo ? `<div>${logo}</div>` : ''}
    </td>
    ` : ''}
    <td style="padding:18px 0 18px ${hasLeft ? '20' : '0'}px;vertical-align:top;">
      ${nameHtml}
      ${jobHtml}
      ${companyHtml}
      ${contactLines.length > 0 ? `
      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:6px;border-collapse:collapse;">
        ${contactLines.join('')}
      </table>
      ` : ''}
      ${data.address ? `<div style="font-size:11px;margin-top:6px;color:#6b7280;">${addressLink(data.address, 'color:#6b7280;text-decoration:none;', tracking)}</div>` : ''}
      ${socials ? `<div style="margin-top:10px;">${socials}</div>` : ''}
      ${cta}
      ${banner}
      ${disclaimer}
      ${verdiict}
    </td>
  </tr>
</table>`;
}

// ─── Template: Image Card ────────────────────────────────────────────────────
// Layout: 3-row table, all rows full width
//   Row 1 (white): 2 cols — left: name+contact | right: portrait photo (bottom-aligned)
//   Row 2 (colour bar): full width — brand name left, social icons right, tagline+website bottom
//   Row 3 (white footer): disclaimer left, powered-by logo right
// The photo sits in row 1 right cell, bottom-aligned, so its feet touch the top of the bar.
// Email-safe: uses only tables + inline styles, no CSS positioning.
function generateImageCard(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const W = data.imageCardWidth || 600;
  const barColor = data.barColor || '#E85A00';
  const barText = data.barTextColor || '#1a1a2e';
  const font = data.fontFamily || 'Arial, Helvetica, sans-serif';

  const photoW = Math.round(W * 0.35); // photo column ~35% of total width
  const leftW = W - photoW;
  const barH = Math.round(W * 0.22);   // colour bar height
  const photoH = Math.round(W * 0.42); // photo height — taller than bar so it dominates

  // Social icons coloured to barText
  const socialList: Array<{ key: keyof typeof SVG_SOURCES; url: string; label: string }> = [
    { key: 'facebook', url: data.facebook, label: 'Facebook' },
    { key: 'instagram', url: data.instagram, label: 'Instagram' },
    { key: 'linkedin', url: data.linkedin, label: 'LinkedIn' },
    { key: 'youtube', url: data.youtube, label: 'YouTube' },
    { key: 'twitter', url: data.twitter, label: 'X' },
    { key: 'github', url: data.github, label: 'GitHub' },
    { key: 'spotify', url: data.spotify, label: 'Spotify' },
    { key: 'pinterest', url: data.pinterest, label: 'Pinterest' },
    { key: 'tiktok', url: data.tiktok, label: 'TikTok' },
    { key: 'googleMaps', url: data.googleMaps, label: 'Google Maps' },
    { key: 'googleReviews', url: data.googleReviews, label: 'Google Reviews' },
    { key: 'trustpilot', url: data.trustpilot, label: 'Trustpilot' },
    { key: 'tripadvisor', url: data.tripadvisor, label: 'TripAdvisor' },
    { key: 'uberEats', url: data.uberEats, label: 'Uber Eats' },
    { key: 'deliveroo', url: data.deliveroo, label: 'Deliveroo' },
    { key: 'expedia', url: data.expedia, label: 'Expedia' },
    { key: 'rss', url: data.rss, label: 'RSS' },
    { key: 'amazon', url: data.amazon, label: 'Amazon' },
    { key: 'websiteLink', url: data.websiteLink, label: 'Website' },
  ].filter(s => s.url);

  // The icons live in the narrow (~35%) right column of the bar. With a handful
  // of links they sit on one line as designed; with many they would overflow a
  // fixed-width, nowrap cell and break the whole card. So shrink the icon + gap
  // as the count grows and let them wrap to additional lines (the cell drops
  // white-space:nowrap below) — the card width stays fixed no matter how many.
  const iconCount = socialList.length;
  const barIconSize = iconCount > 14 ? 14 : iconCount > 10 ? 16 : iconCount > 6 ? 18 : 20;
  const iconGap = iconCount > 14 ? 4 : iconCount > 10 ? 5 : iconCount > 6 ? 6 : 8;
  const barIcons = socialList.map((s, i) => {
    const iconUri = forExport
      ? resolveIconUrlForExport(s.key, barText, iconUrlMap ?? {})
      : resolveIconUrl(s.key, barText, iconUrlMap);
    if (!iconUri) return ''; // skip in export mode if no PNG available
    // Use top+left margins (not left-only) so wrapped rows also get vertical spacing.
    const mt = '4px';
    const ml = i === 0 ? '0' : `${iconGap}px`;
    return `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(s.url), 'social_click', tracking, s.key)}" title="${s.label}" style="display:inline-block;margin:${mt} 0 0 ${ml};text-decoration:none;"><img src="${iconUri}" width="${barIconSize}" height="${barIconSize}" alt="${s.label}" style="display:block;width:${barIconSize}px;height:${barIconSize}px;border:0;" /></a>`;
  }).join('');

  // Contact lines
  const contactItems: string[] = [];
  if (data.mobile) contactItems.push(`<div style="font-size:13px;color:#374151;margin-bottom:4px;">${telLink(data.mobile, 'color:#374151;text-decoration:none;')}</div>`);
  if (data.phone) contactItems.push(`<div style="font-size:13px;color:#374151;margin-bottom:4px;">${telLink(data.phone, 'color:#374151;text-decoration:none;')}</div>`);
  if (data.email) contactItems.push(`<div style="font-size:13px;color:#374151;margin-bottom:4px;"><a href="mailto:${data.email}" style="color:#374151;text-decoration:none;">${data.email}</a></div>`);
  if (data.address) contactItems.push(`<div style="font-size:12px;color:#6b7280;margin-top:8px;line-height:1.4;">${addressLink(data.address, 'color:#6b7280;text-decoration:none;', tracking)}</div>`);

  // Photo cell content
  const initials = data.fullName
    ? data.fullName.split(' ').slice(0, 2).map((w: string) => w[0] || '').join('').toUpperCase()
    : '?';
  const initialsSize = Math.round(photoW * 0.45);
  // Outlook (Word engine) ignores overflow:hidden / width:auto / table-layout:fixed,
  // so a height-scaled img renders at its full natural width and overflows the fixed
  // photo column — blowing out the whole card. Give Outlook a VML <v:rect> whose
  // type="frame" fill cover-crops the photo into an exact photoW×photoH box; every
  // other client keeps the CSS overflow crop. MSO conditional comments gate each side.
  const photoCellImg = data.photoUrl
    ? `<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${photoW}px;height:${photoH}px;"><v:fill type="frame" src="${data.photoUrl}" aspect="atleast" /></v:rect><![endif]--><!--[if !mso]><!--><div style="width:100%;max-width:${photoW}px;height:${photoH}px;overflow:hidden;line-height:0;font-size:0;"><img src="${data.photoUrl}" width="${photoW}" height="${photoH}" alt="${data.fullName}" style="display:block;width:100%;max-width:${photoW}px;height:${photoH}px;object-fit:cover;object-position:center top;border:0;" /></div><!--<![endif]-->`
    : `<table cellpadding="0" cellspacing="0" border="0" width="${photoW}" style="width:${photoW}px;height:${photoH}px;background:${barColor};"><tr><td style="text-align:center;vertical-align:middle;font-family:${font};font-size:${initialsSize}px;font-weight:700;color:${barText};line-height:1;">${initials}</td></tr></table>`;
  const photoCell = (data.photoUrl && data.photoLinkUrl)
    ? `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.photoLinkUrl), 'website_click', tracking, 'photo')}" style="display:block;text-decoration:none;">${photoCellImg}</a>`
    : photoCellImg;

  // Brand logo in bar
  const barLogoH = Math.round(barH * 0.5);
  // Both dims auto + capped so the bar logo scales to fit without ever being
  // stretched (Chromium-engine clients sanitize object-fit → aspect distortion).
  const barLogoStyle = `width:auto;height:auto;max-height:${barLogoH}px;max-width:${Math.round(leftW * 0.75)}px;display:block;border:0;`;
  const barLogoImg = data.barLogoUrl
    ? `<img src="${data.barLogoUrl}" height="${barLogoH}" alt="${data.company || 'Brand'}" style="${barLogoStyle}" />`
    : (data.showLogo && data.logoUrl
      ? `<img src="${data.logoUrl}" height="${barLogoH}" alt="${data.company}" style="${barLogoStyle}" />`
      : '');
  const brandInBar = (barLogoImg && data.barLogoLinkUrl)
    ? `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.barLogoLinkUrl), 'website_click', tracking, 'bar_logo')}" style="display:block;text-decoration:none;">${barLogoImg}</a>`
    : barLogoImg;

  // Footer row
  const hasFooter = data.disclaimer || data.poweredByLogoUrl || data.poweredByLabel;
  const footerRow = hasFooter ? `
  <tr>
    <td colspan="2" style="width:${W}px;background-color:#ffffff;border-top:1px solid #e5e7eb;padding:12px 20px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="font-family:${font};font-size:10px;color:#9ca3af;line-height:1.4;vertical-align:middle;padding-right:16px;">${data.disclaimer || ''}</td>
          ${(data.poweredByLogoUrl || data.poweredByLabel) ? `
          <td style="text-align:right;vertical-align:middle;white-space:nowrap;">
            ${(data.poweredByLabel && !data.poweredByLogoUrl) ? `<div style="font-size:8px;letter-spacing:1.5px;color:#9ca3af;text-transform:uppercase;margin-bottom:4px;text-align:right;">${data.poweredByLabel}</div>` : ''}
            ${data.poweredByLogoUrl ? (data.poweredByLinkUrl ? `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.poweredByLinkUrl), 'website_click', tracking, 'powered_by')}" style="display:inline-block;text-decoration:none;"><img src="${data.poweredByLogoUrl}" height="26" alt="Powered by" style="height:26px;display:inline-block;border:0;" /></a>` : `<img src="${data.poweredByLogoUrl}" height="26" alt="Powered by" style="height:26px;display:inline-block;border:0;" />`) : ''}
          </td>` : ''}
        </tr>
      </table>
    </td>
  </tr>` : '';

  return `<table cellpadding="0" cellspacing="0" border="0" width="${W}" style="font-family:${font};width:100%;max-width:${W}px;border-collapse:collapse;table-layout:fixed;">
  <!-- ROW 1: White section — contact left, photo right -->
  <tr>
    <td width="${leftW}" style="width:${leftW}px;vertical-align:top;background-color:#ffffff;padding:24px 20px 0 24px;">
      <div style="font-size:24px;font-weight:700;color:#111827;line-height:1.1;margin-bottom:4px;letter-spacing:-0.4px;">${data.fullName}</div>
      ${data.jobTitle ? `<div style="font-size:13px;color:#4b5563;margin-bottom:16px;font-weight:500;">${data.jobTitle}${data.company ? ` - ${data.company}` : ''}</div>` : ''}
      <div style="margin-top:12px;">${contactItems.join('')}</div>
    </td>
    <td width="${photoW}" height="${photoH}" style="width:${photoW}px;height:${photoH}px;vertical-align:bottom;background-color:#ffffff;padding:0;line-height:0;font-size:0;">
      ${photoCell}
    </td>
  </tr>
  <!-- ROW 2: Full-width colour bar -->
  <tr>
    <td colspan="2" style="width:100%;max-width:${W}px;background-color:${barColor};padding:0;">
      <table cellpadding="0" cellspacing="0" border="0" width="${W}" style="width:100%;max-width:${W}px;height:${barH}px;table-layout:fixed;border-collapse:collapse;">
        <tr style="vertical-align:top;">
          <td width="${leftW}" style="width:${leftW}px;padding:16px 0 0 24px;vertical-align:top;">
            ${brandInBar}
          </td>
          <td width="${photoW}" style="width:${photoW}px;padding:12px 24px 0 0;vertical-align:top;text-align:right;">
            ${barIcons}
          </td>
        </tr>
        <tr style="vertical-align:bottom;">
          <td width="${leftW}" style="width:${leftW}px;padding:0 0 14px 24px;vertical-align:bottom;">
            ${data.brandTagline ? `<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:${barText};text-transform:uppercase;">${data.brandTagline}</div>` : ''}
          </td>
          <td width="${photoW}" style="width:${photoW}px;padding:0 24px 14px 0;vertical-align:bottom;text-align:right;">
            ${data.website ? `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="font-size:11px;font-weight:700;letter-spacing:0.5px;color:${barText};text-decoration:none;text-transform:uppercase;">${data.website.replace(/^https?:\/\//, '')}</a>` : ''}
          </td>
        </tr>
      </table>
    </td>
  </tr>
  <!-- ROW 3: Footer (disclaimer + powered-by) -->
  ${footerRow}
</table>`;
}


// ─── Template: Hub ────────────────────────────────────────────────────────────
// Layout: clean two-column header (photo + info), then a full-width platform
// icon grid with labels, then optional banner/disclaimer/powered-by footer.
// Designed to showcase all social, review, and delivery platform links.
function generateHub(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const font = data.fontFamily || 'Arial, Helvetica, sans-serif';
  const primary = data.primaryColor || '#6366F1';

  // ── Photo ──
  const photo = photoHtml(data, 72, tracking);

  // ── Logo ──
  const logo = logoHtml(data, tracking);

  // ── Contact lines ──
  const contactParts: string[] = [];
  if (data.email) contactParts.push(`<a href="mailto:${data.email}" style="color:${primary};text-decoration:none;font-size:12px;font-family:${font};font-weight:500;">${data.email}</a>`);
  if (data.phone) contactParts.push(telLink(data.phone, `color:#4b5563;font-size:12px;font-family:${font};text-decoration:none;`));
  if (data.mobile) contactParts.push(telLink(data.mobile, `color:#4b5563;font-size:12px;font-family:${font};text-decoration:none;`));
  if (data.website) contactParts.push(`<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.website), 'website_click', tracking)}" style="color:${primary};text-decoration:none;font-size:12px;font-family:${font};font-weight:500;">${data.website.replace(/^https?:\/\//, '')}</a>`);
  if (data.address) contactParts.push(addressLink(data.address, `color:#6b7280;font-size:11px;font-family:${font};text-decoration:none;`, tracking));

  // ── All platform links with labels ──
  const allPlatforms: Array<{ key: keyof typeof SVG_SOURCES; url: string; label: string }> = [
    { key: 'linkedin', url: data.linkedin, label: 'LinkedIn' },
    { key: 'instagram', url: data.instagram, label: 'Instagram' },
    { key: 'facebook', url: data.facebook, label: 'Facebook' },
    { key: 'twitter', url: data.twitter, label: 'X / Twitter' },
    { key: 'youtube', url: data.youtube, label: 'YouTube' },
    { key: 'tiktok', url: data.tiktok, label: 'TikTok' },
    { key: 'spotify', url: data.spotify, label: 'Spotify' },
    { key: 'pinterest', url: data.pinterest, label: 'Pinterest' },
    { key: 'github', url: data.github, label: 'GitHub' },
    { key: 'googleMaps', url: data.googleMaps, label: 'Google Maps' },
    { key: 'googleReviews', url: data.googleReviews, label: 'Google Reviews' },
    { key: 'trustpilot', url: data.trustpilot, label: 'Trustpilot' },
    { key: 'tripadvisor', url: data.tripadvisor, label: 'TripAdvisor' },
    { key: 'uberEats', url: data.uberEats, label: 'Uber Eats' },
    { key: 'deliveroo', url: data.deliveroo, label: 'Deliveroo' },
    { key: 'expedia', url: data.expedia, label: 'Expedia' },
    { key: 'amazon', url: data.amazon, label: 'Amazon' },
    { key: 'rss', url: data.rss, label: 'RSS' },
    { key: 'websiteLink', url: data.websiteLink, label: 'Website' },
  ].filter(s => s.url);

  // Build labelled icon pills — each platform gets icon + label in a premium pill tag
  const iconPills = allPlatforms.map(s => {
    const iconUri = forExport
      ? resolveIconUrlForExport(s.key, primary, iconUrlMap ?? {})
      : resolveIconUrl(s.key, primary, iconUrlMap);
    if (!iconUri) return ''; // skip in export mode if no PNG available
    return `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(s.url), 'social_click', tracking, s.key)}" title="${s.label}" style="display:inline-block;text-decoration:none;margin:0 6px 6px 0;vertical-align:top;">` +
      `<table cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e2e8f0;border-radius:6px;background-color:#ffffff;box-shadow:0 1px 2px rgba(0,0,0,0.02);border-collapse:collapse;">` +
      `<tr>` +
      `<td style="padding:5px 9px;vertical-align:middle;white-space:nowrap;">` +
      `<img src="${iconUri}" width="14" height="14" alt="${s.label}" style="display:inline-block;vertical-align:middle;width:14px;height:14px;border:0;" />` +
      `<span style="font-family:${font};font-size:11px;font-weight:600;color:#374151;margin-left:6px;vertical-align:middle;">${s.label}</span>` +
      `</td>` +
      `</tr>` +
      `</table>` +
      `</a>`;
  }).join('');

  const hasPlatforms = allPlatforms.length > 0;

  const banner = bannerHtml(data, tracking, true); // full-width to match the Hub signature width
  const cta = ctaHtml(data, tracking);
  const disclaimer = disclaimerHtml(data);
  const verdiict = verdiictHtml(data, tracking);
  const separator = `&nbsp;<span style="color:${primary};font-weight:700;">·</span>&nbsp;`;

  // Footer row (powered-by)
  const hasFooter = !!(data.poweredByLogoUrl || data.poweredByLabel);
  const poweredBySection = hasFooter ? `
    <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td></td>
        <td style="text-align:right;vertical-align:middle;white-space:nowrap;">
          ${data.poweredByLabel ? `<div style="font-size:8px;letter-spacing:1.5px;color:#9ca3af;text-transform:uppercase;margin-bottom:4px;text-align:right;">${data.poweredByLabel}</div>` : ''}
          ${data.poweredByLogoUrl ? (data.poweredByLinkUrl ? `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.poweredByLinkUrl), 'website_click', tracking, 'powered_by')}" style="display:inline-block;text-decoration:none;"><img src="${data.poweredByLogoUrl}" height="22" alt="Powered by" style="height:22px;display:inline-block;border:0;" /></a>` : `<img src="${data.poweredByLogoUrl}" height="22" alt="Powered by" style="height:22px;display:inline-block;border:0;" />`) : ''}
        </td>
      </tr></table>
    </div>` : '';

  const showPhotoCell = data.showPhoto && data.photoUrl;

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${font};max-width:560px;border-collapse:collapse;">
  <tr><td colspan="2" style="height:3px;background-color:${primary};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr>
    ${showPhotoCell ? `<td style="padding:18px 16px 12px 0;vertical-align:top;width:80px;">${photo}</td>` : ''}
    <td style="padding:18px 0 12px 0;vertical-align:top;">
      <div style="font-size:19px;font-weight:700;color:#111827;line-height:1.2;letter-spacing:-0.2px;">${data.fullName}</div>
      ${data.jobTitle ? `<div style="font-size:12px;font-weight:600;color:${primary};margin-top:2px;">${data.jobTitle}${data.company ? `<span style="color:#9ca3af;font-weight:400;"> &bull; ${data.company}</span>` : ''}</div>` : ''}
      ${data.department ? `<div style="font-size:11px;color:#9ca3af;margin-top:1px;">${data.department}</div>` : ''}
      <div style="margin-top:8px;line-height:1.8;color:#4b5563;">${contactParts.join(separator)}</div>
      ${logo ? `<div style="margin-top:10px;">${logo}</div>` : ''}
    </td>
  </tr>
  ${hasPlatforms ? `
  <tr>
    <td colspan="2" style="padding:12px 0 4px 0;border-top:1px solid #f3f4f6;">
      <div style="font-size:9px;font-weight:700;letter-spacing:1.5px;color:#9ca3af;text-transform:uppercase;margin-bottom:8px;">Find us on</div>
      <div style="line-height:1;">${iconPills}</div>
    </td>
  </tr>` : ''}
  ${(cta || banner || disclaimer || verdiict || hasFooter) ? `
  <tr>
    <td colspan="2" style="padding-top:8px;">
      ${cta}${banner}${disclaimer}${verdiict}${poweredBySection}
    </td>
  </tr>` : ''}
</table>`;
}

// ─── URL Normalization ───────────────────────────────────────────────────────
/**
 * Convert any relative /manus-storage/ (or other relative) src URLs in the
 * signature HTML to absolute URLs so images work when pasted into email clients.
 * Must be called on the generated HTML before copy/download.
 */
export function makeSignatureUrlsAbsolute(html: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (!origin) return html;
  return html
    .replace(/src="(\/[^"]+)"/g, `src="${origin}$1"`)
    .replace(/src='(\/[^']+)'/g, `src='${origin}$1'`);
}

// ─── Template: Branded Card ──────────────────────────────────────────────────
// Layout: white body above, then full-bleed colour card below.
//   White body: name (large bold), job title — company, contact lines (phone, mobile, email, address)
//   Colour card top row:    logo (top-left)  |  social icons (top-right)
//   Colour card bottom row: secondary logo / tagline (bottom-left) | website URL (bottom-right)
// All colours user-selectable: barColor = card background, barTextColor = text/icons.
function generateBrandedCard(data: SignatureData, iconUrlMap?: IconUrlMap, forExport = false, tracking?: TrackingContext): string {
  const W = data.imageCardWidth || 480;
  const bgColor = data.barColor || '#0E0E0C';
  const textColor = data.barTextColor || '#FFFFFF';
  const font = data.fontFamily || 'Arial, Helvetica, sans-serif';
  const cardPad = 28; // padding inside the card banner

  // ── White body: name, title, contact (above the card) ──
  const contactBodyItems: string[] = [];
  if (data.phone) contactBodyItems.push(`<div style="font-size:13px;color:#374151;margin-bottom:4px;">${telLink(data.phone, 'color:#374151;text-decoration:none;')}</div>`);
  if (data.mobile) contactBodyItems.push(`<div style="font-size:13px;color:#374151;margin-bottom:4px;">${telLink(data.mobile, 'color:#374151;text-decoration:none;')}</div>`);
  if (data.email) contactBodyItems.push(`<div style="font-size:13px;color:#374151;margin-bottom:4px;"><a href="mailto:${data.email}" style="color:#374151;text-decoration:none;">${data.email}</a></div>`);
  if (data.address) contactBodyItems.push(`<div style="font-size:12px;color:#6b7280;margin-top:8px;line-height:1.4;">${addressLink(data.address, 'color:#6b7280;text-decoration:none;', tracking)}</div>`);

  const whiteBody = `
  <tr>
    <td style="background-color:#ffffff;padding:24px 0 20px ${cardPad}px;font-family:${font};">
      <div style="font-size:24px;font-weight:700;color:#111827;line-height:1.1;margin-bottom:4px;letter-spacing:-0.3px;">${data.fullName || ''}</div>
      ${(data.jobTitle || data.company) ? `<div style="font-size:13px;color:#4b5563;margin-bottom:14px;font-weight:500;">${[data.jobTitle, data.company].filter(Boolean).join(' - ')}</div>` : ''}
      ${contactBodyItems.length ? `<div style="margin-top:10px;">${contactBodyItems.join('')}</div>` : ''}
    </td>
  </tr>`;

  // ── Social icons ──
  const socialList: Array<{ key: keyof typeof SVG_SOURCES; url: string; label: string }> = [
    { key: 'facebook', url: data.facebook, label: 'Facebook' },
    { key: 'instagram', url: data.instagram, label: 'Instagram' },
    { key: 'linkedin', url: data.linkedin, label: 'LinkedIn' },
    { key: 'youtube', url: data.youtube, label: 'YouTube' },
    { key: 'twitter', url: data.twitter, label: 'X' },
    { key: 'github', url: data.github, label: 'GitHub' },
    { key: 'spotify', url: data.spotify, label: 'Spotify' },
    { key: 'pinterest', url: data.pinterest, label: 'Pinterest' },
    { key: 'tiktok', url: data.tiktok, label: 'TikTok' },
    { key: 'googleMaps', url: data.googleMaps, label: 'Google Maps' },
    { key: 'googleReviews', url: data.googleReviews, label: 'Google Reviews' },
    { key: 'trustpilot', url: data.trustpilot, label: 'Trustpilot' },
    { key: 'tripadvisor', url: data.tripadvisor, label: 'TripAdvisor' },
    { key: 'uberEats', url: data.uberEats, label: 'Uber Eats' },
    { key: 'deliveroo', url: data.deliveroo, label: 'Deliveroo' },
    { key: 'expedia', url: data.expedia, label: 'Expedia' },
    { key: 'rss', url: data.rss, label: 'RSS' },
    { key: 'amazon', url: data.amazon, label: 'Amazon' },
    { key: 'websiteLink', url: data.websiteLink, label: 'Website' },
  ].filter(s => s.url);

  const barIconSize = 20;
  const socialIconsHtml = socialList.map((s, i) => {
    const iconUri = forExport
      ? resolveIconUrlForExport(s.key, textColor, iconUrlMap ?? {})
      : resolveIconUrl(s.key, textColor, iconUrlMap);
    if (!iconUri) return '';
    const ml = i === 0 ? '0' : '8px';
    return `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(s.url), 'social_click', tracking, s.key)}" title="${s.label}" style="display:inline-block;margin-left:${ml};text-decoration:none;"><img src="${iconUri}" width="${barIconSize}" height="${barIconSize}" alt="${s.label}" style="display:block;width:${barIconSize}px;height:${barIconSize}px;border:0;" /></a>`;
  }).join('');

  // ── Brand logo ──
  const logoH = 50;
  const logoSrc = data.barLogoUrl || (data.showLogo ? data.logoUrl : '') || '';
  const logoLinkHref = wrapTrackingUrl(ensureAbsoluteUrl(data.barLogoLinkUrl || data.logoLinkUrl || ''), 'website_click', tracking, 'logo');
  const logoImg = logoSrc
    ? `<img src="${logoSrc}" height="${logoH}" alt="${data.company || 'Brand'}" style="width:auto;height:auto;max-height:${logoH}px;display:inline;vertical-align:top;border:0;" />`
    : `<span style="font-size:32px;font-weight:700;color:${textColor};line-height:1;letter-spacing:-0.5px;">${data.company || ''}</span>`;
  const logoEl = (data.barLogoLinkUrl || data.logoLinkUrl)
    ? `<a href="${logoLinkHref}" style="display:inline-block;text-decoration:none;">${logoImg}</a>`
    : `<div style="display:inline-block;">${logoImg}</div>`;

  // ── Secondary logo ──
  const secLogoW = Math.round(W * 0.4);
  const secLogoImg = data.poweredByLogoUrl
    ? `<img src="${data.poweredByLogoUrl}" width="${secLogoW}" alt="${data.poweredByLabel || ''}" style="width:auto;height:auto;max-width:${secLogoW}px;display:inline;vertical-align:bottom;border:0;" />`
    : '';
  const bottomLeft = secLogoImg
    ? (data.poweredByLinkUrl ? `<a href="${wrapTrackingUrl(ensureAbsoluteUrl(data.poweredByLinkUrl), 'website_click', tracking, 'powered_by')}" style="display:inline-block;text-decoration:none;">${secLogoImg}</a>` : `<div style="display:inline-block;">${secLogoImg}</div>`)
    : '';

  // ── Website URL ──
  const websiteRaw = data.website || '';
  const websiteHref = websiteRaw && !/^https?:\/\//i.test(websiteRaw) ? `https://${websiteRaw}` : websiteRaw;
  const websiteDisplay = websiteRaw.replace(/^https?:\/\//, '');
  const websiteEl = websiteDisplay
    ? `<a href="${wrapTrackingUrl(websiteHref, 'website_click', tracking)}" style="font-size:12px;font-weight:700;letter-spacing:0.5px;color:${textColor};text-decoration:none;text-transform:uppercase;">${websiteDisplay}</a>`
    : '';

  // ── Disclaimer footer ──
  const footerRow = data.disclaimer ? `
  <tr>
    <td style="background-color:#ffffff;border-top:1px solid #e5e7eb;padding:12px 0;font-family:${font};font-size:10px;color:#9ca3af;line-height:1.4;">${data.disclaimer}</td>
  </tr>` : '';

  // ── Card banner table layout with email-safe corner rounded borders on cells ──
  const radius = typeof data.cardRadius === 'number' ? data.cardRadius : 12;
  const cardBanner = `<table cellpadding="0" cellspacing="0" border="0" style="width:${W}px;border-collapse:separate;border-radius:${radius}px;background-color:${bgColor};">
    <!-- Top row: logo (left) | social icons (right) -->
    <tr>
      <td width="1" style="border-radius:${radius}px 0 0 0;padding:${cardPad}px 0 0 ${cardPad}px;vertical-align:top;white-space:nowrap;background-color:${bgColor};">${logoEl}</td>
      <td style="border-radius:0 ${radius}px 0 0;padding:${cardPad}px ${cardPad}px 0 0;vertical-align:top;text-align:right;white-space:nowrap;background-color:${bgColor};">${socialIconsHtml}</td>
    </tr>
    <!-- Bottom row: secondary logo/tagline (left) | website (right) -->
    <tr>
      <td width="1" style="border-radius:0 0 0 ${radius}px;padding:${cardPad + 12}px 0 ${cardPad}px ${cardPad}px;vertical-align:bottom;white-space:nowrap;background-color:${bgColor};">${bottomLeft}</td>
      <td style="border-radius:0 0 ${radius}px 0;padding:${cardPad}px ${cardPad}px ${cardPad}px 0;vertical-align:bottom;text-align:right;white-space:nowrap;background-color:${bgColor};">${websiteEl}</td>
    </tr>
  </table>`;

  return `<table cellpadding="0" cellspacing="0" border="0" style="font-family:${font};width:${W}px;max-width:${W}px;border-collapse:collapse;">
  ${whiteBody}
  <!-- BRANDED CARD BANNER -->
  <tr>
    <td style="padding:0;">${cardBanner}</td>
  </tr>
  ${footerRow}
</table>`;
}

// ─── Main Generator ───────────────────────────────────────────────────────────
// Wrap generated HTML in a max-width outer table so the signature never
// stretches to fill the full reading pane in email clients (Outlook, Gmail, etc.).
// The outer table uses a fixed pixel width matching the card width for image-card
// templates, or 600px for all others. This is the email-safe equivalent of max-width.
function wrapWithMaxWidth(inner: string, maxW: number): string {
  return `<table cellpadding="0" cellspacing="0" border="0" width="${maxW}" style="width:100%;max-width:${maxW}px;border-collapse:collapse;"><tr><td style="padding:0;">${inner}</td></tr></table>`;
}

export function generateSignatureHtml(data: SignatureData, iconUrlMap?: IconUrlMap): string {
  // Preview mode — no tracking context, links stay as-is.
  const cardW = data.imageCardWidth || 600;
  switch (data.template) {
    case 'classic': return wrapWithMaxWidth(generateClassic(data, iconUrlMap), 600);
    case 'modern': return wrapWithMaxWidth(generateModern(data, iconUrlMap), 600);
    case 'minimal': return wrapWithMaxWidth(generateMinimal(data, iconUrlMap), 600);
    case 'bold': return wrapWithMaxWidth(generateBold(data, iconUrlMap), 600);
    case 'corporate': return wrapWithMaxWidth(generateCorporate(data, iconUrlMap), 600);
    case 'imagecard': return wrapWithMaxWidth(generateImageCard(data, iconUrlMap), cardW);
    case 'hub': return wrapWithMaxWidth(generateHub(data, iconUrlMap), 600);
    case 'brandedcard': return wrapWithMaxWidth(generateBrandedCard(data, iconUrlMap), cardW);
    default: return wrapWithMaxWidth(generateClassic(data), 600);
  }
}

/**
 * Email-export variant: uses ONLY hosted PNG icon URLs.
 * NEVER falls back to SVG data URIs (Gmail blocks them).
 * iconUrlMap MUST be pre-populated with server-rendered PNGs.
 * Icons with no PNG entry are omitted from the output.
 *
 * When a `TrackingContext` is provided, all clickable links are wrapped
 * through the redirector service for server-side analytics.
 */
export function generateSignatureHtmlForExport(data: SignatureData, iconUrlMap: IconUrlMap, tracking?: TrackingContext): string {
  const cardW = data.imageCardWidth || 600;
  switch (data.template) {
    case 'classic': return wrapWithMaxWidth(generateClassic(data, iconUrlMap, true, tracking), 600);
    case 'modern': return wrapWithMaxWidth(generateModern(data, iconUrlMap, true, tracking), 600);
    case 'minimal': return wrapWithMaxWidth(generateMinimal(data, iconUrlMap, true, tracking), 600);
    case 'bold': return wrapWithMaxWidth(generateBold(data, iconUrlMap, true, tracking), 600);
    case 'corporate': return wrapWithMaxWidth(generateCorporate(data, iconUrlMap, true, tracking), 600);
    case 'imagecard': return wrapWithMaxWidth(generateImageCard(data, iconUrlMap, true, tracking), cardW);
    case 'hub': return wrapWithMaxWidth(generateHub(data, iconUrlMap, true, tracking), 600);
    case 'brandedcard': return wrapWithMaxWidth(generateBrandedCard(data, iconUrlMap, true, tracking), cardW);
    default: return wrapWithMaxWidth(generateClassic(data, iconUrlMap, true, tracking), 600);
  }
}
