/**
 * The review-count opener.
 *
 * This is the one string in the feature that makes a checkable factual claim
 * about a named local market — "the typical dentist in Inner West is on 84" —
 * to someone who knows that market better than we do. Getting it wrong isn't a
 * cosmetic bug; it's a cold email that a prospect can immediately disprove,
 * which is worse than sending nothing.
 *
 * So the contract under test is narrow and mostly about refusing to speak:
 * no benchmark without enough peers, no comparison for a business that isn't
 * actually behind, and no invented number anywhere.
 *
 * See docs/agents/outreach-apify.md §5.
 */
import { describe, it, expect } from 'vitest';
import { buildHooks, holdDecision, REVIEW_HOLD_MS, type Candidate } from './run.js';
import { queueStateOf } from './ledger.js';
import type { OutreachListRunStatus } from '../../../db/schema.js';

function candidate(reviewsCount: number | null, rating: number | null = null): Candidate {
  return {
    placeId: `place-${reviewsCount}-${rating}`,
    email: `a${reviewsCount}@example.com`,
    businessName: 'A Business',
    website: null,
    category: null,
    phone: null,
    address: null,
    rating,
    reviewsCount,
    verdict: 'valid',
    hook: null,
    detail: null,
  };
}

/** A peer set whose median is exactly 50. */
const peers = Array.from({ length: 41 }, (_, i) => ({ reviewsCount: i + 30 }));

describe('buildHooks', () => {
  it('compares a low-review business against the median of its own scrape', () => {
    const rows = [candidate(11, 4.2)];
    const hooked = buildHooks(rows, peers, 'Inner West', 'Dentist');

    expect(hooked).toBe(1);
    expect(rows[0].hook).toBe(
      "you're on 11 Google reviews at 4.2 stars — the typical dentist in Inner West is on 50",
    );
  });

  it('says nothing about a business already at or above typical', () => {
    // The threshold is 60% of the median, so 30 (of 50) must not be hooked:
    // a business that is roughly where its peers are has nothing to be shown,
    // and manufacturing a comparison for them would be both dishonest and
    // unpersuasive.
    const rows = [candidate(30), candidate(50), candidate(400)];
    expect(buildHooks(rows, peers, 'Inner West', 'Dentist')).toBe(0);
    expect(rows.every((r) => r.hook === null)).toBe(true);
  });

  it('refuses to quote a benchmark from too few peers', () => {
    // Below the minimum the median is an anecdote, not a fact about the area.
    const rows = [candidate(1)];
    expect(buildHooks(rows, [{ reviewsCount: 90 }, { reviewsCount: 110 }], 'Mosman', 'Dentist')).toBe(0);
    expect(rows[0].hook).toBeNull();
  });

  it('handles a business with no reviews without pretending it has some', () => {
    const rows = [candidate(0)];
    buildHooks(rows, peers, 'Parramatta', 'Plumber');
    expect(rows[0].hook).toBe(
      "you don't have any Google reviews yet, and the typical plumber in Parramatta is on 50",
    );
  });

  it('leaves an unknown review count alone', () => {
    // A null count is "we didn't get the number", not "they have none".
    const rows = [candidate(null)];
    expect(buildHooks(rows, peers, 'Ryde', 'Dentist')).toBe(0);
    expect(rows[0].hook).toBeNull();
  });

  it('omits the star rating when there isn’t one', () => {
    const rows = [candidate(4, null)];
    buildHooks(rows, peers, 'Bayside', 'Gym');
    expect(rows[0].hook).toBe(
      "you're on 4 Google reviews — the typical gym in Bayside is on 50",
    );
  });

  it('uses the vertical verbatim, without guessing at a singular', () => {
    // This used to strip a trailing "s", which turned the one vertical that
    // legitimately ends in one into "the typical real estate agencie". The
    // vertical is the search term now, and search terms are already singular.
    const rows = [candidate(3)];
    buildHooks(rows, peers, 'Woollahra', 'Real estate agency');
    expect(rows[0].hook).toContain('the typical real estate agency in Woollahra');
  });

  it('counts places with no reviews as part of the market, not the benchmark', () => {
    // Zero-review places are competitors on the map but would drag the median
    // to nothing, which would silence the hook for everyone.
    const withZeroes = [...peers, ...Array.from({ length: 200 }, () => ({ reviewsCount: 0 }))];
    const rows = [candidate(5)];
    expect(buildHooks(rows, withZeroes, 'Ryde', 'Dentist')).toBe(1);
    expect(rows[0].hook).toContain('is on 50');
  });
});

/**
 * The five-minute hold.
 *
 * Everything downstream of `due` is email to strangers, so the only two things
 * worth testing are the two directions this can be wrong in: pushing something
 * that was held, and holding something forever that should have gone.
 */
describe('holdDecision', () => {
  const now = Date.UTC(2026, 7, 17, 9, 0, 0);
  const run = (autoPushAt: Date | null, campaignId: number | null = 42) => ({
    autoPushAt,
    campaignId,
  });

  it('waits out the remainder of the hold', () => {
    const d = holdDecision(run(new Date(now + 90_000)), now);
    expect(d).toEqual({ kind: 'waiting', remainingMs: 90_000 });
  });

  it('pushes once the deadline has passed', () => {
    expect(holdDecision(run(new Date(now - 1)), now).kind).toBe('due');
    expect(holdDecision(run(new Date(now)), now).kind).toBe('due');
  });

  it('never pushes a run with no deadline', () => {
    // The state Hold puts a run into, and the state every row written before
    // auto-push existed is already in. Both must sit still forever.
    expect(holdDecision(run(null), now).kind).toBe('held');
  });

  it('never pushes a run with nowhere to push', () => {
    // Distinct from `held`: the operator didn't ask for this one, so it is
    // reported rather than silently parked.
    expect(holdDecision(run(new Date(now - 60_000), null), now).kind).toBe('no-campaign');
  });

  it('holds long enough to read the list and stop it', () => {
    // A hold shorter than the time it takes to notice one is not a hold.
    expect(REVIEW_HOLD_MS).toBeGreaterThanOrEqual(60_000);
  });
});

/**
 * Where a run sits in the send queue.
 *
 * Three states and no fourth, because the screen is built on that and because
 * the two actions the operator has — reorder and skip — are legal in exactly
 * one of them. A run that leaked into the wrong state would either offer
 * controls that cannot work or hide the ones that can.
 */
describe('queueStateOf', () => {
  const at = (status: OutreachListRunStatus) => queueStateOf({ status });

  it('counts everything before the upload as queued', () => {
    // Including `review`: a run holding its five minutes has not sent, and
    // until it does its place in the order is still worth arguing about.
    expect(at('starting')).toBe('queued');
    expect(at('running')).toBe('queued');
    expect(at('review')).toBe('queued');
  });

  it('counts only the upload itself as sending', () => {
    expect(at('pushing')).toBe('sending');
  });

  it('counts anything finished with as sent, however it finished', () => {
    // `failed` and `superseded` never reached a mailbox, but they are equally
    // done with the queue — leaving them queued would block everything behind
    // them forever, which is the one way a strict order can deadlock.
    expect(at('done')).toBe('sent');
    expect(at('failed')).toBe('sent');
    expect(at('superseded')).toBe('sent');
  });
});
