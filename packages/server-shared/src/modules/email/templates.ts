import { buildCommonTemplate, type AgencyDetails } from './common-template.js';
import { appBaseUrl, PRODESK_BRANDING } from './branding.js';
import { formatPrice } from '../../lib/num.js';

/**
 * Transactional email templates — all rendered through the shared
 * buildCommonTemplate shell so they match production
 * (functions/src/modules/email/templates/*). Each template accepts optional
 * `agencyDetails` (the sending org's branding) + `unsubscribeUrl`; the worker
 * resolves those and the matching unsubscribe `channel` per send.
 */

/** Common optional branding fields threaded into every template. */
interface Brandable {
  agencyDetails?: AgencyDetails;
  unsubscribeUrl?: string;
}

const app = appBaseUrl();

/** Currency for the financial-breakdown blocks — no trailing `.00` on whole amounts. */
function money(n: number): string {
  return formatPrice(n);
}

/** Shared weekly-amount breakdown block (partial-refund / cancellation-request). */
function weeklyBreakdown(d: {
  currentWeeklyAmount?: number;
  projectWeeklyAmount?: number;
  newWeeklyAmount?: number;
}): string {
  if (
    d.currentWeeklyAmount === undefined ||
    d.projectWeeklyAmount === undefined ||
    d.newWeeklyAmount === undefined ||
    d.projectWeeklyAmount <= 0
  )
    return '';
  return `<div style="background-color: rgba(33, 150, 243, 0.04); border: 1px solid rgba(33, 150, 243, 0.2); border-radius: 8px; padding: 12px; margin: 16px 0;">
  <p style="margin: 0 0 4px 0; font-size: 13px;">Current Weekly Total: ${money(d.currentWeeklyAmount)}</p>
  <p style="margin: 0 0 8px 0; font-size: 13px; color: #dc3545; font-weight: 500;">Amount to Remove: -${money(d.projectWeeklyAmount)}</p>
  <hr style="border: 0; border-top: 1px solid rgba(33, 150, 243, 0.2); margin: 12px 0;">
  <p style="margin: 0; font-size: 14px; font-weight: bold;">New Weekly Total: ${money(Math.max(0, d.newWeeklyAmount))}</p>
</div>`;
}

/** Deliverable item as rendered in the completion-request email. */
export interface DeliverableSummary {
  fileName?: string | null;
  description?: string | null;
  content?: string | null;
}

/** Bulleted list of every deliverable sent to a project (completion request). */
function deliverablesBlock(items?: DeliverableSummary[]): string {
  if (!items || items.length === 0) return '';
  const rows = items
    .map((it) => {
      const name = (it.fileName || it.description || it.content || 'Deliverable')
        .toString()
        .trim();
      return `<li style="margin:0 0 6px 0;font-size:14px;color:#374151;">${name}</li>`;
    })
    .join('');
  return `<div style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:16px 20px;margin:16px 0;">
  <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;color:#9CA3AF;letter-spacing:1px;text-transform:uppercase;">Deliverables</p>
  <ul style="margin:0;padding-left:20px;">${rows}</ul>
</div>`;
}

/** Money with an explicit currency code — beta reports may not be in AUD. */
function formatMoneyWithCurrency(n: number, currency: string): string {
  return `${money(n)} ${currency.toUpperCase()}`;
}

/** One product row of the beta price report, as the email renders it. */
export interface BetaReportEmailLine {
  productName: string;
  /** Per-unit rate for a metered tool, or the flat monthly fee. */
  unitAmount: number;
  quantity: number;
  monthlyAmount: number;
  perUnit: boolean;
  /** What the quantity counts, e.g. `active link`. Null for a flat fee. */
  unitNoun: string | null;
  /** What they did with the tool, e.g. `7 links created, 3 active`. */
  usageDetail: string | null;
  /** Already on a paid plan — shown as covered, excluded from the total. */
  alreadySubscribed: boolean;
}

/**
 * The itemised beta report table. Built as a real <table> with inline styles (not
 * a flex/grid layout) because that is the only layout Outlook and the Gmail app
 * both render predictably.
 *
 * Every figure is passed in already computed by modules/beta/report.ts — this
 * function does no arithmetic beyond rendering, so the email can't drift from the
 * in-app screen.
 */
