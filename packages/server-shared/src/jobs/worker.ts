import { Worker } from 'bullmq';
import { and, eq, gt, desc, asc, sql } from 'drizzle-orm';
import { betaQueue, connection, payoutQueue, kanbanQueue, pendingPurchasesQueue, shortLinksQueue, outreachQueue, redis } from './queues.js';
import { purgeExpiredDisabledLinks } from '../modules/short-links/cleanup.js';
import { runCapFanout, type CapPolicy } from '../modules/outreach/caps.js';
import { reconcileUnprocessedEvents, trimOldEvents } from '../modules/outreach/webhook.js';
import { retryUnpushedSuppressions } from '../modules/outreach/suppression.js';
import { tick as tickListBuild } from '../modules/outreach/list-builder/run.js';
import { resumableRuns } from '../modules/outreach/list-builder/ledger.js';
import {
  backfillRegionsFromRuns,
  discoverChildrenFor,
  regionsNeedingChildren,
} from '../modules/outreach/list-builder/gazetteer.js';
import { purgeRunProspects } from '../modules/outreach/list-builder/prospects.js';
import { CHAT_DIGEST_MIN_INTERVAL_MS, lastSentKey, firstQueuedKey } from '../lib/notify.js';
import { db } from '../db/index.js';
import {
  proposals,
  proposalDocuments,
  brands,
  staff,
  agencies,
  brandAgencyConnectionRequests,
  projects,
  projectDeliverables,
  tasks,
  users,
  chatThreadMembers,
  chatThreads,
  emailUnsubscribes,
  purchases,
  pendingPurchases,
  purchaseItems,
  services,
  featureSubscriptions,
  featureSubscriptionProducts,
  supportTickets,
  supportTicketComments,
} from '../db/schema.js';
import { sendEmail, getUnsubscribeUrl } from '../modules/email/mailer.js';
import { templates } from '../modules/email/templates.js';
import {
  agencyBranding,
  brandBranding,
  PRODESK_BRANDING,
  appBaseUrl,
  chatBaseUrl,
  emailBaseUrl,
} from '../modules/email/branding.js';
import { generateProposalEmailHtml } from '../modules/email/proposal-html.js';
import { signInviteToken } from '../lib/invite-token.js';
import {
  buildAgencyInviteTemplate,
  buildReferralInviteTemplate,
} from '../modules/email/invite-templates.js';
import {
  dispatchPayout,
  dispatchDuePayouts,
} from '../modules/billing/dispatch.js';
import { retryFundedWiseLeg2 } from '../modules/billing/wise.js';
import {
  runProjectCycle,
  reconcileDueProjects,
  runProjectCancellation,
} from '../modules/projects/recurring-schedule.js';
import { expireProposal } from '../modules/proposals/expiry.js';
import { cleanupAbandonedPendingPurchases } from '../modules/billing/pending-purchase.js';
import { buildBetaBillingReport } from '../modules/beta/report.js';
import { sweepBetaReminders } from '../modules/beta/reminders.js';
import { transcodeVideo } from '../modules/media/transcode.js';
import { inferThreadName, inferThreadLogo } from '../routers/chat/display.js';
import { isUserOnline } from '../lib/presence.js';
import { attachWorkerLogging } from '../lib/errors.js';

