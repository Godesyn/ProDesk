import { TRPCError } from '@trpc/server';
import { redis } from '../jobs/queues.js';

/**
 * Fixed-window rate limiting on the shared Redis instance.
 *
 * Redis is already the store for exactly this kind of state — the chat-digest
 * debounce in jobs/worker.ts uses it the same way — so there is no new
 * dependency here, only a named helper so call sites stop hand-rolling INCR.
 *
 * FAIL-CLOSED IS THE DEFAULT, and that is the opposite of the usual advice.
 * The first caller is `chat.discoverByEmail`, whose whole job is to answer "does
 * this email address have an account?" — a question an attacker would happily ask
 * a million times. Failing open during a Redis outage turns a Redis outage into
 * an address-enumeration window. A caller that genuinely prefers availability to
 * enforcement passes `failOpen: true` and says why.
 */

type Options = {
  /** Let the call through when Redis is unreachable. Default: false. */
  failOpen?: boolean;
};

/**
 * Consume one unit against `key`. Returns false when the caller is over budget.
 *
 * The window is fixed rather than sliding: the first hit sets the expiry, and
 * the counter dies with it. That means a caller can spend up to `2 × limit`
 * across a window boundary, which is fine for abuse limits and much cheaper than
 * a sorted-set sliding window.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  opts: Options = {},
): Promise<boolean> {
  try {
    const n = await redis.incr(key);
    // Only the caller that created the counter sets the TTL, so a burst can't
    // keep pushing the window out in front of itself.
    if (n === 1) await redis.pexpire(key, windowMs);
    return n <= limit;
  } catch (err) {
    console.error('[rate-limit] redis unavailable', key, (err as Error).message);
    return opts.failOpen === true;
  }
}

/** `consumeRateLimit`, but throws TOO_MANY_REQUESTS instead of returning false. */
export async function assertRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message: string,
  opts: Options = {},
): Promise<void> {
  const ok = await consumeRateLimit(key, limit, windowMs, opts);
  if (!ok) throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message });
}

/**
 * Enforce several windows at once (e.g. 20/15min AND 100/day AND 60/15min per
 * IP). Every budget is consumed even if an earlier one already failed, so a
 * caller cannot probe which limit they tripped by timing the response.
 */
export async function assertRateLimits(
  budgets: Array<{ key: string; limit: number; windowMs: number }>,
  message: string,
  opts: Options = {},
): Promise<void> {
  const results = await Promise.all(
    budgets.map((b) => consumeRateLimit(b.key, b.limit, b.windowMs, opts)),
  );
  if (results.some((ok) => !ok)) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message });
  }
}

/** Windows, named so call sites read as English. */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
