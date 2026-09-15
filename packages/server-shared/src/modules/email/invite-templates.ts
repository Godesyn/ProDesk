/**
 * Standalone (non-common-template) invite emails — verbatim ports of
 * functions/src/modules/email/templates/agency_invite_template.ts and
 * referral_invite_template.ts. These keep their own black-header layout (no
 * agency branding) to match production exactly.
 */

export interface AgencyInviteEmailData {
  inviterName: string;
  email: string;
  signupUrl: string;
  isBrand?: boolean;
  isExistingUser?: boolean;
}

export function buildAgencyInviteTemplate(data: AgencyInviteEmailData) {
  const subject = `${data.inviterName} invited you to join Prodesk${data.isBrand ? '' : ' as an Agency'}`;
  const link = `${data.signupUrl}&email=${encodeURIComponent(data.email)}`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Invitation to Prodesk</title>
</head>
<body style="margin:0;padding:0;background:#F5F6FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6FA;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr>
            <td style="background:#111111;padding:32px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Prodesk</h1>
              <p style="color:rgba(255,255,255,0.55);margin:6px 0 0;font-size:13px;letter-spacing:0.5px;">The Project Operating System</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#9CA3AF;letter-spacing:1px;text-transform:uppercase;">You're Invited</p>
              <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Join Prodesk${data.isBrand ? '' : ' as an Agency'}</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6;">
                <strong style="color:#111827;">${data.inviterName}</strong> has invited you to ${data.isExistingUser ? 'collaborate with them on' : 'join'}
                <strong style="color:#111827;">Prodesk</strong> &mdash; the all-in-one platform ${
                  data.isBrand
                    ? 'to collaborate on projects, track deliverables, and manage payments effortlessly.'
                    : `for
                agencies to manage projects, proposals, and clients effortlessly.`
                }
              </p>
              ${
                data.isBrand
                  ? ''
                  : `
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;border:1px solid #E5E7EB;margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <p style="margin:0 0 12px;font-size:11px;font-weight:700;color:#9CA3AF;letter-spacing:1px;text-transform:uppercase;">What you get with Prodesk</p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">&nbsp;Showcase your services on the Infin8 Marketplace</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">&nbsp;Manage clients, projects &amp; deliverables in one place</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">&nbsp;Send branded proposals and get paid faster</td></tr>
                      <tr><td style="padding:6px 0;font-size:14px;color:#374151;">&nbsp;Collaborate with contractors and clients seamlessly</td></tr>
                    </table>
                  </td>
                </tr>
              </table>
              `
              }
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${link}"
                       style="display:inline-block;background:#111111;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      ${data.isExistingUser ? (data.isBrand ? 'Accept Invitation & Create Brand &rarr;' : 'Accept Invitation &rarr;') : 'Accept Invitation &amp; Sign Up &rarr;'}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.5;">
                Or copy this link into your browser:<br/>
                <a href="${link}" style="color:#111827;font-size:11px;word-break:break-all;">${data.signupUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
                If you didn't expect this invitation, you can safely ignore this email.<br/>
                &copy; 2026 Prodesk. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

export interface ReferralInviteEmailData {
  inviterName: string;
  email: string;
  signupUrl: string;
}

export function buildReferralInviteTemplate(data: ReferralInviteEmailData) {
  const subject = `${data.inviterName} invited you to join Prodesk`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Invitation to Prodesk</title>
</head>
<body style="margin:0;padding:0;background:#F5F6FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6FA;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
          <tr>
            <td style="background:#111111;padding:32px 40px;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:26px;font-weight:700;letter-spacing:-0.5px;">Prodesk</h1>
              <p style="color:rgba(255,255,255,0.55);margin:6px 0 0;font-size:13px;letter-spacing:0.5px;">The Project Operating System</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#9CA3AF;letter-spacing:1px;text-transform:uppercase;">You're Invited</p>
              <h2 style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Join Prodesk</h2>
              <p style="margin:0 0 24px;font-size:15px;color:#6B7280;line-height:1.6;">
                <strong style="color:#111827;">${data.inviterName}</strong> has invited you to join
                <strong style="color:#111827;">Prodesk</strong> &mdash; the all-in-one platform to collaborate on projects, track deliverables, and manage payments effortlessly.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${data.signupUrl}"
                       style="display:inline-block;background:#111111;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.2px;">
                      Accept Invitation &amp; Sign Up &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.5;">
                Or copy this link into your browser:<br/>
                <a href="${data.signupUrl}" style="color:#111827;font-size:11px;word-break:break-all;">${data.signupUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#F9FAFB;padding:20px 40px;text-align:center;border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
                If you didn't expect this invitation, you can safely ignore this email.<br/>
                &copy; 2026 Prodesk. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, html };
}
