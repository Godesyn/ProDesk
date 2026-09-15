import { createHash, timingSafeEqual } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { redis } from '../../jobs/queues.js';
import { outreachEvents, outreachProspectState } from '../../db/schema.js';
import { env } from '../../lib/env.js';
import { recordLastSent } from './sending-floor.js';
import { classifyReply, isHardStop } from './classify.js';
import { suppress } from './suppression.js';
import { queueReplyDraft } from './replies.js';
import {
  createWebhook,
  isSmartleadConfigured,
  type SmartleadWebhookEvent,
} from './smartlead.js';

/**
 * Smartlead webhook receiver.
 *
 * Smartlead does not sign its callbacks and its payloads carry no event id
 * (verified — see outreach-api-findings.md ⚠️2). Two consequences drive the
 * whole design of this file:
 *
 *  1. **The URL is the credential.** `/api/outreach/webhook/<secret>` with the
 *     secret compared in constant time. Anyone who learns the path can forge
 *     events, so it is held in env and never logged.
 *  2. **Idempotency is synthetic.** A hash of type + campaign + recipient +
 *     event time, unique-indexed on `outreach_events`. Smartlead retries, and
 *     without this a retried EMAIL_REPLY would queue a second draft.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * Registration
 *
 * Nothing above reaches this file until Smartlead has been TOLD the URL, and
 * Smartlead has no way to discover it. The whole reply chain — classify, draft,
 * queue, hand off — hangs off a single `POST /webhook/create` that had never
 * been called from anywhere, so every environment was sitting behind an
 * endpoint no event would ever arrive at.
 *
 * The id has to be recorded HERE at registration time, because there is no
 * account-level webhook list to discover it from afterwards: `/webhook` 404s
 * and `/webhook/{id}` validates the segment as a numeric id (verified live —
 * see outreach-api-findings.md "Corrections"). Redis, not a table: losing it
 * costs one re-registration, which is idempotent by URL anyway.
 * ────────────────────────────────────────────────────────────────────────── */

const WEBHOOK_ID_KEY = 'outreach:webhook-id';

/**
 * The events worth waking us for.
 *
 * Opens and clicks are deliberately off. They are the highest-volume events
 * Smartlead emits by an order of magnitude, nothing in this file acts on them,
 * and every one of them would be a row in `outreach_events` and a database
 * round trip for a fact no screen reads.
 */
const SUBSCRIBED: SmartleadWebhookEvent[] = [
  'EMAIL_SENT',
  'FIRST_EMAIL_SENT',
  'EMAIL_REPLY',
  'EMAIL_BOUNCE',
  'LEAD_UNSUBSCRIBED',
  'EMAIL_ACCOUNT_DISCONNECTED',
];

/**
 * Where Smartlead should post, or null when this environment has no secret.
 *
 * The secret IS the credential, so a missing one is not "use a shorter URL" —
 * it is "there is no endpoint", and `mountOutreachWebhook` already refuses
 * every request in that state.
 */
export function outreachWebhookUrl(): string | null {
  const secret = env.OUTREACH_WEBHOOK_SECRET;
  if (!secret) return null;
  return `${env.SERVER_ORIGIN.replace(/\/+$/, '')}/api/outreach/webhook/${encodeURIComponent(secret)}`;
}

export interface WebhookStatus {
  /** False when OUTREACH_WEBHOOK_SECRET is unset — the endpoint is closed. */
  secretConfigured: boolean;
  smartleadConfigured: boolean;
  /** Null when there is no secret to build one from. Carries the secret. */
  url: string | null;
  /** Smartlead's id for the webhook we registered, if we have ever registered one. */
  registeredId: number | null;
  /** The URL we registered, so a changed SERVER_ORIGIN is visible as a mismatch. */
  registeredUrl: string | null;
  registeredAt: string | null;
  events: SmartleadWebhookEvent[];
  /**
   * Whether an event has ever actually arrived. The only end-to-end proof —
   * registration succeeding says Smartlead accepted a URL, not that it can
   * reach it, which is exactly the failure a localhost origin produces.
   */
  lastEventAt: string | null;
  eventCount: number;
}

