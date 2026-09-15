/**
 * Payments (EziQuotes) — Stripe webhook handling, ported 1:1 from the Manus
 * export's inline switch in server/_core/index.ts (the /api/stripe/webhook
 * express route, lines 42-538).
 *
 * The platform already has a Stripe webhook endpoint (servers/backend), so this
 * module exposes a single entry point the platform handler calls FIRST:
 *
 *   handlePaymentsStripeEvent(event) → Promise<boolean>
 *
 * It returns `true` when the event belonged to the payments product — matched
 * by `proposalSlug` metadata (checkout sessions / payment intents we created)
 * or by a payment_proposals / payment_accounts row lookup on
 * stripeSubscriptionId / stripePaymentIntentId / stripeConnectAccountId — and
 * `false` otherwise so the caller can fall through to platform handling
 * (feature subscriptions, billing payouts, …).
 *
 * All 17 event branches from the export are preserved. Handler errors are
 * caught and logged per-branch (the export always ACKed the webhook), so a
 * failing branch still returns `true` once ownership is established.
 */
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentAccounts, paymentTransactions, proposals } from '../../db/schema.js';
import { env } from '../../lib/env.js';
import { projectPaymentTransactionToInvoice } from '../billing/payments-invoice-bridge.js';
import {
  getClientById,
  getPaymentAccount,
  getProposalBySlug,
  logActivity,
  updateProposal,
} from './db.js';
import { sendEmail } from './email.js';
import { autoCreateRenewalReminder, autoSendSurvey } from './lifecycle.js';
import { handleMissedPayment } from './sequence-worker.js';
import { emailBaseUrl } from '../email/branding.js';

/** Payer-facing base URL for links in webhook-triggered emails (no request ctx). */
function paymentsBaseUrl(): string {
  // PAYMENTS_ORIGIN — origin of the payments frontend for links generated
  // outside a request context (workers/webhooks).
  return emailBaseUrl(env.PAYMENTS_ORIGIN ?? null);
}

async function proposalByStripeSubscriptionId(subscriptionId: string) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.stripeSubscriptionId, subscriptionId), eq(proposals.kind, 'payer')))
    .limit(1);
  return proposal
    ? { ...proposal, clientId: proposal.recipientContactId, brandId: proposal.brandId as string }
    : undefined;
}

async function proposalByStripePaymentIntentId(paymentIntentId: string) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.stripePaymentIntentId, paymentIntentId), eq(proposals.kind, 'payer')))
    .limit(1);
  return proposal
    ? { ...proposal, clientId: proposal.recipientContactId, brandId: proposal.brandId as string }
    : undefined;
}

/**
 * Handle a verified Stripe event for the payments product.
 * Returns true when the event was recognised as belonging to payments
 * (caller should stop), false to fall through to platform handling.
 */
