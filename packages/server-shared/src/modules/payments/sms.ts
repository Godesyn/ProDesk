/**
 * Payments (EziQuotes) SMS helper — ported from the export's server/sms.ts.
 * Uses the Twilio REST API via fetch (no npm package required).
 *
 * Credential resolution (per-account first, global fallback):
 *  - When `brandId` is passed and the brand's payment_accounts row has
 *    twilioAccountSid + twilioAuthToken, those are used (From = smsSenderId
 *    alpha sender ?? twilioFromNumber).
 *  - Otherwise the global TWILIO_* env credentials are used.
 * Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_FROM_NUMBER or
 * TWILIO_ALPHA_SENDER (optionally TWILIO_MESSAGING_SERVICE_SID) to activate.
 * Falls back to console.log in dev/demo mode.
 *
 * Compliance features:
 *  - Quiet hours: 8pm–8am in recipient's local time (defaults to AEST/UTC+10)
 *  - Volume cap: max 3 SMS per unique recipient per calendar day
 *  - Per-brand monthly cap: payment_accounts.smsMonthlyCap against payment_sms_logs
 *  - STOP handling: replies of "STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"
 *    are stored in the payment_sms_opt_outs table and respected before sending
 *  - Status callback: Twilio posts delivery receipts to /api/payments/sms/status
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentAccounts, paymentSmsLogs, paymentSmsOptOuts } from '../../db/schema.js';
import { env } from '../../lib/env.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Quiet hours: no SMS before 8am or after 8pm (local time) */
const QUIET_HOUR_START = 20; // 8pm
const QUIET_HOUR_END = 8; // 8am
const MAX_SMS_PER_DAY = 3; // volume cap per recipient

