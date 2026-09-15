/**
 * Payments (EziQuotes) scheduled jobs — plain async functions ported from the
 * Manus export's heartbeat cron handlers, with the Manus cron auth stripped:
 *
 *   runInstallmentReminders   ← server/handlers/installmentReminderHandler.ts
 *   runInstallmentAutoCharge  ← server/handlers/installmentAutoChargeHandler.ts
 *   runAutoChase              ← POST /api/scheduled/auto-chase (server/_core/index.ts)
 *   runRecurringInvoiceSender ← POST /api/scheduled/recurringInvoices (server/_core/index.ts)
 *
 * The export's per-account crons (auto-chase / recurring invoices located their
 * account by taskUid) are folded into single global sweeps that iterate every
 * eligible payment account. The main session wires these into the backend
 * worker as BullMQ repeatables — no schedules are registered here.
 */
import { and, eq, gte, isNotNull, lt, lte, or } from 'drizzle-orm';
import type Stripe from 'stripe';
import { db } from '../../db/index.js';
import {
  paymentAccounts,
  paymentClients,
  paymentInstallmentSchedules,
  proposals,
  paymentRecurringInvoices,
} from '../../db/schema.js';
import { emailBaseUrl } from '../email/branding.js';
import { env } from '../../lib/env.js';
import { stripe, stripeEnabled } from '../stripe/client.js';
import { getClientById, getPaymentAccount, logActivity } from './db.js';
import { resolveFeeForCharge } from './fee-calc.js';
import {
  buildNudgeEmail,
  buildUpcomingInstallmentEmail,
  sendEmail,
} from './email.js';
import {
  buildInstallmentReminderSmsBody,
  buildProposalSmsBody,
  sendSms,
} from './sms.js';
import { autoSendSurvey } from './lifecycle.js';

/** Base origin for payer-facing links in scheduled sends (no request ctx). */
function paymentsOrigin(): string {
  return emailBaseUrl(env.PAYMENTS_ORIGIN ?? null);
}

// ─── Installment reminders ────────────────────────────────────────────────────
/**
 * Runs daily. Finds all pending installments (across every account) due in
 * exactly 3 days (± 12h window) and sends reminder emails + SMS to clients.
 */
