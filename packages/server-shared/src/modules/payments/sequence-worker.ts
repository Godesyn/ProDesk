/**
 * Payments (EziQuotes) sequence worker — processes sequence steps for cold,
 * engagement, and missed_payment sequences. Ported from the Manus export's
 * server/sequenceWorker.ts; ids are uuids and tenancy is brandId.
 *
 * Job types dispatched to the 'payments-sequence' queue (modules/payments/queues.ts):
 *   - fire_touchpoint: fire a single touchpoint for a sequence run
 *   - schedule_cold: start a cold sequence for a newly-sent proposal
 *   - evaluate_engagement: check view count and fire engagement touchpoints
 *   - handle_missed_payment: start missed_payment sequence after payment failure
 *   - recover_handoff: escalate to Recover tier handling (day 14 for Recover-tier accounts)
 *
 * Placeholder tokens supported:
 *   {{payer_first_name}}, {{payer_name}}, {{business_name}}, {{proposal_title}},
 *   {{proposal_url}}, {{portal_url}}, {{sender_name}}
 *
 * Spec compliance:
 *   - Quiet hours (8pm–8am): SMS is queued for 8am release, not skipped.
 *   - Cold sequence: auto-pauses when proposal reaches accept/decline/in_conversation.
 *   - Engagement sequence: cooldown per tier (tier1=24h, tier2=6h, tier3=2h), 3-message max per proposal.
 *   - Missed payment: handleRecoverHandoff fires on day 14 for Recover-tier accounts.
 */
import { and, count as drizzleCount, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  paymentAccounts,
  paymentClients,
  proposals,
  paymentSequenceDefinitions,
  paymentSequenceMessageLog,
  paymentSequenceRuns,
  users,
} from '../../db/schema.js';
import { emailBaseUrl } from '../email/branding.js';
import { env } from '../../lib/env.js';
import { sendEmail as sendPlatformEmail } from '../email/mailer.js';
import { brandOwnerId } from '../feature-subscriptions/entitlements.js';
import { sendSms } from './sms.js';
import { sendEmail } from './email.js';

// ── Quiet hours helpers ───────────────────────────────────────────────────────
/** Returns the next 8am UTC+10 (AEST) from now, used for queue-and-release. */
function nextQuietHoursRelease(): Date {
  const now = new Date();
  // AEST = UTC+10
  const aestOffsetMs = 10 * 60 * 60 * 1000;
  const aestNow = new Date(now.getTime() + aestOffsetMs);
  const localHour = aestNow.getUTCHours();
  // If before 8am, release at 8am today; otherwise release at 8am tomorrow
  const release = new Date(aestNow);
  release.setUTCHours(8, 0, 0, 0);
  if (localHour >= 8 && localHour < 20) {
    // Currently in sending window — should not be called, but return now just in case
    return now;
  }
  if (localHour >= 20) {
    // After 8pm — next 8am is tomorrow
    release.setUTCDate(release.getUTCDate() + 1);
  }
  // Convert back to UTC
  return new Date(release.getTime() - aestOffsetMs);
}

function isCurrentlyQuietHours(): boolean {
  const aestOffsetMs = 10 * 60 * 60 * 1000;
  const aestNow = new Date(Date.now() + aestOffsetMs);
  const localHour = aestNow.getUTCHours();
  return localHour < 8 || localHour >= 20;
}

// ── Engagement cooldown config ────────────────────────────────────────────────
/** Cooldown in milliseconds per engagement view-tier */
const ENGAGEMENT_COOLDOWN_MS: Record<string, number> = {
  tier1: 24 * 60 * 60 * 1000, // 24h — first view
  tier2: 6 * 60 * 60 * 1000, // 6h  — second view
  tier3: 2 * 60 * 60 * 1000, // 2h  — third+ view
};
const ENGAGEMENT_MAX_MESSAGES = 3;

// ── Placeholder renderer ──────────────────────────────────────────────────────
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

