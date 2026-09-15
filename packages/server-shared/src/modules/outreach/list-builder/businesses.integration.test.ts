import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { outreachProspectState } from '../../../db/schema.js';
import type { DB } from '../../../db/index.js';
import { makeTestDb } from '../../../test/db.js';
import { pageProspects, type RunBusinessCut } from './businesses.js';

/**
 * The prospect half of a run's roster, against a real Postgres.
 *
 * Everything in businesses.test.ts is pure and covers the candidate set. This
 * covers the half that is SQL, because the claims it makes are claims about
 * Postgres rather than about JavaScript and reading them proves nothing:
 *
 *  • `reviews_count asc nulls last` — Postgres sorts NULLs FIRST by default on
 *    ASC, so the ordering that puts businesses with no review count at the END
 *    of a list ordered by need is a deliberate override. Get it wrong and the
 *    front of every roster is the rows we know least about.
 *  • `count(*) filter (where …)` for the chip tallies.
 *  • `coalesce(manual_classification, classification)` — a human correction has
 *    to win over the model's call in the tallies and in the cut, and the two
 *    have to agree with each other.
 *  • Offset paging over that ordering, which is only honest if the sort is
 *    total; the email tiebreak is what makes it so.
 *  • Run scoping via `source = 'list-build:<id>'`, which is the only thing
 *    keeping one run's roster from showing another's.
 */
