/**
 * Post-beta activation — turning a report into real subscriptions.
 *
 * The user picks which lines of their report to keep, adds a card, and this
 * subscribes them. Two rules make it safe:
 *
 *   1. The report is REBUILT server-side from the picked product ids. Prices,
 *      quantities and totals are never taken from the client, so a tampered
 *      request can't subscribe at a stale or invented price.
 *   2. Each line goes through `subscribeToPrice` — the same path
 *      `featureSubscriptions.checkout` uses — so activation inherits the
 *      card-on-file charge, the no-double-subscribe guard, per-unit quantity
 *      seeding, and `recordFeatureSubscription`'s side effects. Nothing bespoke.
 *
 * Lines are activated INDEPENDENTLY and failures are reported per line: if the
 * card covers two of three products and the third declines, the user keeps the two
 * and sees exactly which one needs attention, rather than an all-or-nothing error.
 */
import { asc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { brands, users } from '../../db/schema.js';
import {
  SubscribeError,
  subscribeToPrice,
  type SubscribeResult,
} from '../feature-subscriptions/subscribe.js';
import { reportLinesForProducts, type BetaReportLine } from './report.js';

type Db = typeof defaultDb;

/**
 * The brand a beta activation is attributed to: the user's currently-selected
 * brand when they own it, else their oldest owned brand. Feature subscriptions are
 * owner-scoped, so this only sets `createdForBrandId` (audit) and the Stripe
 * metadata — it never affects who is entitled.
 */
export async function primaryOwnedBrandId(
  db: Db,
  ownerId: string,
): Promise<string | null> {
  const [me] = await db
    .select({ selectedBrandId: users.selectedBrandId })
    .from(users)
    .where(eq(users.id, ownerId))
    .limit(1);
  const owned = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.ownerId, ownerId))
    .orderBy(asc(brands.createdAt));
  if (owned.length === 0) return null;
  const selected = me?.selectedBrandId;
  if (selected && owned.some((b) => b.id === selected)) return selected;
  return owned[0].id;
}

/** Per-line outcome of an activation attempt. */
export type BetaActivationOutcome = {
  productId: string;
  productName: string;
  monthlyAmount: number;
  currency: string;
  /**
   * - `active`         — subscribed and charged on the card on file.
   * - `already_active` — they already held it; nothing charged.
   * - `checkout`       — the card needs interactive completion; `url` opens it.
   * - `activated_dev`  — no Stripe configured (local dev only).
   * - `failed`         — see `error`.
   */
  status: SubscribeResult['status'] | 'failed';
  /** Hosted Checkout url, set only for `checkout`. */
  url: string | null;
  error: string | null;
};

export type BetaActivationResult = {
  outcomes: BetaActivationOutcome[];
  /** Lines now live (active / already_active / dev). */
  activatedCount: number;
  /** Monthly total actually committed to. */
  monthlyTotal: number;
  currency: string;
  /**
   * First hosted-Checkout url, if any line fell back to it. The UI redirects here
   * so the user can complete SCA / fix the card; remaining lines can be activated
   * on the return trip.
   */
  checkoutUrl: string | null;
};

/**
 * Subscribe `ownerId` to the picked products. `actorUserId` is who clicked —
 * normally the owner themselves on the post-beta screen.
 */
export async function activateBetaSelection(
  db: Db,
  opts: { ownerId: string; actorUserId: string; productIds: string[] },
): Promise<BetaActivationResult> {
  const lines = await reportLinesForProducts(db, opts.ownerId, opts.productIds);
  const brandId = await primaryOwnedBrandId(db, opts.ownerId);

  const outcomes: BetaActivationOutcome[] = [];
  for (const line of lines) {
    outcomes.push(await activateLine(db, opts, line, brandId));
  }

  const live = outcomes.filter(
    (o) => o.status === 'active' || o.status === 'already_active' || o.status === 'activated_dev',
  );
  return {
    outcomes,
    activatedCount: live.length,
    monthlyTotal: Number(
      live
        .filter((o) => o.status !== 'already_active')
        .reduce((s, o) => s + o.monthlyAmount, 0)
        .toFixed(2),
    ),
    currency: lines[0]?.currency ?? 'AUD',
    checkoutUrl: outcomes.find((o) => o.status === 'checkout' && o.url)?.url ?? null,
  };
}

/** Subscribe one line, converting any failure into a reportable outcome. */
async function activateLine(
  db: Db,
  opts: { ownerId: string; actorUserId: string },
  line: BetaReportLine,
  brandId: string | null,
): Promise<BetaActivationOutcome> {
  const base = {
    productId: line.productId,
    productName: line.productName,
    monthlyAmount: line.monthlyAmount,
    currency: line.currency,
    url: null as string | null,
    error: null as string | null,
  };
  // No brand means nothing to attribute the purchase to, and (since every product
  // here is a brand tool) nothing that was actually usable. Report rather than throw.
  if (!brandId) {
    return { ...base, status: 'failed', error: 'No brand to attach the subscription to.' };
  }
  try {
    const res = await subscribeToPrice(db, {
      ownerId: opts.ownerId,
      actorUserId: opts.actorUserId,
      brandId,
      priceId: line.priceId,
    });
    return { ...base, status: res.status, url: res.url ?? null };
  } catch (err) {
    const message =
      err instanceof SubscribeError
        ? err.message
        : ((err as Error).message ?? 'Could not start this subscription.');
    console.warn(
      `[beta] activation failed for ${line.productSlug} (owner ${opts.ownerId}):`,
      message,
    );
    return { ...base, status: 'failed', error: message };
  }
}