/** Trim a ticket/comment body to a short, email-safe excerpt. */
function ticketExcerpt(body: string, max = 600): string {
  const trimmed = body.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/* ── Email worker — renders a template and sends it ─────────────────────── */
const emailWorker = new Worker(
  'email',
  async (job) => {
    console.log(`[email] processing job: ${job.name} (id=${job.id})`);
    // The frontend the originating request came from (threaded through by routers
    // that enqueue from a request context). Action links resolve against this so
    // an invite from the Links app points back to the Links app. See emailBaseUrl.
    const origin = (job.data as { origin?: string }).origin;
    switch (job.name) {
      case 'proposal-sent': {
        // Rich proposal email (proposal-html.ts), with proposal documents attached.
        // When the proposal targets a brand, embed a signed "View & Accept" link to
        // the public proposal page: it shows a read-only preview and lets a brand
        // that hasn't signed up yet sign up + claim the agency's referral brand so
        // the proposal connects to their new account (auth.redeemInvite / connectViaToken).
        const proposal = (
          await db
            .select()
            .from(proposals)
            .where(eq(proposals.id, job.data.proposalId))
            .limit(1)
        )[0];
        if (!proposal) return;
        const brand = proposal.brandId
          ? (
              await db
                .select()
                .from(brands)
                .where(eq(brands.id, proposal.brandId))
                .limit(1)
            )[0]
          : null;
        const recipient =
          (proposal.brandSnapshot?.email as string | undefined) ??
          brand?.email ??
          null;
        const referralLink = proposal.brandId
          ? `${emailBaseUrl(origin)}/public/proposal/${await signInviteToken({
              kind: 'proposal',
              email: recipient ?? '',
              proposalId: proposal.id,
              brandId: proposal.brandId,
            })}`
          : undefined;
        const rendered = await generateProposalEmailHtml(job.data.proposalId, {
          referralLink,
        });
        if (!rendered) return;
        const to = rendered.brandEmail ?? brand?.email;
        if (!to) return;
        const docs = await db
          .select()
          .from(proposalDocuments)
          .where(eq(proposalDocuments.proposalId, job.data.proposalId));
        // Proposal email is standalone HTML (no common-template footer) — no unsubscribe link.
        await sendEmail({
          to,
          subject: rendered.subject,
          html: rendered.html,
          channel: 'proposal',
          attachments: docs
            .filter((d) => d.url)
            .map((d) => ({ filename: d.fileName ?? 'document', path: d.url })),
        });
        break;
      }
      case 'staff-invite': {
        const s = (
          await db
            .select()
            .from(staff)
            .where(eq(staff.id, job.data.staffId))
            .limit(1)
        )[0];
        if (!s) return;
        const agency = s.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, s.agencyId))
                .limit(1)
            )[0]
          : null;
        const brand = s.brandId
          ? (
              await db
                .select()
                .from(brands)
                .where(eq(brands.id, s.brandId))
                .limit(1)
            )[0]
          : null;
        const orgName = agency?.businessName ?? brand?.businessName ?? 'a team';
        const branding = agency
          ? agencyBranding(agency)
          : brand
            ? brandBranding(brand)
            : undefined;
        // Signed invite link: signing up (or signing in) through it links + activates
        // this staff seat and drops the user into the staff workspace (auth.redeemInvite).
        const staffToken = await signInviteToken({
          kind: 'staff',
          email: s.email,
          staffId: s.id,
        });
        await sendEmail({
          to: s.email,
          channel: 'staff_invite',
          ...templates.staffInvite({
            orgName,
            signupUrl: `${emailBaseUrl(origin)}/signup?invite=${staffToken}`,
            agencyDetails: branding,
            unsubscribeUrl: getUnsubscribeUrl('staff_invite', s.email),
          }),
        });
        break;
      }
      case 'connection-request': {
        const req = (
          await db
            .select()
            .from(brandAgencyConnectionRequests)
            .where(eq(brandAgencyConnectionRequests.id, job.data.requestId))
            .limit(1)
        )[0];
        if (!req) return;
        const [brand, agency] = await Promise.all([
          db.select().from(brands).where(eq(brands.id, req.brandId)).limit(1),
          db
            .select()
            .from(agencies)
            .where(eq(agencies.id, req.agencyId))
            .limit(1),
        ]);
        if (brand[0]?.email)
          await sendEmail({
            to: brand[0].email,
            ...templates.connectionRequest({
              agencyName: agency[0]?.businessName,
              agencyDetails: agency[0] ? agencyBranding(agency[0]) : undefined,
            }),
          });
        break;
      }
      case 'proposal-accepted':
      case 'proposal-rejected':
      case 'proposal-change-requested': {
        const p = (
          await db
            .select()
            .from(proposals)
            .where(eq(proposals.id, job.data.proposalId))
            .limit(1)
        )[0];
        if (!p) return;
        const to = await agencyContactEmail(p.agencyId, p.proposalSentById);
        if (!to) return;
        const agency = p.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, p.agencyId))
                .limit(1)
            )[0]
          : null;
        const brand = p.brandId
          ? (
              await db
                .select()
                .from(brands)
                .where(eq(brands.id, p.brandId))
                .limit(1)
            )[0]
          : null;
        const title = p.title ?? 'Proposal';
        const brandName = brand?.businessName;
        const branding = agency ? agencyBranding(agency) : undefined;
        const unsubscribeUrl = getUnsubscribeUrl('proposal', to);
        if (job.name === 'proposal-accepted')
          await sendEmail({
            to,
            channel: 'proposal',
            ...templates.proposalAccepted({
              title,
              brandName,
              agencyDetails: branding,
              unsubscribeUrl,
            }),
          });
        else if (job.name === 'proposal-rejected')
          await sendEmail({
            to,
            channel: 'proposal',
            ...templates.proposalRejected({
              title,
              brandName,
              agencyDetails: branding,
              unsubscribeUrl,
            }),
          });
        else
          await sendEmail({
            to,
            channel: 'proposal',
            ...templates.proposalChangeRequested({
              title,
              brandName,
              note: p.changeRequestNote ?? undefined,
              agencyDetails: branding,
              unsubscribeUrl,
            }),
          });
        break;
      }
      case 'project-completion-request': {
        const pr = (
          await db
            .select()
            .from(projects)
            .where(eq(projects.id, job.data.projectId))
            .limit(1)
        )[0];
        if (!pr?.brandId) return;
        const brand = (
          await db
            .select()
            .from(brands)
            .where(eq(brands.id, pr.brandId))
            .limit(1)
        )[0];
        const owner = brand?.ownerId
          ? (
              await db
                .select()
                .from(users)
                .where(eq(users.id, brand.ownerId))
                .limit(1)
            )[0]
          : null;
        const to = brand?.email ?? owner?.email;
        if (!to) return;
        const agency = pr.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, pr.agencyId))
                .limit(1)
            )[0]
          : null;
        // One-click confirm link (valid 10 days) when a completion token is stamped.
        const confirmUrl = pr.completionToken
          ? `${emailBaseUrl(origin)}/confirm/complete?projectId=${pr.id}&token=${pr.completionToken}`
          : undefined;
        // Every deliverable sent to the project, in display order — listed in
        // the email so the brand can see what they're approving.
        const deliverables = await db
          .select({
            type: projectDeliverables.type,
            fileName: projectDeliverables.fileName,
            description: projectDeliverables.description,
            content: projectDeliverables.content,
          })
          .from(projectDeliverables)
          .where(eq(projectDeliverables.projectId, pr.id))
          .orderBy(asc(projectDeliverables.sortOrder), asc(projectDeliverables.uploadedAt));
        // Attach the actual files (document/image deliverables whose content is a
        // stored URL) so the brand can open them straight from the email.
        const attachments = deliverables
          .filter((d) => d.type !== 'text' && !!d.content)
          .map((d, i) => ({ filename: d.fileName ?? `deliverable-${i + 1}`, path: d.content as string }));
        await sendEmail({
          to,
          channel: 'request_completion',
          attachments,
          ...templates.projectCompletionRequest({
            projectTitle: pr.title ?? pr.serviceName ?? 'Project',
            agencyName: agency?.businessName,
            brandName: brand?.businessName,
            toPayAmount: releaseAmountOf(pr.amount),
            confirmUrl,
            deliverables,
            agencyDetails: agency ? agencyBranding(agency) : undefined,
            unsubscribeUrl: getUnsubscribeUrl('request_completion', to),
          }),
        });
        break;
      }
      case 'soft-delete-confirm': {
        const pr = (
          await db
            .select()
            .from(projects)
            .where(eq(projects.id, job.data.projectId))
            .limit(1)
        )[0];
        if (!pr?.brandId || !pr.softDeleteToken) return;
        const brand = (
          await db
            .select()
            .from(brands)
            .where(eq(brands.id, pr.brandId))
            .limit(1)
        )[0];
        const owner = brand?.ownerId
          ? (
              await db
                .select()
                .from(users)
                .where(eq(users.id, brand.ownerId))
                .limit(1)
            )[0]
          : null;
        const to = brand?.email ?? owner?.email;
        if (!to) return;
        const agency = pr.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, pr.agencyId))
                .limit(1)
            )[0]
          : null;
        const confirmUrl = `${emailBaseUrl(origin)}/confirm/soft-delete?projectId=${pr.id}&token=${pr.softDeleteToken}`;
        const refundAmount = pr.proposedRefundAmount
          ? Number(pr.proposedRefundAmount)
          : undefined;
        // Partial-refund vs cancellation-request → distinct unsubscribe channels (prod parity).
        const channel =
          (refundAmount ?? 0) > 0 ? 'partial_refund' : 'cancellation_request';
        await sendEmail({
          to,
          channel,
          ...templates.softDeleteConfirm({
            projectTitle: pr.title ?? pr.serviceName ?? 'Project',
            agencyName: agency?.businessName,
            brandName: brand?.businessName,
            refundAmount,
            confirmUrl,
            agencyDetails: agency ? agencyBranding(agency) : undefined,
            unsubscribeUrl: getUnsubscribeUrl(channel, to),
          }),
        });
        break;
      }
      case 'digital-product': {
        const pr = (
          await db
            .select()
            .from(projects)
            .where(eq(projects.id, job.data.projectId))
            .limit(1)
        )[0];
        if (!pr?.brandId) return;
        const item = (
          await db
            .select()
            .from(purchaseItems)
            .where(eq(purchaseItems.projectId, pr.id))
            .limit(1)
        )[0];
        const svc = pr.serviceId
          ? (
              await db
                .select()
                .from(services)
                .where(eq(services.id, pr.serviceId))
                .limit(1)
            )[0]
          : null;
        const fileUrl =
          item?.digitalProductFileUrl ?? svc?.digitalProductFileUrl;
        if (!fileUrl) return;
        const fileName =
          item?.digitalProductFileName ??
          svc?.digitalProductFileName ??
          undefined;
        const brand = (
          await db
            .select()
            .from(brands)
            .where(eq(brands.id, pr.brandId))
            .limit(1)
        )[0];
        const owner = brand?.ownerId
          ? (
              await db
                .select()
                .from(users)
                .where(eq(users.id, brand.ownerId))
                .limit(1)
            )[0]
          : null;
        const to = brand?.email ?? owner?.email;
        if (!to) return;
        const agency = pr.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, pr.agencyId))
                .limit(1)
            )[0]
          : null;
        await sendEmail({
          to,
          channel: 'digital_product',
          attachments: [{ filename: fileName ?? 'download', path: fileUrl }],
          ...templates.digitalProduct({
            brandName: brand?.businessName,
            serviceName: pr.serviceName ?? svc?.name ?? 'Digital Product',
            fileUrl,
            fileName,
            agencyDetails: agency ? agencyBranding(agency) : undefined,
            unsubscribeUrl: getUnsubscribeUrl('digital_product', to),
          }),
        });
        break;
      }
      case 'task-assigned': {
        // Enqueued by tasks.maybeSendTaskEmail with { taskId, email }.
        const task = (
          await db
            .select()
            .from(tasks)
            .where(eq(tasks.id, job.data.taskId))
            .limit(1)
        )[0];
        const to = job.data.email as string | undefined;
        if (!task || !to) return;
        const assignee = task.assigneeId
          ? (
              await db
                .select()
                .from(users)
                .where(eq(users.id, task.assigneeId))
                .limit(1)
            )[0]
          : null;
        // `assignedBy` stores the assigner's user id — resolve it to a display
        // name so the email reads "Jane Doe assigned…", not a raw UID. (Guard the
        // uuid shape: some system rows use non-uuid markers.)
        const assignerId =
          task.assignedBy &&
          task.assignedBy !== 'system' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            task.assignedBy,
          )
            ? task.assignedBy
            : null;
        const assigner = assignerId
          ? (
              await db
                .select({ firstName: users.firstName, lastName: users.lastName })
                .from(users)
                .where(eq(users.id, assignerId))
                .limit(1)
            )[0]
          : null;
        const assignerName = assigner
          ? [assigner.firstName, assigner.lastName].filter(Boolean).join(' ') ||
            undefined
          : undefined;
        await sendEmail({
          to,
          channel: 'task',
          ...templates.taskAssigned({
            taskTitle: task.title,
            assignerName,
            name: assignee?.firstName ?? null,
            email: to,
            agencyDetails: PRODESK_BRANDING,
            unsubscribeUrl: getUnsubscribeUrl('task', to),
          }),
        });
        break;
      }
      case 'chat-invite': {
        // Enqueued by chat.inviteByEmail with { email, invitedBy }. The address
        // has NO Prodesk account — signing up is what turns the pending
        // chat_invites row into an open DM (claimChatInvites).
        const to = job.data.email as string | undefined;
        if (!to) return;
        const inviter = job.data.invitedBy
          ? (
              await db
                .select()
                .from(users)
                .where(eq(users.id, job.data.invitedBy as string))
                .limit(1)
            )[0]
          : null;
        const inviterName = inviter
          ? [inviter.firstName, inviter.lastName].filter(Boolean).join(' ').trim() || undefined
          : undefined;
        await sendEmail({
          to,
          channel: 'chat',
          ...templates.chatInvite({
            inviterName,
            // The messenger, not the main app: this invitation exists because
            // someone tried to send them a MESSAGE, so the account they are
            // being asked to create is a chat account and the link has to land
            // where the conversation is waiting.
            signupUrl: `${chatBaseUrl(origin)}/signup`,
            appUrl: chatBaseUrl(origin),
            agencyDetails: PRODESK_BRANDING,
            unsubscribeUrl: getUnsubscribeUrl('chat', to),
          }),
        });
        break;
      }
      case 'contractor-invite': {
        // Enqueued by connections (invite/apply) with { agencyId, email|contractorId, note? }.
        let to = job.data.email as string | undefined;
        if (!to && job.data.contractorId) {
          to =
            (
              await db
                .select()
                .from(users)
                .where(eq(users.id, job.data.contractorId))
                .limit(1)
            )[0]?.email ?? undefined;
        }
        if (!to) return;
        const agency = job.data.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, job.data.agencyId))
                .limit(1)
            )[0]
          : null;
        // New user (invited by email, no account) → signed invite link that routes
        // them through signup to the contractor-create screen and wires up the agency
        // connection. Existing users already have an in-app task, so point them there.
        const newUser = !!job.data.email && !job.data.contractorId;
        const signupUrl =
          newUser && job.data.agencyId
            ? `${emailBaseUrl(origin)}/signup?invite=${await signInviteToken({ kind: 'contractor', email: to, agencyId: job.data.agencyId, note: job.data.note })}`
            : `${emailBaseUrl(origin)}/tasks`;
        await sendEmail({
          to,
          channel: 'staff_invite',
          ...templates.contractorInvite({
            agencyName: agency?.businessName,
            note: job.data.note,
            signupUrl,
            agencyDetails: agency ? agencyBranding(agency) : undefined,
            unsubscribeUrl: getUnsubscribeUrl('staff_invite', to),
          }),
        });
        break;
      }
      case 'payment-failed': {
        // Enqueued by the Stripe webhook with { purchaseId }.
        const result = await resolvePurchaseParties(
          job.data.purchaseId as string,
        );
        if (!result) return;
        const { brand, agency, purchaseId } = result;
        if (brand?.email)
          await sendEmail({
            to: brand.email,
            channel: 'payment_failed',
            ...templates.paymentFailedBrand({
              brandName: brand.businessName,
              purchaseId,
              agencyDetails: agency ? agencyBranding(agency) : undefined,
              unsubscribeUrl: getUnsubscribeUrl('payment_failed', brand.email),
            }),
          });
        if (agency?.businessEmail)
          await sendEmail({
            to: agency.businessEmail,
            channel: 'payment_failed',
            ...templates.paymentFailedAgency({
              brandName: brand?.businessName ?? 'The client',
              brandEmail: brand?.email ?? undefined,
              purchaseId,
              agencyDetails: agencyBranding(agency),
              unsubscribeUrl: getUnsubscribeUrl(
                'payment_failed',
                agency.businessEmail,
              ),
            }),
          });
        break;
      }
      case 'subscription-cancelled': {
        // Enqueued when a recurring subscription is cancelled with { projectId }.
        const pr = (
          await db
            .select()
            .from(projects)
            .where(eq(projects.id, job.data.projectId))
            .limit(1)
        )[0];
        if (!pr) return;
        const brand = pr.brandId
          ? (
              await db
                .select()
                .from(brands)
                .where(eq(brands.id, pr.brandId))
                .limit(1)
            )[0]
          : null;
        const agency = pr.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, pr.agencyId))
                .limit(1)
            )[0]
          : null;
        const serviceName = pr.serviceName ?? pr.title ?? 'your service';
        const branding = agency ? agencyBranding(agency) : undefined;
        if (brand?.email)
          await sendEmail({
            to: brand.email,
            channel: 'cancel_subscription',
            ...templates.cancelSubscriptionBrand({
              brandName: brand.businessName,
              serviceName,
              agencyDetails: branding,
              unsubscribeUrl: getUnsubscribeUrl(
                'cancel_subscription',
                brand.email,
              ),
            }),
          });
        if (agency?.businessEmail)
          await sendEmail({
            to: agency.businessEmail,
            channel: 'cancel_subscription',
            ...templates.cancelSubscriptionAgency({
              brandName: brand?.businessName ?? 'A client',
              serviceName,
              agencyName: agency.businessName,
              agencyDetails: branding,
              unsubscribeUrl: getUnsubscribeUrl(
                'cancel_subscription',
                agency.businessEmail,
              ),
            }),
          });
        break;
      }
      case 'subscription-resumed': {
        // Enqueued when a scheduled subscription cancellation is reverted with { projectId }.
        const pr = (
          await db
            .select()
            .from(projects)
            .where(eq(projects.id, job.data.projectId))
            .limit(1)
        )[0];
        if (!pr) return;
        const brand = pr.brandId
          ? (
              await db
                .select()
                .from(brands)
                .where(eq(brands.id, pr.brandId))
                .limit(1)
            )[0]
          : null;
        const agency = pr.agencyId
          ? (
              await db
                .select()
                .from(agencies)
                .where(eq(agencies.id, pr.agencyId))
                .limit(1)
            )[0]
          : null;
        const serviceName = pr.serviceName ?? pr.title ?? 'your service';
        const branding = agency ? agencyBranding(agency) : undefined;
        if (brand?.email)
          await sendEmail({
            to: brand.email,
            channel: 'cancel_subscription',
            ...templates.resumeSubscriptionBrand({
              brandName: brand.businessName,
              serviceName,
              agencyDetails: branding,
              unsubscribeUrl: getUnsubscribeUrl(
                'cancel_subscription',
                brand.email,
              ),
            }),
          });
        if (agency?.businessEmail)
          await sendEmail({
            to: agency.businessEmail,
            channel: 'cancel_subscription',
            ...templates.resumeSubscriptionAgency({
              brandName: brand?.businessName ?? 'A client',
              serviceName,
              agencyName: agency.businessName,
              agencyDetails: branding,
              unsubscribeUrl: getUnsubscribeUrl(
                'cancel_subscription',
                agency.businessEmail,
              ),
            }),
          });
        break;
      }
      case 'feature-subscription-started':
      case 'feature-subscription-cancelled':
      case 'feature-subscription-resumed': {
        // Feature subscriptions are gated at the brand-OWNER user level, so their
        // status changes notify the owner's login email. Enqueued with { subscriptionId }.
        const sub = (
          await db
            .select({
              userId: featureSubscriptions.userId,
              currentPeriodEnd: featureSubscriptions.currentPeriodEnd,
              productName: featureSubscriptionProducts.name,
            })
            .from(featureSubscriptions)
            .innerJoin(
              featureSubscriptionProducts,
              eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
            )
            .where(eq(featureSubscriptions.id, job.data.subscriptionId))
            .limit(1)
        )[0];
        if (!sub) return;
        const owner = (
          await db
            .select({ email: users.email, firstName: users.firstName })
            .from(users)
            .where(eq(users.id, sub.userId))
            .limit(1)
        )[0];
        if (!owner?.email) return;
        const productName = sub.productName ?? 'your subscription';
        const ownerName = owner.firstName ?? undefined;
        const unsubscribeUrl = getUnsubscribeUrl('cancel_subscription', owner.email);
        const tpl =
          job.name === 'feature-subscription-started'
            ? templates.featureSubscriptionStarted({ ownerName, productName, unsubscribeUrl })
            : job.name === 'feature-subscription-resumed'
              ? templates.featureSubscriptionResumed({ ownerName, productName, unsubscribeUrl })
              : templates.featureSubscriptionCancelled({
                  ownerName,
                  productName,
                  endsOn: sub.currentPeriodEnd
                    ? sub.currentPeriodEnd.toLocaleDateString('en-AU', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })
                    : undefined,
                  unsubscribeUrl,
                });
        await sendEmail({ to: owner.email, channel: 'cancel_subscription', ...tpl });
        break;
      }
      case 'agency-invite': {
        // Enqueued by auth.sendAgencyInvite with { email, inviterName, isBrand?, isExistingUser?, signupUrl }.
        const to = job.data.email as string | undefined;
        if (!to) return;
        await sendEmail({
          to,
          channel: 'agency_invite',
          ...buildAgencyInviteTemplate({
            inviterName: job.data.inviterName ?? 'Someone',
            email: to,
            signupUrl:
              job.data.signupUrl ?? `${emailBaseUrl(origin)}/signup?invite=agency`,
            isBrand: job.data.isBrand ?? false,
            isExistingUser: job.data.isExistingUser ?? false,
          }),
        });
        break;
      }
      case 'referral-invite': {
        // Enqueued by auth.sendReferralInvite with { email, inviterName, signupUrl }.
        const to = job.data.email as string | undefined;
        if (!to) return;
        await sendEmail({
          to,
          channel: 'referral_invite',
          ...buildReferralInviteTemplate({
            inviterName: job.data.inviterName ?? 'Someone',
            email: to,
            signupUrl: job.data.signupUrl ?? `${emailBaseUrl(origin)}/signup`,
          }),
        });
        break;
      }
      /* ── Support tickets ──────────────────────────────────────────────── */
      case 'support-ticket-created': {
        const ticket = (
          await db.select().from(supportTickets).where(eq(supportTickets.id, job.data.ticketId)).limit(1)
        )[0];
        if (!ticket) return;
        const [firstComment] = await db
          .select()
          .from(supportTicketComments)
          .where(eq(supportTicketComments.ticketId, ticket.id))
          .orderBy(asc(supportTicketComments.createdAt))
          .limit(1);
        const creator = ticket.userId
          ? (await db.select().from(users).where(eq(users.id, ticket.userId)).limit(1))[0]
          : null;
        const admins = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.isSuperAdmin, true));
        const adminUrl = `${appBaseUrl()}/super-admin/tickets`;
        const excerpt = ticketExcerpt(firstComment?.body ?? ticket.subject);
        for (const a of admins) {
          await sendEmail({
            to: a.email,
            ...templates.supportTicketCreated({
              ticketNumber: ticket.ticketNumber,
              subject: ticket.subject,
              category: ticket.category,
              priority: ticket.priority,
              customerName: creator ? [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() || null : null,
              customerEmail: ticket.contactEmail,
              excerpt,
              adminUrl,
            }),
          });
        }
        break;
      }
      case 'support-ticket-customer-reply': {
        const comment = (
          await db.select().from(supportTicketComments).where(eq(supportTicketComments.id, job.data.commentId)).limit(1)
        )[0];
        if (!comment) return;
        const ticket = (
          await db.select().from(supportTickets).where(eq(supportTickets.id, comment.ticketId)).limit(1)
        )[0];
        if (!ticket) return;
        const creator = ticket.userId
          ? (await db.select().from(users).where(eq(users.id, ticket.userId)).limit(1))[0]
          : null;
        const admins = await db
          .select({ email: users.email })
          .from(users)
          .where(eq(users.isSuperAdmin, true));
        const adminUrl = `${appBaseUrl()}/super-admin/tickets`;
        for (const a of admins) {
          await sendEmail({
            to: a.email,
            ...templates.supportTicketCustomerReply({
              ticketNumber: ticket.ticketNumber,
              subject: ticket.subject,
              customerName: creator ? [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim() || null : null,
              customerEmail: ticket.contactEmail,
              excerpt: ticketExcerpt(comment.body),
              adminUrl,
            }),
          });
        }
        break;
      }
      case 'support-ticket-reply': {
        const comment = (
          await db.select().from(supportTicketComments).where(eq(supportTicketComments.id, job.data.commentId)).limit(1)
        )[0];
        if (!comment) return;
        const ticket = (
          await db.select().from(supportTickets).where(eq(supportTickets.id, comment.ticketId)).limit(1)
        )[0];
        if (!ticket) return;
        // Reply links resolve back to the frontend the ticket was raised from.
        const ticketUrl = `${emailBaseUrl(origin ?? ticket.appOrigin ?? undefined)}/support/${ticket.id}`;
        const attachments = (comment.attachments ?? []).map((a) => ({ filename: a.name, path: a.url }));
        await sendEmail({
          to: ticket.contactEmail,
          attachments: attachments.length ? attachments : undefined,
          ...templates.supportTicketReply({
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            excerpt: ticketExcerpt(comment.body),
            ticketUrl,
          }),
        });
        break;
      }
      case 'beta-ending': {
        // Enqueued by the beta sweep with { userId, kind, betaEndsAt }. The report
        // is rebuilt HERE, at send time, rather than carried in the job payload:
        // a queued job can sit for minutes and the quantities (active links,
        // seats) must match what the user would actually be charged.
        const user = (
          await db
            .select({ email: users.email, firstName: users.firstName })
            .from(users)
            .where(eq(users.id, job.data.userId))
            .limit(1)
        )[0];
        if (!user?.email) return;
        const endsAt = job.data.betaEndsAt ? new Date(job.data.betaEndsAt) : null;
        if (!endsAt) return;
        const report = await buildBetaBillingReport(db, job.data.userId);
        const leadDays =
          job.data.kind === 'day_7' ? 7 : job.data.kind === 'day_3' ? 3 : 0;
        // The report + card form live on the main app's account screen; links
        // resolve to the frontend the beta was joined from where known.
        const addCardUrl = `${emailBaseUrl(origin ?? undefined)}/subscriptions?beta_report=1`;
        await sendEmail({
          to: user.email,
          // No unsubscribe channel: this announces an upcoming charge.
          ...templates.betaEnding({
            name: user.firstName ?? undefined,
            leadDays,
            endsOn: endsAt.toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            }),
            lines: report.lines.map((l) => ({
              productName: l.productName,
              unitAmount: l.unitAmount,
              quantity: l.quantity,
              monthlyAmount: l.monthlyAmount,
              perUnit: l.perUnit,
              unitNoun: l.unitNoun,
              usageDetail: l.usageDetail,
              alreadySubscribed: l.alreadySubscribed,
            })),
            monthlyTotal: report.monthlyTotal,
            currency: report.currency,
            addCardUrl,
          }),
        });
        break;
      }
      case 'generic':
        await sendEmail({ to: job.data.to, ...templates.generic(job.data) });
        break;
      default:
        console.warn('[email] unknown template', job.name);
    }
  },
  { connection },
);
attachWorkerLogging(emailWorker, 'email', { logCompleted: true });

