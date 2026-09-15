/**
 * The webhook's two pure decisions.
 *
 * Everything else in `webhook.ts` needs a database, but these two govern what
 * the reconcile sweep costs and whether an event survives at all, and both were
 * wrong in ways that only showed up in a bill or a log:
 *
 *  • A timestamp Postgres would refuse took its whole event down, permanently,
 *    and the sweep then re-ran the classifier on it four times an hour forever.
 *  • The idempotency key is the only thing standing between a Smartlead retry
 *    and a second queued draft, and it has to be stable across exactly the
 *    fields Smartlead may vary between those retries.
 */
import { describe, it, expect } from 'vitest';
import { eventTime, idempotencyKey, MAX_PROCESS_ATTEMPTS } from './webhook.js';

describe('eventTime', () => {
  it('reads the first parsable timestamp', () => {
    expect(eventTime('2026-08-18T04:05:06.000Z').toISOString()).toBe('2026-08-18T04:05:06.000Z');
  });

  it('falls through an empty field to the next one', () => {
    expect(eventTime('', '2026-08-18T04:05:06.000Z').toISOString()).toBe(
      '2026-08-18T04:05:06.000Z',
    );
  });

  it('falls back to now rather than producing an Invalid Date', () => {
    // The failure this replaces: `new Date('whenever')` reaches postgres.js,
    // which throws — from inside the event handler, so the event never lands
    // and the sweep retries it, with an LLM call attached, until the row is
    // deleted by hand.
    const before = Date.now();
    const at = eventTime('whenever');
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(at.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('falls back to now when nothing is a string', () => {
    expect(Number.isNaN(eventTime(undefined, null, 42).getTime())).toBe(false);
  });
});

describe('idempotencyKey', () => {
  const base = {
    event_type: 'EMAIL_REPLY',
    campaign_id: 11,
    to_email: 'Someone@Example.com ',
    event_timestamp: '2026-08-18T04:05:06.000Z',
    sequence_number: 2,
  };

  it('is stable across a retry that reformats the body', () => {
    expect(idempotencyKey({ ...base, reply_body: 'yes please' })).toBe(
      idempotencyKey({ ...base, reply_body: '<p>yes please</p>', preview_text: 'yes' }),
    );
  });

  it('normalises the recipient, so casing cannot split one event into two', () => {
    expect(idempotencyKey(base)).toBe(idempotencyKey({ ...base, to_email: 'someone@example.com' }));
  });

  it('reads the recipient from lead_email when to_email is absent', () => {
    const { to_email, ...withoutTo } = base;
    void to_email;
    expect(idempotencyKey({ ...withoutTo, lead_email: 'someone@example.com' })).toBe(
      idempotencyKey(base),
    );
  });

  it('separates two events that differ only by sequence step', () => {
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, sequence_number: 3 }));
  });

  it('separates a reply from a send at the same instant', () => {
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, event_type: 'EMAIL_SENT' }));
  });
});

describe('the retry bound', () => {
  it('gives up, rather than replaying a classifier forever', () => {
    // The number itself is a judgement call; that it is finite is not.
    expect(MAX_PROCESS_ATTEMPTS).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_PROCESS_ATTEMPTS)).toBe(true);
  });
});
