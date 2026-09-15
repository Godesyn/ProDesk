import { inArray, isNull } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { outreachSuppression } from '../../db/schema.js';
import { addToBlockList, isSmartleadConfigured } from './smartlead.js';

/**
 * The global suppression master.
 *
 * One list across all 4 domains and 20 mailboxes. Written HERE first, then
 * pushed to Smartlead — never the other way round. If the push fails the row
 * still exists locally with `pushedAt` null, and the list-build dedupe already
 * respects it, so a network blip can't result in someone being emailed again.
 *
 * That ordering is the whole point: our copy is authoritative and Smartlead's is
 * a replica we keep in sync, because Smartlead's copy is the one we can't query
 * reliably at list-build time.
 */

export interface SuppressInput {
  /** An email address or a bare domain. Normalised here, not by the caller. */
  value: string;
  kind: 'email' | 'domain';
  reason?: string | null;
  source?: string | null;
  addedByUserId?: string | null;
}

function normalise(value: string, kind: 'email' | 'domain'): string {
  const v = value.trim().toLowerCase();
  // A domain given with a leading @ or as a URL is still a domain.
  return kind === 'domain' ? v.replace(/^@/, '').replace(/^https?:\/\//, '').split('/')[0] : v;
}

/**
 * Suppress an address or domain, then push it to Smartlead.
 *
 * Idempotent: suppressing something already suppressed is a no-op that still
 * retries the push if the first one failed. Never throws — this is called from
 * the webhook path, where a suppression failure must not take down event
 * processing, and a row with `pushedAt` null is already safe locally.
 */
export async function suppress(input: SuppressInput): Promise<{ id: string | null }> {
  const value = normalise(input.value, input.kind);
  if (!value) return { id: null };

  try {
    const [row] = await db
      .insert(outreachSuppression)
      .values({
        value,
        kind: input.kind,
        reason: input.reason ?? null,
        source: input.source ?? null,
        addedByUserId: input.addedByUserId ?? null,
      })
      .onConflictDoNothing({ target: outreachSuppression.value })
      .returning({ id: outreachSuppression.id });

    // Push regardless of whether this insert created the row — an existing row
    // that never reached Smartlead should be retried, not skipped.
    await pushToSmartlead([value]);
    return { id: row?.id ?? null };
  } catch (e) {
    console.error('[outreach] suppress failed', value, (e as Error).message);
    return { id: null };
  }
}

/**
 * Mirror entries into Smartlead's global block list and stamp `pushedAt`.
 *
 * A failure is recorded on the row rather than thrown, so the sweep can retry
 * and the operator can see which entries are still local-only.
 */
export async function pushToSmartlead(values: string[]): Promise<{ pushed: number }> {
  if (values.length === 0) return { pushed: 0 };
  if (!isSmartleadConfigured()) return { pushed: 0 };

  try {
    await addToBlockList(values);
    await db
      .update(outreachSuppression)
      .set({ pushedAt: new Date(), pushError: null })
      .where(inArray(outreachSuppression.value, values));
    return { pushed: values.length };
  } catch (e) {
    const message = (e as Error).message.slice(0, 500);
    console.error('[outreach] block-list push failed', message);
    await db
      .update(outreachSuppression)
      .set({ pushError: message })
      .where(inArray(outreachSuppression.value, values))
      .catch(() => {});
    return { pushed: 0 };
  }
}

/**
 * Retry every entry that never reached Smartlead.
 *
 * Chunked because the block-list endpoint takes an array and we should not post
 * an unbounded one. Runs on the same cron as the event reconcile.
 */
export async function retryUnpushedSuppressions(limit = 500): Promise<{ pushed: number }> {
  const rows = await db
    .select({ value: outreachSuppression.value })
    .from(outreachSuppression)
    .where(isNull(outreachSuppression.pushedAt))
    .limit(limit);

  let pushed = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100).map((r) => r.value);
    const res = await pushToSmartlead(chunk);
    pushed += res.pushed;
  }
  return { pushed };
}

/**
 * Which of `emails` are suppressed — by address OR by their domain.
 *
 * Used by the list builder before anything reaches Smartlead. Domain matching
 * matters: suppressing `acme.com` has to stop `bob@acme.com` too, or a domain
 * suppression would be quietly useless.
 */
export async function filterSuppressed(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const normalised = emails.map((e) => e.trim().toLowerCase());
  const domains = [...new Set(normalised.map((e) => e.split('@')[1]).filter(Boolean))];

  const rows = await db
    .select({ value: outreachSuppression.value, kind: outreachSuppression.kind })
    .from(outreachSuppression)
    .where(inArray(outreachSuppression.value, [...normalised, ...domains]))
    .catch(() => [] as { value: string; kind: string }[]);

  const suppressedEmails = new Set(rows.filter((r) => r.kind === 'email').map((r) => r.value));
  const suppressedDomains = new Set(rows.filter((r) => r.kind === 'domain').map((r) => r.value));

  return new Set(
    normalised.filter(
      (e) => suppressedEmails.has(e) || suppressedDomains.has(e.split('@')[1] ?? ''),
    ),
  );
}