export async function runInstallmentReminders(): Promise<{
  ok: boolean;
  sent: number;
  skipped: number;
  total: number;
}> {
  // Find installments due in 3 days (window: 3 days ± 12 hours from now)
  const now = new Date();
  const windowStart = new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 3.5 * 24 * 60 * 60 * 1000);

  const due = await db
    .select({
      id: paymentInstallmentSchedules.id,
      proposalId: paymentInstallmentSchedules.proposalId,
      brandId: paymentInstallmentSchedules.brandId,
      clientId: paymentInstallmentSchedules.clientId,
      installmentNumber: paymentInstallmentSchedules.installmentNumber,
      totalInstallments: paymentInstallmentSchedules.totalInstallments,
      amountCents: paymentInstallmentSchedules.amountCents,
      currency: paymentInstallmentSchedules.currency,
      dueAt: paymentInstallmentSchedules.dueAt,
    })
    .from(paymentInstallmentSchedules)
    .where(
      and(
        eq(paymentInstallmentSchedules.status, 'pending'),
        gte(paymentInstallmentSchedules.dueAt, windowStart),
        lte(paymentInstallmentSchedules.dueAt, windowEnd),
      ),
    );

  let sent = 0;
  let skipped = 0;

  for (const inst of due) {
    try {
      // Look up proposal, client, account
      const [proposalRow] = await db
        .select({ title: proposals.title, slug: proposals.slug })
        .from(proposals)
        .where(eq(proposals.id, inst.proposalId))
        .limit(1);

      const [clientRow] = inst.clientId
        ? await db
            .select({
              name: paymentClients.name,
              email: paymentClients.email,
              mobile: paymentClients.mobile,
            })
            .from(paymentClients)
            .where(eq(paymentClients.id, inst.clientId))
            .limit(1)
        : [undefined];

      const [accountRow] = inst.brandId
        ? await db
            .select({ businessName: paymentAccounts.businessName })
            .from(paymentAccounts)
            .where(eq(paymentAccounts.brandId, inst.brandId))
            .limit(1)
        : [undefined];

      if (!clientRow) {
        skipped++;
        continue;
      }

      const currency = inst.currency ?? 'AUD';
      const amountFormatted = new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency,
      }).format((inst.amountCents ?? 0) / 100);

      const dueDate = new Date(inst.dueAt).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });

      const paymentUrl = `${paymentsOrigin()}/p/${proposalRow?.slug ?? ''}`;

      const emailOpts = {
        clientName: clientRow.name,
        businessName: accountRow?.businessName ?? 'Your service provider',
        proposalTitle: proposalRow?.title ?? 'Your proposal',
        amountFormatted,
        dueDate,
        installmentNumber: inst.installmentNumber ?? 1,
        totalInstallments: inst.totalInstallments ?? 1,
        paymentUrl,
      };

      // Send email
      if (clientRow.email) {
        const emailContent = buildUpcomingInstallmentEmail(emailOpts);
        await sendEmail({ to: clientRow.email, ...emailContent });
      }

      // Send SMS
      if (clientRow.mobile) {
        const smsBody = buildInstallmentReminderSmsBody({
          clientName: clientRow.name,
          businessName: emailOpts.businessName,
          amountFormatted,
          dueDate,
          paymentUrl,
          installmentNumber: emailOpts.installmentNumber,
          totalInstallments: emailOpts.totalInstallments,
        });
        await sendSms({ to: clientRow.mobile, body: smsBody, brandId: inst.brandId ?? undefined });
      }

      sent++;
    } catch (err) {
      console.error(`[InstallmentReminder] Failed for installment ${inst.id}:`, err);
      skipped++;
    }
  }

  console.log(`[InstallmentReminder] Sent ${sent} reminders, skipped ${skipped}`);
  return { ok: true, sent, skipped, total: due.length };
}

// ─── Installment auto-charge ──────────────────────────────────────────────────
/**
 * Runs daily (or more frequently). Finds installments that are due/overdue with
 * a saved card (proposal.stripePaymentMethodId) and charges them off-session
 * via Stripe PaymentIntents with confirm=true. Idempotent: skips already-paid
 * installments and records chargeError on failure.
 */
