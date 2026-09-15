/**
 * Beta usage probes — "did this owner actually use this tool, and how much?"
 *
 * The post-beta price report only lists tools the user REALLY used, with live
 * quantities, so the total is what they would genuinely owe rather than a
 * catalogue price list. Each feature key gets one probe here; a probe answers
 * both questions in a single query so the report stays cheap.
 *
 * ADDING A PRODUCT: add its feature key to `USAGE_PROBES`. A key with no probe
 * falls back to `neverUsed` — it is silently omitted from the report rather than
 * billed on a guess, which is the safe direction for a bill.
 *
 * Everything is OWNER-scoped (across every brand the user owns) because feature
 * subscriptions are owner-scoped — see modules/feature-subscriptions/entitlements.
 */
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  aiUsage,
  brands,
  logoProjects,
  proposals,
  reviewLocations,
  reviewSubmissions,
  shortLinks,
  signatureMembers,
} from '../../db/schema.js';
import { FEATURE_KEYS, type FeatureKey } from '../feature-subscriptions/feature-keys.js';
import { signaturesBillableUnits } from '../signatures/billing.js';

type Db = typeof defaultDb;

/** What a probe reports about one tool for one owner. */
export type FeatureUsage = {
  /** Did they touch this tool at all during the beta? Drives inclusion in the report. */
  used: boolean;
  /**
   * Billable quantity for a per-unit product (active links, paid seats, …).
   * Always 1 for a flat product. Zero with `used: true` means "they used it but
   * currently meter nothing" — the report shows the line at its flat price.
   */
  quantity: number;
  /**
   * Human phrase for what the quantity counts, singular/plural handled by the
   * caller: e.g. `active link`. Null for flat products.
   */
  unitNoun: string | null;
  /** A short "what they did" line for the report, e.g. `12 reviews captured`. */
  detail: string | null;
};

const neverUsed: FeatureUsage = { used: false, quantity: 1, unitNoun: null, detail: null };

/** Ids of every brand this user owns — the scope every probe counts over. */
async function ownedBrandIds(db: Db, ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.ownerId, ownerId));
  return rows.map((r) => r.id);
}

/**
 * URL shortener — billed per ACTIVE short link. "Used" means they ever created a
 * link (even one since disabled); the quantity is only the currently-active ones,
 * which is exactly what Stripe would meter (see per-unit.ts).
 */
async function probeUrlShortener(db: Db, brandIds: string[]): Promise<FeatureUsage> {
  if (brandIds.length === 0) return neverUsed;
  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${shortLinks.isActive})`,
    })
    .from(shortLinks)
    .where(inArray(shortLinks.brandId, brandIds));
  const total = Number(row?.total ?? 0);
  if (total === 0) return neverUsed;
  const active = Number(row?.active ?? 0);
  return {
    used: true,
    quantity: active,
    unitNoun: 'active link',
    detail: `${total} link${total === 1 ? '' : 's'} created, ${active} active`,
  };
}

/**
 * Signatures (SIGKITT) — billed per active seat past the free allowance. The
 * quantity mirrors `signaturesBillableUnits`, so the report agrees with what the
 * subscription would actually charge.
 */
async function probeSignatures(db: Db, brandIds: string[]): Promise<FeatureUsage> {
  if (brandIds.length === 0) return neverUsed;
  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${signatureMembers.isActive})`,
    })
    .from(signatureMembers)
    .where(inArray(signatureMembers.brandId, brandIds));
  const total = Number(row?.total ?? 0);
  if (total === 0) return neverUsed;
  const active = Number(row?.active ?? 0);
  const billable = signaturesBillableUnits(active);
  return {
    used: true,
    quantity: billable,
    unitNoun: 'paid seat',
    detail: `${active} active seat${active === 1 ? '' : 's'} (first is free)`,
  };
}

/**
 * Reviews (Verdiict) — a flat per-owner subscription. "Used" means they set up a
 * capture location, which is the deliberate act; captured-review volume is only
 * reported as colour.
 */