describe('run roster — prospect rows', () => {
  let db: DB;
  let close: () => Promise<void>;

  const runId = randomUUID();
  const otherRunId = randomUUID();
  const run = { id: runId, status: 'done' as const };

  const query = (over: {
    limit?: number;
    offset?: number;
    search?: string;
    cut?: RunBusinessCut;
  } = {}) => ({
    runId,
    limit: over.limit ?? 25,
    offset: over.offset ?? 0,
    search: over.search,
    cut: over.cut ?? ('all' as RunBusinessCut),
  });

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(outreachProspectState).values([
      {
        email: 'hi@smiles.com.au',
        source: `list-build:${runId}`,
        businessName: 'Smiles Dental',
        address: '1 Windsor Rd, Kellyville',
        category: 'Dental clinic',
        phone: '+61 2 9876 5432',
        website: 'smilesdental.com.au',
        placeId: 'ChIJ-smiles',
        reviewsCount: 3,
        rating: '4.60',
        reviewHook: "you're on 3 Google reviews",
        vertical: 'dentist',
        sendingDomain: 'mail-a.example',
        smartleadCampaignId: 4242,
        lastSentAt: new Date('2026-08-04T00:00:00Z'),
        repliedAt: new Date('2026-08-06T00:00:00Z'),
        classification: 'yes',
      },
      {
        email: 'hi@hills.com.au',
        source: `list-build:${runId}`,
        businessName: 'Hills Family Dental',
        reviewsCount: 11,
        smartleadCampaignId: 4242,
        // The model read this as `never`; a person overrode it to `yes`. Both
        // the tally and the cut have to follow the person.
        classification: 'never',
        manualClassification: 'yes',
        repliedAt: new Date('2026-08-07T00:00:00Z'),
      },
      {
        email: 'hi@ridge.com.au',
        source: `list-build:${runId}`,
        businessName: 'Ridge Orthodontics',
        reviewsCount: 11,
        // …and the mirror case: the model said yes, a person said no. It must
        // NOT be counted as a yes.
        classification: 'yes',
        manualClassification: 'never',
      },
      {
        email: 'hi@nocount.com.au',
        source: `list-build:${runId}`,
        businessName: 'Quiet Practice',
        // No review count at all. Belongs at the END of a list ordered by need.
        reviewsCount: null,
      },
      // A different run entirely. Nothing about it may appear.
      {
        email: 'hi@othertown.com.au',
        source: `list-build:${otherRunId}`,
        businessName: 'Other Town Dental',
        reviewsCount: 1,
      },
      // No run at all — a prospect from before the List Builder existed.
      { email: 'hi@legacy.com.au', businessName: 'Legacy Practice', reviewsCount: 2 },
    ]);
  }, 30_000);

  afterAll(async () => {
    await close();
  });

  it('orders fewest reviews first and no-review-count last', async () => {
    const page = await pageProspects(db, run, query());
    expect(page.items.map((r) => r.email)).toEqual([
      'hi@smiles.com.au', // 3
      'hi@hills.com.au', // 11, email breaks the tie
      'hi@ridge.com.au', // 11
      'hi@nocount.com.au', // null — last, not first
    ]);
  });

  it('shows only this run, and never a prospect with no run', async () => {
    const page = await pageProspects(db, run, query());
    expect(page.total).toBe(4);
    expect(page.items.map((r) => r.email)).not.toContain('hi@othertown.com.au');
    expect(page.items.map((r) => r.email)).not.toContain('hi@legacy.com.au');
  });

  it('walks pages without repeating or skipping a row', async () => {
    const first = await pageProspects(db, run, query({ limit: 2, offset: 0 }));
    const second = await pageProspects(db, run, query({ limit: 2, offset: 2 }));
    const seen = [...first.items, ...second.items].map((r) => r.email);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(second.items).toHaveLength(2);
  });

  it('lets a correction win over the model in the tallies', async () => {
    const page = await pageProspects(db, run, query());
    // Smiles and Hills wrote back; Ridge and Quiet Practice never did.
    expect(page.tallies.replied).toBe(2);
    // Yes: smiles (model yes, no override) and hills (overridden TO yes).
    // Ridge is a model yes overridden to never, so it is not one.
    expect(page.tallies.yes).toBe(2);
    expect(page.tallies.all).toBe(4);
  });

  it('cuts to the same set the tally counted', async () => {
    const page = await pageProspects(db, run, query({ cut: 'yes' }));
    expect(page.items.map((r) => r.email).sort()).toEqual([
      'hi@hills.com.au',
      'hi@smiles.com.au',
    ]);
    expect(page.matched).toBe(2);
    // `total` stays the run's size, so the screen can say "2 of 4 in the run".
    expect(page.total).toBe(4);
  });

  it('cuts to replied', async () => {
    const page = await pageProspects(db, run, query({ cut: 'replied' }));
    expect(page.matched).toBe(2);
    expect(page.items.map((r) => r.email).sort()).toEqual([
      'hi@hills.com.au',
      'hi@smiles.com.au',
    ]);
  });

  it('searches the suburb, the category and the site as well as the name', async () => {
    for (const [term, email] of [
      ['kellyville', 'hi@smiles.com.au'],
      ['dental clinic', 'hi@smiles.com.au'],
      ['smilesdental.com', 'hi@smiles.com.au'],
      ['ridge', 'hi@ridge.com.au'],
    ] as const) {
      const page = await pageProspects(db, run, query({ search: term }));
      expect(page.items.map((r) => r.email), `search: ${term}`).toEqual([email]);
      expect(page.total, `search: ${term}`).toBe(4);
    }
  });

  it('searches case-insensitively', async () => {
    const page = await pageProspects(db, run, query({ search: 'SMILES' }));
    expect(page.items.map((r) => r.email)).toEqual(['hi@smiles.com.au']);
  });

  it('carries every column the screen renders, in the shape it renders them', async () => {
    const [row] = (await pageProspects(db, run, query())).items;
    expect(row).toMatchObject({
      email: 'hi@smiles.com.au',
      businessName: 'Smiles Dental',
      category: 'Dental clinic',
      address: '1 Windsor Rd, Kellyville',
      // Migration 0109. Uploaded to Smartlead all along, kept from here on.
      phone: '+61 2 9876 5432',
      placeId: 'ChIJ-smiles',
      reviewsCount: 3,
      vertical: 'dentist',
      sendingDomain: 'mail-a.example',
      campaignId: 4242,
      classification: 'yes',
      hasThread: true,
    });
    // numeric → number, not the string postgres.js hands back.
    expect(row.rating).toBe(4.6);
    // timestamps → ISO strings, so the row survives the tRPC boundary.
    expect(row.lastSentAt).toBe('2026-08-04T00:00:00.000Z');
    expect(row.repliedAt).toBe('2026-08-06T00:00:00.000Z');
    expect(row.key).not.toBe('');
  });

  it('offers no thread for a business with no campaign', async () => {
    // Nothing was ever sent, so there is no live read to offer — and offering
    // one would be an API call per row for a conversation that cannot exist.
    const page = await pageProspects(db, run, query({ search: 'Quiet' }));
    expect(page.items[0].hasThread).toBe(false);
  });

  it('reports a purged run as empty rather than expired', async () => {
    // A `done` run with no rows had its prospects deleted; the list is gone on
    // purpose. Only a run still holding at review can have "aged out".
    const purged = { id: randomUUID(), status: 'done' as const };
    const page = await pageProspects(db, purged, { ...query(), runId: purged.id });
    expect(page.total).toBe(0);
    expect(page.expired).toBe(false);
  });

  it('reports a run still at review with nothing cached as expired', async () => {
    const stale = { id: randomUUID(), status: 'review' as const };
    const page = await pageProspects(db, stale, { ...query(), runId: stale.id });
    expect(page.expired).toBe(true);
  });

  it('does not call a run that never got a list expired', async () => {
    // Still scraping. It has no roster because it is not finished, which is a
    // different sentence from "the cache lost it".
    const scraping = { id: randomUUID(), status: 'running' as const };
    const page = await pageProspects(db, scraping, { ...query(), runId: scraping.id });
    expect(page.expired).toBe(false);
  });
});