/* ── Payout worker — dispatch single payouts + the weekly cron ──────────── */
attachWorkerLogging(new Worker(
  'payout',
  async (job) => {
    if (job.name === 'cron') {
      const result = await dispatchDuePayouts(new Date());
      console.log('[payout] cron', result);
    } else if (job.name === 'wise-leg2-retry') {
      // Hourly: re-send wise payouts stranded at leg 2 because our Wise balance
      // wasn't credited when `payout.paid` first fired (funds still in transit).
      const result = await retryFundedWiseLeg2();
      if (result.considered) console.log('[payout] wise-leg2-retry', result);
    } else if (job.name === 'dispatch') {
      await dispatchPayout(job.data.payoutId);
    }
  },
  { connection },
), 'payout');

/* ── Chat-digest worker — debounced offline-message email ───────────────── */
attachWorkerLogging(new Worker(
  'chat-digest',
  async (job) => {
    const userId = job.data.userId as string;
    const user = (
      await db.select().from(users).where(eq(users.id, userId)).limit(1)
    )[0];
    if (!user?.email) return;

    // Respect the per-email unsubscribe state for the 'chat' channel.
    const unsub = (
      await db
        .select()
        .from(emailUnsubscribes)
        .where(eq(emailUnsubscribes.email, user.email))
        .limit(1)
    )[0];
    if (unsub?.channels?.includes('chat')) return;

    // Defensive rate-limit guard (the schedule delay already enforces this, but
    // a clock skew / manual re-run shouldn't be able to spam the recipient).
    const lastSent = Number(await redis.get(lastSentKey(userId)));
    if (lastSent && Date.now() - lastSent < CHAT_DIGEST_MIN_INTERVAL_MS) return;

    // Presence gate: if the user is actively using the app (recent heartbeat),
    // don't email them — they see new messages live (unread badges + realtime).
    // Mirrors Flutter's online→snackbar / offline→email split. The batch markers
    // are left intact, so the next inbound message reschedules a fresh digest
    // (which recomputes unread from the DB, losing nothing) once they go idle.
    if (await isUserOnline(userId)) return;

    // Recompute the unread tiles from the DB at fire time (no queue-state table).
    const rows = await db
      .select({
        unreadCount: chatThreadMembers.unreadCount,
        thread: chatThreads,
      })
      .from(chatThreadMembers)
      .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
      .where(
        and(
          eq(chatThreadMembers.userId, userId),
          gt(chatThreadMembers.unreadCount, 0),
          // ANTI-SPAM GATE 2 OF 2, and it is NOT redundant with the filter in
          // chat.send. That one decides who gets a digest SCHEDULED; this query
          // recomputes unread from the database at fire time, so a pending
          // request or a muted thread with unread messages would be emailed by
          // any digest scheduled for a different thread. Since anyone can be
          // found by email address, that is the difference between a messenger
          // and a way to email strangers.
          sql`${chatThreadMembers.requestState} = 'accepted'`,
          sql`(${chatThreadMembers.mutedUntil} is null or ${chatThreadMembers.mutedUntil} <= now())`,
          // Archiving is a mute (routers/chat/consumer.ts#decorateThreads). A
          // thread the user filed away must not reach them by email either, or
          // "archive" means nothing the moment they close the tab.
          eq(chatThreadMembers.isArchived, false),
        ),
      )
      .orderBy(desc(chatThreads.lastMessageAt));

    // Pending message requests — COUNTED, never previewed. Requests used to be
    // silent everywhere, which meant a legitimate first message from someone you
    // hadn't met could sit unseen indefinitely. They now appear in the digest as
    // a bare count: enough to bring you back, and carrying none of a stranger's
    // words into your inbox (see templates.chatDigest#requestCount).
    const [{ requestCount }] = await db
      .select({ requestCount: sql<number>`count(*)::int` })
      .from(chatThreadMembers)
      .where(
        and(
          eq(chatThreadMembers.userId, userId),
          sql`${chatThreadMembers.requestState} = 'pending'`,
          eq(chatThreadMembers.isArchived, false),
        ),
      );

    // Nothing unread and nobody waiting — clear the batch marker and bail.
    if (!rows.length && !requestCount) {
      await redis.del(firstQueuedKey(userId));
      return;
    }

    // Resolve the same display name + counterparty avatar the chat list shows
    // (inferThreadName / inferThreadLogo), so the email mirrors the front end.
    // Every link in this email points at the messenger — see chatBaseUrl. The
    // digest is a cron job, so there is no request origin to infer one from, and
    // the old `emailBaseUrl(origin)` path therefore always resolved to the main
    // app.
    const chatUrl = chatBaseUrl();

    const threads = await Promise.all(
      rows.map(async (r) => ({
        threadId: r.thread.id,
        threadName: await inferThreadName(db, r.thread, userId),
        unreadCount: r.unreadCount,
        lastMessage: r.thread.lastMessage ?? '',
        // platformAdmin shows the app favicon in the UI; reuse it here too.
        avatarUrl:
          (await inferThreadLogo(db, r.thread, userId)) ??
          (r.thread.type === 'platformAdmin' ? `${chatUrl}/favicon.png` : null),
      })),
    );

    await sendEmail({
      to: user.email,
      ...templates.chatDigest({
        name: user.firstName ?? null,
        email: user.email,
        appUrl: chatUrl,
        threads,
        requestCount,
      }),
    });

    // Stamp the send so the rate-limit window starts, and reset the batch.
    await redis.set(lastSentKey(userId), String(Date.now()), 'PX', CHAT_DIGEST_MIN_INTERVAL_MS);
    await redis.del(`digest:first:${userId}`);
  },
  { connection },
), 'chat-digest');

