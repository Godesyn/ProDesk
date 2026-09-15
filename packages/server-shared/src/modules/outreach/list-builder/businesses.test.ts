/**
 * The paging contract for a run's roster.
 *
 * The whole justification for paging a run's businesses by offset rather than by
 * cursor — see the header of businesses.ts — is that a run's roster is fixed, so
 * "page 2" means something. That claim rests on one property: the sort has to be
 * TOTAL. Sorting on review count alone is not, because a region routinely holds
 * a dozen businesses on 3 reviews and a dozen more on none at all, and two rows
 * the comparator calls equal are free to swap between two fetches — at which
 * point one of them is on both pages and another is on neither. The operator
 * would never know; they would just never be shown that business.
 *
 * So these tests page through a set the naive comparator would shuffle, and
 * assert that the concatenated pages are exactly the whole set, once each.
 */
import { describe, it, expect } from 'vitest';
import { pageCandidates, type RunBusinessCut } from './businesses.js';
import type { Candidate } from './run.js';
import type { VerifyResult } from './providers/index.js';

const candidate = (over: Partial<Candidate> & { email: string }): Candidate => ({
  placeId: null,
  businessName: null,
  website: null,
  category: null,
  phone: null,
  address: null,
  rating: null,
  reviewsCount: null,
  verdict: 'valid' as VerifyResult,
  hook: null,
  detail: null,
  ...over,
});

const query = (over: { limit?: number; offset?: number; search?: string; cut?: RunBusinessCut }) => ({
  runId: '00000000-0000-0000-0000-000000000000',
  limit: over.limit ?? 25,
  offset: over.offset ?? 0,
  search: over.search,
  cut: over.cut ?? ('all' as RunBusinessCut),
});

describe('pageCandidates ordering', () => {
  it('puts fewest reviews first — the order they are emailed', () => {
    const page = pageCandidates(
      [
        candidate({ email: 'c@x.com', reviewsCount: 90 }),
        candidate({ email: 'a@x.com', reviewsCount: 3 }),
        candidate({ email: 'b@x.com', reviewsCount: 40 }),
      ],
      'review',
      query({}),
    );
    expect(page.items.map((r) => r.email)).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('puts businesses with no review count last', () => {
    // A missing count is not "zero reviews" — it is "Maps did not say". Sorting
    // it first would put the least useful rows at the head of a list whose
    // entire ordering principle is need.
    const page = pageCandidates(
      [
        candidate({ email: 'unknown@x.com', reviewsCount: null }),
        candidate({ email: 'none@x.com', reviewsCount: 0 }),
      ],
      'review',
      query({}),
    );
    expect(page.items.map((r) => r.email)).toEqual(['none@x.com', 'unknown@x.com']);
  });

  it('breaks ties on email so the order is total', () => {
    const page = pageCandidates(
      [
        candidate({ email: 'zed@x.com', reviewsCount: 3 }),
        candidate({ email: 'amy@x.com', reviewsCount: 3 }),
      ],
      'review',
      query({}),
    );
    expect(page.items.map((r) => r.email)).toEqual(['amy@x.com', 'zed@x.com']);
  });
});

describe('pageCandidates paging', () => {
  // Every business on the same review count, which is the case a comparator
  // without a tiebreak reorders freely.
  const set = Array.from({ length: 23 }, (_, i) =>
    candidate({ email: `biz-${String(i).padStart(2, '0')}@x.com`, reviewsCount: 3 }),
  );

  it('walks the whole set exactly once across pages', () => {
    const seen: string[] = [];
    for (let offset = 0; offset < set.length; offset += 10) {
      seen.push(...pageCandidates(set, 'review', query({ limit: 10, offset })).items.map((r) => r.email));
    }
    expect(seen).toHaveLength(set.length);
    expect(new Set(seen).size).toBe(set.length);
  });

  it('reports the run total alongside the page', () => {
    const page = pageCandidates(set, 'review', query({ limit: 10, offset: 20 }));
    expect(page.total).toBe(23);
    expect(page.matched).toBe(23);
    // The tail is short, and saying so is what stops the pager offering a page 4.
    expect(page.items).toHaveLength(3);
  });

  it('returns nothing past the end rather than wrapping', () => {
    expect(pageCandidates(set, 'review', query({ limit: 10, offset: 500 })).items).toEqual([]);
  });
});

describe('pageCandidates cuts', () => {
  const set = [
    candidate({ email: 'good@x.com', verdict: 'valid' }),
    candidate({ email: 'dead@x.com', verdict: 'invalid' }),
    candidate({ email: 'maybe@x.com', verdict: 'unknown' }),
    // Not verified yet. Neither sendable nor turned down — the resume cursor.
    candidate({ email: 'pending@x.com', verdict: null }),
  ];

  it('counts every cut regardless of which one is showing', () => {
    const page = pageCandidates(set, 'review', query({ cut: 'will_send' }));
    expect(page.tallies).toMatchObject({ all: 4, willSend: 1, rejected: 2 });
  });

  it('sends only the verified-valid', () => {
    const page = pageCandidates(set, 'review', query({ cut: 'will_send' }));
    expect(page.items.map((r) => r.email)).toEqual(['good@x.com']);
    expect(page.matched).toBe(1);
    // `total` stays the run's own size, so the UI can say "1 of 4 in the run".
    expect(page.total).toBe(4);
  });

  it('treats an unverified row as neither sendable nor turned down', () => {
    const page = pageCandidates(set, 'review', query({ cut: 'rejected' }));
    expect(page.items.map((r) => r.email).sort()).toEqual(['dead@x.com', 'maybe@x.com']);
  });
});

describe('pageCandidates search', () => {
  const set = [
    candidate({ email: 'hi@smiles.com.au', businessName: 'Smiles Dental', address: '1 Windsor Rd, Kellyville' }),
    candidate({ email: 'hi@hills.com.au', businessName: 'Hills Family Dental', category: 'Dental clinic' }),
  ];

  it('matches on the suburb in an address', () => {
    const page = pageCandidates(set, 'review', query({ search: 'kellyville' }));
    expect(page.items.map((r) => r.email)).toEqual(['hi@smiles.com.au']);
  });

  it('matches on what Maps called the business', () => {
    const page = pageCandidates(set, 'review', query({ search: 'clinic' }));
    expect(page.items.map((r) => r.email)).toEqual(['hi@hills.com.au']);
  });

  it('leaves the run total alone so the UI can say how much it narrowed', () => {
    const page = pageCandidates(set, 'review', query({ search: 'kellyville' }));
    expect(page.matched).toBe(1);
    expect(page.total).toBe(2);
  });
});

describe('pageCandidates shape', () => {
  it('offers no thread for a run that has not sent', () => {
    // Every "Emails" fetch is a live Smartlead call. Offering one before the
    // push would be one call per business for a conversation that cannot exist.
    const page = pageCandidates([candidate({ email: 'a@x.com' })], 'review', query({}));
    expect(page.items[0].hasThread).toBe(false);
    expect(page.source).toBe('candidates');
    expect(page.expired).toBe(false);
  });

  it('keys a row on the place id when there is one, and the email when there is not', () => {
    const page = pageCandidates(
      [
        candidate({ email: 'a@x.com', placeId: 'ChIJ-a', reviewsCount: 1 }),
        candidate({ email: 'b@x.com', reviewsCount: 2 }),
      ],
      'review',
      query({}),
    );
    expect(page.items.map((r) => r.key)).toEqual(['ChIJ-a', 'b@x.com']);
  });
});