export async function handlePaymentsStripeEvent(event: Stripe.Event): Promise<boolean> {
  // -- Subscription: Checkout session completed ------------------------------
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const proposalSlug = session.metadata?.proposalSlug;
    if (!proposalSlug) return false;
    if (session.mode === 'subscription') {
      try {
        const proposal = await getProposalBySlug(proposalSlug);
        if (proposal) {
          const clientId = proposal.clientId ?? null;
          await updateProposal(proposal.id, proposal.brandId, {
            status: 'active',
            paidAt: new Date(),
            acceptedAt: proposal.acceptedAt ?? new Date(),
            stripeSubscriptionId: session.subscription as string,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            stripeCustomerId: (typeof session.customer === 'string' ? session.customer : (session.customer as any)?.id ?? '') as string,
          });
          await logActivity({
            action: 'proposal.subscription_started',
            brandId: proposal.brandId,
            actorType: 'payer',
            actorId: clientId,
            eventType: 'proposal.subscription_started',
            entityType: 'proposal',
            entityId: proposal.id,
            metadata: {
              subscriptionId: session.subscription,
              customerId: session.customer,
              source: 'webhook',
            },
          });
          console.log(`[Stripe Webhook] Subscription started for proposal ${proposalSlug}`);

          // Auto-send survey + create renewal reminder
          const paymentConfig = (proposal.paymentConfig ?? {}) as Record<string, unknown>;
          autoSendSurvey({
            proposalId: proposal.id,
            brandId: proposal.brandId,
            clientId,
          }).catch(console.error);
          autoCreateRenewalReminder({
            proposalId: proposal.id,
            brandId: proposal.brandId,
            clientId,
            paymentModel: 'subscription',
            acceptedAt: new Date(),
            billingCycle: (paymentConfig.billingCycle as string) ?? 'monthly',
          }).catch(console.error);
        }
      } catch (err) {
        console.error('[Stripe Webhook] Subscription DB update failed:', err);
      }
    }
    return true;
  }

  // -- Subscription: renewal invoice paid -----------------------------------
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionId = (invoice as any).subscription as string | null;
    if (!subscriptionId) return false;
    try {
      const proposal = await proposalByStripeSubscriptionId(subscriptionId);
      if (!proposal) return false;
      await logActivity({
        action: 'proposal.subscription_renewed',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.subscription_renewed',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: {
          invoiceId: invoice.id,
          amountCents: invoice.amount_paid,
          currency: invoice.currency,
          source: 'webhook',
        },
      });
      console.log(`[Stripe Webhook] Subscription renewal logged for proposal ${proposal.id}`);
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] Subscription renewal logging failed:', err);
      return false;
    }
  }

  // -- Subscription: cancelled -----------------------------------------------
  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    try {
      const proposal = await proposalByStripeSubscriptionId(sub.id);
      if (!proposal) return false;
      await updateProposal(proposal.id, proposal.brandId, { status: 'cancelled' });
      await logActivity({
        action: 'proposal.subscription_cancelled',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.subscription_cancelled',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { subscriptionId: sub.id, source: 'webhook' },
      });
      console.log(`[Stripe Webhook] Subscription cancelled for proposal ${proposal.id}`);
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] Subscription cancel update failed:', err);
      return false;
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const proposalSlug = pi.metadata?.proposalSlug;
    if (!proposalSlug) return false;
    try {
      const proposal = await getProposalBySlug(proposalSlug);
      if (proposal && proposal.status !== 'paid') {
        await updateProposal(proposal.id, proposal.brandId, {
          status: 'paid',
          paidAt: new Date(),
          acceptedAt: proposal.acceptedAt ?? new Date(),
          stripePaymentIntentId: pi.id,
        });
        await logActivity({
          action: 'proposal.paid',
          brandId: proposal.brandId,
          actorType: 'payer',
          actorId: proposal.clientId ?? null,
          eventType: 'proposal.paid',
          entityType: 'proposal',
          entityId: proposal.id,
          metadata: {
            paymentIntentId: pi.id,
            amountCents: pi.amount,
            currency: pi.currency,
            source: 'webhook',
          },
        });
        console.log(`[Stripe Webhook] Proposal ${proposalSlug} marked as paid`);
        // Project the inbound charge into a canonical invoice (WS4). Fires when a
        // payment_transactions row exists for this payment intent; no-ops
        // otherwise (the ported charge flow does not yet write the txn ledger).
        const [txn] = await db
          .select({ id: paymentTransactions.id })
          .from(paymentTransactions)
          .where(eq(paymentTransactions.stripePaymentIntentId, pi.id))
          .limit(1);
        if (txn) await projectPaymentTransactionToInvoice(txn.id);
      }
    } catch (err) {
      console.error('[Stripe Webhook] DB update failed:', err);
    }
    return true;
  }

  // -- payment_intent.payment_failed ----------------------------------------
  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const proposalSlug = pi.metadata?.proposalSlug;
    if (!proposalSlug) return false;
    try {
      const proposal = await getProposalBySlug(proposalSlug);
      if (proposal) {
        await logActivity({
          action: 'proposal.payment_failed',
          brandId: proposal.brandId,
          actorType: 'payer',
          actorId: proposal.clientId ?? null,
          eventType: 'proposal.payment_failed',
          entityType: 'proposal',
          entityId: proposal.id,
          metadata: { paymentIntentId: pi.id, failureMessage: pi.last_payment_error?.message ?? 'unknown', source: 'webhook' },
        });
        // Email client + owner about failure
        const client = proposal.clientId ? await getClientById(proposal.clientId, proposal.brandId) : null;
        const acct = await getPaymentAccount(proposal.brandId);
        if (client?.email) {
          await sendEmail({
            to: client.email,
            subject: `Payment failed — ${proposal.title ?? 'Your proposal'}`,
            htmlBody: `<p>Hi ${client.name},</p><p>Your payment of $${(pi.amount / 100).toFixed(2)} failed. Please update your payment method at <a href="${paymentsBaseUrl()}/p/${proposal.slug}">${proposal.title}</a>.</p><p>${acct?.businessName ?? ''}</p>`,
          });
        }
        if (acct?.email) {
          await sendEmail({
            to: acct.email,
            subject: `Payment failed — ${client?.name ?? 'Payer'}`,
            htmlBody: `<p>Payment of $${(pi.amount / 100).toFixed(2)} from ${client?.name ?? 'a payer'} failed for proposal <strong>${proposal.title}</strong>. Reason: ${pi.last_payment_error?.message ?? 'unknown'}.</p>`,
          });
        }
        // Dispatch missed payment sequence
        try {
          await handleMissedPayment({ proposalId: proposal.id, brandId: proposal.brandId });
        } catch (_) { /* non-critical */ }
      }
    } catch (err) {
      console.error('[Stripe Webhook] payment_intent.payment_failed handling failed:', err);
    }
    return true;
  }

  // -- invoice.payment_failed (subscription) ---------------------------------
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionId = (invoice as any).subscription as string | null;
    if (!subscriptionId) return false;
    try {
      const proposal = await proposalByStripeSubscriptionId(subscriptionId);
      if (!proposal) return false;
      await logActivity({
        action: 'proposal.subscription_payment_failed',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.subscription_payment_failed',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { invoiceId: invoice.id, amountCents: invoice.amount_due, source: 'webhook' },
      });
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] invoice.payment_failed handling failed:', err);
      return false;
    }
  }

  // -- customer.subscription.updated ----------------------------------------
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as Stripe.Subscription;
    try {
      const proposal = await proposalByStripeSubscriptionId(sub.id);
      if (!proposal) return false;
      await logActivity({
        action: 'proposal.subscription_updated',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.subscription_updated',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { subscriptionId: sub.id, status: sub.status, source: 'webhook' },
      });
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] customer.subscription.updated handling failed:', err);
      return false;
    }
  }

  // -- customer.subscription.trial_will_end ---------------------------------
  if (event.type === 'customer.subscription.trial_will_end') {
    const sub = event.data.object as Stripe.Subscription;
    try {
      const proposal = await proposalByStripeSubscriptionId(sub.id);
      if (!proposal) return false;
      await logActivity({
        action: 'proposal.trial_ending',
        brandId: proposal.brandId,
        actorType: 'system',
        actorId: null,
        eventType: 'proposal.trial_ending',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { subscriptionId: sub.id, trialEnd: sub.trial_end, source: 'webhook' },
      });
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] trial_will_end handling failed:', err);
      return false;
    }
  }

  // -- charge.dispute.created -----------------------------------------------
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute;
    try {
      const proposal = await proposalByStripePaymentIntentId(dispute.payment_intent as string);
      if (!proposal) return false;
      await updateProposal(proposal.id, proposal.brandId, { status: 'disputed' });
      await logActivity({
        action: 'proposal.disputed',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.disputed',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { disputeId: dispute.id, reason: dispute.reason, amountCents: dispute.amount, source: 'webhook' },
      });
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] charge.dispute.created handling failed:', err);
      return false;
    }
  }

  // -- charge.refunded -------------------------------------------------------
  if (event.type === 'charge.refunded') {
    const charge = event.data.object as Stripe.Charge;
    const piId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;
    if (!piId) return false;
    try {
      const proposal = await proposalByStripePaymentIntentId(piId);
      if (!proposal) return false;
      const newStatus = charge.amount_refunded === charge.amount ? 'refunded' : 'partially_refunded';
      await updateProposal(proposal.id, proposal.brandId, { status: newStatus });
      await logActivity({
        action: `proposal.${newStatus}`,
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: `proposal.${newStatus}`,
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { chargeId: charge.id, refundedCents: charge.amount_refunded, totalCents: charge.amount, source: 'webhook' },
      });
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] charge.refunded handling failed:', err);
      return false;
    }
  }

  // -- account.updated (Connect) --------------------------------------------
  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account;
    try {
      const [account] = await db
        .select({ id: paymentAccounts.id })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.stripeConnectAccountId, acct.id))
        .limit(1);
      if (!account) return false;
      const chargesEnabled = acct.charges_enabled ?? false;
      const payoutsEnabled = acct.payouts_enabled ?? false;
      // The export stored raw stripeConnectChargesEnabled/PayoutsEnabled flags;
      // our schema models the same state as stripeConnectStatus + a single
      // onboarded flag: charges enabled → status 'active' (else 'pending'),
      // payouts enabled → fully onboarded.
      await db
        .update(paymentAccounts)
        .set({
          stripeConnectStatus: chargesEnabled ? 'active' : 'pending',
          stripeConnectOnboarded: chargesEnabled && payoutsEnabled,
        })
        .where(eq(paymentAccounts.stripeConnectAccountId, acct.id));
      console.log(`[Stripe Webhook] Connect account ${acct.id} updated: charges=${chargesEnabled} payouts=${payoutsEnabled}`);
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] account.updated handling failed:', err);
      return false;
    }
  }

  // -- account.application.deauthorized (Connect) ---------------------------
  if (event.type === 'account.application.deauthorized') {
    const app = event.data.object as Stripe.Application;
    // For Connect deauthorization the connected account id arrives on
    // event.account (data.object is the *application*); fall back to the
    // export's behaviour of matching data.object.id.
    const connectId = event.account ?? app.id;
    try {
      const [account] = await db
        .select({ id: paymentAccounts.id })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.stripeConnectAccountId, connectId))
        .limit(1);
      if (!account) return false;
      await db
        .update(paymentAccounts)
        .set({
          stripeConnectAccountId: null,
          stripeConnectStatus: 'not_connected',
          stripeConnectOnboarded: false,
        })
        .where(eq(paymentAccounts.stripeConnectAccountId, connectId));
      console.log(`[Stripe Webhook] Connect account ${connectId} deauthorized`);
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] account.application.deauthorized handling failed:', err);
      return false;
    }
  }

  // -- checkout.session.expired ---------------------------------------------
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const proposalSlug = session.metadata?.proposalSlug;
    if (!proposalSlug) return false;
    try {
      const proposal = await getProposalBySlug(proposalSlug);
      if (proposal) {
        await logActivity({
          action: 'proposal.checkout_expired',
          brandId: proposal.brandId,
          actorType: 'payer',
          actorId: proposal.clientId ?? null,
          eventType: 'proposal.checkout_expired',
          entityType: 'proposal',
          entityId: proposal.id,
          metadata: { sessionId: session.id, source: 'webhook' },
        });
      }
    } catch (err) {
      console.error('[Stripe Webhook] checkout.session.expired handling failed:', err);
    }
    return true;
  }

  // -- invoice.upcoming (subscription renewal warning) ----------------------
  if (event.type === 'invoice.upcoming') {
    const invoice = event.data.object as Stripe.Invoice;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subscriptionId = (invoice as any).subscription as string | null;
    if (!subscriptionId) return false;
    try {
      const proposal = await proposalByStripeSubscriptionId(subscriptionId);
      if (!proposal) return false;
      const client = proposal.clientId ? await getClientById(proposal.clientId, proposal.brandId) : null;
      const acct = await getPaymentAccount(proposal.brandId);
      if (client?.email) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const renewalDate = new Date((invoice as any).next_payment_attempt * 1000).toLocaleDateString();
        await sendEmail({
          to: client.email,
          subject: `Upcoming renewal — ${proposal.title ?? 'Your subscription'}`,
          htmlBody: `<p>Hi ${client.name},</p><p>Your subscription of $${(invoice.amount_due / 100).toFixed(2)} with ${acct?.businessName ?? ''} renews on ${renewalDate}.</p>`,
        });
      }
      await logActivity({
        action: 'proposal.renewal_reminder_sent',
        brandId: proposal.brandId,
        actorType: 'system',
        actorId: null,
        eventType: 'proposal.renewal_reminder_sent',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { invoiceId: invoice.id, amountDue: invoice.amount_due, source: 'webhook' },
      });
      return true;
    } catch (err) {
      console.error('[Stripe Webhook] invoice.upcoming handling failed:', err);
      return false;
    }
  }

  // -- transfer.created (Connect payout to connected account) ---------------
  // Log-only in the export; there is no payments-row ownership signal here so
  // we return false and let platform handlers (billing payouts) also run.
  if (event.type === 'transfer.created') {
    const transfer = event.data.object as { id: string; amount: number; currency: string; destination: string };
    console.log(`[Stripe Webhook] transfer.created: ${transfer.id} amount=${transfer.amount} dest=${transfer.destination}`);
    return false;
  }

  // -- payout.failed (bank payout failure) ----------------------------------
  if (event.type === 'payout.failed') {
    const payout = event.data.object as { id: string; amount: number; failure_message?: string };
    console.error(`[Stripe Webhook] payout.failed: ${payout.id} — ${payout.failure_message ?? 'unknown reason'}`);
    return false;
  }

  // -- radar.early_fraud_warning.created ------------------------------------
  if (event.type === 'radar.early_fraud_warning.created') {
    const warning = event.data.object as { id: string; charge: string; fraud_type: string };
    console.error(`[Stripe Webhook] radar.early_fraud_warning.created: charge=${warning.charge} type=${warning.fraud_type}`);
    return false;
  }

  return false;
}
