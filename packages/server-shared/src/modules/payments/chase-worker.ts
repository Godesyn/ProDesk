/**
 * Payments (EziQuotes) chase queue worker — processes payment chase sequence
 * steps. Ported from the Manus export's server/chaseWorker.ts. Called by the
 * BullMQ worker registered in modules/payments/queues.ts.
 *
 * The chase data model uses the payment_proposals table (chaseStatus, chaseToken)
 * and the payment_accounts table (autoChaseEnabled, chaseDelayDays).
 * This worker handles the actual delivery of chase messages.
 */
import { sendSms } from './sms.js';
import { sendEmail, buildNudgeEmail } from './email.js';

export interface ChaseStepPayload {
  /** The proposal ID being chased */
  proposalId: string;
  /** The step number in the sequence (1-indexed) */
  stepNumber: number;
  /** Recipient details */
  recipientEmail: string;
  recipientPhone?: string;
  recipientName: string;
  businessName: string;
  portalUrl: string;
  proposalTitle: string;
  brandId: string;
  /** Channel to use for this step */
  channel: 'email' | 'sms' | 'both';
}

export async function processChaseStep(payload: ChaseStepPayload): Promise<void> {
  const {
    recipientEmail,
    recipientPhone,
    recipientName,
    businessName,
    portalUrl,
    proposalTitle,
    brandId,
    channel,
  } = payload;

  if (channel === 'email' || channel === 'both') {
    const emailPayload = buildNudgeEmail({
      clientName: recipientName,
      businessName,
      proposalUrl: portalUrl,
      proposalTitle,
    });
    await sendEmail({ ...emailPayload, to: recipientEmail });
  }

  if ((channel === 'sms' || channel === 'both') && recipientPhone) {
    const body = `Hi ${recipientName}, a friendly reminder that your proposal from ${businessName} is awaiting your review. View it here: ${portalUrl}`;
    await sendSms({ to: recipientPhone, body, brandId });
  }
}
