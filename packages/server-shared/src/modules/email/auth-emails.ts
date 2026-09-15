import { buildCommonTemplate } from './common-template.js';
import { appBaseUrl, PRODESK_BRANDING } from './branding.js';

/**
 * Auth emails — verification + password reset. Ports of
 * functions/src/modules/email/templates/verification_email_template.ts (and the
 * GoTrue recovery email we're replacing). Generic Prodesk branding, no
 * unsubscribe link (transactional auth mail is not opt-out-able).
 */

export function buildVerificationEmail(data: {
  name?: string | null;
  email: string;
  verificationUrl: string;
}) {
  const subject = 'Verify your email address';
  const html = buildCommonTemplate({
    title: 'Verify your email',
    applicationUrl: appBaseUrl(),
    redirectUrl: { url: data.verificationUrl, cta: 'Verify Email &rarr;' },
    subtitle: `Hi ${data.name || data.email.split('@')[0]}`,
    body: 'Thanks for signing up. Please verify your email address by clicking the link below.',
    agencyDetails: PRODESK_BRANDING,
    unsubscribeUrl: '',
  });
  return { subject, html };
}

/**
 * One-time code email for the migrated-account password reset. Users brought
 * over from Firebase Auth have no usable password hash, so on their first login
 * we email a 6-digit code; they enter it, then set a new password.
 */
export function buildPasswordResetOtpEmail(data: {
  name?: string | null;
  email: string;
  otp: string;
}) {
  const subject = 'Your password reset code';
  const codeBlock = `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr><td align="center">
        <div style="display:inline-block;background:#F3F4F6;border:1px solid #E5E7EB;border-radius:12px;padding:18px 32px;font-size:32px;font-weight:700;letter-spacing:10px;color:#111827;font-family:'Helvetica Neue',Arial,sans-serif;">
          ${data.otp}
        </div>
      </td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.5;text-align:center;">This code expires in 10 minutes. If you didn’t try to sign in, you can ignore this email.</p>`;
  const html = buildCommonTemplate({
    title: 'Create a new password',
    applicationUrl: appBaseUrl(),
    subtitle: `Hi ${data.name || data.email.split('@')[0]}`,
    // The exact security message requested for migrated accounts.
    body: 'For security purposes you will be invoked to create a new password. Enter the code below to continue.',
    moreContent: codeBlock,
    agencyDetails: PRODESK_BRANDING,
    unsubscribeUrl: '',
  });
  return { subject, html };
}

export function buildPasswordResetEmail(data: {
  name?: string | null;
  email: string;
  resetUrl: string;
}) {
  const subject = 'Reset your password';
  const html = buildCommonTemplate({
    title: 'Reset your password',
    applicationUrl: appBaseUrl(),
    redirectUrl: { url: data.resetUrl, cta: 'Reset Password &rarr;' },
    subtitle: `Hi ${data.name || data.email.split('@')[0]}`,
    body: 'We received a request to reset your Prodesk password. Click the link below to choose a new one. If you didn’t request this, you can safely ignore this email — your password won’t change.',
    agencyDetails: PRODESK_BRANDING,
    unsubscribeUrl: '',
  });
  return { subject, html };
}
