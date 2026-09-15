/**
 * Shared helpers for the AI tool modules: schema builders, validation/merge
 * utilities, billing lookups, and user-facing constant catalogs. Everything
 * here is brand-agnostic — per-turn state lives in ToolModuleCtx (types.ts).
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../../db/index.js';
import { brands, staff, users } from '../../../db/schema.js';
import type { ReviewEmbedTheme } from '../../../db/schema.js';
import { stripe } from '../../stripe/client.js';
import { brandOwnerId } from '../../feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../../feature-subscriptions/feature-keys.js';
import type { ToolDef } from './types.js';

export const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef['input_schema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/**
 * The shared `createAnyway` input every AI create-tool accepts. When the tool
 * finds a SIMILAR existing record it stops and asks the user (see
 * `similarExistsResult`); the user's "yes, make a new one anyway" is expressed
 * by the model re-calling with this flag set true.
 */
export const CREATE_ANYWAY_PROP = {
  createAnyway: {
    type: 'boolean',
    description:
      'Leave this off (false) the first time. If the tool reports a SIMILAR existing item, do NOT resend automatically — ask the user first. Only set true to proceed once the user has explicitly confirmed they want a NEW one anyway despite the similar item.',
  },
} as const;

/** Case/punctuation-insensitive comparison key: lowercased, alphanumerics only. */
export function normalizeName(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

/** Levenshtein edit distance between two strings (small inputs only). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur.push(Math.min(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Are two names "similar enough" that creating both is probably an accidental
 * duplicate? True when they normalise to the same key, when one contains the
 * other (≥3 chars, so trivial fragments don't match everything), or when they
 * are a small edit-distance apart (typos / minor wording tweaks).
 */
export function isSimilarName(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 3 && nb.length >= 3 && (na.includes(nb) || nb.includes(na))) return true;
  const dist = levenshtein(na, nb);
  return dist <= Math.max(1, Math.floor(Math.max(na.length, nb.length) * 0.2));
}

/**
 * From existing { id, name } records, those whose name is similar to `name`
 * (see isSimilarName). Capped so the confirm prompt stays tidy.
 */
export function findSimilarByName<T extends { name: string }>(name: string, items: readonly T[], limit = 5): T[] {
  return items.filter((i) => isSimilarName(name, i.name)).slice(0, limit);
}

/**
 * The tool result that tells the model to STOP and ask the user before creating
 * a likely-duplicate. `thing` names the record type ("review location"); `similar`
 * lists the existing matches (id + name); `updateHint` says how to use/edit an
 * existing one instead. The model relays this, then either re-calls with
 * createAnyway:true (user wants a new one) or takes the update path.
 */
export function similarExistsResult(
  thing: string,
  similar: Array<{ id: string; name: string }>,
  updateHint: string,
): Record<string, unknown> {
  return {
    status: 'similar_exists',
    similar,
    note: [
      `One or more existing ${thing}s look similar to what you're about to create (listed in \`similar\` with their id + name).`,
      'Do NOT create anything yet. Tell the user what already exists and ask whether they want to create a NEW one anyway, or use the existing one.',
      'To create a new one anyway once the user confirms, call this tool again with createAnyway: true.',
      updateHint,
    ].join(' '),
  };
}

export const STATUS_ACTIVE_EXCLUDE = ['completed'] as const;

