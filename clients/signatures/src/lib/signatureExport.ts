/**
 * signatureExport — the single source of truth for turning a signature brand +
 * member into final, email-ready HTML.
 *
 * Every surface that copies/downloads a signature (Home editor, Brands admin
 * dialog, Brands "Download all", public BrandShare page) MUST go through
 * `renderExportHtml` so they all agree on:
 *   - field mapping (buildSignatureData — brand + member → SignatureData)
 *   - redirector click-tracking (buildTrackingContext)
 *   - hosted PNG icons, never SVG data URIs (fetchExportIconMap — Gmail/Outlook
 *     strip SVG data URIs)
 *   - relative → absolute image URLs (makeSignatureUrlsAbsolute)
 */
import {
  generateSignatureHtmlForExport,
  makeSignatureUrlsAbsolute,
  SOCIAL_ICON_KEYS,
  type IconUrlMap,
  type SocialIconKey,
  type TrackingContext,
} from './signatureGenerator';
import { DEFAULT_SIGNATURE, type SignatureData } from './signatureTypes';
import { trpc } from './trpc';
import { redirectorHost } from '@shared/lib/origins';

type TrpcUtils = ReturnType<typeof trpc.useUtils>;

// ─── Brand/member → SignatureData ────────────────────────────────────────────
/**
 * Structural subsets of the signature brand/member rows — every consumer's
 * locally-typed row (Brands admin, public share) is assignable to these.
 */
export interface SignatureBrandFields {
  id: string;
  name: string;
  website?: string | null;
  address?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  fontFamily?: string | null;
  barColor?: string | null;
  barTextColor?: string | null;
  barLogoUrl?: string | null;
  barLogoLinkUrl?: string | null;
  brandDisplayName?: string | null;
  brandTagline?: string | null;
  logoUrl?: string | null;
  logoLinkUrl?: string | null;
  logoWidth?: number | null;
  poweredByLogoUrl?: string | null;
  poweredByLabel?: string | null;
  poweredByLinkUrl?: string | null;
  verdiictUrl?: string | null;
  verdiictReviewsUrl?: string | null;
  disclaimer?: string | null;
  defaultTemplate?: string | null;
  imageCardWidth?: number | null;
  cardRadius?: number | null;
}

export interface SignatureMemberFields {
  id: string;
  signatureBrandId?: string | null;
  fullName: string;
  jobTitle?: string | null;
  department?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  photoUrl?: string | null;
  photoLinkUrl?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  github?: string | null;
  spotify?: string | null;
  pinterest?: string | null;
  tiktok?: string | null;
  googleMaps?: string | null;
  googleReviews?: string | null;
  trustpilot?: string | null;
  tripadvisor?: string | null;
  uberEats?: string | null;
  deliveroo?: string | null;
  expedia?: string | null;
  rss?: string | null;
  amazon?: string | null;
  websiteLink?: string | null;
  verdiictUrl?: string | null;
  verdiictReviewsUrl?: string | null;
}

/** Map a signature brand + member row onto renderable SignatureData. */
export function buildSignatureData(
  brand: SignatureBrandFields,
  member: SignatureMemberFields,
): SignatureData {
  return {
    ...DEFAULT_SIGNATURE,
    template:
      (brand.defaultTemplate as SignatureData['template']) ?? 'imagecard',
    fullName: member.fullName,
    jobTitle: member.jobTitle ?? '',
    department: member.department ?? '',
    company: brand.brandDisplayName || brand.name,
    email: member.email ?? '',
    phone: member.phone ?? '',
    mobile: member.mobile ?? '',
    website: brand.website ?? '',
    address: brand.address ?? '',
    photoUrl: member.photoUrl ?? '',
    showPhoto: !!member.photoUrl,
    logoUrl: brand.logoUrl ?? '',
    showLogo: !!brand.logoUrl,
    logoWidth: brand.logoWidth ?? 120,
    primaryColor: brand.primaryColor ?? '#4A7C59',
    secondaryColor: brand.secondaryColor ?? '#2D4A3E',
    fontFamily: brand.fontFamily ?? 'Arial, Helvetica, sans-serif',
    linkedin: member.linkedin ?? '',
    twitter: member.twitter ?? '',
    instagram: member.instagram ?? '',
    facebook: member.facebook ?? '',
    youtube: member.youtube ?? '',
    github: member.github ?? '',
    spotify: member.spotify ?? '',
    pinterest: member.pinterest ?? '',
    tiktok: member.tiktok ?? '',
    googleMaps: member.googleMaps ?? '',
    googleReviews: member.googleReviews ?? '',
    trustpilot: member.trustpilot ?? '',
    tripadvisor: member.tripadvisor ?? '',
    uberEats: member.uberEats ?? '',
    deliveroo: member.deliveroo ?? '',
    expedia: member.expedia ?? '',
    rss: member.rss ?? '',
    amazon: member.amazon ?? '',
    websiteLink: member.websiteLink ?? '',
    disclaimer: brand.disclaimer ?? '',
    barColor: brand.barColor ?? '#E85D26',
    barTextColor: brand.barTextColor ?? '#1a1a2e',
    barLogoUrl: brand.barLogoUrl ?? '',
    brandDisplayName: brand.brandDisplayName ?? '',
    brandTagline: brand.brandTagline ?? '',
    poweredByLogoUrl: brand.poweredByLogoUrl ?? '',
    poweredByLabel: brand.poweredByLabel ?? 'POWERED BY',
    poweredByLinkUrl: brand.poweredByLinkUrl ?? '',
    logoLinkUrl: brand.logoLinkUrl ?? '',
    barLogoLinkUrl: brand.barLogoLinkUrl ?? '',
    photoLinkUrl: member.photoLinkUrl ?? '',
    verdiictUrl: member.verdiictUrl ?? brand.verdiictUrl ?? '',
    verdiictReviewsUrl:
      member.verdiictReviewsUrl ?? brand.verdiictReviewsUrl ?? '',
    imageCardWidth: brand.imageCardWidth ?? 600,
    cardRadius: brand.cardRadius ?? 0,
  };
}

