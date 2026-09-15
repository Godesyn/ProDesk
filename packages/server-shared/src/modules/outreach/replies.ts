import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  outreachProspectState,
  outreachReplyDrafts,
  type OutreachClassification,
  type OutreachProspectState,
} from '../../db/schema.js';
import { draftReply } from './classify.js';
import { replyToThread } from './smartlead.js';
import { suppress } from './suppression.js';

/**
 * The reply queue's data layer.
 *
 * Every outgoing reply passes through a human (§2.9). Nothing in this file can
 * send without an explicit approval call, and the draft the model wrote is kept
 * verbatim even after a human edits it — so "what did the model suggest" stays
 * answerable after the fact.
 */

/**
 * Draft a reply and put it in the queue.
 *
 * Called from the webhook when a reply classifies as `yes` or `question`. Never
 * throws: a drafting failure must not lose the reply, so an empty draft is
 * queued instead and the queue renders it as "write this one yourself".
 */
export async function queueReplyDraft(opts: {
  prospect: OutreachProspectState | null;
  email: string;
  campaignId: number | null;
  emailStatsId: string | null;
  messageId: string | null;
  classification: OutreachClassification;
  replyBody: string;
}): Promise<void> {
  try {
    // One open draft per prospect. A second reply before the first is answered
    // should update the queue item, not stack a duplicate in front of the operator.
    const [open] = await db
      .select({ id: outreachReplyDrafts.id })
      .from(outreachReplyDrafts)
      .where(
        and(
          eq(outreachReplyDrafts.email, opts.email),
          sql`${outreachReplyDrafts.status} IN ('pending','approved','edited')`,
        ),
      )
      .limit(1);

    const body = await draftReply({
      db,
      classification: opts.classification,
      replyBody: opts.replyBody,
      businessName: opts.prospect?.businessName ?? null,
      accountLinkHint: opts.classification === 'yes' ? 'yes' : null,
    });

    if (open) {
      await db
        .update(outreachReplyDrafts)
        .set({
          draftBody: body,
          smartleadEmailStatsId: opts.emailStatsId,
          smartleadMessageId: opts.messageId,
          status: 'pending',
        })
        .where(eq(outreachReplyDrafts.id, open.id));
      return;
    }

    await db.insert(outreachReplyDrafts).values({
      prospectId: opts.prospect?.id ?? null,
      email: opts.email,
      smartleadCampaignId: opts.campaignId,
      smartleadEmailStatsId: opts.emailStatsId,
      smartleadMessageId: opts.messageId,
      draftBody: body,
      status: 'pending',
    });
  } catch (e) {
    console.error('[outreach] queueReplyDraft failed', opts.email, (e as Error).message);
  }
}

export interface QueueItem {
  id: string;
  email: string;
  businessName: string | null;
  website: string | null;
  classification: OutreachClassification | null;
  classificationReasoning: string | null;
  classificationConfidence: string | null;
  manualClassification: OutreachClassification | null;
  draftBody: string;
  status: string;
  campaignId: number | null;
  emailStatsId: string | null;
  fulfilmentStatus: string | null;
  createdAt: Date;
}

/**
 * The queue, oldest first.
 *
 * Oldest-first on purpose: a reply that has been waiting two days is more urgent
 * than one that arrived a minute ago, and the person who wrote it is deciding
 * right now whether we're worth dealing with.
 */
export async function listQueue(limit = 100): Promise<QueueItem[]> {
  const rows = await db
    .select({
      id: outreachReplyDrafts.id,
      email: outreachReplyDrafts.email,
      draftBody: outreachReplyDrafts.draftBody,
      status: outreachReplyDrafts.status,
      campaignId: outreachReplyDrafts.smartleadCampaignId,
      emailStatsId: outreachReplyDrafts.smartleadEmailStatsId,
      createdAt: outreachReplyDrafts.createdAt,
      businessName: outreachProspectState.businessName,
      website: outreachProspectState.website,
      classification: outreachProspectState.classification,
      classificationReasoning: outreachProspectState.classificationReasoning,
      classificationConfidence: outreachProspectState.classificationConfidence,
      manualClassification: outreachProspectState.manualClassification,
      fulfilmentStatus: outreachProspectState.fulfilmentStatus,
    })
    .from(outreachReplyDrafts)
    .leftJoin(
      outreachProspectState,
      eq(outreachProspectState.email, outreachReplyDrafts.email),
    )
    .where(sql`${outreachReplyDrafts.status} IN ('pending','approved','edited')`)
    .orderBy(outreachReplyDrafts.createdAt)
    .limit(limit);

  return rows as QueueItem[];
}

/** How many replies are waiting — drives the tab badge. */
export async function pendingCount(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachReplyDrafts)
    .where(sql`${outreachReplyDrafts.status} IN ('pending','approved','edited')`);
  return row?.n ?? 0;
}

/**
 * Send an approved reply through Smartlead, from the mailbox that owns the thread.
 *
 * The suppression check immediately before sending is not redundant with the
 * one at list-build time: someone can unsubscribe between a draft being queued
 * and a human approving it, and sending after that is the exact mistake that
 * generates a complaint.
 */
