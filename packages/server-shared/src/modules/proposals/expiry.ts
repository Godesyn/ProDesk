/**
 * Proposal auto-expiry — an emailed proposal that is neither accepted nor
 * rejected by its `expiresAt` flips to `expired` (Flutter modelled the status
 * but never set it; this closes that gap). Driven by an exact-time BullMQ job
 * scheduled when the proposal is sent, with a date guard so a late/lost job
 * still does the right thing.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { proposals } from '../../db/schema.js';
import { proposalQueue } from '../../jobs/queues.js';

const jobId = (proposalId: string) => `expire-${proposalId}`;

/** Schedule (or reschedule) a proposal's expiry job for its `expiresAt`. */
export async function scheduleProposalExpiry(proposalId: string, expiresAt: Date | null): Promise<void> {
  if (!expiresAt) return;
  await proposalQueue.remove(jobId(proposalId)).catch(() => {});
  const delay = Math.max(0, expiresAt.getTime() - Date.now());
  await proposalQueue.add('expire', { proposalId }, { jobId: jobId(proposalId), delay });
}

/** Whether a still-open proposal status can transition to expired. */
export function isExpirableStatus(status: string): boolean {
  return status === 'sent' || status === 'viewed';
}

/**
 * Expire a proposal if it's still open and past its expiry. Idempotent and safe
 * to call from the scheduled job or inline (e.g. on read) as a guard.
 */
export async function expireProposal(proposalId: string, now = new Date(), db = defaultDb): Promise<boolean> {
  const p = (await db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1))[0];
  if (!p || !isExpirableStatus(p.status)) return false;
  if (!p.expiresAt || p.expiresAt.getTime() > now.getTime()) return false;
  await db.update(proposals).set({ status: 'expired', updatedAt: now }).where(eq(proposals.id, proposalId));
  return true;
}