// ─── Click tracking ──────────────────────────────────────────────────────────
/**
 * Build the redirector TrackingContext, or undefined when tracking isn't
 * possible (no redirector origin configured, or no owning Prodesk brand).
 */
export function buildTrackingContext(opts: {
  /** The owning Prodesk brand id (NOT the signature brand id). */
  brandId: string | null | undefined;
  signatureBrandId?: string | null;
  memberId?: string | null;
  campaignId?: string | null;
}): TrackingContext | undefined {
  // The canonical redirector host, normalised — a signature is pasted into a mail
  // client and lives for years, so a link on anything but this host is dead mail.
  const base = redirectorHost();
  if (!base || !opts.brandId) return undefined;
  return {
    redirectorBase: `https://${base}`,
    brandId: opts.brandId,
    signatureBrandId: opts.signatureBrandId || undefined,
    memberId: opts.memberId || undefined,
    campaignId: opts.campaignId || undefined,
  };
}

// ─── Icon resolution ─────────────────────────────────────────────────────────
/**
 * The colour social icons are rendered in: bar-based templates (imagecard,
 * brandedcard) colour icons to barTextColor so they're visible on the coloured
 * bar; every other template uses primaryColor.
 */
export function exportIconColor(data: SignatureData): string {
  if (data.template === 'imagecard' || data.template === 'brandedcard')
    return data.barTextColor || '#1a1a2e';
  return data.primaryColor || '#1a1a2e';
}

/** Social icon keys that have a non-empty URL on this signature. */
export function activeIconKeys(data: SignatureData): SocialIconKey[] {
  return SOCIAL_ICON_KEYS.filter((key) => {
    const val = (data as unknown as Record<string, unknown>)[key];
    return typeof val === 'string' && val.trim().length > 0;
  });
}

// PNG URLs for a given (brand, colour, key-set) are deterministic, so cache
// them for the session — repeat exports (and "Download all") are instant.
const iconMapCache = new Map<string, IconUrlMap>();

/**
 * Fetch the hosted-PNG icon map for this signature, colorized to its current
 * icon colour. Always keyed to the CURRENT colour (a DB-preloaded map may have
 * been rendered with a stale colour); on fetch failure falls back to the
 * provided map rather than exporting a signature with no icons.
 */
export async function fetchExportIconMap(
  utils: TrpcUtils,
  brandId: string,
  data: SignatureData,
  fallback?: IconUrlMap,
): Promise<IconUrlMap> {
  const keys = activeIconKeys(data);
  if (keys.length === 0) return {};
  const color = exportIconColor(data);
  const cacheKey = `${brandId}|${color}|${keys.join(',')}`;
  const cached = iconMapCache.get(cacheKey);
  if (cached) return cached;
  try {
    const map = (await utils.signatures.icons.batchColorize.fetch({
      brandId,
      requests: keys.map((key) => ({ key, color })),
    })) as IconUrlMap;
    iconMapCache.set(cacheKey, map);
    return map;
  } catch {
    return fallback ?? {};
  }
}

// ─── Final HTML ──────────────────────────────────────────────────────────────
/**
 * Produce the final email-ready HTML for a signature: hosted PNG icons,
 * redirector-tracked links, absolute image URLs. `buildSuffix` lets a caller
 * append extra tracked HTML (e.g. a campaign banner) before URL normalization.
 *
 * When `brandId` is absent the signature still renders, just untracked and
 * with the fallback icon map (there is no brand to scope icon rendering to).
 */
export async function renderExportHtml(opts: {
  utils: TrpcUtils;
  data: SignatureData;
  /** The owning Prodesk brand id (icon scope + tracking attribution). */
  brandId: string | null | undefined;
  signatureBrandId?: string | null;
  memberId?: string | null;
  fallbackIconMap?: IconUrlMap;
  buildSuffix?: (tracking?: TrackingContext) => string;
}): Promise<string> {
  const tracking = buildTrackingContext(opts);
  const iconUrlMap = opts.brandId
    ? await fetchExportIconMap(
        opts.utils,
        opts.brandId,
        opts.data,
        opts.fallbackIconMap,
      )
    : (opts.fallbackIconMap ?? {});
  const suffix = opts.buildSuffix?.(tracking) ?? '';
  return makeSignatureUrlsAbsolute(
    generateSignatureHtmlForExport(opts.data, iconUrlMap, tracking) + suffix,
  );
}