/* ── Kanban worker — exact-time per-project cycle jobs + daily backstop ──── */
attachWorkerLogging(new Worker(
  'kanban',
  async (job) => {
    if (job.name === 'cycle' && job.data?.projectId) {
      // Exact-time job armed at a project's nextCycleAt (recurring re-cycle or
      // delayed-phase activation). Scheduled by recurring-schedule.
      const result = await runProjectCycle(job.data.projectId, new Date());
      console.log('[kanban] cycle', job.data.projectId, result);
    } else if (job.name === 'cancel-item' && job.data?.projectId) {
      // Deferred per-item subscription removal for a scheduled cancel (§9.1):
      // fires shortly before the boundary charge to drop just this project's item.
      await runProjectCancellation(job.data.projectId);
      console.log('[kanban] cancel-item', job.data.projectId);
    } else {
      // 'reconcile' (daily backstop) — and legacy 'cron' jobs still in Redis.
      const result = await reconcileDueProjects(new Date());
      console.log('[kanban] reconcile', result);
    }
  },
  { connection },
), 'kanban');

/* ── Proposal worker — exact-time auto-expiry ───────────────────────────── */
attachWorkerLogging(new Worker(
  'proposal',
  async (job) => {
    if (job.name === 'expire' && job.data?.proposalId) {
      const expired = await expireProposal(job.data.proposalId, new Date());
      console.log('[proposal] expire', job.data.proposalId, expired);
    }
  },
  { connection },
), 'proposal');