interface StoredRegistration {
  id: number | null;
  url: string;
  at: string;
}

async function readRegistration(): Promise<StoredRegistration | null> {
  try {
    const raw = await redis.get(WEBHOOK_ID_KEY);
    return raw ? (JSON.parse(raw) as StoredRegistration) : null;
  } catch {
    return null;
  }
}

export async function outreachWebhookStatus(): Promise<WebhookStatus> {
  const url = outreachWebhookUrl();
  const [registration, [latest], [counted]] = await Promise.all([
    readRegistration(),
    db
      .select({ receivedAt: outreachEvents.receivedAt })
      .from(outreachEvents)
      .orderBy(desc(outreachEvents.receivedAt))
      .limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(outreachEvents),
  ]);

  return {
    secretConfigured: !!env.OUTREACH_WEBHOOK_SECRET,
    smartleadConfigured: isSmartleadConfigured(),
    url,
    registeredId: registration?.id ?? null,
    registeredUrl: registration?.url ?? null,
    registeredAt: registration?.at ?? null,
    events: SUBSCRIBED,
    lastEventAt: latest?.receivedAt?.toISOString() ?? null,
    eventCount: counted?.n ?? 0,
  };
}

/**
 * Point Smartlead at this environment's endpoint.
 *
 * One USER-level webhook covers every campaign, so this is a one-time setup act
 * per environment — and re-runnable, because the only thing a second call can
 * do is replace a URL that has drifted (a new Railway domain, a rotated
 * secret). `force_create` is not sent: Smartlead treats a repeat of the same
 * name as an update, which is the behaviour we want.
 */
export async function registerOutreachWebhook(): Promise<WebhookStatus> {
  const url = outreachWebhookUrl();
  if (!url) {
    throw new Error(
      'There is no webhook secret for this environment, so there is no endpoint to register. Set OUTREACH_WEBHOOK_SECRET.',
    );
  }
  if (/localhost|127\.0\.0\.1/i.test(url)) {
    throw new Error(
      `Smartlead cannot reach ${env.SERVER_ORIGIN}. Register the webhook from a deployed environment, or point SERVER_ORIGIN at a tunnel.`,
    );
  }

  const result = (await createWebhook({
    name: `ProDesk Outreach — ${env.NODE_ENV}`,
    webhook_url: url,
    event_type_map: Object.fromEntries(SUBSCRIBED.map((e) => [e, true])),
  })) as { id?: number; data?: { id?: number } } | null;

  const id = result?.id ?? result?.data?.id ?? null;
  const stored: StoredRegistration = { id, url, at: new Date().toISOString() };
  await redis.set(WEBHOOK_ID_KEY, JSON.stringify(stored)).catch(() => undefined);
  return outreachWebhookStatus();
}

/** Events we act on. Anything else is still recorded, just not processed. */
type HandledEvent =
  | 'EMAIL_SENT'
  | 'FIRST_EMAIL_SENT'
  | 'EMAIL_REPLY'
  | 'EMAIL_BOUNCE'
  | 'LEAD_UNSUBSCRIBED'
  | 'EMAIL_ACCOUNT_DISCONNECTED';

interface SmartleadEventPayload {
  event_type?: string;
  campaign_id?: number | string;
  to_email?: string;
  from_email?: string;
  lead_email?: string;
  subject?: string;
  reply_body?: string;
  preview_text?: string;
  sequence_number?: number;
  event_timestamp?: string;
  time_replied?: string;
  sent_at?: string;
  stats_id?: string;
  message_id?: string;
  [k: string]: unknown;
}