/** Base origin for payer-facing links in worker-sent messages (no request ctx). */
function paymentsOrigin(): string {
  return emailBaseUrl(env.PAYMENTS_ORIGIN ?? null);
}

// ── Payload types ─────────────────────────────────────────────────────────────
export interface FireTouchpointPayload {
  runId: string;
  touchpointIndex: number;
}

export interface ScheduleColdPayload {
  proposalId: string;
  brandId: string;
}

export interface EvaluateEngagementPayload {
  proposalId: string;
  brandId: string;
  viewCount: number;
}

export interface HandleMissedPaymentPayload {
  proposalId: string;
  brandId: string;
}

// ── Auto-pause terminal proposal states ──────────────────────────────────────
const TERMINAL_PROPOSAL_STATES = ['accepted', 'declined', 'in_conversation', 'paid', 'expired'];

// ── Core: fire a single touchpoint ───────────────────────────────────────────
export async function fireTouchpoint(payload: FireTouchpointPayload): Promise<void> {
  const [run] = await db
    .select()
    .from(paymentSequenceRuns)
    .where(eq(paymentSequenceRuns.id, payload.runId))
    .limit(1);
  if (!run) return;
  if (run.status === 'halted' || run.status === 'completed' || run.status === 'paused') return;

  // Auto-pause cold sequences when proposal reaches a terminal state
  if (run.sequenceType === 'cold') {
    const [proposal] = await db
      .select({ status: proposals.status })
      .from(proposals)
      .where(eq(proposals.id, run.proposalId))
      .limit(1);
    if (proposal && TERMINAL_PROPOSAL_STATES.includes(proposal.status)) {
      await db
        .update(paymentSequenceRuns)
        .set({
          status: 'halted',
          haltReason: 'proposal_auto_pause',
          updatedAt: new Date(),
        })
        .where(eq(paymentSequenceRuns.id, run.id));
      return;
    }
  }

  // Get definition
  const [def] = await db
    .select()
    .from(paymentSequenceDefinitions)
    .where(
      and(
        eq(paymentSequenceDefinitions.brandId, run.brandId),
        eq(paymentSequenceDefinitions.sequenceType, run.sequenceType),
      ),
    )
    .limit(1);
  if (!def || !def.isActive) return;

  const touchpoints = def.touchpoints ?? [];

  const tp = touchpoints[payload.touchpointIndex];
  if (!tp || !tp.isActive) return;

  // Get proposal + client + account for placeholder data
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, run.proposalId))
    .limit(1);
  if (!proposal) return;
  const [client] = proposal.recipientContactId
    ? await db
        .select()
        .from(paymentClients)
        .where(eq(paymentClients.id, proposal.recipientContactId))
        .limit(1)
    : [undefined];
  const [account] = await db
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.brandId, run.brandId))
    .limit(1);

  const portalUrl = proposal.slug ? `${paymentsOrigin()}/p/${proposal.slug}` : '';

  const vars: Record<string, string> = {
    payer_first_name: (client?.name ?? 'there').split(' ')[0],
    payer_name: client?.name ?? 'there',
    business_name: account?.businessName ?? 'us',
    proposal_title: proposal.title ?? 'your proposal',
    proposal_url: portalUrl,
    portal_url: portalUrl,
    sender_name: account?.businessName ?? 'The team',
  };

  // Fire SMS — with quiet hours queue-and-release
  if (tp.smsEnabled && tp.smsBody && client?.mobile) {
    if (isCurrentlyQuietHours()) {
      // Queue for 8am release: update the run's nextFireAt and return without sending
      const releaseAt = nextQuietHoursRelease();
      await db
        .update(paymentSequenceRuns)
        .set({
          nextFireAt: releaseAt,
          updatedAt: new Date(),
        })
        .where(eq(paymentSequenceRuns.id, run.id));
      await db.insert(paymentSequenceMessageLog).values({
        sequenceRunId: run.id,
        touchpointIndex: payload.touchpointIndex,
        channel: 'sms',
        status: 'queued',
        skipReason: `quiet_hours_queued_until_${releaseAt.toISOString()}`,
        renderedBody: renderTemplate(tp.smsBody, vars),
        placeholdersUsed: vars,
      });
      return; // The BullMQ scheduler will retry at nextFireAt
    }
    try {
      const body = renderTemplate(tp.smsBody, vars);
      await sendSms({ to: client.mobile, body, brandId: run.brandId, skipQuietHours: true });
      await db.insert(paymentSequenceMessageLog).values({
        sequenceRunId: run.id,
        touchpointIndex: payload.touchpointIndex,
        channel: 'sms',
        status: 'sent',
        renderedBody: body,
        placeholdersUsed: vars,
      });
    } catch (err) {
      await db.insert(paymentSequenceMessageLog).values({
        sequenceRunId: run.id,
        touchpointIndex: payload.touchpointIndex,
        channel: 'sms',
        status: 'failed',
        skipReason: String(err),
        renderedBody: tp.smsBody,
        placeholdersUsed: vars,
      });
    }
  } else if (tp.smsEnabled && !client?.mobile) {
    await db.insert(paymentSequenceMessageLog).values({
      sequenceRunId: run.id,
      touchpointIndex: payload.touchpointIndex,
      channel: 'sms',
      status: 'skipped',
      skipReason: 'no_phone',
      renderedBody: tp.smsBody,
      placeholdersUsed: vars,
    });
  }

  // Fire email
  if (tp.emailEnabled && tp.emailBody && client?.email) {
    try {
      const body = renderTemplate(tp.emailBody, vars);
      const subject = renderTemplate(tp.emailSubject, vars);
      await sendEmail({ to: client.email, subject, htmlBody: body, textBody: body });
      await db.insert(paymentSequenceMessageLog).values({
        sequenceRunId: run.id,
        touchpointIndex: payload.touchpointIndex,
        channel: 'email',
        status: 'sent',
        renderedBody: body,
        placeholdersUsed: vars,
      });
    } catch (err) {
      await db.insert(paymentSequenceMessageLog).values({
        sequenceRunId: run.id,
        touchpointIndex: payload.touchpointIndex,
        channel: 'email',
        status: 'failed',
        skipReason: String(err),
        renderedBody: tp.emailBody,
        placeholdersUsed: vars,
      });
    }
  }

  // Update run state
  const firedList = [...(run.touchpointsFired ?? [])];
  firedList.push({ touchpointIndex: payload.touchpointIndex, firedAt: new Date().toISOString() });

  const nextIndex = payload.touchpointIndex + 1;
  const isLast = nextIndex >= touchpoints.length;

  // Schedule the next time-based touchpoint. The export never advanced
  // nextFireAt after a fire (its scheduler was dormant — see MIGRATION-NOTES),
  // so multi-touchpoint sequences stalled after the first message. dayOffset is
  // relative to sequence start (run.createdAt); an already-overdue next
  // touchpoint gets a 1-hour grace instead of firing instantly. Engagement
  // sequences are view-driven (evaluateEngagement sets nextFireAt), not timed.
  let nextFireAt: Date | null = null;
  const nextTp = touchpoints[nextIndex];
  if (!isLast && run.sequenceType !== 'engagement' && typeof nextTp?.dayOffset === 'number') {
    const base = run.createdAt ?? new Date();
    const candidate = new Date(base.getTime() + nextTp.dayOffset * 24 * 60 * 60 * 1000);
    nextFireAt = candidate > new Date() ? candidate : new Date(Date.now() + 60 * 60 * 1000);
  }

  await db
    .update(paymentSequenceRuns)
    .set({
      touchpointsFired: firedList,
      status: isLast ? 'completed' : 'running',
      nextFireAt,
      updatedAt: new Date(),
    })
    .where(eq(paymentSequenceRuns.id, run.id));
}