export async function sendReply(opts: {
  draftId: string;
  body: string;
  userId: string;
  /** Appended verbatim after the body — the Verdiict account link on a `yes`. */
  appendLink?: string | null;
}): Promise<{ sent: true }> {
  const [draft] = await db
    .select()
    .from(outreachReplyDrafts)
    .where(eq(outreachReplyDrafts.id, opts.draftId))
    .limit(1);

  if (!draft) throw new Error('That reply is no longer in the queue.');
  if (draft.status === 'sent') throw new Error('That reply has already been sent.');
  if (!draft.smartleadEmailStatsId) {
    throw new Error(
      'Smartlead did not give this reply a thread reference, so it cannot be answered in-thread.',
    );
  }
  // The reply endpoint is campaign-scoped, so a draft with no campaign has
  // nowhere to go. This used to fall back to `?? 0` and post to
  // `/campaigns/0/reply-email-thread`, which surfaces as a Smartlead 404 about
  // a campaign that was never real — the wrong sentence in front of somebody
  // deciding whether their answer went out.
  const campaignId = draft.smartleadCampaignId;
  if (!campaignId) {
    throw new Error(
      'This reply is not attached to a campaign, so Smartlead has no thread to answer in. Reply from the mailbox directly.',
    );
  }

  const { filterSuppressed } = await import('./suppression.js');
  const blocked = await filterSuppressed([draft.email]);
  if (blocked.has(draft.email)) {
    throw new Error(`${draft.email} is on the suppression list. Nothing was sent.`);
  }

  const body = opts.appendLink ? `${opts.body.trim()}\n\n${opts.appendLink}` : opts.body.trim();

  /*
   * Claim the draft BEFORE the send, not after.
   *
   * The status check above is a read, and the window between it and the write
   * below is wide enough to double-send: two tabs on the queue, a double-click
   * on Approve, or an operator retrying what looked like a hang. Sending the
   * same reply twice to a prospect is the one mistake on this screen that
   * cannot be taken back, so the row is claimed with a conditional update and
   * a caller that loses the race is told so instead of sending.
   *
   * `sent_at` is stamped by the claim, and rolled back below if Smartlead
   * refuses — a draft stuck as sent when nothing was sent would be worse than
   * the race it prevents.
   */
  const claimed = await db
    .update(outreachReplyDrafts)
    .set({
      status: 'sent',
      sentBody: body,
      sentAt: new Date(),
      approvedByUserId: opts.userId,
      approvedAt: draft.approvedAt ?? new Date(),
    })
    .where(
      and(eq(outreachReplyDrafts.id, opts.draftId), sql`${outreachReplyDrafts.status} <> 'sent'`),
    )
    .returning({ id: outreachReplyDrafts.id });

  if (claimed.length === 0) throw new Error('That reply has already been sent.');

  try {
    await replyToThread(campaignId, {
      email_stats_id: draft.smartleadEmailStatsId,
      email_body: body,
    });
  } catch (e) {
    await db
      .update(outreachReplyDrafts)
      .set({ status: draft.status, sentAt: null })
      .where(eq(outreachReplyDrafts.id, opts.draftId))
      .catch(() => {});
    throw e;
  }

  return { sent: true };
}

/**
 * Drop a reply out of the queue without answering it.
 *
 * `alsoSuppress` is the queue's one-key "never contact again" — it writes the
 * suppression and discards in a single action, because those two always happen
 * together and making them separate steps invites doing only the first.
 */
export async function discardDraft(opts: {
  draftId: string;
  userId: string;
  alsoSuppress: boolean;
}): Promise<void> {
  const [draft] = await db
    .select({ email: outreachReplyDrafts.email })
    .from(outreachReplyDrafts)
    .where(eq(outreachReplyDrafts.id, opts.draftId))
    .limit(1);

  await db
    .update(outreachReplyDrafts)
    .set({ status: 'discarded', discardedAt: new Date(), approvedByUserId: opts.userId })
    .where(eq(outreachReplyDrafts.id, opts.draftId));

  if (opts.alsoSuppress && draft?.email) {
    await suppress({
      value: draft.email,
      kind: 'email',
      reason: 'suppressed from the reply queue',
      source: 'operator',
      addedByUserId: opts.userId,
    });
  }
}

/** Save an edit without sending. Keeps `draftBody` (the model's words) intact. */
export async function saveDraftEdit(draftId: string, body: string): Promise<void> {
  await db
    .update(outreachReplyDrafts)
    .set({ sentBody: body, status: 'edited' })
    .where(eq(outreachReplyDrafts.id, draftId));
}

/** The most recent draft for a prospect, for the Prospects detail view. */
export async function latestDraftFor(email: string) {
  const [row] = await db
    .select()
    .from(outreachReplyDrafts)
    .where(eq(outreachReplyDrafts.email, email))
    .orderBy(desc(outreachReplyDrafts.createdAt))
    .limit(1);
  return row ?? null;
}