/* ── Video worker — Supabase Storage faststart + thumbnail (ffmpeg) ─────── */
attachWorkerLogging(new Worker(
  'video',
  async (job) => {
    if (job.data?.path) {
      const result = await transcodeVideo({
        bucket: job.data.bucket ?? 'project-files',
        path: job.data.path,
      });
      console.log('[video] transcode', job.data.path, result);
    }
  },
  { connection },
), 'video');

/* ── Beta worker — daily "your beta is ending" sweep (7 / 3 / 0 days out) ── */
attachWorkerLogging(new Worker(
  'beta',
  async (job) => {
    if (job.name === 'reminders') {
      // Idempotent and concurrency-safe: each (user, milestone, deadline) send is
      // claimed by a unique row before the email is enqueued, so a retry or an
      // overlapping run can't double-notify. See modules/beta/reminders.ts.
      const result = await sweepBetaReminders(db, new Date());
      console.log('[beta] reminders', result);
    }
  },
  { connection },
), 'beta');

/* ── Pending-purchases worker — sweep abandoned (unpaid) checkouts ──────── */
attachWorkerLogging(new Worker(
  'pending-purchases',
  async (job) => {
    if (job.name === 'cleanup') {
      const result = await cleanupAbandonedPendingPurchases(new Date());
      console.log('[pending-purchases] cleanup', result);
    }
  },
  { connection },
), 'pending-purchases');