// ── Schedule cold sequence ────────────────────────────────────────────────────
export async function scheduleColdSequence(payload: ScheduleColdPayload): Promise<void> {
  // Check if a cold run already exists for this proposal
  const [existing] = await db
    .select({ id: paymentSequenceRuns.id })
    .from(paymentSequenceRuns)
    .where(
      and(
        eq(paymentSequenceRuns.proposalId, payload.proposalId),
        eq(paymentSequenceRuns.sequenceType, 'cold'),
      ),
    )
    .limit(1);
  if (existing) return;

  // Get definition
  const [def] = await db
    .select()
    .from(paymentSequenceDefinitions)
    .where(
      and(
        eq(paymentSequenceDefinitions.brandId, payload.brandId),
        eq(paymentSequenceDefinitions.sequenceType, 'cold'),
      ),
    )
    .limit(1);
  if (!def || !def.isActive) return;

  const touchpoints = def.touchpoints ?? [];
  const firstActive = touchpoints.find((tp) => tp.isActive);
  if (!firstActive) return;

  const delayMs = (firstActive.dayOffset ?? 2) * 24 * 60 * 60 * 1000;
  const nextFireAt = new Date(Date.now() + delayMs);

  await db.insert(paymentSequenceRuns).values({
    proposalId: payload.proposalId,
    brandId: payload.brandId,
    sequenceType: 'cold',
    status: 'pending',
    nextFireAt,
  });
}

