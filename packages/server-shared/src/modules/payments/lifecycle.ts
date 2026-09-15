/**
 * Payments (EziQuotes) lifecycle hooks — fire-and-forget side effects triggered
 * when a proposal transitions to a key status (paid, accepted-subscription).
 * Ported from the export's server/lifecycle.ts.
 *
 * Keep all logic here so it can be called from multiple payment paths
 * (one-off, subscription webhook, installment final payment).
 *
 * Link origin: pass `origin` (ctx.clientOrigin) from procedures; workers
 * without a request context fall back to PAYMENTS_ORIGIN.
 */
import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentClientSurveys, paymentRenewalReminders } from '../../db/schema.js';
import { emailBaseUrl } from '../email/branding.js';
import { env } from '../../lib/env.js';
import { getClientById, getPaymentAccount } from './db.js';
import { sendEmail } from './email.js';

interface ProposalContext {
  proposalId: string;
  brandId: string;
  clientId: string | null;
  paymentModel?: string | null;
  /** ISO string or Date of when the subscription/service was accepted */
  acceptedAt?: Date | null;
  /** billing cycle for renewal reminder calculation */
  billingCycle?: string | null;
  /** Request origin (ctx.clientOrigin) for building the survey link. */
  origin?: string | null;
}

/**
 * Auto-send a satisfaction survey when a proposal is paid/closed.
 * Fire-and-forget — never throws.
 */
export async function autoSendSurvey(ctx: ProposalContext): Promise<void> {
  try {
    if (!ctx.clientId) return;

    const [client, account] = await Promise.all([
      getClientById(ctx.clientId, ctx.brandId),
      getPaymentAccount(ctx.brandId),
    ]);
    if (!client?.email) return;

    // Don't send duplicate surveys for the same proposal
    const existing = await db.select({ id: paymentClientSurveys.id })
      .from(paymentClientSurveys)
      .where(and(
        eq(paymentClientSurveys.proposalId, ctx.proposalId),
        eq(paymentClientSurveys.brandId, ctx.brandId),
      ))
      .limit(1);
    if (existing.length > 0) return;

    const token = randomBytes(32).toString('hex');
    await db.insert(paymentClientSurveys).values({
      brandId: ctx.brandId,
      proposalId: ctx.proposalId,
      clientId: ctx.clientId,
      token,
    });

    const baseUrl = emailBaseUrl(ctx.origin ?? env.PAYMENTS_ORIGIN ?? null);
    const surveyUrl = `${baseUrl}/survey/${token}`;
    const businessName = account?.businessName ?? 'us';

    await sendEmail({
      to: client.email,
      subject: `How did we do? Quick feedback for ${businessName}`,
      htmlBody: `
        <p>Hi ${client.name ?? 'there'},</p>
        <p>Thank you for working with <strong>${businessName}</strong>. We'd love to hear how your experience was — it only takes 30 seconds.</p>
        <p><a href="${surveyUrl}" style="background:#0F766E;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Share your feedback</a></p>
        <p style="color:#666;font-size:12px;">This link is personal to you and expires in 30 days.</p>
      `,
      textBody: `Thank you for working with ${businessName}. Share your feedback here: ${surveyUrl}`,
      account,
    });
  } catch (err) {
    console.error('[lifecycle] autoSendSurvey failed:', err);
  }
}

/**
 * Auto-create a renewal reminder for subscription proposals when accepted.
 * Calculates due date based on billing cycle.
 * Fire-and-forget — never throws.
 */
export async function autoCreateRenewalReminder(ctx: ProposalContext): Promise<void> {
  try {
    if (!ctx.clientId) return;
    if (ctx.paymentModel !== 'subscription') return;

    // Don't create duplicate reminders
    const existing = await db.select({ id: paymentRenewalReminders.id })
      .from(paymentRenewalReminders)
      .where(and(
        eq(paymentRenewalReminders.proposalId, ctx.proposalId),
        eq(paymentRenewalReminders.brandId, ctx.brandId),
        eq(paymentRenewalReminders.type, 'renewal'),
      ))
      .limit(1);
    if (existing.length > 0) return;

    // Calculate due date based on billing cycle
    const base = ctx.acceptedAt ?? new Date();
    const dueAt = new Date(base);
    const cycle = ctx.billingCycle ?? 'monthly';
    switch (cycle) {
      case 'weekly':      dueAt.setDate(dueAt.getDate() + 7); break;
      case 'fortnightly': dueAt.setDate(dueAt.getDate() + 14); break;
      case 'quarterly':   dueAt.setMonth(dueAt.getMonth() + 3); break;
      case 'annually':    dueAt.setFullYear(dueAt.getFullYear() + 1); break;
      default:            dueAt.setMonth(dueAt.getMonth() + 1); // monthly
    }
    // Remind 7 days before renewal
    dueAt.setDate(dueAt.getDate() - 7);

    await db.insert(paymentRenewalReminders).values({
      brandId: ctx.brandId,
      clientId: ctx.clientId,
      proposalId: ctx.proposalId,
      type: 'renewal',
      dueAt,
      notes: `Auto-created: ${cycle} subscription renewal approaching`,
      status: 'pending',
    });
  } catch (err) {
    console.error('[lifecycle] autoCreateRenewalReminder failed:', err);
  }
}
