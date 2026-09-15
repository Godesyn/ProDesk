/**
 * Feature keys — the bridge between an admin-defined Feature Subscription product
 * and the code that GATES a feature. A product carries a `featureKey`; gating
 * code (entitlements.ts) checks for an active subscription to a product with the
 * matching key. To add a new feature subscription you add a key here, gate the
 * feature on it, and create a product with that key in the super-admin panel.
 */

export const FEATURE_KEYS = {
  /** Unlocks the brand AI assistant chat (Growth Strategy product). */
  AI_GROWTH_STRATEGY: 'ai_growth_strategy',
  /**
   * Unlocks creating short links / QR codes. Billed per-unit ($1 per active
   * short link / month) via a `perUnit` product — see per-unit.ts. Beta users
   * get it free like every other feature.
   */
  URL_SHORTENER: 'url_shortener',
  /**
   * Unlocks the Verdiict review-capture tool for a brand (unlimited locations,
   * embeds, directory listing). A flat brand-level subscription; the first
   * captured reviews brand-wide are free before it's required — see
   * modules/reviews/billing.ts. Beta users get it free like every other feature.
   */
  REVIEWS: 'reviews',
  /**
   * Unlocks the Payments (EziQuotes) proposals/quotes tool for a brand. Note:
   * the tool's core monetization is the per-payment platform fee (plan tiers
   * send/close/recover on Stripe Connect charges), not this subscription — the
   * feature key exists so access can be packaged/gated like other tools.
   */
  PAYMENTS: 'payments',
  /**
   * Unlocks the Signatures (SIGKITT) email-signature builder for a brand —
   * signature brands, members, campaigns, saved signatures and analytics. A flat
   * brand-level subscription; a handful of signature brands are free before it's
   * required — see modules/signatures/billing.ts. Beta users get it free like
   * every other feature.
   */
  EMAIL_SIGNATURES: 'email_signatures',
  /**
   * Unlocks the Logo Studio (AI logo builder + brand-genesis engine) for a brand.
   * Designing is always free; this key gates the EXPORT/download boundary (owning
   * the finished vectors + asset kit). Pricing model is deferred — the seam is
   * wired (see modules/logo/entitlement.ts) but no product is required yet, so
   * gating fails open until a `logo_builder` product exists. Beta users get it
   * free like every other feature.
   */
  LOGO: 'logo_builder',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

/**
 * The catalogue of known feature keys, surfaced to the super-admin product form
 * as a dropdown so a product is always tied to a real code gate (free-text keys
 * would silently gate nothing).
 */
export const KNOWN_FEATURES: { key: FeatureKey; label: string; gates: string }[] = [
  {
    key: FEATURE_KEYS.AI_GROWTH_STRATEGY,
    label: 'AI Growth Strategy',
    gates: 'Sending messages to the brand AI assistant chat.',
  },
  {
    key: FEATURE_KEYS.URL_SHORTENER,
    label: 'URL Shortener',
    gates: 'Creating short links / QR codes ($1 per active link / month).',
  },
  {
    key: FEATURE_KEYS.REVIEWS,
    label: 'Reviews (Verdiict)',
    gates: 'Capturing reviews once the free trial is used up.',
  },
  {
    key: FEATURE_KEYS.PAYMENTS,
    label: 'Payments (EziQuotes)',
    gates: 'Access to the proposals/quotes + Stripe Connect payments tool.',
  },
  {
    key: FEATURE_KEYS.EMAIL_SIGNATURES,
    label: 'Signatures (SIGKITT)',
    gates: 'Building email signatures once the free allowance is used up.',
  },
  {
    key: FEATURE_KEYS.LOGO,
    label: 'Logo Studio',
    gates: 'Exporting / downloading a finished logo + brand assets (designing is free).',
  },
];
