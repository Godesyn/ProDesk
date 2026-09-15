/**
 * Signature analytics event capture. The redirector calls
 * `recordSignatureEvent` fire-and-forget when a signature tracking link is
 * clicked. The analytics router aggregates `signature_analytics_events`.
 *
 * Reuses UA/referrer parsing from the short-links events module.
 */
import { db as defaultDb } from '../../db/index.js';
import { signatureAnalyticsEvents } from '../../db/schema.js';
import {
  parseUserAgent,
  referrerHost,
} from '../short-links/events.js';

type Db = typeof defaultDb;

export interface SignatureEventInput {
  brandId: string;
  eventType:
    | 'banner_click'
    | 'cta_click'
    | 'verdiict_review_click'
    | 'verdiict_reviews_click'
    | 'social_click'
    | 'email_click'
    | 'phone_click'
    | 'website_click';
  signatureBrandId?: string | null;
  memberId?: string | null;
  campaignId?: string | null;
  label?: string | null;
  userAgent?: string;
  referer?: string;
  country?: string | null;
  /** Automated / prefetch traffic, filtered out of analytics by default. */
  isBot?: boolean;
  /** Daily-rotating unique-visitor fingerprint (see analytics/capture). */
  ipHash?: string | null;
}

/**
 * Persist one signature analytics event. Never throws into the caller's hot
 * path — the redirector should still `.catch()` it, but parsing is defensive.
 */
export async function recordSignatureEvent(
  db: Db,
  input: SignatureEventInput,
): Promise<void> {
  const { device, browser, os } = parseUserAgent(input.userAgent);
  await db.insert(signatureAnalyticsEvents).values({
    brandId: input.brandId,
    signatureBrandId: input.signatureBrandId ?? null,
    memberId: input.memberId ?? null,
    campaignId: input.campaignId ?? null,
    eventType: input.eventType,
    label: input.label ?? null,
    userAgent: input.userAgent ?? null,
    referer: input.referer ?? null,
    device,
    browser,
    os,
    country: input.country ?? null,
    isBot: input.isBot ?? false,
    ipHash: input.ipHash ?? null,
  });
}

export { parseUserAgent, referrerHost };