/* ── Short-links worker — daily sweep of expired parked links (>=30 days) ──── */
attachWorkerLogging(new Worker(
  'short-links',
  async (job) => {
    if (job.name === 'cleanup') {
      const result = await purgeExpiredDisabledLinks(db);
      console.log('[short-links] cleanup', result);
    }
  },
  { connection },
), 'short-links');

/**
 * Which list runs already have a tick booked.
 *
 * Read from the queue rather than tracked on the row, because the queue is the
 * thing that actually holds the answer: a tick that is waiting, delayed, or
 * running right now is a tick that will happen, and none of those states is
 * visible from the ledger. Reads the three non-terminal sets only — a completed
 * job is history, and a failed one is precisely the case the resume sweep
 * exists to recover.
 *
 * Best-effort: on a Redis hiccup it reports nothing booked, which degrades to
 * the old behaviour (an extra chain) rather than to a run nobody resumes.
 */
async function scheduledListBuildRunIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  try {
    const jobs = await outreachQueue.getJobs(['waiting', 'delayed', 'active'], 0, 500);
    for (const job of jobs) {
      if (job?.name !== 'list-build') continue;
      const runId = (job.data as { runId?: unknown } | null)?.runId;
      if (typeof runId === 'string') ids.add(runId);
    }
  } catch (e) {
    console.error('[outreach] could not read the outreach queue', (e as Error).message);
  }
  return ids;
}

