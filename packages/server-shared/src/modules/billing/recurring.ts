import { stripe } from '../stripe/client.js';
import { env } from '../../lib/env.js';
import { withEnvTag } from '../stripe/env-tag.js';
import { purchaseItems } from '../../db/schema.js';
import { buildCheckoutLineItems } from './subscription.js';

/** Append `purchaseId` to a caller-supplied URL (if provided). */
function appendQuery(base: string | undefined, purchaseId: string): string | undefined {
  if (!base) return undefined;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}purchaseId=${purchaseId}`;
}

/**
 * Create a hosted Stripe Checkout session for a marketplace purchase. The line
 * items are built PER purchase item from each item's frozen `amount` snapshot
 * (see {@link buildCheckoutLineItems}) — a 1:1 port of the cloud function's
 * `createStripeSession`.
 *
 * - Pure one-off orders → `mode: 'payment'` (single charge of the one-time lines).
 * - Orders with any weekly component (forever retainer OR payment-plan
 *   instalment) → `mode: 'subscription'`: each weekly fee is its own recurring
 *   line, while the one-time (upfront/setup/deposit) lines ride along on the
 *   first invoice. A 7-day trial defers the first weekly charge by a week so the
 *   checkout collects only the one-time amount; later weekly invoices fire
 *   `invoice.payment_succeeded` → `advanceRecurringCycle`. Instalment plans are
 *   auto-cancelled after `durationWeeks` renewals (webhook `maybeCancelInstalment`).
 */
export async function createCheckoutSession(opts: {
  purchaseId: string;
  /** The purchase's item snapshots — passed in (they live in the pending
   *  purchase blob at checkout time, not yet in `purchase_items`, so they carry
   *  no `purchaseId`). */
  items: Omit<typeof purchaseItems.$inferInsert, 'purchaseId'>[];
  /** Optional redirect URLs supplied by the frontend. When omitted the server
   *  falls back to `env.SERVER_ORIGIN`-based defaults. */
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ url: string | null; sessionId: string | null }> {
  if (!stripe) return { url: null, sessionId: null };
  const { purchaseId, items } = opts;
  const ref = purchaseId.slice(0, 8);

  // One recurring subscription ITEM per recurring purchase item (each on its own
  // metadata-tagged product) so a single project can be cancelled later without
  // killing the whole subscription; delayed phases are added at activation. The
  // upfront/one-off lines ride along on the subscription's first invoice.
  const { mode, lineItems } = buildCheckoutLineItems(items as never, ref);

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: lineItems,
    // 7-day trial on the recurring portion: at checkout only the one-time
    // (upfront/setup/deposit) lines are charged; the first WEEKLY charge lands a
    // week later as a `subscription_cycle` invoice. This matches the cloud
    // function (stripe_service.ts) AND the web's own cycle accounting, where
    // `paidTill = createdAt + paymentCount·7d` and the checkout leaves
    // `paymentCount` at 0 (nothing paid forward yet).
    ...(mode === 'subscription'
      ? { subscription_data: { metadata: withEnvTag({ purchaseId }), trial_period_days: 7 } }
      : {}),
    // Capture the customer so a delayed phase can add its subscription item (or
    // open a subscription) off-session later. Tag the PaymentIntent with the env
    // ONLY (no purchaseId — that would change the failure-email behaviour) so a
    // one-off `payment_intent.payment_failed` can still be env-scoped.
    ...(mode === 'payment'
      ? { customer_creation: 'always' as const, payment_intent_data: { metadata: withEnvTag() } }
      : {}),
    success_url: appendQuery(opts.successUrl, purchaseId) ?? `${env.SERVER_ORIGIN}/payment-success?purchaseId=${purchaseId}`,
    cancel_url: appendQuery(opts.cancelUrl, purchaseId) ?? `${env.SERVER_ORIGIN}/payment-cancel?purchaseId=${purchaseId}`,
    metadata: withEnvTag({ purchaseId }),
  });
  return { url: session.url, sessionId: session.id };
}