/** Normalised: lowercase + trimmed. The identity of a prospect everywhere. */
function normaliseEmail(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

/**
 * A timestamp off the payload, or now.
 *
 * `new Date('whenever')` is an Invalid Date, and postgres.js throws on one —
 * from inside `process()`, which meant a single event with a timestamp we could
 * not read failed forever and took its whole reply with it. Now is the right
 * fallback: the event demonstrably just happened, and being a few seconds out
 * is not a state anybody reads.
 */
export function eventTime(...vals: unknown[]): Date {
  const raw = firstString(...vals);
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * The synthetic idempotency key.
 *
 * Deliberately excludes anything Smartlead might vary between retries of the
 * same event (preview text, body formatting) and includes everything that makes
 * an event distinct.
 */
export function idempotencyKey(p: SmartleadEventPayload): string {
  const parts = [
    String(p.event_type ?? ''),
    String(p.campaign_id ?? ''),
    normaliseEmail(p.to_email ?? p.lead_email),
    firstString(p.event_timestamp, p.time_replied, p.sent_at),
    String(p.sequence_number ?? ''),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** Constant-time secret comparison — a plain `===` leaks length and prefix by timing. */
function secretMatches(candidate: string): boolean {
  const expected = env.OUTREACH_WEBHOOK_SECRET;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Apply one event's effects.
 *
 * Runs AFTER the receipt is stored, so a crash here leaves an unprocessed row
 * the reconcile sweep can retry rather than losing the event entirely.
 */
async function process(p: SmartleadEventPayload): Promise<void> {
  const type = String(p.event_type ?? '').toUpperCase() as HandledEvent;
  const email = normaliseEmail(p.to_email ?? p.lead_email);
  const campaignId = Number(p.campaign_id);

  switch (type) {
    case 'EMAIL_SENT':
    case 'FIRST_EMAIL_SENT': {
      const sentAt = eventTime(p.sent_at, p.event_timestamp);
      // Per-mailbox last-send lives in Redis: a live-view detail, worthless if
      // lost, and not worth a table.
      const from = normaliseEmail(p.from_email);
      if (from) await recordLastSent(from, sentAt);
      if (email) {
        await db
          .update(outreachProspectState)
          .set({ lastSentAt: sentAt, smartleadCampaignId: campaignId || undefined })
          .where(eq(outreachProspectState.email, email));
      }
      return;
    }

    case 'EMAIL_BOUNCE': {
      // A bounce is the fastest way to burn a domain, so the address is
      // suppressed immediately rather than waiting for a human.
      if (email) await suppress({ value: email, kind: 'email', reason: 'bounced', source: 'webhook' });
      return;
    }

    case 'LEAD_UNSUBSCRIBED': {
      if (email) {
        await suppress({ value: email, kind: 'email', reason: 'unsubscribed', source: 'webhook' });
        await db
          .update(outreachProspectState)
          .set({
            classification: 'never',
            classificationReasoning: 'Unsubscribed via Smartlead.',
            classificationConfidence: '1.000',
            classifiedAt: new Date(),
          })
          .where(eq(outreachProspectState.email, email));
      }
      return;
    }

    case 'EMAIL_REPLY': {
      if (!email) return;
      const repliedAt = eventTime(p.time_replied, p.event_timestamp);
      const body = firstString(p.reply_body, p.preview_text);

      const [prospect] = await db
        .select()
        .from(outreachProspectState)
        .where(eq(outreachProspectState.email, email))
        .limit(1);

      // An unsubscribe request is acted on WITHOUT waiting for the classifier —
      // §9 makes this path instant and automatic, and a model call is both a
      // delay and a failure point on the one path that must never fail.
      if (isHardStop(body)) {
        await suppress({ value: email, kind: 'email', reason: 'reply opt-out', source: 'webhook' });
        await db
          .update(outreachProspectState)
          .set({
            repliedAt,
            classification: 'never',
            classificationReasoning: 'Reply asked to stop contact.',
            classificationConfidence: '1.000',
            classifiedAt: new Date(),
          })
          .where(eq(outreachProspectState.email, email));
        return;
      }

      const result = await classifyReply({
        db,
        body,
        subject: p.subject ?? null,
        businessName: prospect?.businessName ?? null,
      });

      await db
        .update(outreachProspectState)
        .set({
          repliedAt,
          classification: result.classification,
          classificationReasoning: result.reasoning,
          classificationConfidence: result.confidence.toFixed(3),
          classifiedAt: new Date(),
          smartleadCampaignId: campaignId || undefined,
        })
        .where(eq(outreachProspectState.email, email));

      if (result.classification === 'never') {
        await suppress({ value: email, kind: 'email', reason: 'classified never', source: 'classifier' });
        return;
      }

      // Only the two classifications that want an answer get a queued draft.
      if (result.classification === 'yes' || result.classification === 'question') {
        await queueReplyDraft({
          prospect: prospect ?? null,
          email,
          campaignId: campaignId || null,
          emailStatsId: firstString(p.stats_id) || null,
          messageId: firstString(p.message_id) || null,
          classification: result.classification,
          replyBody: body,
        });
      }
      return;
    }

    case 'EMAIL_ACCOUNT_DISCONNECTED': {
      // Nothing to store — the Sending Floor reads connection state live. Logged
      // loudly because a disconnected mailbox is invisible lost throughput.
      console.error('[outreach] mailbox disconnected in Smartlead', normaliseEmail(p.from_email));
      return;
    }

    default:
      return;
  }
}

/**
 * POST /api/outreach/webhook/:secret
 *
 * Always answers 200 once the receipt is stored. Smartlead retries on non-2xx,
 * and a retry storm caused by a bug in OUR processing would be self-inflicted —
 * the event is already durably recorded, so the reconcile sweep owns recovery.
 */
export function mountOutreachWebhook(app: Express): void {
  app.post('/api/outreach/webhook/:secret', async (req: Request, res: Response) => {
    if (!secretMatches(req.params.secret ?? '')) {
      // Deliberately terse: no hint about whether the secret is unset or wrong.
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const payload = (req.body ?? {}) as SmartleadEventPayload;
    const eventType = String(payload.event_type ?? '').toUpperCase();
    if (!eventType) {
      res.status(400).json({ error: 'Missing event_type' });
      return;
    }

    const key = idempotencyKey(payload);

    // Store first, process second. `onConflictDoNothing` makes the retry a
    // no-op: an event we already hold returns 200 without re-running effects.
    const inserted = await db
      .insert(outreachEvents)
      .values({ idempotencyKey: key, eventType, payload })
      .onConflictDoNothing({ target: outreachEvents.idempotencyKey })
      .returning({ id: outreachEvents.id })
      .catch((e) => {
        console.error('[outreach] webhook receipt insert failed', (e as Error).message);
        return [] as { id: string }[];
      });

    if (inserted.length === 0) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }

    res.status(200).json({ ok: true });

    // Effects run after responding: Smartlead gets a fast ack, and a slow
    // classifier call can't push the request into a webhook timeout.
    try {
      await process(payload);
      await db
        .update(outreachEvents)
        .set({ processedAt: new Date() })
        .where(eq(outreachEvents.id, inserted[0].id));
    } catch (e) {
      const message = (e as Error).message;
      console.error('[outreach] webhook processing failed', eventType, message);
      await db
        .update(outreachEvents)
        .set({ processError: message.slice(0, 1000) })
        .where(eq(outreachEvents.id, inserted[0].id))
        .catch(() => {});
    }
  });
}

/**
 * How many times the sweep will re-apply one receipt before leaving it alone.
 *
 * The bound is the point. Replaying an EMAIL_REPLY re-runs the classifier, so
 * an event that can never succeed — an address whose prospect row has since
 * been deleted, a payload we cannot read — was billing a model call four times
 * an hour, forever, for as long as the row existed. Five tries covers every
 * transient cause (a Smartlead blip, a redeploy mid-effect, a classifier
 * outage) and nothing else; past that the row keeps its reason and stops
 * costing anything.
 */
export const MAX_PROCESS_ATTEMPTS = 5;

/**
 * Retry events that were received but never processed.
 *
 * The reconcile backstop for the "responded 200, then crashed" window. Runs on a
 * cron; picks up anything with no `processed_at` that has tries left.
 */
export async function reconcileUnprocessedEvents(limit = 100): Promise<{ retried: number; abandoned: number }> {
  const pending = await db
    .select({
      id: outreachEvents.id,
      payload: outreachEvents.payload,
      attempts: outreachEvents.processAttempts,
    })
    .from(outreachEvents)
    .where(
      and(
        sql`${outreachEvents.processedAt} IS NULL`,
        sql`${outreachEvents.processAttempts} < ${MAX_PROCESS_ATTEMPTS}`,
        sql`${outreachEvents.receivedAt} < now() - interval '5 minutes'`,
      ),
    )
    .limit(limit);

  let retried = 0;
  let abandoned = 0;
  for (const row of pending) {
    const attempts = row.attempts + 1;
    try {
      await process(row.payload as SmartleadEventPayload);
      await db
        .update(outreachEvents)
        .set({ processedAt: new Date(), processError: null, processAttempts: attempts })
        .where(eq(outreachEvents.id, row.id));
      retried += 1;
    } catch (e) {
      const spent = attempts >= MAX_PROCESS_ATTEMPTS;
      if (spent) abandoned += 1;
      const message = (e as Error).message;
      await db
        .update(outreachEvents)
        .set({
          processAttempts: attempts,
          processError: (spent
            ? `Given up after ${attempts} attempts. ${message}`
            : message
          ).slice(0, 1000),
        })
        .where(eq(outreachEvents.id, row.id))
        .catch(() => {});
      if (spent) {
        console.error('[outreach] webhook event abandoned after retries', row.id, message);
      }
    }
  }
  return { retried, abandoned };
}

/**
 * How long a processed receipt is kept.
 *
 * §5 makes this table receipts-only — idempotency and replay, not reporting —
 * and asks for a retention window. Ninety days is well past any window in which
 * Smartlead could still retry an event, and long enough to reconstruct a
 * month's argument about who was emailed what. Nothing analytical reads it;
 * `outreach_prospect_state` is the table that carries the outcomes.
 *
 * Only PROCESSED rows are trimmed. An unprocessed one is unfinished business,
 * even a spent one — its `process_error` is the only record that an event
 * arrived and never landed.
 */
export const EVENT_RETENTION_DAYS = 90;

export async function trimOldEvents(limit = 5_000): Promise<{ deleted: number }> {
  // `make_interval` rather than `$1 * interval '1 day'`: the multiplication form
  // sends the number as an untyped parameter and Postgres has no `text *
  // interval` operator, so it fails at plan time rather than returning nothing.
  // Cast explicitly: the retention window arrives as a bind parameter, and
  // Postgres will not infer a type for one sitting in a named function argument.
  const cutoff = sql`now() - make_interval(days => ${EVENT_RETENTION_DAYS}::int)`;
  const deleted = await db
    .delete(outreachEvents)
    .where(
      // Bounded per pass so a first run against a large backlog is a series of
      // small deletes rather than one long lock on the table.
      sql`${outreachEvents.id} IN (
        SELECT ${outreachEvents.id} FROM ${outreachEvents}
        WHERE ${outreachEvents.processedAt} IS NOT NULL
          AND ${outreachEvents.receivedAt} < ${cutoff}
        LIMIT ${limit}
      )`,
    )
    .returning({ id: outreachEvents.id });
  return { deleted: deleted.length };
}