/* ── Outreach worker — bulk Smartlead operations ──────────────────────────
 * Smartlead's rate limit is per API key across every endpoint, so anything that
 * touches all 20 mailboxes at once runs here rather than inline from a click.
 * Progress is written to Redis for the UI to follow. */
attachWorkerLogging(new Worker(
  'outreach',
  async (job) => {
    if (job.name === 'cap-fanout') {
      const { runId, policy } = job.data as { runId: string; policy: CapPolicy };
      const result = await runCapFanout(runId, policy);
      console.log('[outreach] cap fan-out', {
        runId,
        done: result.done,
        total: result.total,
        failed: result.failures.length,
      });
      return;
    }
    if (job.name === 'reconcile') {
      // Smartlead retries on non-2xx, but we answer 200 as soon as the receipt
      // is stored — so anything that died during processing is only recoverable
      // here. Also retries suppressions that never reached Smartlead's block list.
      const [events, suppressions, trimmed] = await Promise.all([
        reconcileUnprocessedEvents(),
        retryUnpushedSuppressions(),
        // §5 makes `outreach_events` receipts-only and asks for a retention
        // window; nothing had ever enforced one, so the table and its jsonb
        // payloads grew without limit. Bounded per pass — see `trimOldEvents`.
        trimOldEvents().catch((e: Error) => {
          console.error('[outreach] event trim failed', e.message);
          return { deleted: 0 };
        }),
      ]);
      if (events.retried || events.abandoned || suppressions.pushed || trimmed.deleted) {
        console.log('[outreach] reconcile', {
          events: events.retried,
          // Loud on purpose: an abandoned receipt is an event that arrived and
          // will never be applied, and nothing else in the system says so.
          abandoned: events.abandoned,
          suppressions: suppressions.pushed,
          trimmed: trimmed.deleted,
        });
      }
      /**
       * Fill in the coverage map's geography.
       *
       * Two jobs in one: registering regions from runs that predate the
       * gazetteer, and enumerating what is inside any region we have not yet
       * asked about. Both are bounded per pass — Overpass is donation-funded
       * and this fires every fifteen minutes — so a large backlog drains over
       * a few hours rather than in one burst.
       *
       * A region whose lookup FAILED is deliberately not retried here. It
       * carries a `children_fetched_at`, so it is not "pending"; hammering a
       * service that just refused us, four times an hour forever, is how you
       * stop being welcome on it.
       */
      const registered = await backfillRegionsFromRuns();
      for (const osmId of await regionsNeedingChildren()) {
        await outreachQueue.add(
          'region-children',
          { osmId },
          { jobId: `region-children-${osmId}`, removeOnComplete: true, removeOnFail: 20 },
        );
      }
      if (registered) console.log('[outreach] regions registered from runs', { registered });
      return;
    }
    if (job.name === 'region-children') {
      // "What is inside this region" — one Overpass round trip per admin level
      // probed, so five to fifteen seconds. Runs here rather than on the path
      // that starts a run, because a scrape must never wait on a geocoder.
      const { osmId } = job.data as { osmId: string };
      const result = await discoverChildrenFor(osmId);
      console.log('[outreach] region children job', { osmId, ...result });
      return;
    }
    if (job.name === 'list-build') {
      // One STEP of a list run, not the whole thing. The Apify scrape takes
      // tens of minutes and holding a worker for it would be bad; not
      // surviving a restart mid-scrape would be worse, because Apify has no
      // idempotency key on run start and the retry pays again. So each tick
      // ends in a durable state and says when it wants to be called back.
      const { runId } = job.data as { runId: string };
      const result = await tickListBuild(runId);
      console.log('[outreach] list build', {
        runId,
        status: result.status,
        stage: result.stage,
        counts: result.counts,
      });
      if (result.requeueMs !== null) {
        await outreachQueue.add(
          'list-build',
          { runId },
          { delay: result.requeueMs, removeOnComplete: true, removeOnFail: 50 },
        );
      }
      return;
    }
    if (job.name === 'list-build-resume') {
      // A restart drops the delayed tick that was in flight. Anything left
      // mid-run is nudged once, which also drives the orphan-adoption path for
      // rows stuck in `starting` — the case where we may already have paid for
      // a scrape whose id we never wrote down.
      //
      // ONLY what is genuinely unattended, though. A ticking run schedules its
      // own follow-up with a fresh job id, and this sweep repeats every ten
      // minutes — so it used to hand every in-flight run a second, third and
      // fourth polling chain, none of which ever merged back. A ninety-minute
      // scrape ended up with nine chains asking Apify the same question every
      // twenty seconds. Skipping runs that already have a tick booked makes the
      // sweep what its name says: a recovery pass, not a multiplier.
      const rows = await resumableRuns();
      const booked = await scheduledListBuildRunIds();
      const orphaned = rows.filter((r) => !booked.has(r.id));
      for (const row of orphaned) {
        await outreachQueue.add(
          'list-build',
          { runId: row.id },
          { jobId: `list-build-resume-${row.id}`, removeOnComplete: true, removeOnFail: 50 },
        );
      }
      if (orphaned.length) {
        console.log('[outreach] resumed list runs', {
          resumed: orphaned.length,
          alreadyTicking: rows.length - orphaned.length,
        });
      }
      return;
    }
    if (job.name === 'prospect-purge') {
      // Undoing a run: every contact it created is taken out of its Smartlead
      // campaign and then deleted. Two paced API calls per contact puts this
      // well past what a request can hold open, and the operator closing the tab
      // must not abandon people half-removed from a running sequence.
      const { runId } = job.data as { runId: string };
      await purgeRunProspects(runId);
      return;
    }
  },
  { connection },
), 'outreach');


