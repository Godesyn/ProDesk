/**
 * The two predicates the cost model rests on.
 *
 * Rule 1 is "never scrape the same (vertical × region) twice", and everything
 * that enforces it — the unique indexes, the covering-run check, the coverage
 * map, the form's own warning — asks the same underlying question: does this
 * run still OWN its region?
 *
 * The answer used to be `status !== 'failed'`, and that is true of exactly one
 * kind of failure: one that happened before the provider was ever called.
 * Every other failure — the verifier unreachable, Smartlead refusing an upload,
 * a redeploy mid-push, the ninety-minute deadline — happens after the bill has
 * landed. Treating those as "bought nothing" released the region, and the
 * operator's next honest move paid ~$15 again for a dataset still sitting on
 * the provider, free to re-read.
 *
 * `run_id` is the line: it is written in the same patch that records the
 * provider run, so a row that has one has spent money.
 */
import { describe, it, expect } from 'vitest';
import { hasBeenBilled, isResumable } from './ledger.js';
import type { OutreachListRunStatus } from '../../../db/schema.js';

const run = (status: OutreachListRunStatus, runId: string | null, datasetId: string | null = runId) =>
  ({ status, runId, datasetId }) as const;

describe('hasBeenBilled', () => {
  it('holds the region for a run that failed after its scrape landed', () => {
    expect(hasBeenBilled(run('failed', 'apify-run-1'))).toBe(true);
  });

  it('releases the region for a run that never reached the provider', () => {
    // Nothing was spent, so blocking a retry here would be pure ceremony.
    expect(hasBeenBilled(run('failed', null))).toBe(false);
  });

  it('releases the region for a run an operator deliberately retired', () => {
    // Superseding is the sanctioned way to buy a stale region again, so it has
    // to release the pair even though the original run did spend money.
    expect(hasBeenBilled(run('superseded', 'apify-run-1'))).toBe(false);
  });

  it('holds the region through every live status', () => {
    for (const status of ['starting', 'running', 'review', 'pushing', 'done'] as const) {
      expect(hasBeenBilled(run(status, 'apify-run-1'))).toBe(true);
    }
  });

  it('holds the region for a run still starting, before anything is spent', () => {
    // Deliberately conservative in the other direction: a run mid-start may be
    // about to spend, and two runs racing for one region is the thing the
    // uniqueness rule exists to stop.
    expect(hasBeenBilled(run('starting', null))).toBe(true);
  });
});

describe('isResumable', () => {
  it('is true only for a failure whose dataset can still be re-read', () => {
    expect(isResumable(run('failed', 'apify-run-1', 'dataset-1'))).toBe(true);
  });

  it('is false without a dataset to collect from', () => {
    expect(isResumable(run('failed', 'apify-run-1', null))).toBe(false);
  });

  it('is false for a run that never started', () => {
    expect(isResumable(run('failed', null))).toBe(false);
  });

  it('is false for anything that has not failed', () => {
    // "Retry" is only ever offered on a failure; a running or reviewed run has
    // its own path forward and re-entering it would double-push.
    expect(isResumable(run('done', 'apify-run-1'))).toBe(false);
    expect(isResumable(run('review', 'apify-run-1'))).toBe(false);
  });
});