// STOP keywords per TCPA / ACMA
const STOP_KEYWORDS = new Set(['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);

// ---------------------------------------------------------------------------
// Quiet-hours check
// ---------------------------------------------------------------------------

/**
 * Returns true if the current time is within quiet hours (8pm–8am).
 * Uses UTC+10 (AEST) as the default timezone when none is provided.
 */
export function isQuietHours(tzOffset = 10): boolean {
  const nowUtc = new Date();
  const localHour = (nowUtc.getUTCHours() + tzOffset) % 24;
  return isQuietHoursForHour(localHour);
}

/**
 * Pure helper: returns true if the given local hour (0–23) falls in the quiet
 * window (20:00–08:00). Exported for deterministic unit testing.
 */
export function isQuietHoursForHour(localHour: number): boolean {
  return localHour >= QUIET_HOUR_START || localHour < QUIET_HOUR_END;
}

// ---------------------------------------------------------------------------
// Opt-out helpers
// ---------------------------------------------------------------------------

/**
 * Check if a phone number has opted out.
 */
export async function isOptedOut(phoneNumber: string): Promise<boolean> {
  try {
    const rows = await db
      .select()
      .from(paymentSmsOptOuts)
      .where(eq(paymentSmsOptOuts.phoneNumber, phoneNumber))
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Record an opt-out for a phone number.
 */
export async function recordOptOut(phoneNumber: string, keyword = 'STOP'): Promise<void> {
  try {
    await db
      .insert(paymentSmsOptOuts)
      .values({ phoneNumber, keyword, optedOutAt: new Date() })
      .onConflictDoNothing();
  } catch (e) {
    console.error('[SMS] Failed to record opt-out:', e);
  }
}

// ---------------------------------------------------------------------------
// Volume cap helpers
// ---------------------------------------------------------------------------

/**
 * Count how many SMS have been sent to this number today (calendar day UTC).
 */
async function getDailyCount(phoneNumber: string): Promise<number> {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentSmsLogs)
      .where(and(eq(paymentSmsLogs.toNumber, phoneNumber), gte(paymentSmsLogs.sentAt, startOfDay)));
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Count how many SMS this brand has sent this calendar month (UTC) — used for
 * the per-account smsMonthlyCap.
 */
async function getMonthlyCountForBrand(brandId: string): Promise<number> {
  try {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(paymentSmsLogs)
      .where(and(eq(paymentSmsLogs.brandId, brandId), gte(paymentSmsLogs.sentAt, startOfMonth)));
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Log a sent SMS for volume tracking.
 */
async function logSms(opts: {
  toNumber: string;
  body: string;
  sid?: string;
  status?: string;
  brandId?: string;
}): Promise<void> {
  try {
    await db.insert(paymentSmsLogs).values({
      toNumber: opts.toNumber,
      body: opts.body,
      twilioSid: opts.sid ?? null,
      status: opts.status ?? 'sent',
      brandId: opts.brandId ?? null,
      sentAt: new Date(),
    });
  } catch (e) {
    console.error('[SMS] Failed to log SMS:', e);
  }
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

export interface SendSmsOptions {
  to: string;
  body: string;
  /** Brand ID for volume tracking + per-account Twilio credentials */
  brandId?: string;
  /** Skip quiet-hours check (e.g. for urgent alerts) */
  skipQuietHours?: boolean;
  /** Skip volume cap check */
  skipVolumeCap?: boolean;
  /** Timezone offset in hours for quiet-hours calculation (default +10 AEST) */
  tzOffset?: number;
}

export interface SendSmsResult {
  success: boolean;
  message?: string;
  /** "sent" | "skipped_quiet_hours" | "skipped_opted_out" | "skipped_volume_cap" | "skipped_monthly_cap" | "error" */
  reason?: string;
}

export async function sendSms(opts: SendSmsOptions): Promise<SendSmsResult> {
  const { to, body, brandId, skipQuietHours = false, skipVolumeCap = false, tzOffset = 10 } = opts;

  // 1. Opt-out check
  if (await isOptedOut(to)) {
    console.log(`[SMS] Skipped — ${to} has opted out`);
    return { success: false, reason: 'skipped_opted_out', message: 'Recipient has opted out' };
  }

  // 2. Quiet-hours check (8pm–8am)
  if (!skipQuietHours && isQuietHours(tzOffset)) {
    console.log(`[SMS] Skipped — quiet hours (8pm–8am)`);
    return { success: false, reason: 'skipped_quiet_hours', message: 'Outside sending hours (8am–8pm)' };
  }

  // 3. Volume cap (max 3/day per recipient)
  if (!skipVolumeCap) {
    const count = await getDailyCount(to);
    if (count >= MAX_SMS_PER_DAY) {
      console.log(`[SMS] Skipped — volume cap reached for ${to} (${count}/${MAX_SMS_PER_DAY})`);
      return { success: false, reason: 'skipped_volume_cap', message: `Daily SMS limit reached (${MAX_SMS_PER_DAY}/day)` };
    }
  }

  // 4. Per-account credentials + monthly cap
  let account: typeof paymentAccounts.$inferSelect | undefined;
  if (brandId) {
    try {
      account = (
        await db.select().from(paymentAccounts).where(eq(paymentAccounts.brandId, brandId)).limit(1)
      )[0];
    } catch {
      account = undefined;
    }
    if (!skipVolumeCap && account?.smsMonthlyCap != null) {
      const monthly = await getMonthlyCountForBrand(brandId);
      if (monthly >= account.smsMonthlyCap) {
        console.log(`[SMS] Skipped — monthly cap reached for brand ${brandId} (${monthly}/${account.smsMonthlyCap})`);
        return {
          success: false,
          reason: 'skipped_monthly_cap',
          message: `Monthly SMS limit reached (${account.smsMonthlyCap}/month)`,
        };
      }
    }
  }

  // Per-account Twilio credentials win; otherwise global env fallback.
  const hasAccountCreds = !!(account?.twilioAccountSid && account?.twilioAuthToken);
  const accountSid = hasAccountCreds ? account!.twilioAccountSid! : env.TWILIO_ACCOUNT_SID;
  const authToken = hasAccountCreds ? account!.twilioAuthToken! : env.TWILIO_AUTH_TOKEN;
  // Prefer Messaging Service SID (enables opt-out management, A2P 10DLC compliance)
  const messagingServiceSid = hasAccountCreds ? undefined : env.TWILIO_MESSAGING_SERVICE_SID;
  const from = hasAccountCreds
    ? (account!.smsSenderId ?? account!.twilioFromNumber ?? undefined)
    : (env.TWILIO_ALPHA_SENDER ?? env.TWILIO_FROM_NUMBER);

  if (!accountSid || !authToken || (!messagingServiceSid && !from)) {
    console.log(`[SMS] Would send to ${to}: "${body.slice(0, 60)}…"`);
    await logSms({ toNumber: to, body, status: 'demo', brandId });
    return { success: true, reason: 'demo', message: 'SMS logged (Twilio not configured)' };
  }

  // Delivery receipts land on the backend server (wired in servers/backend).
  const statusCallbackUrl = `${env.SERVER_ORIGIN}/api/payments/sms/status`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  // Use Messaging Service SID if available (recommended for A2P 10DLC / AU compliance)
  const fromParams: Record<string, string> = messagingServiceSid
    ? { MessagingServiceSid: messagingServiceSid }
    : { From: from! };
  const params = new URLSearchParams({
    To: to,
    ...fromParams,
    Body: body,
    StatusCallback: statusCallbackUrl,
  });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[SMS] Twilio error: ${err}`);
      await logSms({ toNumber: to, body, status: 'failed', brandId });
      return { success: false, reason: 'error', message: err };
    }

    const json = (await res.json()) as { sid: string; status: string };
    console.log(`[SMS] Sent to ${to}, SID: ${json.sid}`);
    await logSms({ toNumber: to, body, sid: json.sid, status: json.status, brandId });
    return { success: true };
  } catch (e) {
    console.error('[SMS] Failed to send:', e);
    return { success: false, reason: 'error', message: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Inbound message handler (STOP replies)
// ---------------------------------------------------------------------------

/**
 * Handle an inbound Twilio SMS webhook (TwiML).
 * Detects STOP keywords and records opt-outs.
 * Returns TwiML response body.
 */
export async function handleInboundSms(from: string, body: string): Promise<string> {
  const keyword = body.trim().toUpperCase();

  if (STOP_KEYWORDS.has(keyword)) {
    await recordOptOut(from, keyword);
    console.log(`[SMS] Opt-out recorded for ${from} via keyword "${keyword}"`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been unsubscribed and will no longer receive messages from us. Reply START to re-subscribe.</Message>
</Response>`;
  }

  if (keyword === 'START' || keyword === 'UNSTOP') {
    // Re-subscribe: remove from opt-out list
    try {
      await db.delete(paymentSmsOptOuts).where(eq(paymentSmsOptOuts.phoneNumber, from));
      console.log(`[SMS] Re-subscribed ${from}`);
    } catch (e) {
      console.error('[SMS] Failed to remove opt-out:', e);
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>You have been re-subscribed and will receive messages from us again.</Message>
</Response>`;
  }

  // No auto-reply for other messages
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

/**
 * Build a proposal delivery SMS body.
 */
export function buildProposalSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  proposalTitle: string;
  proposalUrl: string;
  customMessage?: string;
}): string {
  const name = opts.clientName ?? 'there';
  const custom = opts.customMessage ? `\n\n${opts.customMessage}` : '';
  return `Hi ${name}, ${opts.businessName} has sent you a proposal: "${opts.proposalTitle}".${custom}\n\nView & accept here: ${opts.proposalUrl}\n\nReply STOP to opt out.`;
}

/**
 * Build a payment reminder SMS body.
 */
export function buildPaymentReminderSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  amountFormatted: string;
  dueDate: string;
  paymentUrl: string;
}): string {
  const name = opts.clientName ?? 'there';
  return `Hi ${name}, a payment of ${opts.amountFormatted} is due on ${opts.dueDate} to ${opts.businessName}.\n\nPay now: ${opts.paymentUrl}\n\nReply STOP to opt out.`;
}

/**
 * Build a chase/recovery SMS body.
 */
export function buildChaseSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  amountFormatted: string;
  recoveryUrl: string;
}): string {
  const name = opts.clientName ?? 'there';
  return `Hi ${name}, your invoice of ${opts.amountFormatted} from ${opts.businessName} is overdue.\n\nPay securely here: ${opts.recoveryUrl}\n\nReply STOP to opt out.`;
}

/**
 * Build a proposal-accepted confirmation SMS (trigger 3: client accepts).
 */
export function buildProposalAcceptedSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  proposalTitle: string;
  proposalUrl: string;
}): string {
  const name = opts.clientName ?? 'there';
  return `Hi ${name}, your proposal "${opts.proposalTitle}" from ${opts.businessName} has been accepted. View the details here: ${opts.proposalUrl}\n\nReply STOP to opt out.`;
}

/**
 * Build a payment-received confirmation SMS (trigger 4: payment succeeds).
 */
export function buildPaymentReceivedSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  amountFormatted: string;
  receiptUrl?: string;
}): string {
  const name = opts.clientName ?? 'there';
  const receipt = opts.receiptUrl ? `\n\nView receipt: ${opts.receiptUrl}` : '';
  return `Hi ${name}, your payment of ${opts.amountFormatted} to ${opts.businessName} has been received. Thank you!${receipt}\n\nReply STOP to opt out.`;
}

/**
 * Build a payment-failed alert SMS (trigger 5: payment fails).
 */
export function buildPaymentFailedSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  amountFormatted: string;
  paymentUrl: string;
}): string {
  const name = opts.clientName ?? 'there';
  return `Hi ${name}, your payment of ${opts.amountFormatted} to ${opts.businessName} was unsuccessful. Please update your payment method: ${opts.paymentUrl}\n\nReply STOP to opt out.`;
}

/**
 * Build an upcoming installment reminder SMS (trigger 6: 3 days before due).
 */
export function buildInstallmentReminderSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  amountFormatted: string;
  dueDate: string;
  paymentUrl: string;
  installmentNumber: number;
  totalInstallments: number;
}): string {
  const name = opts.clientName ?? 'there';
  return `Hi ${name}, a reminder that installment ${opts.installmentNumber}/${opts.totalInstallments} of ${opts.amountFormatted} is due on ${opts.dueDate} to ${opts.businessName}.\n\nPay here: ${opts.paymentUrl}\n\nReply STOP to opt out.`;
}

/**
 * Build a subscription renewal reminder SMS (trigger 7: 3 days before renewal).
 */
export function buildSubscriptionRenewalSmsBody(opts: {
  clientName: string | null;
  businessName: string;
  amountFormatted: string;
  renewalDate: string;
  manageUrl: string;
}): string {
  const name = opts.clientName ?? 'there';
  return `Hi ${name}, your subscription of ${opts.amountFormatted} with ${opts.businessName} renews on ${opts.renewalDate}.\n\nManage here: ${opts.manageUrl}\n\nReply STOP to opt out.`;
}
