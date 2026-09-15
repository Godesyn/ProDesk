import nodemailer from 'nodemailer';
import { eq } from 'drizzle-orm';
import { env, isDev } from '../../lib/env.js';
import { db } from '../../db/index.js';
import { emailUnsubscribes, users, globalSettings } from '../../db/schema.js';

let transporter: nodemailer.Transporter | null = null;
if (env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    // Match production (functions getEmailConfig): Gmail on :465 with TLS.
    port: env.SMTP_PORT ?? 465,
    secure: env.SMTP_SECURE ?? true,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

/**
 * The notification channels a recipient can unsubscribe from. Mirrors the
 * `notification_channel` pg enum (email_unsubscribes.channels) and the Flutter
 * `UnsubscribeChannel` (functions/src/modules/email/email_functions.ts). Pass
 * one to every branded email so the mailer can suppress it for opted-out
 * recipients (ports the recipient-filtering in functions `sendEmail`).
 */
export type UnsubscribeChannel =
  | 'staff_invite'
  | 'agency_invite'
  | 'request_completion'
  | 'proposal'
  | 'payment_failed'
  | 'digital_product'
  | 'cancel_subscription'
  | 'verification'
  | 'task'
  | 'chat'
  | 'partial_refund'
  | 'cancellation_request'
  | 'brand_added_you'
  | 'referral_invite';

/** All unsubscribe channels, in pg-enum order — single source for the enum/migration. */
export const UNSUBSCRIBE_CHANNELS: readonly UnsubscribeChannel[] = [
  'staff_invite',
  'agency_invite',
  'request_completion',
  'proposal',
  'payment_failed',
  'digital_product',
  'cancel_subscription',
  'verification',
  'task',
  'chat',
  'partial_refund',
  'cancellation_request',
  'brand_added_you',
  'referral_invite',
];

export interface MailAttachment {
  filename: string;
  /** A URL or local path — nodemailer fetches URL paths. */
  path: string;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  /** Optional unsubscribe channel — if the recipient opted out of it, the send is suppressed. */
  channel?: UnsubscribeChannel;
  /** Optional file attachments (proposal documents, digital products). */
  attachments?: MailAttachment[];
}

/** True if `email` has unsubscribed from `channel`. Best-effort: any lookup failure fails open (sends). */
async function isUnsubscribed(email: string, channel: UnsubscribeChannel): Promise<boolean> {
  try {
    const row = (await db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.email, email)).limit(1))[0];
    return row?.channels?.includes(channel) ?? false;
  } catch (err) {
    console.error('[mail] unsubscribe lookup failed', email, channel, (err as Error).message);
    return false;
  }
}

/**
 * If `to` belongs to a super-admin user, returns the configured admin-forwarding
 * addresses (comma-joined) so the mail is redirected to them INSTEAD of the
 * super-admin. Returns null when the recipient isn't a super-admin or no
 * forwarding addresses are configured (send proceeds to the original `to`).
 * Best-effort: any lookup failure fails open (returns null → normal send).
 */
async function superAdminForwardingTarget(to: string): Promise<string | null> {
  try {
    const user = (
      await db.select({ isSuperAdmin: users.isSuperAdmin }).from(users).where(eq(users.email, to)).limit(1)
    )[0];
    if (!user?.isSuperAdmin) return null;
    const row = (
      await db.select({ emails: globalSettings.adminForwardingEmails }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1)
    )[0];
    const emails = (row?.emails ?? []).map((e) => e.trim()).filter(Boolean);
    return emails.length ? emails.join(', ') : null;
  } catch (err) {
    console.error('[mail] super-admin forwarding lookup failed', to, (err as Error).message);
    return null;
  }
}

/**
 * Send an email. In dev (or when SMTP is unconfigured) it logs instead of sending,
 * and all mail is redirected to EMAIL_DEV_REDIRECT — mirrors the behaviour of
 * functions/src/modules/email/email_functions.ts.
 *
 * When `channel` is supplied, the send is suppressed for recipients who have
 * unsubscribed from that channel (single source of truth — callers no longer
 * need to pre-check the email_unsubscribes table).
 */
export async function sendEmail({ to, subject, html, channel, attachments }: MailInput): Promise<void> {
  if (channel && (await isUnsubscribed(to, channel))) {
    console.log(`[mail] suppressed → ${to}: ${subject} (unsubscribed from ${channel})`);
    return;
  }
  // When the recipient is a super-admin, redirect the mail to the configured
  // admin-forwarding addresses instead of the super-admin themselves.
  const forwardTarget = await superAdminForwardingTarget(to);
  if (forwardTarget) console.log(`[mail] forwarding super-admin mail ${to} → ${forwardTarget}: ${subject}`);
  const target = forwardTarget ?? to;
  // Redirect mail to EMAIL_DEV_REDIRECT only in local development. Staging and
  // production both send to the real recipient.
  const recipient = isDev && env.EMAIL_DEV_REDIRECT ? env.EMAIL_DEV_REDIRECT : target;
  if (!transporter) {
    console.log(`[mail] (no SMTP) → ${recipient}: ${subject}`);
    return;
  }
  await transporter.sendMail({ from: env.EMAIL_FROM, to: recipient, subject, html, attachments });
  console.log(`[mail] sent → ${recipient}: ${subject}`);
}

/**
 * Build the unsubscribe deep link for a channel/recipient — ports
 * functions `getUnsubscribeUrl`. Hits the server's GET /unsubscribe endpoint
 * (see _core/index.ts), which upserts into email_unsubscribes.
 */
export function getUnsubscribeUrl(channel: UnsubscribeChannel, email: string): string {
  return `${env.SERVER_ORIGIN}/unsubscribe?type=${channel}&email=${encodeURIComponent(email)}`;
}
