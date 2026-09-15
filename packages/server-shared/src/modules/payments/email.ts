/**
 * Payments (EziQuotes) email layer — ported from the export's server/email.ts.
 *
 * Behavior mapping:
 *  - Per-account Postmark: when the brand's payment_accounts row has a
 *    postmarkServerToken, the email is sent through Postmark's REST API using
 *    that token (From = postmarkFromEmail when set). Pass the account row via
 *    `payload.account`.
 *  - Otherwise the send falls back to the PLATFORM mailer (modules/email/mailer)
 *    instead of the export's own global SMTP transporter — the platform mailer
 *    already handles SMTP config, dev redirects and unsubscribe suppression.
 *  - Template builders are kept verbatim (names, subjects, HTML).
 *
 * Returns boolean like the source (`true` on success / logged-only, `false` on
 * a send failure) so ported call sites keep their semantics.
 */
import {
  sendEmail as sendPlatformEmail,
  type UnsubscribeChannel,
} from '../email/mailer.js';

export interface PaymentEmailAccount {
  postmarkServerToken?: string | null;
  postmarkFromEmail?: string | null;
}

export interface EmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  from?: string;
  attachments?: Array<{
    name: string;
    content: string; // base64-encoded
    contentType: string;
  }>;
  /**
   * Brand's payment settings row (or the Postmark subset of it) — enables the
   * per-account Postmark path. Omit to send via the platform mailer.
   */
  account?: PaymentEmailAccount | null;
  /** Optional platform unsubscribe channel (platform-mailer path only). */
  channel?: UnsubscribeChannel;
}

