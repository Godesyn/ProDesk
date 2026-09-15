import { redis } from '../../jobs/queues.js';

/**
 * Short-TTL Redis cache in front of Smartlead.
 *
 * Almost nothing about Outreach is stored: mailboxes, campaigns, schedules,
 * message bodies and deliverability are read live from Smartlead. That would
 * make one page view a burst of API calls, so every read goes through here and
 * a 30–60 second TTL collapses the burst into one call.
 *
 * The TTL is deliberately short. This is a cockpit for a live system — stale
 * capacity numbers are worse than a slightly slower page.
 */

const PREFIX = 'outreach:cache:';

/** Long enough to collapse a page load, short enough that the floor stays live. */
export const DEFAULT_TTL_SECONDS = 45;

/**
 * Read `key` from cache, or run `fetcher` and store the result.
 *
 * A Redis failure is never fatal: the fetcher still runs and the caller still
 * gets fresh data. Losing the cache costs API budget, not correctness.
 */
export async function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<T> {
  const fullKey = `${PREFIX}${key}`;

  try {
    const hit = await redis.get(fullKey);
    if (hit) return JSON.parse(hit) as T;
  } catch (e) {
    console.error('[outreach] cache read failed', (e as Error).message);
  }

  const value = await fetcher();

  try {
    await redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (e) {
    console.error('[outreach] cache write failed', (e as Error).message);
  }

  return value;
}

/**
 * Drop cached entries so the next read is fresh.
 *
 * Call this immediately after any mutation that changes what a cached read would
 * return — changing a cap, stopping a mailbox, starting a campaign. Without it
 * an optimistic UI update would be contradicted by a stale refetch seconds later,
 * which reads as a failed mutation.
 */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys.map((k) => `${PREFIX}${k}`));
  } catch (e) {
    console.error('[outreach] cache invalidate failed', (e as Error).message);
  }
}

/** Cache keys, in one place so a mutation can't misspell what it invalidates. */
export const cacheKeys = {
  emailAccounts: 'email-accounts',
  campaigns: 'campaigns',
  warmupStats: (accountId: number) => `warmup-stats:${accountId}`,
  domainHealth: (start: string, end: string) => `domain-health:${start}:${end}`,
} as const;