export async function runInstallmentAutoCharge(): Promise<{
  ok: boolean;
  charged: number;
  failed: number;
  skipped: number;
  total: number;
}> {
  if (!stripeEnabled || !stripe) {
    console.warn('[AutoCharge] Stripe is not configured — skipping run');
    return { ok: true, charged: 0, failed: 0, skipped: 0, total: 0 };
  }

  const now = new Date();

  // Find all due installments that have a saved payment method and are ready to charge
  const dueInstallments = await db
    .select({
      id: paymentInstallmentSchedules.id,
      proposalId: paymentInstallmentSchedules.proposalId,
      brandId: paymentInstallmentSchedules.brandId,
      clientId: paymentInstallmentSchedules.clientId,
      installmentNumber: paymentInstallmentSchedules.installmentNumber,
      totalInstallments: paymentInstallmentSchedules.totalInstallments,
      amountCents: paymentInstallmentSchedules.amountCents,
      currency: paymentInstallmentSchedules.currency,
      dueAt: paymentInstallmentSchedules.dueAt,
      autoChargeAt: paymentInstallmentSchedules.autoChargeAt,
      stripePaymentIntentId: paymentInstallmentSchedules.stripePaymentIntentId,
    })
    .from(paymentInstallmentSchedules)
    .innerJoin(proposals, eq(proposals.id, paymentInstallmentSchedules.proposalId))
    .where(
      and(
        or(
          eq(paymentInstallmentSchedules.status, 'due'),
          eq(paymentInstallmentSchedules.status, 'overdue'),
        ),
        lte(paymentInstallmentSchedules.dueAt, now),
        isNotNull(proposals.stripePaymentMethodId),
        isNotNull(proposals.stripeCustomerId),
      ),
    );

  let charged = 0;
  let failed = 0;
  let skipped = 0;

  for (const inst of dueInstallments) {
    try {
      // Fetch the proposal to get payment method
      const [proposalRow] = await db
        .select({
          id: proposals.id,
          title: proposals.title,
          slug: proposals.slug,
          brandId: proposals.brandId,
          clientId: proposals.recipientContactId,
          stripeCustomerId: proposals.stripeCustomerId,
          stripePaymentMethodId: proposals.stripePaymentMethodId,
        })
        .from(proposals)
        .where(eq(proposals.id, inst.proposalId))
        .limit(1);

      if (!proposalRow?.stripePaymentMethodId || !proposalRow?.stripeCustomerId) {
        skipped++;
        continue;
      }

      // Check if already paid (idempotency)
      const [freshInst] = await db
        .select({ status: paymentInstallmentSchedules.status })
        .from(paymentInstallmentSchedules)
        .where(eq(paymentInstallmentSchedules.id, inst.id))
        .limit(1);
      if (freshInst?.status === 'paid') {
        skipped++;
        continue;
      }

      const brandId = inst.brandId ?? proposalRow.brandId;
      const account = brandId ? await getPaymentAccount(brandId) : undefined;
      const connectId = account?.stripeConnectAccountId ?? null;
      const { applicationFeeCents } = await resolveFeeForCharge(inst.proposalId, inst.amountCents);

      const piParams: Stripe.PaymentIntentCreateParams = {
        amount: inst.amountCents,
        currency: (inst.currency ?? 'AUD').toLowerCase(),
        customer: proposalRow.stripeCustomerId,
        payment_method: proposalRow.stripePaymentMethodId,
        confirm: true,
        off_session: true,
        description: `Auto-charge: Installment ${inst.installmentNumber}/${inst.totalInstallments} — ${proposalRow.title ?? proposalRow.slug}`,
        metadata: {
          proposalId: inst.proposalId,
          proposalSlug: proposalRow.slug ?? '',
          brandId: brandId ?? '',
          clientId: inst.clientId ?? '',
          installmentId: inst.id,
          installmentNumber: String(inst.installmentNumber),
          totalInstallments: String(inst.totalInstallments),
          autoCharge: 'true',
        },
      };
      // application_fee_amount is only valid on destination/direct payments (requires connectId)
      if (connectId) {
        piParams.application_fee_amount = applicationFeeCents;
        piParams.on_behalf_of = connectId;
        piParams.transfer_data = { destination: connectId };
      }

      const idempotencyKey = `auto-charge-${inst.proposalId}-${inst.id}-${inst.installmentNumber}`;
      const pi = await stripe.paymentIntents.create(piParams, { idempotencyKey });

      if (pi.status === 'succeeded') {
        // Mark this installment as paid
        await db
          .update(paymentInstallmentSchedules)
          .set({ status: 'paid', paidAt: new Date(), stripePaymentIntentId: pi.id, chargeError: null })
          .where(eq(paymentInstallmentSchedules.id, inst.id));

        // Check if all installments are now paid
        const allInstallments = await db
          .select()
          .from(paymentInstallmentSchedules)
          .where(eq(paymentInstallmentSchedules.proposalId, inst.proposalId));
        const allPaid = allInstallments.every((i) => i.id === inst.id || i.status === 'paid');

        if (allPaid) {
          if (brandId) {
            await db
              .update(proposals)
              .set({ status: 'paid', paidAt: new Date() })
              .where(eq(proposals.id, inst.proposalId));
          }
          autoSendSurvey({
            proposalId: inst.proposalId,
            brandId: brandId!,
            clientId: inst.clientId ?? null,
          }).catch(console.error);
        } else {
          // Set autoChargeAt on the next pending installment
          const nextInst = allInstallments
            .filter((i) => i.status === 'pending')
            .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
          if (nextInst) {
            await db
              .update(paymentInstallmentSchedules)
              .set({ status: 'due', autoChargeAt: nextInst.dueAt })
              .where(eq(paymentInstallmentSchedules.id, nextInst.id));
          }
        }

        // Send payment confirmation email
        try {
          const client =
            inst.clientId && brandId ? await getClientById(inst.clientId, brandId) : undefined;
          if (client?.email && proposalRow) {
            const amountFormatted = new Intl.NumberFormat('en-AU', {
              style: 'currency',
              currency: inst.currency ?? 'AUD',
            }).format(inst.amountCents / 100);
            await sendEmail({
              to: client.email,
              subject: `Payment ${inst.installmentNumber}/${inst.totalInstallments} charged — ${proposalRow.title ?? proposalRow.slug}`,
              htmlBody: `<p>Hi ${client.name},</p><p>Your instalment payment of <strong>${amountFormatted}</strong> has been automatically charged to your card on file. Thank you!</p><p>— ${account?.businessName ?? 'EziQuotes'}</p>`,
              textBody: `Instalment ${inst.installmentNumber}/${inst.totalInstallments} of ${amountFormatted} charged automatically.`,
            });
          }
        } catch (emailErr) {
          console.error('[AutoCharge] Confirmation email failed:', emailErr);
        }

        if (brandId) {
          await logActivity({
            action: 'proposal.installment_auto_charged',
            brandId,
            actorType: 'system',
            actorId: null,
            eventType: 'proposal.installment_auto_charged',
            entityType: 'proposal',
            entityId: inst.proposalId,
            metadata: {
              installmentId: inst.id,
              installmentNumber: inst.installmentNumber,
              amountCents: inst.amountCents,
              paymentIntentId: pi.id,
            },
          });
        }

        charged++;
      } else {
        // Payment requires action (e.g. 3DS) — mark as failed and notify
        const errMsg = `Payment status: ${pi.status}`;
        await db
          .update(paymentInstallmentSchedules)
          .set({ chargeError: errMsg, status: 'overdue' })
          .where(eq(paymentInstallmentSchedules.id, inst.id));
        failed++;
        console.error(`[AutoCharge] Installment ${inst.id} requires action: ${pi.status}`);
      }
    } catch (err: any) {
      // Stripe error (card declined, etc.)
      const errMsg = err?.message ?? String(err);
      await db
        .update(paymentInstallmentSchedules)
        .set({ chargeError: errMsg, status: 'overdue' })
        .where(eq(paymentInstallmentSchedules.id, inst.id));
      failed++;
      console.error(`[AutoCharge] Installment ${inst.id} charge failed:`, errMsg);

      // Notify the client their card failed
      try {
        const [proposalRow2] = await db
          .select({ title: proposals.title, slug: proposals.slug })
          .from(proposals)
          .where(eq(proposals.id, inst.proposalId))
          .limit(1);
        const client =
          inst.clientId && inst.brandId ? await getClientById(inst.clientId, inst.brandId) : undefined;
        const account = inst.brandId ? await getPaymentAccount(inst.brandId) : undefined;
        if (client?.email) {
          const origin = paymentsOrigin();
          await sendEmail({
            to: client.email,
            subject: `Action required: Payment failed for ${proposalRow2?.title ?? 'your proposal'}`,
            htmlBody: `<p>Hi ${client.name},</p><p>We were unable to automatically charge your card for instalment ${inst.installmentNumber}/${inst.totalInstallments}. Please update your payment details at: <a href="${origin}/p/${proposalRow2?.slug}">${origin}/p/${proposalRow2?.slug}</a></p><p>— ${account?.businessName ?? 'EziQuotes'}</p>`,
            textBody: `Payment failed for instalment ${inst.installmentNumber}/${inst.totalInstallments}. Please pay at: ${origin}/p/${proposalRow2?.slug}`,
          });
        }
      } catch (notifyErr) {
        console.error('[AutoCharge] Failed to send failure notification:', notifyErr);
      }
    }
  }

  console.log(
    `[AutoCharge] Charged: ${charged}, Failed: ${failed}, Skipped: ${skipped}, Total: ${dueInstallments.length}`,
  );
  return { ok: true, charged, failed, skipped, total: dueInstallments.length };
}