// Review platforms a location can link to (mirrors reviews.locations.updatePlatform).
export const REVIEW_PLATFORMS = ['google', 'facebook', 'trustpilot', 'yelp', 'tripadvisor'] as const;
// The brand-relevant staff permissions the assistant may grant on an invite. A
// curated, non-deprecated subset of the full permission enum (schema.ts) — each
// maps to a tab/capability in the brand's frontends. `staffManagement` lets the
// invitee in turn manage the team, so it's offered but should be used sparingly.
export const BRAND_STAFF_PERMISSIONS = [
  'brandProjects', 'projectBoard', 'documents', 'brandGuidelines', 'brandBusinessInfo',
  'invoice', 'subscriptions', 'proposals', 'agencies', 'staffManagement',
  'payments', 'paymentsViewer', 'links', 'linksViewer', 'reviews', 'reviewsViewer',
  'chatWithStaffs', 'chatWithBrands',
] as const;
export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const QR_CORNER_STYLES = ['square', 'rounded', 'dots', 'dot', 'extra-rounded'] as const;
export const QR_DOT_STYLES = ['square', 'rounded', 'dots', 'classy'] as const;
export const EMBED_VARIANTS = ['carousel', 'wall', 'marquee', 'hero'] as const;
export const EMBED_FONTS = ['geist', 'inter', 'system', 'playfair', 'dm-sans'] as const;
export const EMBED_DENSITIES = ['compact', 'cozy', 'comfortable'] as const;
export const EMBED_RADII = ['sharp', 'soft', 'round'] as const;

/** The short-link QR design shape (mirrors qrConfigSchema in routers/shortLinks.ts). */
export interface QrConfig {
  logoUrl?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  cornerStyle?: (typeof QR_CORNER_STYLES)[number];
  dotStyle?: (typeof QR_DOT_STYLES)[number];
}

/**
 * Merge the QR fields a tool proposed onto an existing config, validating each.
 * Returns the merged config and a display map of the changed fields, or an error
 * string. `logoUrl: ''` clears the logo.
 */
export function mergeQrConfig(
  existing: QrConfig | null | undefined,
  input: Record<string, unknown>,
): { config: QrConfig; changes: Record<string, string> } | { error: string } {
  const config: QrConfig = { ...(existing ?? {}) };
  const changes: Record<string, string> = {};
  const setColor = (key: 'foregroundColor' | 'backgroundColor', label: string): string | null => {
    const v = input[key];
    if (v === undefined) return null;
    if (typeof v !== 'string' || !HEX_COLOR.test(v)) return `${label} must be a 6-digit hex colour like "#1a2b3c".`;
    config[key] = v;
    changes[label] = v;
    return null;
  };
  const e1 = setColor('foregroundColor', 'Foreground colour');
  if (e1) return { error: e1 };
  const e2 = setColor('backgroundColor', 'Background colour');
  if (e2) return { error: e2 };
  if (input.logoUrl !== undefined) {
    const v = String(input.logoUrl ?? '').trim();
    if (v) {
      try { new URL(v); } catch { return { error: 'The logo URL is not valid.' }; }
      config.logoUrl = v;
      changes['Logo'] = v;
    } else {
      delete config.logoUrl;
      changes['Logo'] = '— cleared —';
    }
  }
  if (input.cornerStyle !== undefined) {
    const v = String(input.cornerStyle);
    if (!(QR_CORNER_STYLES as readonly string[]).includes(v)) {
      return { error: `Corner style must be one of: ${QR_CORNER_STYLES.join(', ')}.` };
    }
    config.cornerStyle = v as QrConfig['cornerStyle'];
    changes['Corner style'] = v;
  }
  if (input.dotStyle !== undefined) {
    const v = String(input.dotStyle);
    if (!(QR_DOT_STYLES as readonly string[]).includes(v)) {
      return { error: `Dot style must be one of: ${QR_DOT_STYLES.join(', ')}.` };
    }
    config.dotStyle = v as QrConfig['dotStyle'];
    changes['Dot style'] = v;
  }
  if (Object.keys(changes).length === 0) return { error: 'Provide at least one QR style field to change.' };
  return { config, changes };
}

/**
 * Merge the embed-theme fields a tool proposed onto an existing theme, validating
 * each against the allowed enums. Returns the merged theme plus a display map of
 * changed fields, or an error string.
 */
