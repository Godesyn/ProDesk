import { redis } from '../../jobs/queues.js';
import { cacheKeys, invalidate } from './cache.js';
import { listEmailAccounts, setDailyCap } from './smartlead.js';

/**
 * Daily-cap policy and the fan-out that applies it.
 *
 * The governing constraint is not getting the domains flagged. Caps are the main
 * throttle, so they are set centrally (default 20, range 20–25) and pushed to all
 * 20 mailboxes — never edited one at a time and hoped to stay consistent.
 *
 * Twenty sequential Smartlead writes is far too slow for a click, so the fan-out
 * runs in the Worker and reports progress back through Redis.
 */

export const CAP_MIN = 20;
export const CAP_MAX = 25;
export const CAP_DEFAULT = 20;

const POLICY_KEY = 'outreach:cap-policy';
const FANOUT_KEY = (runId: string) => `outreach:fanout:${runId}`;
/** Progress outlives the run so a refresh right after it finishes still shows the result. */
const FANOUT_TTL_SECONDS = 3600;

export interface CapPolicy {
  /** The cap every mailbox gets unless it has an override. */
  global: number;
  /** Smartlead email-account id → its own cap. */
  overrides: Record<string, number>;
}

/**
 * The intended policy.
 *
 * Redis holds it because there is no table for it and Smartlead has no field for
 * "what we meant". If the key is ever lost the policy is re-derived from the
 * mailboxes themselves — the most common cap in use is, by definition, the global
 * one — so a Redis flush degrades to a correct guess rather than a broken screen.
 */
export async function getCapPolicy(): Promise<CapPolicy> {
  try {
    const raw = await redis.get(POLICY_KEY);
    if (raw) return JSON.parse(raw) as CapPolicy;
  } catch (e) {
    console.error('[outreach] cap policy read failed', (e as Error).message);
  }
  return deriveCapPolicy();
}

/** Reconstruct the policy from the live caps: the modal non-zero cap is the global. */
async function deriveCapPolicy(): Promise<CapPolicy> {
  try {
    const accounts = await listEmailAccounts();
    const counts = new Map<number, number>();
    for (const a of accounts) {
      const cap = a.message_per_day ?? 0;
      // A zeroed cap means "stopped", not "the policy" — it must not win the vote.
      if (cap > 0) counts.set(cap, (counts.get(cap) ?? 0) + 1);
    }
    let global = CAP_DEFAULT;
    let best = 0;
    for (const [cap, n] of counts) {
      if (n > best) {
        best = n;
        global = cap;
      }
    }
    const overrides: Record<string, number> = {};
    for (const a of accounts) {
      const cap = a.message_per_day ?? 0;
      if (cap > 0 && cap !== global) overrides[String(a.id)] = cap;
    }
    return { global, overrides };
  } catch {
    return { global: CAP_DEFAULT, overrides: {} };
  }
}

export async function saveCapPolicy(policy: CapPolicy): Promise<void> {
  await redis.set(POLICY_KEY, JSON.stringify(policy));
}

export function clampCap(cap: number): number {
  return Math.min(CAP_MAX, Math.max(CAP_MIN, Math.round(cap)));
}

/* ──────────────────────────────────────────────────────────────────────────
 * Fan-out
 * ────────────────────────────────────────────────────────────────────────── */

export interface FanoutProgress {
  runId: string;
  total: number;
  done: number;
  /** Mailboxes Smartlead refused, with its own words. */
  failures: { email: string; message: string }[];
  startedAt: string;
  finishedAt: string | null;
}

async function writeProgress(p: FanoutProgress): Promise<void> {
  try {
    await redis.set(FANOUT_KEY(p.runId), JSON.stringify(p), 'EX', FANOUT_TTL_SECONDS);
  } catch (e) {
    console.error('[outreach] fan-out progress write failed', (e as Error).message);
  }
}

export async function getFanoutProgress(runId: string): Promise<FanoutProgress | null> {
  try {
    const raw = await redis.get(FANOUT_KEY(runId));
    return raw ? (JSON.parse(raw) as FanoutProgress) : null;
  } catch {
    return null;
  }
}

/**
 * Seed a fan-out run so the UI has something to show the instant it is enqueued.
 * The caller enqueues the job; this only records intent.
 */
export async function beginFanout(runId: string, total: number): Promise<FanoutProgress> {
  const progress: FanoutProgress = {
    runId,
    total,
    done: 0,
    failures: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  await writeProgress(progress);
  return progress;
}

/**
 * Apply `policy` to every mailbox, one Smartlead write at a time.
 *
 * Sequential on purpose: the client's rate limiter would serialise these anyway,
 * and a steady walk lets progress advance visibly instead of finishing in one
 * jump. A mailbox that fails does not stop the others — the operator gets a
 * partial result plus Smartlead's reason for each failure, which is more useful
 * than an abort halfway through.
 *
 * Stopped mailboxes (cap 0) are left alone: stopping is a deliberate act and a
 * policy change must not silently restart a mailbox someone shut off.
 */
export async function runCapFanout(runId: string, policy: CapPolicy): Promise<FanoutProgress> {
  const accounts = await listEmailAccounts();
  const targets = accounts.filter((a) => (a.message_per_day ?? 0) > 0);

  const progress: FanoutProgress =
    (await getFanoutProgress(runId)) ?? (await beginFanout(runId, targets.length));
  progress.total = targets.length;
  progress.done = 0;
  progress.failures = [];
  await writeProgress(progress);

  for (const account of targets) {
    const desired = policy.overrides[String(account.id)] ?? policy.global;
    try {
      if ((account.message_per_day ?? 0) !== desired) {
        await setDailyCap(account.id, clampCap(desired));
      }
    } catch (e) {
      progress.failures.push({ email: account.from_email, message: (e as Error).message });
    }
    progress.done += 1;
    await writeProgress(progress);
  }

  progress.finishedAt = new Date().toISOString();
  await writeProgress(progress);
  // The floor's cached account list is now wrong in exactly the way the operator
  // is watching for.
  await invalidate(cacheKeys.emailAccounts);
  return progress;
}