// ─── Auto-chase nudges ────────────────────────────────────────────────────────
/**
 * Runs daily. The export scheduled one heartbeat cron per account; here a
 * single sweep iterates every payment account with autoChaseEnabled and nudges
 * proposals still in "sent" past that account's chaseDelayDays.
 */
export async function runAutoChase(): Promise<{
  ok: boolean;
  accountsProcessed: number;
  nudgeCount: number;
}> {
  const enabledAccounts = await db
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.autoChaseEnabled, true));

  const origin = paymentsOrigin();
  let totalNudges = 0;

  for (const account of enabledAccounts) {
    const delayMs = (account.chaseDelayDays ?? 3) * 24 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - delayMs);

    // Find proposals sent before cutoff that are still in "sent" status
    const overdueProposals = await db
      .select()
      .from(proposals)
      .where(
        and(
          eq(proposals.brandId, account.brandId),
          eq(proposals.kind, 'payer'),
          eq(proposals.status, 'sent'),
          lt(proposals.sentAt, cutoff),
        ),
      );

    let nudgeCount = 0;
    for (const proposal of overdueProposals) {
      try {
        if (!proposal.recipientContactId) continue;
        const client = await getClientById(proposal.recipientContactId, account.brandId);
        if (!client) continue;
        const proposalUrl = `${origin}/p/${proposal.slug}`;
        const businessName = account.businessName ?? 'Your service provider';
        // Send SMS nudge if client has mobile
        if (client.mobile) {
          const smsBody = buildProposalSmsBody({
            clientName: client.name,
            businessName,
            proposalTitle: proposal.title ?? 'Proposal',
            proposalUrl,
            customMessage: 'Just a friendly reminder — your proposal is waiting for your review.',
          });
          await sendSms({ to: client.mobile, body: smsBody, brandId: account.brandId });
        }
        // Send email nudge if client has email
        if (client.email) {
          const emailPayload = buildNudgeEmail({
            clientName: client.name,
            businessName,
            proposalTitle: proposal.title ?? 'Proposal',
            proposalUrl,
          });
          await sendEmail({ to: client.email, ...emailPayload });
        }
        // Log the auto-nudge activity
        await logActivity({
          action: 'proposal.auto_nudge_sent',
          brandId: account.brandId,
          actorType: 'system',
          actorId: null,
          eventType: 'proposal.auto_nudge_sent',
          entityType: 'proposal',
          entityId: proposal.id,
          metadata: {
            source: 'auto-chase',
            delayDays: account.chaseDelayDays,
            clientId: client.id,
          },
        });
        nudgeCount++;
      } catch (err) {
        console.error(`[AutoChase] Failed to nudge proposal ${proposal.id}:`, err);
      }
    }

    if (nudgeCount > 0) {
      console.log(`[AutoChase] Processed ${nudgeCount} nudges for brand ${account.brandId}`);
    }
    totalNudges += nudgeCount;
  }

  return { ok: true, accountsProcessed: enabledAccounts.length, nudgeCount: totalNudges };
}