export function mergeEmbedTheme(
  existing: ReviewEmbedTheme,
  input: Record<string, unknown>,
): { theme: ReviewEmbedTheme; changes: Record<string, string> } | { error: string } {
  const theme: ReviewEmbedTheme = { ...existing };
  const bag = theme as Record<string, unknown>;
  const changes: Record<string, string> = {};
  const enumField = (key: keyof ReviewEmbedTheme, allowed: readonly string[], label: string): string | null => {
    const v = input[key as string];
    if (v === undefined) return null;
    if (typeof v !== 'string' || !allowed.includes(v)) return `${label} must be one of: ${allowed.join(', ')}.`;
    bag[key as string] = v;
    changes[label] = v;
    return null;
  };
  const boolField = (key: keyof ReviewEmbedTheme, label: string): void => {
    const v = input[key as string];
    if (typeof v !== 'boolean') return;
    bag[key as string] = v;
    changes[label] = v ? 'yes' : 'no';
  };
  const errs = [
    enumField('variant', EMBED_VARIANTS, 'Layout'),
    enumField('fontFamily', EMBED_FONTS, 'Font'),
    enumField('density', EMBED_DENSITIES, 'Density'),
    enumField('radius', EMBED_RADII, 'Corner radius'),
  ].filter(Boolean);
  if (errs.length) return { error: errs[0] as string };
  if (input.accentColor !== undefined) {
    const v = String(input.accentColor);
    if (!HEX_COLOR.test(v)) return { error: 'Accent colour must be a 6-digit hex colour like "#1a2b3c".' };
    theme.accentColor = v;
    changes['Accent colour'] = v;
  }
  boolField('dark', 'Dark mode');
  boolField('showLogo', 'Show logo');
  boolField('showWinTags', 'Show win tags');
  boolField('showStarCount', 'Show star count');
  boolField('onlyFiveStar', 'Only 5-star');
  if (Object.keys(changes).length === 0) return { error: 'Provide at least one embed style field to change.' };
  return { theme, changes };
}

// Invoice status derivation + display-number formatting are single-sourced in the
// billing module (also used by the invoices router). Re-exported here so tool
// modules keep importing them from one place.
export { deriveInvoiceStatus, formatInvoiceNumber } from '../../billing/invoice-parties.js';

export interface BrandMember {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'staff';
}

/**
 * The brand's assignable team: the owner plus active staff who have a linked user
 * account. Keyed by user id (owner wins over a duplicate staff row). Shared by the
 * `list_staff` read tool and `create_brand_task` assignee validation.
 */
export async function listBrandMembers(db: DB, brandId: string): Promise<BrandMember[]> {
  const displayName = (firstName: string | null, lastName: string | null, email: string): string =>
    [firstName, lastName].filter(Boolean).join(' ').trim() || email;

  const [ownerRows, staffRows] = await Promise.all([
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
      .from(brands)
      .innerJoin(users, eq(brands.ownerId, users.id))
      .where(eq(brands.id, brandId))
      .limit(1),
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, displayName: staff.displayName })
      .from(staff)
      .innerJoin(users, eq(staff.userId, users.id))
      .where(and(eq(staff.brandId, brandId), eq(staff.status, 'active'))),
  ]);

  const byId = new Map<string, BrandMember>();
  for (const o of ownerRows) {
    byId.set(o.id, { id: o.id, name: displayName(o.firstName, o.lastName, o.email), email: o.email, role: 'owner' });
  }
  for (const s of staffRows) {
    if (byId.has(s.id)) continue; // owner row already claimed this user
    byId.set(s.id, { id: s.id, name: s.displayName?.trim() || displayName(s.firstName, s.lastName, s.email), email: s.email, role: 'staff' });
  }
  return [...byId.values()];
}

/**
 * The brand OWNER's saved card (the default payment method on their Stripe
 * customer) — the card all feature-subscription charges go to. Mirrors
 * shortLinks.paymentMethod. Returns null when Stripe is off, there is no
 * customer/card, or Stripe errors (billing disclosure degrades gracefully).
 */
