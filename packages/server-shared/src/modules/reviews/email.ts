/**
 * Transactional emails for the Reviews tool — the review-request invite and the
 * private "bad review" alert. Remaps the Manus export's Resend templates onto our
 * shared mailer (modules/email). Best-effort: callers wrap sends so a mail outage
 * never fails the mutation.
 */
import { sendEmail } from '../email/mailer.js';

const esc = (s: string) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Email-safe branded shell: warm paper background, centered white card,
 * "Powered by" footer. Table-based so Gmail/Outlook render it faithfully.
 */
const shell = (inner: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3eb;padding:32px 12px">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e4da;border-radius:14px">
      <tr><td style="padding:36px 40px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;line-height:1.6;font-size:15px">${inner}</td></tr>
    </table>
    <p style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:20px 0 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#a8a69d">Powered by Prodesk Reviews</p>
  </td></tr>
</table>`;

/** Logo image when the business has one, otherwise an initial-letter monogram tile. */
const logoBlock = (businessName: string, logoUrl?: string | null) =>
  logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(businessName)}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:14px;object-fit:cover;border:1px solid #e7e4da" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="64" height="64" style="width:64px;height:64px;border-radius:14px;background:#1a1a1a;color:#C7F560;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:26px;font-weight:700">${esc(businessName.trim().charAt(0).toUpperCase() || '★')}</td></tr></table>`;

/** Invite a customer to leave a review. */
export async function sendReviewRequestEmail(params: {
  to: string;
  customerName: string;
  businessName: string;
  locationName: string;
  reviewLink: string;
  customMessage?: string | null;
  logoUrl?: string | null;
  businessWebsite?: string | null;
  businessPhone?: string | null;
  businessAddress?: string | null;
}): Promise<void> {
  const greeting = params.customerName ? `Hi ${esc(params.customerName)},` : 'Hi there,';
  const showLocation =
    params.locationName &&
    params.locationName.trim().toLowerCase() !== params.businessName.trim().toLowerCase();
  const message = params.customMessage
    ? esc(params.customMessage)
    : `Thanks for choosing ${esc(params.businessName)}. We'd love to hear how we did${showLocation ? ` at ${esc(params.locationName)}` : ''} — your feedback helps us keep improving.`;

  // Business contact footer — only render the lines we actually have.
  const website = params.businessWebsite?.trim();
  const websiteHref = website && !/^https?:\/\//i.test(website) ? `https://${website}` : website;
  const contactBits = [
    params.businessAddress?.trim() ? esc(params.businessAddress.trim()) : null,
    params.businessPhone?.trim() ? esc(params.businessPhone.trim()) : null,
    website
      ? `<a href="${esc(websiteHref!)}" style="color:#8a887f;text-decoration:underline">${esc(website.replace(/^https?:\/\//i, ''))}</a>`
      : null,
  ].filter(Boolean);

  await sendEmail({
    to: params.to,
    subject: `How was your experience with ${params.businessName}?`,
    html: shell(`
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding-bottom:16px">${logoBlock(params.businessName, params.logoUrl)}</td></tr>
        <tr><td align="center" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:19px;font-weight:700;color:#1a1a1a;padding-bottom:2px">${esc(params.businessName)}</td></tr>
        ${showLocation ? `<tr><td align="center" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#8a887f">${esc(params.locationName)}</td></tr>` : ''}
        <tr><td style="padding:22px 0 0;border-bottom:1px solid #efede4"></td></tr>
      </table>
      <p style="margin:24px 0 0">${greeting}</p>
      <p style="margin:12px 0 0">${message}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:26px 0 6px">
          <a href="${esc(params.reviewLink)}" style="font-size:30px;letter-spacing:8px;color:#f59e0b;text-decoration:none;line-height:1">&#9733;&#9733;&#9733;&#9733;&#9733;</a>
        </td></tr>
        <tr><td align="center" style="padding:14px 0 6px">
          <a href="${esc(params.reviewLink)}" style="display:inline-block;background:#C7F560;color:#1a1a1a;text-decoration:none;padding:13px 32px;border-radius:10px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-weight:700;font-size:15px">Leave a review</a>
        </td></tr>
        <tr><td align="center" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#8a887f;padding-top:8px">It only takes about 15 seconds — and it means a lot to our team.</td></tr>
      </table>
      <p style="margin:26px 0 0;font-size:12px;color:#a8a69d;word-break:break-all">If the button doesn't work, paste this link into your browser:<br /><a href="${esc(params.reviewLink)}" style="color:#8a887f">${esc(params.reviewLink)}</a></p>
      ${contactBits.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding-top:24px;border-top:1px solid #efede4;margin-top:24px"></td></tr><tr><td align="center" style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:12px;color:#8a887f;line-height:1.7">${esc(params.businessName)}<br />${contactBits.join('<br />')}</td></tr></table>` : ''}
    `),
  });
}

/** Alert the business when a private (≤4★) review comes in. */
export async function sendBadReviewAlertEmail(params: {
  to: string;
  locationName: string;
  stars: number;
  feedback: string;
  dashboardUrl?: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: `New ${params.stars}-star feedback for ${params.locationName}`,
    html: shell(
      `<p style="margin:0">You received a <strong>${params.stars}-star</strong> private review for <strong>${esc(params.locationName)}</strong>.</p><p style="margin:16px 0 0"><strong>What they said:</strong></p><blockquote style="border-left:3px solid #ddd;margin:8px 0;padding:4px 14px;color:#444">${esc(params.feedback || '(no message provided)')}</blockquote><p style="font-size:13px;color:#666">This was submitted privately and will not appear on any public platform.</p>${params.dashboardUrl ? `<p style="margin-top:20px"><a href="${esc(params.dashboardUrl)}" style="color:#0e0e0c">Open your dashboard →</a></p>` : ''}`,
    ),
  });
}