// ─── Recurring invoice sender ─────────────────────────────────────────────────
/**
 * Runs daily. The export scheduled one heartbeat cron per account; here a
 * single sweep sends every active recurring invoice that is due (nextDueAt
 * <= now) across all accounts and advances its nextDueAt by its frequency.
 */
export async function runRecurringInvoiceSender(): Promise<{ ok: boolean; sentCount: number }> {
  const now = new Date();
  const dueInvoices = await db
    .select()
    .from(paymentRecurringInvoices)
    .where(
      and(eq(paymentRecurringInvoices.isActive, true), lte(paymentRecurringInvoices.nextDueAt, now)),
    );

  let sentCount = 0;
  for (const inv of dueInvoices) {
    try {
      const account = await getPaymentAccount(inv.brandId);
      const client = await getClientById(inv.clientId, inv.brandId);
      if (!client || !client.email) continue;
      const lineItems: any[] = JSON.parse(inv.lineItemsJson || '[]');
      const total = (inv.totalCents / 100).toFixed(2);
      const lineItemsHtml = lineItems
        .map(
          (li: any) =>
            `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${li.name}</td><td style="text-align:right;padding:6px 0;border-bottom:1px solid #eee">${inv.currency} ${(((li.qty ?? 1) * li.unitCents) / 100).toFixed(2)}</td></tr>`,
        )
        .join('');
      const html = `
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
  <h2 style="font-size:20px;margin-bottom:4px">${inv.title}</h2>
  <p style="color:#666;margin-bottom:24px">From ${account?.businessName ?? ''}</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    ${lineItemsHtml}
    <tr><td style="padding:10px 0;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${inv.currency} ${total}</td></tr>
  </table>
  ${inv.notes ? `<p style="color:#555;font-size:14px">${inv.notes}</p>` : ''}
  <p style="color:#999;font-size:12px;margin-top:32px">Sent on behalf of ${account?.businessName ?? ''}</p>
</div>`;
      await sendEmail({
        to: client.email,
        subject: `Invoice: ${inv.title} — ${inv.currency} ${total}`,
        htmlBody: html,
      });
      // Advance nextDueAt
      const next = new Date(inv.nextDueAt);
      switch (inv.frequency) {
        case 'weekly':
          next.setDate(next.getDate() + 7);
          break;
        case 'fortnightly':
          next.setDate(next.getDate() + 14);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
        case 'quarterly':
          next.setMonth(next.getMonth() + 3);
          break;
        case 'annually':
          next.setFullYear(next.getFullYear() + 1);
          break;
      }
      await db
        .update(paymentRecurringInvoices)
        .set({ lastSentAt: now, nextDueAt: next })
        .where(eq(paymentRecurringInvoices.id, inv.id));
      sentCount++;
    } catch (err) {
      console.error(`[RecurringInvoices] Failed to send invoice ${inv.id}:`, err);
    }
  }

  console.log(`[RecurringInvoices] Sent ${sentCount} invoices`);
  return { ok: true, sentCount };
}