/**
 * Best-effort "amount to release" for the completion email, read from the
 * project's `amount` jsonb (shape varies by service type). Tries the common
 * numeric keys; returns undefined if none is found, in which case the email
 * omits the figure and uses an "Approve & Complete" CTA.
 */
function releaseAmountOf(amount: unknown): number | undefined {
  if (!amount || typeof amount !== 'object') return undefined;
  const a = amount as Record<string, unknown>;
  const oneOff = (a.oneOff ?? {}) as Record<string, unknown>;
  const recurring = (a.recurring ?? {}) as Record<string, unknown>;
  const candidates = [
    a.dueToday,
    a.total,
    a.oneOffSubtotal,
    oneOff.total,
    oneOff.subtotal,
    oneOff.weeklyAfter,
    a.weekly,
    a.weeklyAfter,
    recurring.weeklyAfter,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/** Resolve the brand + agency parties for a purchase (payment-failed recipients). */
async function resolvePurchaseParties(purchaseId: string) {
  if (!purchaseId) return null;
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .limit(1)
  )[0] ?? null;
  // A failed payment leaves the purchase in `pending_purchases` (it's promoted to
  // `purchases` only on success), so resolve the parties from the pending
  // snapshot when the real row doesn't exist yet.
  let brandId: string | null;
  let agencyId: string | null;
  if (purchase) {
    brandId = purchase.brandId ?? null;
    agencyId = purchase.proposalSentByAgencyId ?? null;
    if (!agencyId) {
      const item = (
        await db
          .select({ agencyId: purchaseItems.agencyId })
          .from(purchaseItems)
          .where(eq(purchaseItems.purchaseId, purchaseId))
          .limit(1)
      )[0];
      agencyId = item?.agencyId ?? null;
    }
  } else {
    const pending = (await db.select().from(pendingPurchases).where(eq(pendingPurchases.id, purchaseId)).limit(1))[0];
    if (!pending) return null;
    brandId = pending.data.purchase.brandId ?? null;
    agencyId = pending.data.purchase.proposalSentByAgencyId ?? pending.data.items[0]?.agencyId ?? null;
  }
  const brand = brandId
    ? ((
        await db
          .select()
          .from(brands)
          .where(eq(brands.id, brandId))
          .limit(1)
      )[0] ?? null)
    : null;
  const agency = agencyId
    ? ((
        await db
          .select()
          .from(agencies)
          .where(eq(agencies.id, agencyId))
          .limit(1)
      )[0] ?? null)
    : null;
  return { brand, agency, purchaseId };
}

/** Resolve the best contact email for an agency: its business email, else the proposal sender, else the owner. */
async function agencyContactEmail(
  agencyId: string | null,
  senderUserId: string | null,
): Promise<string | undefined> {
  const agency = agencyId
    ? (
        await db
          .select()
          .from(agencies)
          .where(eq(agencies.id, agencyId))
          .limit(1)
      )[0]
    : null;
  if (agency?.businessEmail) return agency.businessEmail;
  const userId = senderUserId ?? agency?.ownerId ?? null;
  if (!userId) return undefined;
  return (
    (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0]
      ?.email ?? undefined
  );
}

// Register the weekly payout cron (Fri 23:59) — idempotent on jobId.
await payoutQueue.add(
  'cron',
  {},
  { repeat: { pattern: '59 23 * * 5' }, jobId: 'payout-weekly' },
);
// Hourly wise leg-2 retry — re-send payouts whose Stripe funding settled but
// whose Wise balance hadn't been credited yet when the send was first tried
// (funds in transit). Idempotent on jobId; never re-runs leg-1 funding.
await payoutQueue.add(
  'wise-leg2-retry',
  {},
  { repeat: { pattern: '0 * * * *' }, jobId: 'wise-leg2-retry-hourly' },
);
// Recurring projects now re-cycle via EXACT-TIME per-project delayed jobs
// (recurring-schedule.scheduleProjectCycle), not a sweep. Remove the legacy
// hourly cron if present and register a once-daily reconciliation backstop that
// catches any cycle job lost to a Redis flush.
await kanbanQueue
  .removeRepeatable('cron', { pattern: '0 * * * *' })
  .catch(() => {});
await kanbanQueue.add(
  'reconcile',
  {},
  { repeat: { pattern: '0 3 * * *' }, jobId: 'kanban-reconcile' },
);

// Daily sweep of abandoned (unpaid) pending purchases (2 AM) — idempotent on jobId.
await pendingPurchasesQueue.add(
  'cleanup',
  {},
  { repeat: { pattern: '0 2 * * *' }, jobId: 'pending-purchases-cleanup' },
);

// Daily "your beta is ending" sweep (8 AM) — sends the 7-day, 3-day and day-of
// notices. Idempotent on jobId, and the sweep itself dedupes per
// (user, milestone, deadline), so a missed day catches up without double-sending.
await betaQueue.add(
  'reminders',
  {},
  { repeat: { pattern: '0 8 * * *' }, jobId: 'beta-reminders-daily' },
);

// Daily sweep of parked short links disabled >= 30 days (3 AM) — idempotent on jobId.
await shortLinksQueue.add(
  'cleanup',
  {},
  { repeat: { pattern: '0 3 * * *' }, jobId: 'short-links-cleanup' },
);

// Outreach reconcile, every 15 minutes — retries webhook events that were
// received but never processed, and suppressions that never reached Smartlead's
// block list. Both are silent failures otherwise: an unprocessed reply never
// reaches the queue, and an unpushed suppression means someone can be emailed again.
await outreachQueue.add(
  'reconcile',
  {},
  { repeat: { pattern: '*/15 * * * *' }, jobId: 'outreach-reconcile' },
);

// Pick list runs back up after a restart. Fires once at boot and then every
// 10 minutes, because a delayed tick lost to a deploy leaves a run silently
// parked — and a run parked in `starting` is one that may have already been
// paid for. The tick itself is idempotent, so a redundant nudge costs nothing.
await outreachQueue.add('list-build-resume', {}, { removeOnComplete: true });
await outreachQueue.add(
  'list-build-resume',
  {},
  { repeat: { pattern: '*/10 * * * *' }, jobId: 'outreach-list-build-resume' },
);

// Payments (EziQuotes) tool — its own payments-* queues + cron repeatables
// (auto-chase, recurring invoices, installment reminders/auto-charge, outbound
// webhook retries, sequence sweep). See modules/payments/queues.ts.
const { startPaymentsWorkers, registerPaymentsRepeatables } = await import(
  '../modules/payments/queues.js'
);
startPaymentsWorkers();
await registerPaymentsRepeatables();

console.log(
  '▸ Prodesk worker started (email, payout, chat-digest, kanban, video, pending-purchases, beta, short-links, outreach, payments-*)',
);
