import { db as defaultDb } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { emailQueue, chatDigestQueue, redis } from '../jobs/queues.js';

/** Quiet period after the last message before a digest fires (CHAT_EMAIL_DEBOUNCER_IN_SECONDS). */
const CHAT_DIGEST_DEBOUNCE_MS = 60_000;
/**
 * Hard cap on how long a digest can be debounced. Without it, a perpetually
 * active thread (a message every <debounce) would push the fire time forward
 * forever and the recipient would never be notified.
 */
const CHAT_DIGEST_MAX_WAIT_MS = 10 * 60_000;
/** Minimum interval between two chat emails to one recipient (CHAT_EMAIL_ONCE_EVERY_IN_SECONDS). */
export const CHAT_DIGEST_MIN_INTERVAL_MS = 60 * 60_000;

export const firstQueuedKey = (userId: string) => `digest:first:${userId}`;
export const lastSentKey = (userId: string) => `digest:last:${userId}`;

type TaskInsert = typeof tasks.$inferInsert;

/** Create an in-app task (the platform's notification/action system). */
export async function createTask(values: TaskInsert, db = defaultDb) {
  const [task] = await db.insert(tasks).values(values).returning();
  return task;
}

/** Enqueue a transactional email job (processed by the BullMQ worker). */
export async function enqueueEmail(name: string, payload: Record<string, unknown>) {
  try {
    await emailQueue.add(name, payload, { removeOnComplete: true, attempts: 3 });
  } catch (err) {
    // Don't fail the request if Redis is down — log and move on.
    console.error('[notify] failed to enqueue email', name, (err as Error).message);
  }
}

/**
 * Schedule a debounced chat-digest email for a recipient.
 *
 * Replaces the legacy `chat_email_queue` doc + `flush_chat_email_queue` cron —
 * which re-scanned the *entire* pending-recipient collection every minute — with
 * a single event-driven delayed job per user (deterministic jobId), re-scheduled
 * on each new message. No polling, no full scans; the worker recomputes the
 * unread tiles from the DB at fire time, so there is no queue-state table.
 *
 * The fire delay folds in three constraints so the worker can simply send:
 *   • debounce — fire only after `DEBOUNCE_MS` of quiet;
 *   • max-wait — but never later than `MAX_WAIT_MS` after the first unsent
 *     message, so an always-active thread still flushes (anti-starvation);
 *   • rate-limit — and never sooner than `MIN_INTERVAL_MS` after the last email
 *     to this recipient (ports CHAT_EMAIL_ONCE_EVERY, the anti-spam guard the
 *     legacy cron had but the first web port dropped).
 *
 * Best-effort — never blocks the send.
 */
export async function scheduleChatDigest(userId: string) {
  const jobId = `digest-${userId}`;
  try {
    const now = Date.now();

    // Stamp (once) when the current un-notified batch began, to anchor max-wait.
    let firstAt = Number(await redis.get(firstQueuedKey(userId)));
    if (!firstAt) {
      firstAt = now;
      await redis.set(firstQueuedKey(userId), String(firstAt), 'PX', CHAT_DIGEST_MIN_INTERVAL_MS + CHAT_DIGEST_MAX_WAIT_MS);
    }

    const lastSent = Number(await redis.get(lastSentKey(userId)));
    const debounceDelay = Math.max(0, Math.min(CHAT_DIGEST_DEBOUNCE_MS, firstAt + CHAT_DIGEST_MAX_WAIT_MS - now));
    const rateFloor = lastSent ? Math.max(0, lastSent + CHAT_DIGEST_MIN_INTERVAL_MS - now) : 0;
    const delay = Math.max(debounceDelay, rateFloor);

    await chatDigestQueue.remove(jobId).catch(() => {});
    await chatDigestQueue.add('digest', { userId }, { jobId, delay, removeOnComplete: true, removeOnFail: true });
  } catch (err) {
    console.error('[notify] failed to schedule chat digest', userId, (err as Error).message);
  }
}

/** Schedule digests for many recipients concurrently (one message → all members). */
export async function scheduleChatDigests(userIds: string[]) {
  await Promise.allSettled(userIds.map((id) => scheduleChatDigest(id)));
}