function betaReportBlock(
  lines: BetaReportEmailLine[],
  monthlyTotal: number,
  currency: string,
): string {
  if (lines.length === 0) return '';
  const rows = lines
    .map((l) => {
      const rate = l.perUnit
        ? `${money(l.unitAmount)} × ${l.quantity} ${l.unitNoun ?? 'unit'}${l.quantity === 1 ? '' : 's'}`
        : `${money(l.unitAmount)} / month`;
      const amount = l.alreadySubscribed
        ? `<span style="color:#059669;font-weight:600;">Already active</span>`
        : `<strong>${money(l.monthlyAmount)}</strong>`;
      return `<tr>
  <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;">
    <div style="font-size:14px;font-weight:600;color:#111827;">${l.productName}</div>
    <div style="font-size:12px;color:#6B7280;margin-top:2px;">${rate}${
      l.usageDetail ? ` &middot; ${l.usageDetail}` : ''
    }</div>
  </td>
  <td style="padding:12px 0;border-bottom:1px solid #E5E7EB;text-align:right;font-size:14px;color:#111827;white-space:nowrap;">${amount}</td>
</tr>`;
    })
    .join('');
  return `<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:20px 24px;margin:20px 0;">
  <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;color:#9CA3AF;letter-spacing:1px;text-transform:uppercase;">What you'll pay each month</p>
  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">${rows}
  <tr>
    <td style="padding:16px 0 0 0;font-size:15px;font-weight:700;color:#111827;">Total per month</td>
    <td style="padding:16px 0 0 0;text-align:right;font-size:15px;font-weight:700;color:#111827;white-space:nowrap;">${formatMoneyWithCurrency(monthlyTotal, currency)}</td>
  </tr>
  </table>
  <p style="margin:14px 0 0 0;font-size:12px;color:#6B7280;line-height:1.6;">Usage-based tools are billed on what's live at the time — the quantities above are today's. You can cancel any tool from your Subscriptions tab at any point, and you're never charged for a tool you don't keep.</p>
</div>`;
}