// ── Evaluate engagement sequence ──────────────────────────────────────────────
export async function evaluateEngagement(payload: EvaluateEngagementPayload): Promise<void> {
  const [def] = await db
    .select()
    .from(paymentSequenceDefinitions)
    .where(
      and(
        eq(paymentSequenceDefinitions.brandId, payload.brandId),
        eq(paymentSequenceDefinitions.sequenceType, 'engagement'),
      ),
    )
    .limit(1);
  if (!def || !def.isActive) return;

  const touchpoints = def.touchpoints ?? [];

  // Determine view tier label for cooldown lookup
  const viewTierLabel = payload.viewCount >= 3 ? 'tier3' : payload.viewCount === 2 ? 'tier2' : 'tier1';
  // Also map to hot/warm for touchpoint matching
  const viewTier = payload.viewCount >= 3 ? 'hot' : 'warm';
  const matchingTpIndex = touchpoints.findIndex((tp) => tp.viewTier === viewTier && tp.isActive);
  if (matchingTpIndex === -1) return;

  // Check if engagement run exists
  const [existing] = await db
    .select()
    .from(paymentSequenceRuns)
    .where(
      and(
        eq(paymentSequenceRuns.proposalId, payload.proposalId),
        eq(paymentSequenceRuns.sequenceType, 'engagement'),
        inArray(paymentSequenceRuns.status, ['pending', 'running', 'completed']),
      ),
    )
    .limit(1);

  if (!existing) {
    // Create run and fire immediately
    const [run] = await db
      .insert(paymentSequenceRuns)
      .values({
        proposalId: payload.proposalId,
        brandId: payload.brandId,
        sequenceType: 'engagement',
        status: 'running',
        viewCount: payload.viewCount,
        lastViewAt: new Date(),
        nextFireAt: new Date(),
      })
      .returning();
    await fireTouchpoint({ runId: run.id, touchpointIndex: matchingTpIndex });
  } else {
    // Check 3-message max
    const [msgCountRow] = await db
      .select({ cnt: drizzleCount() })
      .from(paymentSequenceMessageLog)
      .where(
        and(
          eq(paymentSequenceMessageLog.sequenceRunId, existing.id),
          inArray(paymentSequenceMessageLog.status, ['sent', 'queued']),
        ),
      );
    const msgCount = Number(msgCountRow?.cnt ?? 0);
    if (msgCount >= ENGAGEMENT_MAX_MESSAGES) return;

    // Cooldown check — reset on new view
    const lastViewAt = existing.lastViewAt ? new Date(existing.lastViewAt).getTime() : 0;
    const cooldownMs = ENGAGEMENT_COOLDOWN_MS[viewTierLabel] ?? ENGAGEMENT_COOLDOWN_MS.tier1;
    const timeSinceLastView = Date.now() - lastViewAt;
    if (timeSinceLastView < cooldownMs) return;

    // Update view count + fire next touchpoint
    await db
      .update(paymentSequenceRuns)
      .set({
        viewCount: payload.viewCount,
        lastViewAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentSequenceRuns.id, existing.id));
    await fireTouchpoint({ runId: existing.id, touchpointIndex: matchingTpIndex });
  }
}