export async function getOwnerCardOnFile(
  db: DB,
  brandId: string,
): Promise<{ brand: string; last4: string; expMonth: number; expYear: number } | null> {
  if (!stripe) return null;
  try {
    const ownerId = await brandOwnerId(db, brandId);
    if (!ownerId) return null;
    const [owner] = await db
      .select({ cust: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, ownerId))
      .limit(1);
    if (!owner?.cust) return null;
    const customer = await stripe.customers.retrieve(owner.cust);
    if (customer.deleted) return null;
    const defaultPm = customer.invoice_settings?.default_payment_method;
    const defaultPmId = typeof defaultPm === 'string' ? defaultPm : (defaultPm?.id ?? null);
    const pms = await stripe.paymentMethods.list({ customer: owner.cust, type: 'card', limit: 5 });
    const chosen = pms.data.find((p) => p.id === defaultPmId) ?? pms.data[0] ?? null;
    const card = chosen?.card;
    if (!card) return null;
    return { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year };
  } catch {
    return null;
  }
}

/** "VISA ending in 4242", or a no-card phrase for billing summaries. */
export function cardPhrase(card: { brand: string; last4: string } | null): string {
  return card ? `${card.brand.toUpperCase()} ending in ${card.last4}` : 'no card on file';
}

/**
 * What each feature subscription guards, in user-facing terms. Keyed by
 * featureKey; prices are NEVER stated here (they are read live from the
 * products catalog so admin price changes are always reflected).
 */
export const FEATURE_GUIDE: Record<string, { app: string; guards: string; billedAction: string }> = {
  [FEATURE_KEYS.AI_GROWTH_STRATEGY]: {
    app: 'Dashboard (Growth Strategy)',
    guards: 'This AI growth-strategy assistant. Without an active subscription the AI chat is unavailable for the brand.',
    billedAction: 'A flat monthly subscription (not per-unit) that unlocks this AI assistant.',
  },
  [FEATURE_KEYS.URL_SHORTENER]: {
    app: 'Links',
    guards: 'Short links and QR codes. Creating links is free; a link only redirects while it is ACTIVE, and active links are what the subscription covers.',
    billedAction: 'Billed per ACTIVE short link per month, metered across all the owner\'s brands combined. Creating a link is free; activating it adds a unit, and deactivating or deleting it removes one.',
  },
  [FEATURE_KEYS.REVIEWS]: {
    app: 'Reviews',
    guards: 'Review capture across all the brand\'s locations, plus embeds and the public directory. A limited free trial of captured reviews applies before the subscription is required.',
    billedAction: 'A flat monthly subscription (not per-unit) — locations are unlimited and free to create; capturing reviews is what it keeps live. Note the one exception to the account-wide rule: the free trial (captured reviews before a subscription is required) is counted PER BRAND.',
  },
  [FEATURE_KEYS.EMAIL_SIGNATURES]: {
    app: 'Signatures',
    guards: 'Email-signature team members (seats). The signature builder, campaigns, and analytics are included.',
    billedAction: `Billed per signature MEMBER (seat) per month at $1/seat. Seats are totalled across all the owner's brands combined — e.g. 2 members in one brand + 3 in another = 5 seats total ($5/mo). Adding a member adds a unit; removing one lowers the bill.`,
  },
  [FEATURE_KEYS.PAYMENTS]: {
    app: 'Payments',
    guards: 'The proposals/quotes + payments tool. It is not usually subscription-billed — it charges a small per-payment platform fee on transactions instead.',
    billedAction: 'Per-payment platform fee (plan-tier based), not a monthly subscription.',
  },
};

export const SUPPORT_CATEGORIES = ['general', 'billing', 'technical', 'feature_request', 'account', 'other'] as const;
export const SUPPORT_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

/**
 * The signature-member fields the assistant may set (a pragmatic subset of the
 * full MemberInput — file/photo keys are upload-flow-only and excluded).
 */