/** Send via the per-account Postmark server token (Postmark REST API). */
async function sendViaPostmark(
  payload: EmailPayload,
  account: PaymentEmailAccount,
): Promise<boolean> {
  const from = account.postmarkFromEmail ?? payload.from;
  if (!from) {
    console.warn('[payments:email] Postmark token set but no from address — falling back to platform mailer');
    return sendViaPlatform(payload);
  }
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': account.postmarkServerToken!,
      },
      body: JSON.stringify({
        From: from,
        To: payload.to,
        Subject: payload.subject,
        HtmlBody: payload.htmlBody,
        TextBody: payload.textBody ?? payload.subject,
        MessageStream: 'outbound',
        ...(payload.attachments?.length
          ? {
              Attachments: payload.attachments.map((a) => ({
                Name: a.name,
                Content: a.content,
                ContentType: a.contentType,
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      console.error(`[payments:email] Postmark send failed (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[payments:email] Postmark send failed:', e);
    return false;
  }
}

/** Fallback: the platform mailer (replaces the export's global SMTP transport). */
async function sendViaPlatform(payload: EmailPayload): Promise<boolean> {
  try {
    await sendPlatformEmail({
      to: payload.to,
      subject: payload.subject,
      html: payload.htmlBody,
      channel: payload.channel,
      // Platform attachments take a path/URL — encode base64 content as a data URI.
      attachments: payload.attachments?.length
        ? payload.attachments.map((a) => ({
            filename: a.name,
            path: `data:${a.contentType};base64,${a.content}`,
          }))
        : undefined,
    });
    return true;
  } catch (e) {
    console.error('[payments:email] platform mailer send failed:', e);
    return false;
  }
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  if (payload.account?.postmarkServerToken) {
    return sendViaPostmark(payload, payload.account);
  }
  return sendViaPlatform(payload);
}

// -- Email templates ----------------------------------------------------------

export function buildPaymentReceiptEmail({
  clientName,
  businessName,
  proposalTitle,
  amountFormatted,
  proposalUrl,
}: {
  clientName: string;
  businessName: string;
  proposalTitle: string;
  amountFormatted: string;
  proposalUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const subject = `Payment confirmed — ${amountFormatted} to ${businessName}`;
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">Payment Confirmed</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${clientName},</p>
      <p>Your payment of <strong>${amountFormatted}</strong> to <strong>${businessName}</strong> for <em>${proposalTitle}</em> has been confirmed.</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${proposalUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">View proposal</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${clientName},\n\nYour payment of ${amountFormatted} to ${businessName} for "${proposalTitle}" has been confirmed.\n\nView: ${proposalUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildProposalEmail(opts: {
  clientName: string;
  businessName: string;
  proposalTitle: string;
  proposalUrl: string;
  customMessage?: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.clientName ?? 'there';
  const subject = `${opts.businessName} has sent you a proposal`;
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">${opts.businessName}</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>${opts.customMessage ?? `${opts.businessName} has sent you a proposal: <strong>${opts.proposalTitle}</strong>.`}</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.proposalUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">View &amp; Accept Proposal</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\n${opts.businessName} has sent you a proposal: "${opts.proposalTitle}".\n\nView it here: ${opts.proposalUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildWelcomeEmail(opts: {
  name?: string | null;
  userName?: string | null;
  userEmail?: string;
  dashboardUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.name ?? opts.userName ?? 'there';
  const subject = 'Welcome to EziQuotes';
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">Welcome to EziQuotes</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>Your EziQuotes account is ready. Start sending proposals and collecting payments.</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.dashboardUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">Go to Dashboard</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\nWelcome to EziQuotesments! Your account is ready.\n\nGo to dashboard: ${opts.dashboardUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildAccountApprovedEmail(opts: {
  ownerName: string | null;
  ownerEmail: string;
  dashboardUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.ownerName ?? 'there';
  const subject = 'Your EziQuotes account has been approved';
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">Account Approved</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>Your EziQuotes account has been <strong>approved</strong>. You can now send proposals, collect payments, and manage your clients.</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.dashboardUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">Go to Dashboard</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\nYour EziQuotes account has been approved. Log in at ${opts.dashboardUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildAccountDeclinedEmail(opts: {
  ownerName: string | null;
  ownerEmail: string;
  reason: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.ownerName ?? 'there';
  const subject = 'Update on your EziQuotes account application';
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong>Account Application Update</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>Unfortunately, your EziQuotes account application was not approved at this time.</p>
      <p><strong>Reason:</strong> ${opts.reason}</p>
      <p>If you believe this is an error, please contact our support team.</p>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\nYour EziQuotes account application was not approved.\n\nReason: ${opts.reason}\n\nContact support if you have questions.`;
  return { subject, htmlBody, textBody };
}

export function buildUpcomingInstallmentEmail(opts: {
  clientName: string | null;
  businessName: string;
  proposalTitle: string;
  amountFormatted: string;
  dueDate: string;
  installmentNumber: number;
  totalInstallments: number;
  paymentUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.clientName ?? 'there';
  const subject = `Reminder: payment due in 3 days — ${opts.amountFormatted}`;
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong>Payment reminder — 3 days</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>Installment ${opts.installmentNumber}/${opts.totalInstallments} of <strong>${opts.amountFormatted}</strong> for <em>${opts.proposalTitle}</em> is due on <strong>${opts.dueDate}</strong>.</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.paymentUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">Pay now</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\nInstallment ${opts.installmentNumber}/${opts.totalInstallments} of ${opts.amountFormatted} for "${opts.proposalTitle}" is due on ${opts.dueDate}.\n\nPay: ${opts.paymentUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildProposalDeliveryEmail(opts: {
  clientName: string | null;
  businessName: string;
  proposalTitle: string;
  proposalUrl: string;
  customMessage?: string;
  expiresAt?: string | null;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.clientName ?? 'there';
  const subject = `${opts.proposalTitle} — proposal from ${opts.businessName}`;
  const expiry = opts.expiresAt ? `<p style="color:#888;font-size:12px;">This proposal expires on ${opts.expiresAt}.</p>` : '';
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">${opts.businessName}</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>${opts.customMessage ?? `${opts.businessName} has sent you a proposal: <strong>${opts.proposalTitle}</strong>.`}</p>
      ${expiry}
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.proposalUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">View &amp; Accept Proposal</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\n${opts.businessName} has sent you a proposal: "${opts.proposalTitle}".\n\nView it here: ${opts.proposalUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildProposalViewedEmail(opts: {
  ownerName: string | null;
  clientName: string;
  proposalTitle: string;
  proposalUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.ownerName ?? 'there';
  const subject = `${opts.clientName} just viewed your proposal`;
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">Proposal Viewed</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p><strong>${opts.clientName}</strong> just viewed your proposal <em>${opts.proposalTitle}</em>.</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.proposalUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">View Proposal</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\n${opts.clientName} just viewed your proposal "${opts.proposalTitle}".\n\nView: ${opts.proposalUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildNudgeEmail(opts: {
  clientName: string | null;
  businessName: string;
  proposalTitle: string;
  proposalUrl: string;
  customMessage?: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.clientName ?? 'there';
  const subject = `Reminder: ${opts.proposalTitle} — still waiting for your response`;
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">${opts.businessName}</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p>${opts.customMessage ?? `Just a friendly reminder — your proposal <strong>${opts.proposalTitle}</strong> from ${opts.businessName} is still waiting for your response.`}</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.proposalUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">View Proposal</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\nJust a reminder — your proposal "${opts.proposalTitle}" from ${opts.businessName} is still waiting.\n\nView: ${opts.proposalUrl}`;
  return { subject, htmlBody, textBody };
}

export function buildPaymentNotificationEmail(opts: {
  ownerName: string | null;
  clientName: string;
  proposalTitle: string;
  amountFormatted: string;
  proposalUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.ownerName ?? 'there';
  const subject = `${opts.clientName} just paid — ${opts.amountFormatted}`;
  const htmlBody = `<!DOCTYPE html><html><body style="margin:0;padding:40px 20px;background:#0A0A0A;font-family:Inter,Arial,sans-serif;color:#FAFAF9;">
  <table width="560" style="margin:0 auto;background:#141414;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;max-width:560px;width:100%;">
    <tr><td style="padding:24px 32px;background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.06);"><strong style="color:#d4f53c;">Payment Received</strong></td></tr>
    <tr><td style="padding:24px 32px;font-size:14px;line-height:1.6;">
      <p>Hi ${name},</p>
      <p><strong>${opts.clientName}</strong> just paid <strong>${opts.amountFormatted}</strong> for <em>${opts.proposalTitle}</em>.</p>
      <div style="margin-top:24px;text-align:center;">
        <a href="${opts.proposalUrl}" style="display:inline-block;background:#d4f53c;color:#0f0f0f;font-weight:700;font-size:14px;padding:14px 32px;border-radius:10px;text-decoration:none;">View Proposal</a>
      </div>
    </td></tr>
  </table></body></html>`;
  const textBody = `Hi ${name},\n\n${opts.clientName} just paid ${opts.amountFormatted} for "${opts.proposalTitle}".\n\nView: ${opts.proposalUrl}`;
  return { subject, htmlBody, textBody };
}

// Alias used by payments router — same as buildPaymentNotificationEmail
export const buildOwnerPaymentNotificationEmail = buildPaymentNotificationEmail;
