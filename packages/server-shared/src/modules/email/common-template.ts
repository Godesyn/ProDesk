/**
 * Shared branded HTML email shell — a faithful port of
 * functions/src/modules/email/templates/common_template.ts so in-folder emails
 * render identically to production: accent header, agency signature block,
 * social icons, and footer unsubscribe link.
 */

export interface AgencyDetails {
  name: string | null;
  social?: {
    facebookUrl?: string | null;
    xUrl?: string | null;
    instagramUrl?: string | null;
  } | null;
  businessEmail?: string | null;
  address?: string | null;
  phone?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  themeAccent?: number | string | null;
}

function getAccentColor(themeAccent?: number | string | null): string {
  if (themeAccent == null) return '#111111';
  let num: number;
  if (typeof themeAccent === 'string') {
    // Allow hex strings (e.g. "#2e9e58") to pass straight through.
    if (themeAccent.startsWith('#')) return themeAccent;
    num = parseInt(themeAccent, 10);
  } else {
    num = themeAccent;
  }
  if (isNaN(num)) return '#111111';

  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export const buildCommonTemplate = (data: {
  title: string;
  subtitle: string;
  body: string;
  unsubscribeUrl: string;
  applicationUrl: string;
  redirectUrl?: { url: string; cta: string };
  agencyDetails?: AgencyDetails;
  moreContent?: string;
  overrideAgencyName?: string; // In place of Agency Name in header
}) => {
  const accentColor = getAccentColor(data.agencyDetails?.themeAccent);

  // Gmail collapses content it considers "quoted" — i.e. a block that repeats
  // identically across messages from the same sender (our header, CTA button,
  // signature and footer are byte-identical every send). That hides the CTA (e.g.
  // the chat digest's "Open chat" button) behind "show trimmed content". A unique,
  // invisible token at the very end breaks that identical-trailing-block match so
  // the whole email — CTA included — always renders.
  const antiTrimToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${data.title}</title>
</head>
<body style="margin:0;padding:0;background:#F5F6FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6FA;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">

          <!-- Header -->
          <tr>
            <td style="background:${accentColor};padding:32px 40px;text-align:center;">
              <a href="${data.applicationUrl}" style="text-decoration:none;display:inline-block;">
                <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">${data.overrideAgencyName || data.agencyDetails?.name || ''} </h1>
              </a>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 16px;">
              <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">${
                data.title
              } </h2>
              ${
                data.subtitle
                  ? `<p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#9CA3AF;letter-spacing:1px;text-transform:uppercase;">${data.subtitle}</p>`
                  : ''
              } 
              <div style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6;">
                ${data.body}
              </div>

              ${
                data.moreContent
                  ? data.moreContent
                  : data.redirectUrl
                    ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px; margin-bottom:24px;">
                <tr>
                  <td align="left">
                    <a href="${data.redirectUrl.url}"
                       style="display:inline-block;background:${accentColor};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      ${data.redirectUrl.cta}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;line-height:1.5;">
                Or copy this link into your browser:<br/>
                <a href="${data.redirectUrl.url}" style="color:#111827;font-size:11px;word-break:break-all;">${data.redirectUrl.url}</a>
              </p>
              `
                    : ''
              }
${
  data.agencyDetails
    ? ` <!-- Agency Signature -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;padding-top:24px;">
                <tr>
                  <td align="left">
                    <div style="width:56px;border-top:1px solid #E5E7EB;margin-bottom:24px;"></div>
                    ${
                      data.agencyDetails.logoUrl
                        ? `<img src="${data.agencyDetails.logoUrl}" alt="${data.agencyDetails.name || ''} logo" style="max-height:48px;max-width:150px;display:block;margin:0 0 12px;object-fit:contain;" />`
                        : `<table cellpadding="0" cellspacing="0" style="margin:0 0 12px;border-collapse:collapse;"><tr><td style="width:48px;height:48px;border-radius:50%;background:#F3F4F6;text-align:center;vertical-align:middle;font-size:20px;font-weight:700;color:#9CA3AF;">${data.agencyDetails.name ? data.agencyDetails.name.charAt(0).toUpperCase() : ''}</td></tr></table>`
                    }
                    <p style="margin:0;font-size:14px;font-weight:600;color:#111827;">Best Regards,</p>
                    <p style="margin:4px 0 0;font-size:14px;color:#6B7280;">The ${data.agencyDetails.name ? data.agencyDetails.name.substring(0, 1).toUpperCase() + data.agencyDetails.name.substring(1) : ''} Team</p>
                    ${
                      data.agencyDetails.website ||
                      data.agencyDetails.businessEmail ||
                      data.agencyDetails.phone ||
                      data.agencyDetails.address
                        ? `<div style="margin-top:12px;">
                            ${data.agencyDetails.website ? `<p style="margin:0 0 4px;font-size:13px;color:#6B7280;"><a href="${data.agencyDetails.website.startsWith('http') ? data.agencyDetails.website : 'https://' + data.agencyDetails.website}" style="color:#6B7280;text-decoration:none;">${data.agencyDetails.website}</a></p>` : ''}
                            ${data.agencyDetails.businessEmail ? `<p style="margin:0 0 4px;font-size:13px;color:#6B7280;"><a href="mailto:${data.agencyDetails.businessEmail}" style="color:#6B7280;text-decoration:none;">${data.agencyDetails.businessEmail}</a></p>` : ''}
                            ${data.agencyDetails.phone ? `<p style="margin:0 0 4px;font-size:13px;color:#6B7280;"><a href="tel:${data.agencyDetails.phone}" style="color:#6B7280;text-decoration:none;">${data.agencyDetails.phone}</a></p>` : ''}
                            ${data.agencyDetails.address ? `<p style="margin:0;font-size:13px;color:#6B7280;">${data.agencyDetails.address}</p>` : ''}
                           </div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>

            </td>
          </tr>`
    : ''
}

          <!-- Footer -->
          <tr>
            <td style="background:#F9FAFB;padding:12px 40px 16px;text-align:center;border-top:1px solid #E5E7EB;">
              <!-- Social Links -->
              ${
                data.agencyDetails &&
                (data.agencyDetails.social?.facebookUrl ||
                  data.agencyDetails.social?.xUrl ||
                  data.agencyDetails.social?.instagramUrl)
                  ? `
              <div style="margin-bottom:16px;">
                ${
                  data.agencyDetails.social?.facebookUrl
                    ? `<a href="${data.agencyDetails.social.facebookUrl}" style="margin:0 8px;text-decoration:none;display:inline-block;"><img src="https://braze-images.com/appboy/communication/assets/image_assets/images/6722690cd6492200640c3585/original.png?1730308363" alt="Facebook" style="width:24px;height:24px;border:none;"/></a>`
                    : ''
                }
                ${
                  data.agencyDetails.social?.xUrl
                    ? `<a href="${data.agencyDetails.social.xUrl}" style="margin:0 8px;text-decoration:none;display:inline-block;"><img src="https://braze-images.com/appboy/communication/assets/image_assets/images/6722690ce09e220063148c8f/original.png?1730308364" alt="X" style="width:24px;height:24px;border:none;"/></a>`
                    : ''
                }
                ${
                  data.agencyDetails.social?.instagramUrl
                    ? `<a href="${data.agencyDetails.social.instagramUrl}" style="margin:0 8px;text-decoration:none;display:inline-block;"><img src="https://braze-images.com/appboy/communication/assets/image_assets/images/6722690c3fa5aa00648ed709/original.png?1730308363" alt="Instagram" style="width:24px;height:24px;border:none;"/></a>`
                    : ''
                }
              </div>
              `
                  : ''
              }
              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5;">
                ${
                  data.unsubscribeUrl
                    ? `<a href="${data.unsubscribeUrl}" style="color:#9CA3AF;text-decoration:underline;margin-top:8px;display:inline-block;">Unsubscribe from these emails</a>`
                    : ''
                }
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <!-- Unique, invisible token so Gmail never treats this email's CTA + footer as
       repeated/quoted content and collapses them behind "show trimmed content". -->
  <div style="display:none !important;max-height:0;width:0;overflow:hidden;mso-hide:all;font-size:0;line-height:0;color:transparent;">ref:${antiTrimToken}</div>
</body>
</html>
  `;
  return html;
};