// ─── Sequence due-run sweep ────────────────────────────────────────────────────
// The export relied on "the BullMQ scheduler will retry at nextFireAt" but never
// actually swept due runs (a dormant scheduler — see MIGRATION-NOTES). This
// sweep makes it live: every due pending/running run gets its next touchpoint
// enqueued. nextFireAt is cleared first so a slow worker can't double-fire; the
// touchpoint handler re-sets it (quiet-hours re-queue or next-touchpoint delay).
export async function runSequenceSweep(): Promise<number> {
  const { inArray, isNotNull: notNull } = await import('drizzle-orm');
  const { paymentSequenceRuns } = await import('../../db/schema.js');
  const { sequenceQueue } = await import('./queues.js');
  const now = new Date();
  const due = await db
    .select()
    .from(paymentSequenceRuns)
    .where(
      and(
        inArray(paymentSequenceRuns.status, ['pending', 'running']),
        notNull(paymentSequenceRuns.nextFireAt),
        lte(paymentSequenceRuns.nextFireAt, now),
      ),
    )
    .limit(200);

  for (const run of due) {
    const touchpointIndex = (run.touchpointsFired ?? []).length;
    await db
      .update(paymentSequenceRuns)
      .set({ nextFireAt: null, updatedAt: now })
      .where(eq(paymentSequenceRuns.id, run.id));
    await sequenceQueue.add('fire_touchpoint', { runId: run.id, touchpointIndex });
  }
  return due.length;
}

// ─── Outbound webhook retry sweep ─────────────────────────────────────────────
export async function runWebhookRetries(): Promise<number> {
  const { retryPendingDeliveries } = await import('./webhook-dispatcher.js');
  return retryPendingDeliveries(db);
}