async function probeReviews(db: Db, brandIds: string[]): Promise<FeatureUsage> {
  if (brandIds.length === 0) return neverUsed;
  const locations = await db
    .select({ id: reviewLocations.id })
    .from(reviewLocations)
    .where(inArray(reviewLocations.brandId, brandIds));
  if (locations.length === 0) return neverUsed;
  const [row] = await db
    .select({ n: count() })
    .from(reviewSubmissions)
    .where(
      inArray(
        reviewSubmissions.locationId,
        locations.map((l) => l.id),
      ),
    );
  const captured = Number(row?.n ?? 0);
  return {
    used: true,
    quantity: 1,
    unitNoun: null,
    detail: `${locations.length} location${locations.length === 1 ? '' : 's'}, ${captured} review${captured === 1 ? '' : 's'} captured`,
  };
}

/**
 * AI Growth Strategy — a flat subscription. `ai_usage` is written for every
 * Anthropic/Gemini call we make (see modules/ai), so a row for an owned brand is
 * proof the assistant was actually used, not merely opened.
 */
async function probeAiStrategy(db: Db, brandIds: string[]): Promise<FeatureUsage> {
  if (brandIds.length === 0) return neverUsed;
  const [row] = await db
    .select({ n: count() })
    .from(aiUsage)
    .where(inArray(aiUsage.brandId, brandIds));
  const n = Number(row?.n ?? 0);
  if (n === 0) return neverUsed;
  return {
    used: true,
    quantity: 1,
    unitNoun: null,
    detail: `${n} assistant request${n === 1 ? '' : 's'}`,
  };
}

/**
 * Payments (EziQuotes) — a flat subscription over the proposals/quotes tool. A
 * payer-kind proposal sent from an owned brand is the signal. (The tool's main
 * monetization is the per-payment platform fee, which is charged independently of
 * this subscription and so never appears on this report.)
 */
async function probePayments(db: Db, brandIds: string[]): Promise<FeatureUsage> {
  if (brandIds.length === 0) return neverUsed;
  const [row] = await db
    .select({ n: count() })
    .from(proposals)
    .where(and(inArray(proposals.brandId, brandIds), eq(proposals.kind, 'payer')));
  const n = Number(row?.n ?? 0);
  if (n === 0) return neverUsed;
  return {
    used: true,
    quantity: 1,
    unitNoun: null,
    detail: `${n} quote${n === 1 ? '' : 's'} built`,
  };
}

/** Logo Studio — a flat subscription gating export. Any started project counts. */
async function probeLogo(db: Db, brandIds: string[]): Promise<FeatureUsage> {
  if (brandIds.length === 0) return neverUsed;
  const [row] = await db
    .select({ n: count() })
    .from(logoProjects)
    .where(inArray(logoProjects.brandId, brandIds));
  const n = Number(row?.n ?? 0);
  if (n === 0) return neverUsed;
  return {
    used: true,
    quantity: 1,
    unitNoun: null,
    detail: `${n} logo project${n === 1 ? '' : 's'}`,
  };
}

/**
 * One probe per feature key. A product whose key is absent here is omitted from
 * the report — deliberately conservative: we never put a line on a bill we can't
 * evidence.
 */
const USAGE_PROBES: Partial<
  Record<FeatureKey, (db: Db, brandIds: string[]) => Promise<FeatureUsage>>
> = {
  [FEATURE_KEYS.URL_SHORTENER]: probeUrlShortener,
  [FEATURE_KEYS.EMAIL_SIGNATURES]: probeSignatures,
  [FEATURE_KEYS.REVIEWS]: probeReviews,
  [FEATURE_KEYS.AI_GROWTH_STRATEGY]: probeAiStrategy,
  [FEATURE_KEYS.PAYMENTS]: probePayments,
  [FEATURE_KEYS.LOGO]: probeLogo,
};

/** True when we can evidence usage for this key at all (i.e. a probe exists). */
export function hasUsageProbe(key: string): boolean {
  return key in USAGE_PROBES;
}

/**
 * Run every probe for an owner, once. Returns a map keyed by feature key; keys
 * without a probe are absent. One `ownedBrandIds` lookup is shared by all probes.
 */
export async function probeOwnerUsage(
  db: Db,
  ownerId: string,
): Promise<Map<string, FeatureUsage>> {
  const brandIds = await ownedBrandIds(db, ownerId);
  const entries = Object.entries(USAGE_PROBES) as [
    FeatureKey,
    (db: Db, brandIds: string[]) => Promise<FeatureUsage>,
  ][];
  const results = await Promise.all(entries.map(([, probe]) => probe(db, brandIds)));
  return new Map(entries.map(([key], i) => [key as string, results[i]]));
}