export const templates = {
  /** Staff invitation (ports staff_invite_template.ts). */
  staffInvite: (
    d: { orgName: string; name?: string; signupUrl?: string } & Brandable,
  ) => ({
    subject: `Invitation to join ${d.orgName}`,
    html: buildCommonTemplate({
      title: 'Staff Invitation',
      applicationUrl: app,
      subtitle: `Hi ${d.name ?? 'there'}`,
      body: `${d.orgName} has invited you to join their organization. Click the link below to accept the invitation and accept staff invitation.`,
      redirectUrl: {
        url: d.signupUrl ?? `${app}/signup`,
        cta: 'Accept Invitation &rarr;',
      },
      agencyDetails: d.agencyDetails ?? { name: d.orgName },
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Contractor invitation (ports staff_invite_template.ts isContractor variant). */
  contractorInvite: (
    d: {
      agencyName?: string;
      name?: string;
      signupUrl?: string;
      note?: string;
    } & Brandable,
  ) => ({
    subject: `Invitation to join ${d.agencyName ?? 'an agency'}`,
    html: buildCommonTemplate({
      title: 'Contractor Invitation',
      applicationUrl: app,
      subtitle: `Hi ${d.name ?? 'there'}`,
      body:
        `${d.agencyName ?? 'An agency'} has invited you to join their organization. Click the link below to accept the invitation and accept contractor invitation.` +
        (d.note
          ? `<div style="margin-top:12px;padding:12px;background:#F3F4F6;border-radius:8px;color:#374151;">${d.note}</div>`
          : ''),
      redirectUrl: {
        url: d.signupUrl ?? `${app}/signup?createContractorIfNotAlready=true`,
        cta: 'Accept Invitation &rarr;',
      },
      agencyDetails: d.agencyDetails ?? { name: d.agencyName ?? 'Prodesk' },
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /**
   * Consumer messenger invite — someone tried to message an address with no
   * Prodesk account yet (clients/chat). Deliberately the plainest invite in the
   * file: it is a person saying hello, not an organisation onboarding you, so it
   * names the person, says nothing about the product, and never quotes the
   * message they were trying to send (they wrote it before this address was
   * confirmed to be a real inbox).
   */
  chatInvite: (
    d: {
      inviterName?: string;
      signupUrl?: string;
      /** The messenger's own base URL — see branding.ts#chatBaseUrl. */
      appUrl: string;
    } & Brandable,
  ) => ({
    subject: `${d.inviterName ?? 'Someone'} wants to message you on Prodesk`,
    html: buildCommonTemplate({
      title: 'A message is waiting',
      applicationUrl: d.appUrl,
      subtitle: 'Hi there',
      body: `${d.inviterName ?? 'Someone'} tried to start a conversation with you on Prodesk, but there is no account on this address yet. Create one and the conversation will be waiting.`,
      redirectUrl: {
        url: d.signupUrl ?? `${d.appUrl}/signup`,
        cta: 'Create your account &rarr;',
      },
      agencyDetails: d.agencyDetails ?? { name: 'Prodesk' },
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Brand–agency connection request notification. */
  connectionRequest: (d: { agencyName?: string } & Brandable) => ({
    subject: `${d.agencyName ?? 'An agency'} wants to connect on Prodesk`,
    html: buildCommonTemplate({
      title: 'New connection request',
      applicationUrl: app,
      subtitle: 'Connection request',
      body: `<strong>${d.agencyName ?? 'An agency'}</strong> would like to work with you on Prodesk.`,
      redirectUrl: { url: `${app}/agencies`, cta: 'Review request &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Agency added by a brand (ports agency_added_by_brand.ts). */
  agencyAddedByBrand: (
    d: { brandName: string; agencyName?: string } & Brandable,
  ) => ({
    subject: `Connected by ${d.brandName}`,
    html: buildCommonTemplate({
      title: `Connected by ${d.brandName}`,
      applicationUrl: app,
      subtitle: `Hi ${d.agencyName ?? 'there'}`,
      body: `${d.brandName} has added you as an agency. You might want to reach out to them.`,
      redirectUrl: { url: `${app}/clients`, cta: 'View Clients &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  proposalAccepted: (d: { title: string; brandName?: string } & Brandable) => ({
    subject: `Proposal accepted: ${d.title}`,
    html: buildCommonTemplate({
      title: 'Your proposal was accepted',
      applicationUrl: app,
      subtitle: 'Proposal update',
      body: `<strong>${d.brandName ?? 'The client'}</strong> accepted the proposal “<strong>${d.title}</strong>”. They can now proceed to payment.`,
      redirectUrl: { url: `${app}/proposals`, cta: 'View proposal &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  proposalRejected: (d: { title: string; brandName?: string } & Brandable) => ({
    subject: `Proposal declined: ${d.title}`,
    html: buildCommonTemplate({
      title: 'Your proposal was declined',
      applicationUrl: app,
      subtitle: 'Proposal update',
      body: `<strong>${d.brandName ?? 'The client'}</strong> declined the proposal “<strong>${d.title}</strong>”.`,
      redirectUrl: { url: `${app}/proposals`, cta: 'View proposal &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  proposalChangeRequested: (
    d: { title: string; brandName?: string; note?: string } & Brandable,
  ) => ({
    subject: `Changes requested: ${d.title}`,
    html: buildCommonTemplate({
      title: 'The client requested changes',
      applicationUrl: app,
      subtitle: 'Proposal update',
      body:
        `<strong>${d.brandName ?? 'The client'}</strong> requested changes to “<strong>${d.title}</strong>”.` +
        (d.note
          ? `<div style="margin-top:12px;padding:12px;background:#F3F4F6;border-radius:8px;color:#374151;">${d.note}</div>`
          : ''),
      redirectUrl: { url: `${app}/proposals`, cta: 'Edit & resend &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Digital product ready (ports digital_product_template.ts). File is attached by the worker. */
  digitalProduct: (
    d: {
      brandName?: string;
      serviceName: string;
      fileUrl: string;
      fileName?: string;
    } & Brandable,
  ) => ({
    subject: `Your Digital Product for ${d.serviceName}`,
    html: buildCommonTemplate({
      title: `Purchased ${d.serviceName}`,
      applicationUrl: app,
      subtitle: `Hi ${d.brandName ?? 'there'}`,
      body: 'Your digital product is ready. You can download it using the link below.',
      redirectUrl: {
        url: d.fileUrl,
        cta: `Download ${d.fileName ?? d.serviceName} &rarr;`,
      },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /**
   * Soft-delete confirmation. Branches like production into a partial-refund
   * variant (refundAmount > 0 → partial_refund_template.ts) and a
   * cancellation-request variant (no refund → cancel_subscription_request_template.ts).
   */
  softDeleteConfirm: (
    d: {
      projectTitle: string;
      agencyName?: string;
      refundAmount?: number;
      confirmUrl: string;
      currentWeeklyAmount?: number;
      projectWeeklyAmount?: number;
      newWeeklyAmount?: number;
      brandName?: string;
    } & Brandable,
  ) => {
    const isRefund = (d.refundAmount ?? 0) > 0;
    const hi = `Hi ${d.brandName ?? 'there'}`;
    if (isRefund) {
      return {
        subject: `Refund Proposed - ${d.projectTitle}`,
        html: buildCommonTemplate({
          title: 'Partial Refund',
          applicationUrl: app,
          subtitle: d.projectTitle,
          body: `${hi},<br/><br/>The agency has proposed a refund of <strong>${money(d.refundAmount ?? 0)}</strong> for your project.${weeklyBreakdown(d)}<br/>Please click the button below to accept the refund and cancel the project.`,
          redirectUrl: { url: d.confirmUrl, cta: 'View Refund &rarr;' },
          agencyDetails: d.agencyDetails,
          unsubscribeUrl: d.unsubscribeUrl ?? '',
        }),
      };
    }
    return {
      subject: `Cancellation Request - ${d.projectTitle}`,
      html: buildCommonTemplate({
        title: 'Cancel Subscription Request',
        applicationUrl: app,
        subtitle: d.projectTitle,
        body: `${hi},<br/><br/>Are you sure you want to cancel the subscription for <strong>${d.projectTitle}</strong>?${weeklyBreakdown(d)}<p style="font-style: italic; color:#6B7280;">You acknowledge that by cancelling, no further work will be completed in this project and no refunds will be issued.</p>Please click the button below to confirm subscription cancellation.`,
        redirectUrl: { url: d.confirmUrl, cta: 'Confirm Cancellation &rarr;' },
        agencyDetails: d.agencyDetails,
        unsubscribeUrl: d.unsubscribeUrl ?? '',
      }),
    };
  },

  /**
   * Project completion / approval request (ports request_completion_template.ts).
   * When `confirmUrl` is supplied the CTA is a one-click "Complete & Release" link
   * (the /confirm/complete token endpoint, valid 10 days); otherwise it falls back
   * to the brand-projects review screen.
   */
  projectCompletionRequest: (
    d: {
      projectTitle: string;
      agencyName?: string;
      brandName?: string;
      toPayAmount?: number;
      confirmUrl?: string;
      deliverables?: DeliverableSummary[];
    } & Brandable,
  ) => {
    const oneClick = !!d.confirmUrl;
    const hasPayment = d.toPayAmount !== undefined;
    const cta = oneClick
      ? hasPayment
        ? 'Complete & Release Payment &rarr;'
        : 'Approve & Complete &rarr;'
      : 'Review project &rarr;';
    const intro = oneClick
      ? `By pressing '${hasPayment ? 'Complete & Release Payment' : 'Approve & Complete'}' below, you confirm that <strong>${d.agencyName ?? 'your agency'}</strong> has completed “<strong>${d.projectTitle}</strong>”` +
        (hasPayment ? ` and you release payment to the agency` : '') +
        `. This link expires in 10 days.`
      : `<strong>${d.agencyName ?? 'Your agency'}</strong> has marked “<strong>${d.projectTitle}</strong>” as ready for your review.` +
        (hasPayment ? ` Approving will release payment to the agency.` : '') +
        ` Review the deliverables and approve or request changes.`;
    // Reject path is intentionally passive: there's no decline button — the
    // brand simply ignores the email and reaches out to the agency directly.
    const rejectNote = `<p style="margin:16px 0 0;font-style:italic;color:#6B7280;">If you'd like to reject this request, simply ignore this email and contact ${d.agencyName ?? 'the agency'} directly.</p>`;
    const body = intro + deliverablesBlock(d.deliverables) + rejectNote;
    return {
      subject: `Confirm Completion for ${d.projectTitle}`,
      html: buildCommonTemplate({
        title: 'Completion Request',
        applicationUrl: app,
        subtitle: `Hi ${d.brandName ?? 'there'}`,
        body,
        redirectUrl: { url: d.confirmUrl ?? `${app}/brand-projects`, cta },
        agencyDetails: d.agencyDetails,
        unsubscribeUrl: d.unsubscribeUrl ?? '',
      }),
    };
  },

  /** Task assignment (ports task_email_template.ts). Channel: 'task'. */
  taskAssigned: (
    d: {
      taskTitle: string;
      assignerName?: string;
      name?: string | null;
      email: string;
    } & Brandable,
  ) => ({
    subject: `New Task Assigned: ${d.taskTitle}`,
    html: buildCommonTemplate({
      title: `Task assigned${d.assignerName ? ` by ${d.assignerName}` : ''}`,
      applicationUrl: app,
      subtitle: `Hi ${d.name ?? d.email.split('@')[0]}`,
      body: `You have been assigned a new task: “<strong>${d.taskTitle}</strong>”. Click the link below to view it in your dashboard.`,
      redirectUrl: { url: `${app}/tasks`, cta: 'View Task &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Offline chat digest (ports chat_digest_template.ts). Channel: 'chat'. */
  chatDigest: (
    d: {
      name?: string | null;
      email: string;
      /**
       * The messenger's base URL (branding.ts#chatBaseUrl). EVERY link in this
       * email is built from it, so a chat notification lands in chat rather than
       * on a route of the main app that isn't the messenger at all.
       */
      appUrl: string;
      threads: {
        /** Deep-link target — the tile opens this conversation, not the inbox. */
        threadId: string;
        threadName: string;
        unreadCount: number;
        lastMessage: string;
        lastSenderName?: string;
        /** Counterparty avatar/logo (brand logo, user photo, …); falls back to
         *  initials of the thread name when absent. Mirrors the chat list. */
        avatarUrl?: string | null;
      }[];
      /**
       * Pending message requests — people the recipient shares no conversation
       * with. Counted, never previewed: anyone can be found by email address, so
       * quoting a stranger's words into an inbox would turn the request queue
       * into a way to email people who have not agreed to hear from you.
       */
      requestCount?: number;
    } & Brandable,
  ) => {
    const totalUnread = d.threads.reduce((s, t) => s + t.unreadCount, 0);
    const requestCount = d.requestCount ?? 0;
    const greeting = d.name ?? d.email.split('@')[0] ?? 'there';
    // First letters of the first two words (matches the in-app initials avatar).
    const initialsOf = (name: string) => {
      const parts = name.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '?';
      const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
      return letters.toUpperCase();
    };
    // 34px rounded avatar: real image when available, otherwise an initials chip.
    const avatarCell = (t: { threadName: string; avatarUrl?: string | null }) =>
      t.avatarUrl
        ? `<img src="${t.avatarUrl}" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border-radius:8px;object-fit:cover;border:1px solid #E5E7EB;" />`
        : `<table cellpadding="0" cellspacing="0" style="width:34px;height:34px;border-radius:8px;background:#111111;"><tr><td align="center" valign="middle" style="width:34px;height:34px;color:#ffffff;font-size:13px;font-weight:700;text-align:center;">${initialsOf(t.threadName)}</td></tr></table>`;
    // Each tile is a LINK to its own conversation. "Open chat" at the bottom
    // drops you in the inbox with the same list you already just read; the
    // thing someone wants after reading "Priya · 4" is Priya.
    const chatUrl = d.appUrl.replace(/\/$/, '');
    const tiles = d.threads
      .map((t) => {
        const badge = t.unreadCount > 10 ? '10+' : String(t.unreadCount);
        const sender = t.lastSenderName
          ? `<strong>${t.lastSenderName}:</strong> `
          : '';
        return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px solid #E5E7EB;border-radius:10px;background:#fff;"><tr><td style="padding:0;">
          <a href="${chatUrl}/t/${t.threadId}" style="display:block;padding:12px 14px;text-decoration:none;color:inherit;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td valign="top" width="34" style="width:34px;padding-right:12px;">${avatarCell(t)}</td>
            <td valign="top">
              <table width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="font-weight:700;color:#111827;font-size:14px;">${t.threadName}</td>
                <td align="right"><span style="background:#111111;color:#fff;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;">${badge}</span></td>
              </tr></table>
              <div style="margin-top:6px;font-size:13px;color:#6B7280;">${sender}${t.lastMessage}</div>
            </td>
          </tr></table>
          </a>
        </td></tr></table>`;
      })
      .join('');
    // One muted line, no names and no words — enough to know the queue is not
    // empty, not enough to be a delivery channel for strangers.
    const requestTile = requestCount
      ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px;border:1px dashed #D1D5DB;border-radius:10px;background:#FAFAFA;"><tr><td style="padding:0;">
          <a href="${chatUrl}/requests" style="display:block;padding:12px 14px;font-size:13px;color:#6B7280;text-decoration:none;">
          <strong style="color:#111827;">${requestCount} message request${requestCount === 1 ? '' : 's'}</strong> from ${requestCount === 1 ? 'someone you' : 'people you'} haven't spoken to yet. Open chat to read ${requestCount === 1 ? 'it' : 'them'}.
          </a>
        </td></tr></table>`
      : '';
    const subject = totalUnread
      ? `You have ${totalUnread} new message${totalUnread === 1 ? '' : 's'} from ${d.threads.length} chat${d.threads.length === 1 ? '' : 's'}`
      : `You have ${requestCount} new message request${requestCount === 1 ? '' : 's'}`;
    const subtitle = [
      totalUnread ? `${totalUnread} message${totalUnread === 1 ? '' : 's'} · ${d.threads.length} chat${d.threads.length === 1 ? '' : 's'}` : '',
      requestCount ? `${requestCount} request${requestCount === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      subject,
      html: buildCommonTemplate({
        title: 'New messages on Prodesk',
        applicationUrl: chatUrl,
        subtitle,
        body: `<p style="margin:0 0 16px;">Hi ${greeting}, here's what you've missed.</p>${tiles}${requestTile}`,
        redirectUrl: { url: chatUrl, cta: 'Open chat &rarr;' },
        agencyDetails: d.agencyDetails ?? PRODESK_BRANDING,
        unsubscribeUrl: d.unsubscribeUrl ?? '',
      }),
    };
  },

  /** Payment failed — brand variant (ports payment_failed_template.ts). */
  paymentFailedBrand: (
    d: { brandName: string; purchaseId: string } & Brandable,
  ) => ({
    subject: `Payment Failed for purchase ${d.purchaseId}`,
    html: buildCommonTemplate({
      title: 'Payment Unsuccessful',
      applicationUrl: app,
      subtitle: `Hi ${d.brandName}, Hope to find you in good spirits`,
      body: `Payment was unsuccessful for your purchase <strong>${d.purchaseId}</strong>. Please make sure there is enough balance in the corresponding card within the next 24hrs to avoid any service disruption.`,
      redirectUrl: { url: `${app}/projects`, cta: 'Visit Application &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Payment failed — agency variant. */
  paymentFailedAgency: (
    d: {
      brandName: string;
      brandEmail?: string;
      purchaseId: string;
    } & Brandable,
  ) => ({
    subject: `${d.brandName} failed to make payment for purchase ${d.purchaseId}`,
    html: buildCommonTemplate({
      title: 'Payment Unsuccessful',
      applicationUrl: app,
      subtitle: 'Payment Unsuccessful',
      body: `Payment was unsuccessful for purchase <strong>${d.purchaseId}</strong>. A warning email has been sent to ${d.brandName}'s email${d.brandEmail ? ` (${d.brandEmail})` : ''} so they can make sure there is enough balance in the corresponding card within the next 24hrs to avoid any service disruption. Until then the project will not be reset to brief.`,
      redirectUrl: { url: `${app}/projects`, cta: 'Visit Application &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Subscription cancelled — brand variant (ports cancel_subscription_template.ts). */
  cancelSubscriptionBrand: (
    d: { brandName: string; serviceName: string } & Brandable,
  ) => ({
    subject: `Subscription Cancelled for ${d.serviceName}`,
    html: buildCommonTemplate({
      title: 'Cancelled Subscription',
      applicationUrl: app,
      subtitle: `Hi ${d.brandName}`,
      body: `Your subscription for <strong>${d.serviceName}</strong> has been successfully cancelled and the weekly deductions have been stopped for this service.`,
      redirectUrl: { url: `${app}/projects`, cta: 'Visit Application &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Subscription cancelled — agency variant. */
  cancelSubscriptionAgency: (
    d: {
      brandName: string;
      serviceName: string;
      agencyName?: string;
    } & Brandable,
  ) => ({
    subject: `Subscription Cancelled by ${d.brandName} for ${d.serviceName}`,
    html: buildCommonTemplate({
      title: 'Cancelled Subscription',
      applicationUrl: app,
      subtitle: `Hi ${d.agencyName ?? 'there'}`,
      body: `${d.brandName}'s subscription for <strong>${d.serviceName}</strong> has been successfully cancelled and the weekly deductions have been stopped for the service.`,
      redirectUrl: { url: `${app}/projects`, cta: 'Visit Application &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Subscription cancellation reverted ("continue") — brand variant. */
  resumeSubscriptionBrand: (
    d: { brandName: string; serviceName: string } & Brandable,
  ) => ({
    subject: `Subscription Resumed for ${d.serviceName}`,
    html: buildCommonTemplate({
      title: 'Subscription Resumed',
      applicationUrl: app,
      subtitle: `Hi ${d.brandName}`,
      body: `Good news — the scheduled cancellation for <strong>${d.serviceName}</strong> has been reverted. Your subscription stays active and weekly billing continues as normal.`,
      redirectUrl: { url: `${app}/projects`, cta: 'Visit Application &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Subscription cancellation reverted ("continue") — agency variant. */
  resumeSubscriptionAgency: (
    d: {
      brandName: string;
      serviceName: string;
      agencyName?: string;
    } & Brandable,
  ) => ({
    subject: `Subscription Resumed by ${d.brandName} for ${d.serviceName}`,
    html: buildCommonTemplate({
      title: 'Subscription Resumed',
      applicationUrl: app,
      subtitle: `Hi ${d.agencyName ?? 'there'}`,
      body: `${d.brandName} reverted the scheduled cancellation for <strong>${d.serviceName}</strong>. The subscription stays active and weekly billing continues as normal.`,
      redirectUrl: { url: `${app}/projects`, cta: 'Visit Application &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Feature subscription started — sent to the brand owner (user-level gate). */
  featureSubscriptionStarted: (
    d: { ownerName?: string; productName: string } & Brandable,
  ) => ({
    subject: `You're subscribed to ${d.productName}`,
    html: buildCommonTemplate({
      title: 'Subscription Active',
      applicationUrl: app,
      subtitle: `Hi ${d.ownerName ?? 'there'}`,
      body: `Your subscription to <strong>${d.productName}</strong> is now active and the feature has been unlocked across your brands. You can manage it any time from your Subscriptions tab.`,
      redirectUrl: { url: `${app}/subscriptions`, cta: 'Manage Subscription &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Feature subscription cancellation scheduled — sent to the brand owner. */
  featureSubscriptionCancelled: (
    d: { ownerName?: string; productName: string; endsOn?: string } & Brandable,
  ) => ({
    subject: `Subscription Cancelled for ${d.productName}`,
    html: buildCommonTemplate({
      title: 'Cancelled Subscription',
      applicationUrl: app,
      subtitle: `Hi ${d.ownerName ?? 'there'}`,
      body: `Your subscription to <strong>${d.productName}</strong> has been scheduled for cancellation. ${
        d.endsOn
          ? `You'll keep access until <strong>${d.endsOn}</strong> and won't be charged again — after that the feature locks.`
          : `You'll keep access until the end of the current billing period and won't be charged again — after that the feature locks.`
      } Changed your mind? You can resume it from your Subscriptions tab before it ends.`,
      redirectUrl: { url: `${app}/subscriptions`, cta: 'Manage Subscription &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Feature subscription cancellation reverted — sent to the brand owner. */
  featureSubscriptionResumed: (
    d: { ownerName?: string; productName: string } & Brandable,
  ) => ({
    subject: `Subscription Resumed for ${d.productName}`,
    html: buildCommonTemplate({
      title: 'Subscription Resumed',
      applicationUrl: app,
      subtitle: `Hi ${d.ownerName ?? 'there'}`,
      body: `Good news — the scheduled cancellation for <strong>${d.productName}</strong> has been reverted. Your subscription stays active and billing continues as normal.`,
      redirectUrl: { url: `${app}/subscriptions`, cta: 'Manage Subscription &rarr;' },
      agencyDetails: d.agencyDetails,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** New support ticket raised — sent to each super-admin. */
  supportTicketCreated: (
    d: {
      ticketNumber: number;
      subject: string;
      category: string;
      priority: string;
      customerName?: string | null;
      customerEmail: string;
      excerpt: string;
      adminUrl: string;
    } & Brandable,
  ) => ({
    subject: `New support ticket #${d.ticketNumber}: ${d.subject}`,
    html: buildCommonTemplate({
      title: `Support ticket #${d.ticketNumber}`,
      applicationUrl: app,
      subtitle: 'A new support request needs attention',
      body: `<p style="margin:0 0 12px 0;">${d.customerName ?? d.customerEmail} opened a support ticket.</p>
<p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;"><strong>Subject:</strong> ${d.subject}</p>
<p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;"><strong>Category:</strong> ${d.category} &nbsp;·&nbsp; <strong>Priority:</strong> ${d.priority}</p>
<p style="margin:0 0 4px 0;font-size:13px;color:#6B7280;"><strong>From:</strong> ${d.customerEmail}</p>
<blockquote style="margin:12px 0;padding:12px 16px;background:#F9FAFB;border-left:3px solid #E5E7EB;font-size:14px;color:#374151;white-space:pre-wrap;">${d.excerpt}</blockquote>`,
      redirectUrl: { url: d.adminUrl, cta: 'Open in admin &rarr;' },
      agencyDetails: d.agencyDetails ?? PRODESK_BRANDING,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Customer replied to a ticket — sent to each super-admin. */
  supportTicketCustomerReply: (
    d: {
      ticketNumber: number;
      subject: string;
      customerName?: string | null;
      customerEmail: string;
      excerpt: string;
      adminUrl: string;
    } & Brandable,
  ) => ({
    subject: `New reply on ticket #${d.ticketNumber}: ${d.subject}`,
    html: buildCommonTemplate({
      title: `Ticket #${d.ticketNumber}`,
      applicationUrl: app,
      subtitle: 'The customer added a reply',
      body: `<p style="margin:0 0 12px 0;">${d.customerName ?? d.customerEmail} replied to their support ticket.</p>
<blockquote style="margin:12px 0;padding:12px 16px;background:#F9FAFB;border-left:3px solid #E5E7EB;font-size:14px;color:#374151;white-space:pre-wrap;">${d.excerpt}</blockquote>`,
      redirectUrl: { url: d.adminUrl, cta: 'Open in admin &rarr;' },
      agencyDetails: d.agencyDetails ?? PRODESK_BRANDING,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /** Support replied — sent to the ticket's contact email. */
  supportTicketReply: (
    d: {
      ticketNumber: number;
      subject: string;
      excerpt: string;
      ticketUrl: string;
    } & Brandable,
  ) => ({
    subject: `Re: [Ticket #${d.ticketNumber}] ${d.subject}`,
    html: buildCommonTemplate({
      title: `Ticket #${d.ticketNumber}`,
      applicationUrl: app,
      subtitle: 'Our support team replied',
      body: `<p style="margin:0 0 12px 0;">There's a new reply on your support ticket <strong>#${d.ticketNumber}</strong> — ${d.subject}.</p>
<blockquote style="margin:12px 0;padding:12px 16px;background:#F9FAFB;border-left:3px solid #E5E7EB;font-size:14px;color:#374151;white-space:pre-wrap;">${d.excerpt}</blockquote>
<p style="margin:0;font-size:13px;color:#6B7280;">Reply from the button below to continue the conversation.</p>`,
      redirectUrl: { url: d.ticketUrl, cta: 'View &amp; reply &rarr;' },
      agencyDetails: d.agencyDetails ?? PRODESK_BRANDING,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),

  /**
   * "Your beta is ending" — sent 7 days out, 3 days out, and on the final day.
   *
   * The whole point is that nobody is surprised by a charge, so it carries the
   * FULL itemised report: every tool they actually used, its live quantity, the
   * per-tool monthly figure, and the total. Same numbers as the in-app screen —
   * both come from modules/beta/report.ts.
   *
   * Sent WITHOUT an unsubscribe channel: it announces money about to leave the
   * customer's account, which is transactional, not something to opt out of.
   */
  betaEnding: (
    d: {
      name?: string;
      /** Which reminder this is — drives the subject line's urgency. */
      leadDays: number;
      /** Formatted deadline, e.g. `12 Sep 2026`. */
      endsOn: string;
      lines: BetaReportEmailLine[];
      monthlyTotal: number;
      currency: string;
      /** Deep link to the in-app report + card form. */
      addCardUrl: string;
    } & Brandable,
  ) => ({
    subject:
      d.leadDays <= 0
        ? `Your Prodesk beta ends today — ${formatMoneyWithCurrency(d.monthlyTotal, d.currency)}/month to continue`
        : `${d.leadDays} days left on your Prodesk beta — here's what happens next`,
    html: buildCommonTemplate({
      title: d.leadDays <= 0 ? 'Your beta ends today' : `${d.leadDays} days of beta left`,
      applicationUrl: app,
      subtitle: `Hi ${d.name ?? 'there'}`,
      body:
        (d.leadDays <= 0
          ? `Your beta access to the Prodesk Suite ends <strong>today (${d.endsOn})</strong>. `
          : `Your beta access to the Prodesk Suite ends on <strong>${d.endsOn}</strong> — that's ${d.leadDays} days away. `) +
        (d.lines.length === 0
          ? `You haven't started using any of the paid tools yet, so there's nothing to pay. Everything you've set up stays where it is, and you can subscribe to any tool whenever you're ready.`
          : `Here's exactly what you'd pay each month to keep the tools you've been using. ` +
            `Add a card before the beta ends and nothing is interrupted — the first charge is taken when the beta finishes, not today.`) +
        betaReportBlock(d.lines, d.monthlyTotal, d.currency),
      redirectUrl:
        d.lines.length === 0
          ? undefined
          : { url: d.addCardUrl, cta: 'Add a card &rarr;' },
      agencyDetails: d.agencyDetails ?? PRODESK_BRANDING,
      // Intentionally no unsubscribe link — see the doc comment above.
      unsubscribeUrl: '',
    }),
  }),

  generic: (
    d: {
      subject: string;
      body: string;
      ctaLabel?: string;
      ctaUrl?: string;
    } & Brandable,
  ) => ({
    subject: d.subject,
    html: buildCommonTemplate({
      title: d.subject,
      applicationUrl: app,
      subtitle: '',
      body: `<p>${d.body}</p>`,
      redirectUrl:
        d.ctaLabel && d.ctaUrl ? { url: d.ctaUrl, cta: d.ctaLabel } : undefined,
      agencyDetails: d.agencyDetails ?? PRODESK_BRANDING,
      unsubscribeUrl: d.unsubscribeUrl ?? '',
    }),
  }),
};

export type TemplateName = keyof typeof templates;
