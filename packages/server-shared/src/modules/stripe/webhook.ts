import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { env } from '../../lib/env.js';
import { stripe } from './client.js';
import { db } from '../../db/index.js';
import { purchases } from '../../db/schema.js';
import { fulfillPurchase, advanceRecurringCycle } from '../billing/fulfillment.js';
import { persistSubscriptionItemIds } from '../billing/subscription.js';
import { promotePendingPurchase } from '../billing/pending-purchase.js';
import { advanceInternalProjectToProduction } from '../../routers/projects.js';
import { handleWiseStripePayoutPaid, handleWiseStripePayoutFailed } from '../billing/wise.js';
import { eventEnvTag } from './env-tag.js';
import { enqueueEmail } from '../../lib/notify.js';
import {
  handleFeatureCheckoutCompleted,
  handleFeatureSubscriptionLifecycle,
  isFeatureSubObject,
} from '../feature-subscriptions/webhook.js';
import { handlePaymentsStripeEvent } from '../payments/stripe-webhook.js';
import { assertConnectDisjoint } from './connect-registry.js';

/**
 * Stripe webhook endpoint. Ports functions/src/modules/stripe/stripe_webhook.ts.
 * Mounted with express.raw() so the signature can be verified.
 */
export async function stripeWebhookHandler(req: Request, res: Response) {
  // A single webhook URL can back multiple Stripe dashboard endpoints (one per
  // event type), each with its OWN signing secret. Collect every configured
  // secret and try each until one verifies the signature — the request is
  // accepted as soon as any of them matches.
  const secrets = [
    env.STRIPE_WEBHOOK_SECRET,
    env.CHECKOUT_SESSION_COMPLETED_WEBHOOK_SECRET,
    env.STRIPE_ACCOUNT_UPDATED_WEBHOOK_SECRET,
  ].filter((s): s is string => !!s);
  if (!stripe || secrets.length === 0) return res.status(503).send('Stripe not configured');

  const sig = req.headers['stripe-signature'];
  let event: Stripe.Event | undefined;
  let lastErr: Error | undefined;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig as string, secret);
      break;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  if (!event) {
    return res.status(400).send(`Webhook signature error: ${lastErr?.message ?? 'no matching secret'}`);
  }

  // Shared Stripe account: a foreign environment's events are delivered here too.
  // If the object is tagged for a different env, ack with 200 (so Stripe doesn't
  // retry) and do nothing. Untagged objects (legacy / prod) fall through. See env-tag.ts.
  const evEnv = eventEnvTag(event.data.object as Parameters<typeof eventEnvTag>[0]);
  if (evEnv && evEnv !== env.NODE_ENV) return res.json({ received: true });

  // Connect disjointness guardrail: the payments (Standard-OAuth inbound) and
  // agency-payout (Express-outbound) integrations share this endpoint. A
  // connected-account id must belong to exactly one of them — log loudly if an
  // event's account is registered in both (a misconfiguration that would let
  // the two handlers fight over it). Purely observational; never blocks the ack.
  if (event.account) {
    await assertConnectDisjoint(event.account).catch((err) =>
      console.error('[stripe] connect disjointness check failed', (err as Error).message),
    );
  }

  // Payments (EziQuotes) tool events get first refusal — matched by
  // proposalSlug metadata or a payment_* row lookup (subscription/PI/Connect
  // account id). Unmatched events fall through to the platform handling below.
  try {
    if (await handlePaymentsStripeEvent(event)) return res.json({ received: true });
  } catch (err) {
    console.error('[stripe] payments-tool webhook handler error', (err as Error).message);
    return res.status(500).send('handler error');
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        // Feature Subscription checkout (separate system) → record the membership
        // and return before any marketplace-purchase handling.
        if (isFeatureSubObject(session)) {
          await handleFeatureCheckoutCompleted(session);
          break;
        }
        // Internal-project payment → advance allocate→production + book contractor payout.
        // Only when the session is actually paid: for async/delayed payment methods
        // `checkout.session.completed` can fire with payment_status 'unpaid', and an
        // unpaid internal project must NOT advance (it stays in `allocate`).
        const internalProjectId = session.metadata?.internalProjectId;
        if (internalProjectId) {
          if (session.payment_status === 'paid') await advanceInternalProjectToProduction(internalProjectId);
          break;
        }
        const purchaseId = session.metadata?.purchaseId;
        if (purchaseId) {
          // Persist the subscription id so we can cancel it later (cancel-sub /
          // instalment auto-cancel).
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;
          // Payment confirmed → copy the pending purchase into `purchases` (+ items)
          // under the same id. Idempotent on webhook retries. Only after this does
          // the row exist to update/fulfil.
          await promotePendingPurchase(purchaseId);
          if (subId) await db.update(purchases).set({ stripeSubscriptionId: subId }).where(eq(purchases.id, purchaseId));
          // Fulfil first (spawns the projects) THEN map each subscription item to
          // its project so a single project can be cancelled independently.
          await fulfillPurchase(purchaseId);
          if (subId) await persistSubscriptionItemIds(purchaseId, subId, customerId);
          else if (customerId) await db.update(purchases).set({ stripeCustomerId: customerId }).where(eq(purchases.id, purchaseId));
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice & { metadata?: Record<string, string>; billing_reason?: string };
        const purchaseId = invoice.metadata?.purchaseId ?? (invoice.subscription_details?.metadata as Record<string, string> | undefined)?.purchaseId;
        // Only RENEWALS advance the cycle (the first invoice is covered by
        // fulfillment). `subscription_cycle` = a renewal; `subscription_create` = first.
        if (purchaseId && invoice.billing_reason === 'subscription_cycle') {
          await advanceRecurringCycle(purchaseId);
          await maybeCancelInstalment(purchaseId, typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id);
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Recurring/instalment charge failed → warn the brand + agency
        // (ports stripe_webhook.ts payment-failed branch).
        const invoice = event.data.object as Stripe.Invoice & { metadata?: Record<string, string> };
        const purchaseId =
          invoice.metadata?.purchaseId ??
          (invoice.subscription_details?.metadata as Record<string, string> | undefined)?.purchaseId;
        if (purchaseId) await enqueueEmail('payment-failed', { purchaseId });
        break;
      }
      case 'payment_intent.payment_failed': {
        // One-off checkout payment failed.
        const pi = event.data.object as Stripe.PaymentIntent & { metadata?: Record<string, string> };
        const purchaseId = pi.metadata?.purchaseId;
        if (purchaseId) await enqueueEmail('payment-failed', { purchaseId });
        break;
      }
      // Connect payout.* events for the Wise-linked account (leg 1b). Scoped by
      // metadata so unrelated payouts are ignored. Ported from stripe_webhook.ts.
      case 'payout.paid':
      case 'payout.failed':
      case 'payout.canceled': {
        const p = event.data.object as Stripe.Payout & { metadata?: Record<string, string> };
        if (p.metadata?.purpose === 'wise-funding') {
          if (event.type === 'payout.paid') await handleWiseStripePayoutPaid(p.id);
          else await handleWiseStripePayoutFailed(p.id, p.failure_message ?? event.type);
        }
        break;
      }
      // Feature Subscription lifecycle (renewals, cancellations, status changes).
      // Marketplace subscriptions are driven by invoice.* above and carry no
      // feature-sub marker, so they're ignored here.
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        if (isFeatureSubObject(sub)) {
          await handleFeatureSubscriptionLifecycle(sub, event.type === 'customer.subscription.deleted');
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[stripe] webhook handler error', (err as Error).message);
    return res.status(500).send('handler error');
  }

  res.json({ received: true });
}

/**
 * Instalment plans split a ONE-OFF price into a finite number of weekly charges
 * (the plan's `durationWeeks`). Once that many renewals have been paid, cancel
 * the Stripe subscription so it stops billing. Genuinely recurring retainers
 * have no `durationWeeks`, so they're never cancelled here. (C5.)
 */
async function maybeCancelInstalment(purchaseId: string, subscriptionId: string | null | undefined) {
  if (!subscriptionId || !stripe) return;
  const p = (await db.select().from(purchases).where(eq(purchases.id, purchaseId)).limit(1))[0];
  const plan = p?.selectedPaymentPlan as { durationWeeks?: number } | null;
  const duration = plan?.durationWeeks ?? 0;
  if (duration > 0 && (p?.paymentCount ?? 0) >= duration) {
    await stripe.subscriptions.cancel(subscriptionId).catch((e) => console.error('[stripe] instalment cancel failed', (e as Error).message));
  }
}