export const SIGNATURE_MEMBER_FIELDS = [
  'fullName', 'jobTitle', 'department', 'email', 'phone', 'mobile',
  'linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'tiktok', 'websiteLink',
] as const;

export const SIGNATURE_MEMBER_FIELD_PROPS: Record<string, unknown> = {
  fullName: { type: 'string', description: "The member's full name (required, non-empty)." },
  jobTitle: { type: 'string', description: 'Job title, e.g. "Head of Sales".' },
  department: { type: 'string', description: 'Department or team name.' },
  email: { type: 'string', description: 'Work email address shown on the signature. Must be a valid email if provided.' },
  phone: { type: 'string', description: 'Office/landline phone number (free-text).' },
  mobile: { type: 'string', description: 'Mobile phone number (free-text).' },
  linkedin: { type: 'string', description: 'LinkedIn profile URL.' },
  twitter: { type: 'string', description: 'X/Twitter profile URL.' },
  instagram: { type: 'string', description: 'Instagram profile URL.' },
  facebook: { type: 'string', description: 'Facebook page URL.' },
  youtube: { type: 'string', description: 'YouTube channel URL.' },
  tiktok: { type: 'string', description: 'TikTok profile URL.' },
  websiteLink: { type: 'string', description: 'Personal/company website URL.' },
};

/**
 * Human-readable labels for the signature-member fields, used as the confirm
 * card's row labels (the raw camelCase keys must never leak into the UI).
 */
export const SIGNATURE_MEMBER_FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name',
  jobTitle: 'Job title',
  department: 'Department',
  email: 'Email',
  phone: 'Phone',
  mobile: 'Mobile',
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  websiteLink: 'Website',
};

/**
 * Human-readable labels for the signature brand/design settings fields, used as
 * the confirm card's row labels.
 */
export const SIGNATURE_SETTINGS_FIELD_LABELS: Record<string, string> = {
  brandDisplayName: 'Brand name',
  brandTagline: 'Tagline',
  website: 'Website',
  address: 'Address',
  primaryColor: 'Primary colour',
  secondaryColor: 'Secondary colour',
  barColor: 'Bar colour',
  barTextColor: 'Bar text colour',
  fontFamily: 'Font',
  logoWidth: 'Logo width',
  disclaimer: 'Disclaimer',
  defaultTemplate: 'Default template',
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Input types the ask_user form supports (mirror FieldType in editable-card-fields.tsx). */
export const ASK_FIELD_TYPES = ['text', 'textarea', 'email', 'url', 'tel', 'number', 'year', 'date', 'select'] as const;

/**
 * Brand-profile fields the assistant may ask the USER to fill in on the confirm
 * card (rendered as blank, validated inputs) rather than fetching or inferring —
 * the verifiable facts only the user can supply. Used by update_brand_profile's
 * `requestFields`. Soft positioning/voice fields are omitted on purpose: the
 * assistant is expected to DRAFT those, not request them.
 */
export const PROFILE_REQUESTABLE_FIELDS = [
  'businessName', 'legalName', 'contactName', 'email', 'phone', 'website',
  'address', 'abn', 'industry', 'yearFounded',
] as const;

/**
 * Validate + normalise one proposed signature member. Returns the clean field
 * map or an error string. `label` names the row in errors ("member 3").
 */
export function cleanSignatureMember(
  raw: Record<string, unknown>,
  label: string,
): { member: Record<string, string> } | { error: string } {
  const member: Record<string, string> = {};
  for (const f of SIGNATURE_MEMBER_FIELDS) {
    const v = raw[f];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') return { error: `${label}: ${f} must be text.` };
    const t = v.trim();
    if (t) member[f] = t;
  }
  if (!member.fullName) return { error: `${label}: fullName is required.` };
  if (member.email && !EMAIL_RE.test(member.email)) return { error: `${label}: "${member.email}" is not a valid email address.` };
  return { member };
}