// ── Handle missed payment ─────────────────────────────────────────────────────
export async function handleMissedPayment(payload: HandleMissedPaymentPayload): Promise<void> {
  const [existing] = await db
    .select({ id: paymentSequenceRuns.id, createdAt: paymentSequenceRuns.createdAt })
    .from(paymentSequenceRuns)
    .where(
      and(
        eq(paymentSequenceRuns.proposalId, payload.proposalId),
        eq(paymentSequenceRuns.sequenceType, 'missed_payment'),
        inArray(paymentSequenceRuns.status, ['pending', 'running']),
      ),
    )
    .limit(1);

  if (existing) {
    // Check day-14 Recover handoff
    const ageMs = Date.now() - new Date(existing.createdAt!).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays >= 14) {
      await handleRecoverHandoff({ proposalId: payload.proposalId, brandId: payload.brandId });
    }
    return;
  }

  const [def] = await db
    .select()
    .from(paymentSequenceDefinitions)
    .where(
      and(
        eq(paymentSequenceDefinitions.brandId, payload.brandId),
        eq(paymentSequenceDefinitions.sequenceType, 'missed_payment'),
      ),
    )
    .limit(1);
  if (!def || !def.isActive) return;

  const [run] = await db
    .insert(paymentSequenceRuns)
    .values({
      proposalId: payload.proposalId,
      brandId: payload.brandId,
      sequenceType: 'missed_payment',
      status: 'running',
      nextFireAt: new Date(),
    })
    .returning();

  // Fire first touchpoint immediately
  await fireTouchpoint({ runId: run.id, touchpointIndex: 0 });
}

// ── Recover handoff (day 14 for Recover-tier accounts) ───────────────────────
export async function handleRecoverHandoff(payload: HandleMissedPaymentPayload): Promise<void> {
  // Only escalate for Recover-tier accounts
  const [account] = await db
    .select({ tier: paymentAccounts.tier })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.brandId, payload.brandId))
    .limit(1);
  if (!account || account.tier !== 'recover') return;

  // Mark the missed_payment run as completed and create a recover_handoff event
  await db
    .update(paymentSequenceRuns)
    .set({
      status: 'completed',
      haltReason: 'recover_handoff_day14',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentSequenceRuns.proposalId, payload.proposalId),
        eq(paymentSequenceRuns.sequenceType, 'missed_payment'),
      ),
    );

  // Notify the brand owner (the Manus notifyOwner SDK is replaced by a platform email)
  try {
    const [proposal] = await db
      .select({ title: proposals.title, slug: proposals.slug })
      .from(proposals)
      .where(eq(proposals.id, payload.proposalId))
      .limit(1);
    const ownerId = await brandOwnerId(db, payload.brandId);
    const [owner] = ownerId
      ? await db.select({ email: users.email }).from(users).where(eq(users.id, ownerId)).limit(1)
      : [undefined];
    if (owner?.email) {
      await sendPlatformEmail({
        to: owner.email,
        subject: `🔴 Recover escalation: ${proposal?.title ?? 'Proposal'} — Day 14`,
        html: `The missed payment sequence for "${proposal?.title ?? 'a proposal'}" has reached day 14. This proposal has been escalated to Recover-tier handling. Review it in your dashboard.`,
      });
    }
  } catch (_) {
    /* non-critical */
  }
}
