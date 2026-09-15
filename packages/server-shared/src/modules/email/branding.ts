import { env, isProd } from '../../lib/env.js';
import type { agencies, brands } from '../../db/schema.js';
import type { AgencyDetails } from './common-template.js';

type AgencyRow = typeof agencies.$inferSelect;
type BrandRow = typeof brands.$inferSelect;

/** Default Prodesk logo used when an org has no logo (matches production). */
export const DEFAULT_PRODESK_LOGO =
  'https://storage.googleapis.com/crew-prodesk.firebasestorage.app/meta/blogo.png';

/**
 * Map an agency row to the `AgencyDetails` consumed by buildCommonTemplate so
 * org-context emails render with the agency's branding (logo, social, contact),
 * mirroring production. Agencies have no theme-accent column yet, so the header
 * falls back to the default dark accent (#111111).
 */
export function agencyBranding(
  agency: Partial<AgencyRow> | null | undefined,
): AgencyDetails {
  return {
    name: agency?.businessName ?? 'Prodesk',
    logoUrl: agency?.logoUrl ?? DEFAULT_PRODESK_LOGO,
    businessEmail: agency?.businessEmail ?? null,
    address: agency?.address ?? null,
    phone: agency?.phone ?? null,
    website: agency?.website ?? null,
    themeAccent: null, // no per-agency accent column today → default header color
    social: agency?.social
      ? {
          facebookUrl: agency.social.facebookUrl ?? null,
          xUrl: agency.social.xUrl ?? null,
          instagramUrl: agency.social.instagramUrl ?? null,
        }
      : null,
  };
}

/**
 * Map a brand row to `AgencyDetails`. Brands carry a `colors[]` brand-guideline
 * array — the first hex is used as the email accent when present.
 */
export function brandBranding(
  brand: Partial<BrandRow> | null | undefined,
): AgencyDetails {
  return {
    name: brand?.businessName ?? 'Prodesk',
    logoUrl: brand?.logoUrl ?? DEFAULT_PRODESK_LOGO,
    businessEmail: brand?.email ?? null,
    address: brand?.address ?? null,
    phone: brand?.phone ?? null,
    website: brand?.website ?? null,
    themeAccent: brand?.colors?.[0] ?? null,
    social: null,
  };
}

/** Generic Prodesk-branded details (auth emails, no org context). */
export const PRODESK_BRANDING: AgencyDetails = { name: 'Prodesk' };

/**
 * The app base URL for an email's links. In production, an agency-referred
 * recipient gets the agency subdomain (`<username>.app.prodesk.com`), mirroring
 * the prod `referredAgencyUsername` logic; otherwise the configured client origin.
 */
export function appBaseUrl(username?: string | null): string {
  if (isProd) {
    return `https://${username ? `${username}.` : ''}${env.VITE_APP_PRODESK_ORIGIN}`;
  }
  return env.SERVER_ORIGIN;
}

/**
 * Apex domains trusted as email link origins: always `prodesk.com`, plus any
 * white-label frontend domains configured via `EMAIL_ALLOWED_ORIGINS`
 * (comma-separated). A hostname matches an apex when it equals it or is a
 * subdomain of it.
 */
function allowedEmailApexes(): string[] {
  const extra = (env.EMAIL_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return ['prodesk.com', ...extra];
}

/** In hosted envs, only embed allow-listed origins in outbound emails — the
 *  `x-client-origin` header is client-controlled, so it must be allow-listed. */
function isAllowedEmailOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    const host = hostname.toLowerCase();
    return allowedEmailApexes().some(
      (apex) => host === apex || host.endsWith(`.${apex}`),
    );
  } catch {
    return false;
  }
}

/**
 * Base URL for the action links in an email, honoring the FRONTEND the request
 * came from (`ctx.clientOrigin`) so an invite sent from the Links app points back
 * to the Links app — not always the main app.
 *
 * - production / staging: the origin must be a `*.prodesk.com` host to be used
 *   (allow-list, since the origin header is client-controlled); otherwise we fall
 *   back to {@link appBaseUrl}.
 * - development: no allow-list — the originating origin (e.g. localhost:5175) is
 *   trusted as-is, falling back to SERVER_ORIGIN when absent.
 */
export function emailBaseUrl(origin?: string | null, username?: string | null): string {
  const hosted = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  if (!hosted) return origin || env.SERVER_ORIGIN;
  if (origin && isAllowedEmailOrigin(origin)) return origin;
  return appBaseUrl(username);
}

/**
 * Base URL for a MESSENGER email's links — always the chat frontend, never the
 * main app.
 *
 * Chat is its own product on its own domain, and its emails were pointing at
 * `app.prodesk.com/chat`: a route that is not the messenger, reached through a
 * sign-in for a different app, which is the wrong side of the suite entirely for
 * someone who was told they have unread messages. Worse, the digest is fired by
 * a cron worker with no request behind it, so `emailBaseUrl(origin)` had no
 * origin to honour and fell back to the main app every single time.
 *
 * So this does not consult the request at all in hosted environments. Where the
 * message came from is irrelevant — a chat notification belongs in the chat app,
 * whether it was triggered from the messenger, from a workspace thread, or from
 * a scheduled job. Locally it prefers CHAT_ORIGIN, then the originating
 * frontend, so dev links are clickable without configuration when you are
 * already in the messenger.
 */
export function chatBaseUrl(origin?: string | null): string {
  const hosted = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
  if (hosted) return `https://${env.VITE_CHAT_PRODESK_ORIGIN}`;
  return env.CHAT_ORIGIN || origin || env.SERVER_ORIGIN;
}
