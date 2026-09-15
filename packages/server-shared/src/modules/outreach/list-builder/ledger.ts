import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { redis } from '../../../jobs/queues.js';
import { env } from '../../../lib/env.js';
import {
  outreachListRuns,
  type OutreachListRun,
  type OutreachListRunStatus,
} from '../../../db/schema.js';
import type { GeoJsonArea } from '../../../lib/geojson.js';
import { contains } from '../../../lib/geometry.js';
import { estimateCostUsd, mapsProvider, type ScrapeSpec } from './providers/index.js';
import { normaliseKey } from './regions.js';

/**
 * The run ledger.
 *
 * Two jobs, and neither is bookkeeping.
 *
 * **1. It is the thing that stops us paying twice.** Apify has no idempotency
 * key on run start, so the window between "call startRun" and "write down the
 * run id" is a window in which a Worker crash costs the entire scrape a second
 * time. The row is therefore written BEFORE the call, in `starting`, and a row
 * found in `starting` on resume must try to ADOPT an orphan run before it is
 * ever allowed to start a new one.
 *
 * **2. It is the record the coverage map is computed from.** Every row carries
 * the polygon it was scraped against, which is what makes "have I already
 * bought this council?" a question about geometry rather than about whether two
 * people spelled a name the same way. The map itself lives in coverage.ts.
 *
 * See docs/agents/outreach-apify.md §7 and §8.
 */

/** Fine-grained progress within a status — what the stage rail renders. */
export type ListRunStage =
  | 'starting'
  | 'scraping'
  | 'collecting'
  | 'deduping'
  | 'verifying'
  | 'hooking'
  | 'review'
  | 'pushing'
  | 'done'
  | 'failed';

export interface ListRunCounts {
  found: number;
  noEmail: number;
  duplicate: number;
  suppressed: number;
  unverified: number;
  /** Verification was attempted and the provider gave no verdict. */
  unknown: number;
  /** Got a review-count opener — free, and the reason §5 demoted the crawl. */
  hooked: number;
  /** Got a homepage detail from the optional Haiku crawl. */
  enriched: number;
  pushed: number;
}

export const emptyCounts = (): ListRunCounts => ({
  found: 0,
  noEmail: 0,
  duplicate: 0,
  suppressed: 0,
  unverified: 0,
  unknown: 0,
  hooked: 0,
  enriched: 0,
  pushed: 0,
});

export function countsOf(row: Pick<OutreachListRun, 'counts'>): ListRunCounts {
  return { ...emptyCounts(), ...((row.counts ?? {}) as Partial<ListRunCounts>) };
}

/**
 * Did this run stop because it ran out of budget rather than out of businesses?
 *
 * `collect()` takes the dataset up to `maxRecords` and no further, so `found`
 * reaching the cap means the region had more to give and the rest was never
 * looked at. Nothing else in the pipeline notices — the run completes, reviews
 * and pushes exactly as a complete sweep would — which is precisely why it has
 * to be said out loud: a truncated region reads as a finished one on the
 * coverage map, and that is how a vertical gets quietly written off at 40%.
 *
 * A region holding EXACTLY `maxRecords` businesses reports as capped too. That
 * is the harmless direction to be wrong in.
 */
export function isCapped(row: Pick<OutreachListRun, 'counts' | 'maxRecords'>): boolean {
  return countsOf(row).found >= row.maxRecords;
}

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * A repeat of a (vertical × region) pair that is already spent.
 *
 * Thrown rather than warned about: rule 1 of the cost model is the only way to
 * genuinely waste money on this pipeline, and the database — not the operator's
 * memory — is what enforces it.
 */
export class RegionAlreadyScrapedError extends Error {
  constructor(
    readonly vertical: string,
    readonly region: string,
    readonly existing: OutreachListRun | null,
  ) {
    super(
      `${vertical} in ${region} has already been scraped${
        existing ? ` (run ${existing.id.slice(0, 8)}, ${existing.status})` : ''
      }. Supersede that run to scrape it again.`,
    );
    this.name = 'RegionAlreadyScrapedError';
  }
}

/**
 * A region that is already inside one we bought.
 *
 * The unique indexes catch a region scraped twice under one name, and under two
 * names for one OSM object. Neither can see the case that costs the most: a
 * council scraped after the metro that contains it. Those are two different
 * regions with two different ids, so the database is happy — and Apify bills
 * for every business in the council a second time, after which `dedupe()`
 * silently drops all of them as already known. The run "succeeds", pushes
 * nothing, and the money is gone.
 *
 * Since migration 0102 every run carries the polygon it was scraped against, so
 * this is now answerable. It is a refusal rather than a warning for the same
 * reason as its sibling above: rule 1 of the cost model is the only way to
 * genuinely waste money here.
 */
export class RegionCoveredError extends Error {
  constructor(
    readonly vertical: string,
    readonly region: string,
    readonly covering: OutreachListRun,
  ) {
    super(
      `${region} is inside ${covering.regionLabel ?? covering.regionKey}, which has already been scraped for ${vertical} (run ${covering.id.slice(
        0,
        8,
      )}, ${covering.status}). Those businesses are already bought — scraping this would pay for them again and push nothing. Retire that run to redo the area.`,
    );
    this.name = 'RegionCoveredError';
  }
}

/**
 * A run that has been paid for and can never be paid for again.
 *
 * This is the predicate the whole cost model turns on, and it is NOT
 * `status <> 'failed'`. The unique indexes say "everything except failed and
 * superseded blocks a repeat", on the reasoning that a failed run bought
 * nothing worth keeping — and that is true of exactly one kind of failure: one
 * that happened before `beginScrape` ever called the provider.
 *
 * Every other failure happens AFTER the money is gone. The scrape succeeds, the
 * bill lands, and then the verifier is unreachable, or Smartlead refuses the
 * upload, or the process is redeployed mid-push, or the ninety-minute deadline
 * trips. `tick`'s catch-all marks all of those `failed`, at which point the row
 * stops blocking its own region and the operator's next honest move — run it
 * again, nothing came through — pays the full price a second time for a dataset
 * that is still sitting on the provider, free to re-read.
 *
 * `run_id` is the line between the two. It is written in the same patch that
 * records the provider run, so a row that has one has spent money and a row
 * that has not, has not.
 */
const BILLED = sql`${outreachListRuns.runId} IS NOT NULL`;

/** Runs that still hold their region: live ones, plus failed ones already paid for. */
const HOLDS_REGION = sql`(
  ${outreachListRuns.status} <> 'superseded'
  AND (${outreachListRuns.status} <> 'failed' OR ${BILLED})
)`;

/**
 * Can this failed run be picked up again for free?
 *
 * True when the provider run exists and its dataset is still named on the row.
 * Everything after the scrape re-reads that dataset at no cost, so a retry is a
 * few cents of re-verification against the ~$15 the scrape cost.
 */
export function isResumable(row: Pick<OutreachListRun, 'status' | 'runId' | 'datasetId'>): boolean {
  return row.status === 'failed' && !!row.runId && !!row.datasetId;
}

/**
 * Did this run's region actually get bought?
 *
 * The in-memory twin of `HOLDS_REGION`, for the coverage map, which reads every
 * run at once and decides containment in JavaScript. Both have to answer the
 * same way or the map will show an area as unbought that the ledger refuses to
 * scrape — or, worse, the other way round.
 */
export function hasBeenBilled(row: Pick<OutreachListRun, 'status' | 'runId'>): boolean {
  return row.status !== 'superseded' && (row.status !== 'failed' || !!row.runId);
}

/**
 * The live run for this vertical whose area swallows the one being asked for.
 *
 * Exported because the UI wants to say so before the operator commits, not
 * after. A run that never reached the provider cannot cover anything — letting
 * it block thirty councils would be the most expensive kind of wrong — but one
 * that failed *after* billing owns its area exactly as a finished run does.
 */
export async function findCoveringRun(
  vertical: string,
  boundary: GeoJsonArea,
): Promise<OutreachListRun | null> {
  const rows = await db
    .select()
    .from(outreachListRuns)
    .where(
      and(
        eq(outreachListRuns.vertical, normaliseKey(vertical)),
        HOLDS_REGION,
        sql`${outreachListRuns.regionBoundary} IS NOT NULL`,
      ),
    );
  for (const row of rows) {
    if (row.regionBoundary && contains(row.regionBoundary, boundary)) return row;
  }
  return null;
}

/**
 * A run that already bought this exact (vertical × region) and then failed.
 *
 * Checked in the application rather than by widening the unique indexes,
 * deliberately. The indexes are the backstop for the common case and must not
 * be able to reject a write for a reason nobody can see; this refusal has a
 * sentence attached to it that names the run and offers the free path.
 */
async function findBilledFailedRun(
  vertical: string,
  regionKey: string,
  placeId: string | null,
): Promise<OutreachListRun | null> {
  const [row] = await db
    .select()
    .from(outreachListRuns)
    .where(
      and(
        eq(outreachListRuns.vertical, vertical),
        eq(outreachListRuns.status, 'failed'),
        BILLED,
        placeId
          ? sql`(${outreachListRuns.regionKey} = ${regionKey} OR ${outreachListRuns.placeId} = ${placeId})`
          : eq(outreachListRuns.regionKey, regionKey),
      ),
    )
    .orderBy(desc(outreachListRuns.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * A repeat of a pair whose scrape was already bought and then fell over.
 *
 * Separate from `RegionAlreadyScrapedError` because the answer is different:
 * that one says "retire the run to do it again", which means paying again. This
 * one has a free path — the dataset is still there — so it points at retry
 * first and leaves retiring as the deliberate second choice.
 */
export class RegionBilledButFailedError extends Error {
  constructor(
    readonly vertical: string,
    readonly region: string,
    readonly existing: OutreachListRun,
  ) {
    super(
      `${vertical} in ${region} was already scraped — run ${existing.id.slice(0, 8)} paid for it and then failed (${
        existing.error ?? 'no reason recorded'
      }). Retry that run instead: re-reading a scraped dataset is free, and starting this one would buy the same businesses a second time. Retire it if you genuinely want a fresh scrape.`,
    );
    this.name = 'RegionBilledButFailedError';
  }
}

export interface CreateRunInput {
  /** The search term. There is no separate one — see regions.ts. */
  vertical: string;
  region: string;
  countryCode?: string;
  maxRecords: number;
  campaignId: number | null;
  sendingDomain: string | null;
  /** The optional Haiku homepage crawl. Off by default — see run.ts. */
  personalise: boolean;
  /** The region's stable id, from region search. */
  placeId?: string | null;
  /**
   * The region's boundary — what the scraper is actually pointed at.
   *
   * Optional on the type so the pre-boundary path still compiles, but every
   * caller that can get one should: without it the scraper falls back to
   * geocoding the region's NAME, which cannot resolve an LGA at all and
   * silently resolves some city names to the wrong area (see apify.ts).
   */
  boundary?: GeoJsonArea | null;
}

export function specOf(row: OutreachListRun): ScrapeSpec {
  return {
    // `vertical` is the search term, stored normalised. Case is the only thing
    // normalisation takes off it, and Maps search is case-insensitive — so the
    // stored form and the typed form return the same places.
    searchTerm: row.vertical,
    // The region LABEL, not the key: the key is lowercased for uniqueness, and
    // what goes to a geocoder should be the name a human chose. Only reached
    // now on rows that predate boundaries — the boundary below is what a
    // current run is scraped by.
    region: row.regionLabel ?? row.regionKey,
    countryCode: row.countryCode,
    // Read back off the row, never re-fetched. See the column comment: the
    // input hash is derived from this, and adoption compares hashes.
    boundary: row.regionBoundary ?? null,
    maxRecords: row.maxRecords,
  };
}

/**
 * Reserve the (vertical × region) pair and record the intent — before a single
 * cent is spent.
 */
export async function createRun(input: CreateRunInput): Promise<OutreachListRun> {
  const provider = mapsProvider();
  const vertical = normaliseKey(input.vertical);
  // Normalised, because it is half of the uniqueness key and this used to be a
  // bare `.trim()` — which made the index case-sensitive on one side only, and
  // "Inner West" vs "inner west" two ledger rows for one council.
  const regionLabel = input.region.trim();
  const regionKey = normaliseKey(regionLabel);
  const countryCode = (input.countryCode ?? 'au').toLowerCase();
  const boundary = input.boundary ?? null;
  const spec: ScrapeSpec = {
    // The normalised form, so the input hash a resumed run rebuilds matches the
    // one the original was started with regardless of how the term was typed.
    searchTerm: vertical,
    region: regionLabel,
    countryCode,
    boundary,
    maxRecords: input.maxRecords,
  };

  // Before the unique indexes, because they cannot see either of these.
  // Checked here rather than in the router so that every path to a run — the
  // UI, the e2e script, anything later — is covered by them.
  if (boundary) {
    const covering = await findCoveringRun(vertical, boundary);
    if (covering) throw new RegionCoveredError(input.vertical, regionLabel, covering);
  }
  // The pair itself, when the run that holds it is `failed` and therefore
  // invisible to the unique index — but has a provider run id, and so has
  // already been paid for. See `BILLED`.
  const billedFailure = await findBilledFailedRun(vertical, regionKey, input.placeId ?? null);
  if (billedFailure) {
    throw new RegionBilledButFailedError(input.vertical, regionLabel, billedFailure);
  }

  try {
    const [row] = await db
      .insert(outreachListRuns)
      .values({
        provider: provider.name,
        actorId: provider.name === 'apify' ? env.APIFY_MAPS_ACTOR_ID : null,
        vertical,
        regionKey,
        regionLabel,
        countryCode,
        placeId: input.placeId ?? null,
        regionBoundary: boundary,
        inputHash: provider.inputHash(spec),
        status: 'starting',
        stage: 'starting',
        maxRecords: input.maxRecords,
        personalise: input.personalise,
        campaignId: input.campaignId,
        sendingDomain: input.sendingDomain,
        // Last in the send queue. A new run goes behind everything already
        // waiting — the operator can promote it, but "newest jumps the line" is
        // never the default when the line decides who gets emailed first.
        queuePosition: sql<number>`(select coalesce(max(${outreachListRuns.queuePosition}), 0) + 1 from ${outreachListRuns})`,
        counts: emptyCounts(),
        costEstimateUsd: String(estimateCostUsd(input.maxRecords)),
      })
      .returning();
    return row;
  } catch (e) {
    if ((e as { code?: string }).code === UNIQUE_VIOLATION) {
      // Either index can fire. The place-id one is the interesting case: the
      // operator picked a name we've never seen for an area we have already
      // scraped under a different name, so the error has to name the run they
      // can't see rather than the words they just typed.
      throw new RegionAlreadyScrapedError(
        input.vertical,
        regionLabel,
        (await findLiveRun(vertical, regionKey)) ??
          (input.placeId ? await findLiveRunByPlace(vertical, input.placeId) : null),
      );
    }
    throw e;
  }
}

async function findLiveRun(vertical: string, regionKey: string): Promise<OutreachListRun | null> {
  const [row] = await db
    .select()
    .from(outreachListRuns)
    .where(
      and(
        eq(outreachListRuns.vertical, vertical),
        eq(outreachListRuns.regionKey, regionKey),
        sql`${outreachListRuns.status} NOT IN ('failed', 'superseded')`,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The same lookup, keyed on Google's id — for a region named two ways. */
async function findLiveRunByPlace(vertical: string, placeId: string): Promise<OutreachListRun | null> {
  const [row] = await db
    .select()
    .from(outreachListRuns)
    .where(
      and(
        eq(outreachListRuns.vertical, vertical),
        eq(outreachListRuns.placeId, placeId),
        sql`${outreachListRuns.status} NOT IN ('failed', 'superseded')`,
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getRun(id: string): Promise<OutreachListRun | null> {
  const [row] = await db.select().from(outreachListRuns).where(eq(outreachListRuns.id, id)).limit(1);
  return row ?? null;
}

export async function listRuns(limit = 50): Promise<OutreachListRun[]> {
  return db
    .select()
    .from(outreachListRuns)
    .orderBy(desc(outreachListRuns.createdAt), desc(outreachListRuns.id))
    .limit(limit);
}

/* ──────────────────────────────────────────────────────────────────────────
 * The send queue
 *
 * Scraping is parallel; sending is single-file. Every run lands in the same one
 * campaign, so "which region hears from us first" is a real decision, and
 * `queue_position` is where it is written down.
 *
 * The order is STRICT: a run may only push when nothing ahead of it is still
 * unsent — including a run that is merely still scraping. A queue that let
 * whoever finished first go first would not be a queue, it would be a race with
 * a table of numbers next to it. Strictness is what makes the order mean
 * something, and `skipped_at` is what makes strictness liveable.
 * ────────────────────────────────────────────────────────────────────────── */

/** Statuses that are finished with the queue — sent, given up on, or retired. */
export const SETTLED_STATUSES: OutreachListRunStatus[] = ['done', 'failed', 'superseded'];

/** Where a run sits relative to the send queue. Three states, no fourth. */
export type QueueState = 'queued' | 'sending' | 'sent';

export function queueStateOf(row: Pick<OutreachListRun, 'status'>): QueueState {
  if (SETTLED_STATUSES.includes(row.status)) return 'sent';
  return row.status === 'pushing' ? 'sending' : 'queued';
}

/**
 * Is this run allowed to send yet?
 *
 * Returns the run that is holding it up, or null when it is clear to go. Kept
 * as a query rather than computed from a fetched list because it is asked on
 * every tick of every waiting run, and because the answer has to be true at the
 * moment it is acted on — the run ahead may have finished a second ago.
 *
 * Skipped runs are invisible to this. That is the whole point of skipping: a
 * run someone is not ready to send must not silently hold up the four behind
 * it, and the alternative — deleting it — throws away a scrape that was paid
 * for.
 */
export async function blockedBy(
  row: Pick<OutreachListRun, 'id' | 'queuePosition' | 'createdAt'>,
): Promise<OutreachListRun | null> {
  const [ahead] = await db
    .select()
    .from(outreachListRuns)
    .where(
      and(
        // Compared as a tuple, with creation time breaking the tie. Two runs
        // started in the same instant can be handed the same position — the
        // `max + 1` that assigns it is not serialised — and on a plain `<` they
        // would each see nothing ahead and both push. Which of the two goes
        // first does not matter; that exactly one does.
        sql`(${outreachListRuns.queuePosition}, ${outreachListRuns.createdAt}) < (${row.queuePosition}, ${row.createdAt.toISOString()}::timestamptz)`,
        sql`${outreachListRuns.status} NOT IN ('done', 'failed', 'superseded')`,
        sql`${outreachListRuns.skippedAt} IS NULL`,
      ),
    )
    .orderBy(outreachListRuns.queuePosition, outreachListRuns.createdAt)
    .limit(1);
  return ahead ?? null;
}

/**
 * The queue as the operator sees it: unsent runs in send order.
 *
 * Skipped runs are included — they are still IN the list, holding their place,
 * just not eligible to send. Leaving them out would make unskipping look like
 * an insert rather than the restoration it is.
 */
export async function sendQueue(): Promise<OutreachListRun[]> {
  return db
    .select()
    .from(outreachListRuns)
    .where(sql`${outreachListRuns.status} NOT IN ('done', 'failed', 'superseded')`)
    .orderBy(outreachListRuns.queuePosition, outreachListRuns.createdAt);
}

/** Nothing to reorder — the run has already sent, or is sending right now. */
export class RunNotQueuedError extends Error {
  constructor(what: string) {
    super(
      `This run is ${what}, so its place in the queue can no longer be changed. ` +
        'Only runs that have not sent yet can be reordered or skipped.',
    );
    this.name = 'RunNotQueuedError';
  }
}

function assertQueued(row: OutreachListRun): void {
  const state = queueStateOf(row);
  if (state === 'sent') throw new RunNotQueuedError('already finished');
  if (state === 'sending') throw new RunNotQueuedError('sending now');
}

/**
 * Move a run one place up or down the queue.
 *
 * One place at a time rather than a drag target, because the list is read as an
 * order and the honest gesture for "this one before that one" is a swap. It
 * swaps with the adjacent UNSENT run, skipped ones included: a skipped run
 * still occupies a place, and being unable to move past it would make skipping
 * feel like a wall.
 *
 * The whole queue is renumbered from zero inside one transaction rather than
 * two positions being swapped in place. Renumbering is idempotent and cannot
 * leave two runs sharing a position, which a swap can if it half-applies.
 */
export async function moveRun(id: string, delta: -1 | 1): Promise<void> {
  await db.transaction(async (tx) => {
    const queue = await tx
      .select()
      .from(outreachListRuns)
      .where(sql`${outreachListRuns.status} NOT IN ('done', 'failed', 'superseded')`)
      .orderBy(outreachListRuns.queuePosition, outreachListRuns.createdAt)
      .for('update');

    const from = queue.findIndex((r) => r.id === id);
    if (from === -1) throw new RunNotQueuedError('no longer in the queue');
    assertQueued(queue[from]);

    const to = from + delta;
    // Already at the end it was heading for. Not an error — the button is at
    // the edge of the list and pressing it again should do nothing, quietly.
    if (to < 0 || to >= queue.length) return;
    // And never past the run that is uploading right now. Its contacts are
    // already going out; putting something "before" it would be an order the
    // world has stopped being able to honour.
    if (queueStateOf(queue[to]) === 'sending') return;

    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);

    // Positions start above every settled run so a new run never lands ahead of
    // one that has already sent, which would make the history read backwards.
    const [{ base }] = await tx
      .select({ base: sql<number>`coalesce(max(${outreachListRuns.queuePosition}), 0)` })
      .from(outreachListRuns)
      .where(sql`${outreachListRuns.status} IN ('done', 'failed', 'superseded')`);

    for (const [i, row] of queue.entries()) {
      await tx
        .update(outreachListRuns)
        .set({ queuePosition: base + i + 1 })
        .where(eq(outreachListRuns.id, row.id));
    }
  });
}

/**
 * Park a run out of the queue, or put it back.
 *
 * Skipping also clears `auto_push_at`, because the two would otherwise
 * contradict each other the moment the run reached the front: a countdown that
 * expires on a run the queue is passing over would send it anyway. Unskipping
 * re-arms the countdown from now, so the five minutes to change your mind is
 * five minutes from the decision rather than five minutes from whenever the
 * scrape happened to land.
 */
export async function setRunSkipped(
  id: string,
  skipped: boolean,
  holdMs: number,
): Promise<OutreachListRun | null> {
  const row = await getRun(id);
  if (!row) return null;
  assertQueued(row);

  const [updated] = await db
    .update(outreachListRuns)
    .set({
      skippedAt: skipped ? new Date() : null,
      // Only a run that has something to send has a countdown to re-arm. One
      // still scraping gets its deadline stamped when it reaches `review`.
      autoPushAt: skipped ? null : row.status === 'review' ? new Date(Date.now() + holdMs) : null,
    })
    .where(eq(outreachListRuns.id, id))
    .returning();
  return updated ?? null;
}

/**
 * The verticals we have actually run, most recent first.
 *
 * This replaces a hand-written table of 13 with estimated Sydney listing
 * counts. The estimates were guesses that fed a cap default, and the list never
 * shrank as verticals were done, so it read as a plan rather than as a state.
 * What an operator actually wants from this field is "what did I call it last
 * time" — the exact string, because the string is the search, the campaign
 * bucket and the noun in the opener all at once, and a near-miss spelling is a
 * second ledger row for one set of businesses.
 */
export async function listVerticals(): Promise<{ vertical: string; runs: number }[]> {
  const rows = await db
    .select({
      vertical: outreachListRuns.vertical,
      runs: sql<number>`count(*)::int`,
      latest: sql<Date>`max(${outreachListRuns.createdAt})`,
    })
    .from(outreachListRuns)
    .where(sql`${outreachListRuns.status} <> 'failed'`)
    .groupBy(outreachListRuns.vertical)
    .orderBy(sql`max(${outreachListRuns.createdAt}) desc`);
  return rows.map((r) => ({ vertical: r.vertical, runs: r.runs }));
}

export async function patchRun(
  id: string,
  patch: Partial<{
    status: OutreachListRunStatus;
    stage: ListRunStage;
    runId: string;
    datasetId: string;
    counts: ListRunCounts;
    costActualUsd: number | null;
    error: string | null;
    /** Null clears the hold's deadline, which is what Hold means. */
    autoPushAt: Date | null;
    startedAt: Date;
    finishedAt: Date | null;
  }>,
): Promise<OutreachListRun | null> {
  const [row] = await db
    .update(outreachListRuns)
    .set({
      ...patch,
      costActualUsd:
        patch.costActualUsd === undefined
          ? undefined
          : patch.costActualUsd === null
            ? null
            : String(patch.costActualUsd),
    })
    .where(eq(outreachListRuns.id, id))
    .returning();
  return row ?? null;
}

/**
 * Somebody else is already starting this scrape.
 *
 * Not a failure — nothing was spent and the other holder is going to finish the
 * job. `tick` has to tell this apart from a real error, because its catch-all
 * marks the run `failed`, and a run failed for losing a race would then need a
 * retry to recover from something that never went wrong.
 */
export class ScrapeClaimedError extends Error {
  constructor() {
    super('Another worker is already starting this scrape.');
    this.name = 'ScrapeClaimedError';
  }
}

/**
 * Start the scrape, or adopt one we already paid for.
 *
 * This is the only function in the feature that spends money, and everything
 * about it is arranged around the fact that the spend is not reversible and not
 * idempotent.
 *
 * Adoption first, always. A row sitting in `starting` means one of two things
 * happened: we crashed before calling Apify (nothing was spent, adoption finds
 * nothing, we start fresh), or we crashed after (the run exists and is running
 * right now). Those two are indistinguishable from our side, and only one of
 * them is safe to guess at — so we ask Apify instead of guessing.
 *
 * A provider that cannot answer the adoption question refuses to auto-resume a
 * `starting` row at all. Blocking a run is recoverable by a human in a minute;
 * a duplicate scrape is not recoverable at all.
 */
export async function beginScrape(row: OutreachListRun): Promise<OutreachListRun> {
  const provider = mapsProvider();
  // Already started, and the row never caught up — the provider run was created
  // and the patch that records it did not land, or a retry routed here. Move it
  // to `running` rather than returning it as-is: this used to hand `tick` a row
  // still marked `starting`, which re-queued itself every twenty seconds and
  // polled a scrape it was never going to advance past.
  if (row.runId) {
    return (
      (await patchRun(row.id, {
        status: 'running',
        stage: 'scraping',
        startedAt: row.startedAt ?? new Date(),
      })) ?? row
    );
  }

  /*
   * Claim the row before spending anything.
   *
   * Everything else in this function protects against the SAME process trying
   * twice. Nothing protected against two of them: the Worker runs one job at a
   * time, but a second Worker replica is one Railway setting away, and two
   * `list-build` ticks for one run on two replicas both read `run_id IS NULL`,
   * both find no orphan to adopt, and both call `startRun`. That is two full
   * scrapes on one bill, and no amount of care further down recovers it.
   *
   * Five minutes is longer than a start takes and shorter than anyone would
   * wait to retry. A holder that dies inside the window leaves the row in
   * `starting` with the lock expiring on its own, which is exactly the state
   * the adoption path above was built for.
   */
  const claim = `outreach:listrun:${row.id}:starting`;
  const held = await redis
    .set(claim, '1', 'EX', 300, 'NX')
    .catch(() => 'OK' as const); // A Redis outage must not stop a run starting.
  if (held !== 'OK') throw new ScrapeClaimedError();

  if (provider.supportsAdoption) {
    // A generous window: the row's own creation time, less a minute of clock
    // skew between us and Apify. Anything older is a different run.
    const since = new Date(row.createdAt.getTime() - 60_000);
    const orphans = await provider.findRunsByInput(row.inputHash, since).catch(() => []);
    const orphan = orphans[0];
    if (orphan) {
      console.warn('[outreach] adopted an orphan scrape', {
        ledgerRow: row.id,
        runId: orphan.runId,
      });
      return (
        (await patchRun(row.id, {
          runId: orphan.runId,
          datasetId: orphan.datasetId,
          status: 'running',
          stage: 'scraping',
          startedAt: new Date(),
        })) ?? row
      );
    }
    // No orphan found, but the row has been sitting in `starting` long enough
    // that a run we started could have finished and aged out of the recent-runs
    // window. Starting fresh here would be a coin flip on a real charge.
    const age = Date.now() - row.createdAt.getTime();
    if (age > 60 * 60_000) {
      throw new Error(
        'This run was created over an hour ago and never recorded a scrape id, and no matching Apify run is still visible. Starting it now risks paying for a scrape twice — check the Apify console, then supersede this run or start a new one deliberately.',
      );
    }
  } else if (Date.now() - row.createdAt.getTime() > 5 * 60_000) {
    throw new Error(
      `${provider.name} cannot be asked whether a run was already started, so a stalled run is not safe to resume automatically. Check the provider console before retrying.`,
    );
  }

  const handle = await provider.startRun(specOf(row));
  return (
    (await patchRun(row.id, {
      runId: handle.runId,
      datasetId: handle.datasetId,
      status: 'running',
      stage: 'scraping',
      startedAt: new Date(),
    })) ?? row
  );
}

/**
 * Put a failed run back on the rails, without paying for anything twice.
 *
 * Everything after the scrape is free to repeat — paging a dataset is not a
 * billable event — so a run that fell over in `verifying`, `hooking` or
 * `pushing` can be picked up exactly where the money stopped mattering. It
 * re-enters at `running`, which makes the next tick re-poll the provider (it
 * answers SUCCEEDED instantly for a finished run), re-collect from the dataset,
 * and carry on. The working set in Redis is reused when it survived and rebuilt
 * from the dataset when it did not.
 *
 * A run with no provider run id never spent anything, so it goes back to
 * `starting` and takes the ordinary path — including orphan adoption, which is
 * what stops *that* case paying twice.
 *
 * Failure is only ever recoverable in one direction: this never re-runs the
 * scrape itself. If the provider run genuinely failed, the next tick fails the
 * ledger row again with the provider's own reason, and the operator's remaining
 * option is to retire it and buy a new scrape deliberately.
 */
export async function retryRun(id: string): Promise<OutreachListRun | null> {
  const row = await getRun(id);
  if (!row) return null;
  if (row.status !== 'failed') {
    throw new RunNotRetryableError(`This run is ${row.status}, not failed.`);
  }
  // Routed on `run_id` alone, not on `isResumable`. A row with a run id and no
  // dataset id has still SPENT the money, and sending it back to `starting`
  // would put it in front of `beginScrape` — which is the one place that can
  // start a second paid run. `running` costs nothing to be wrong about: the
  // next tick refuses it by name if there is genuinely nothing to collect.
  const billed = !!row.runId;
  return patchRun(row.id, {
    status: billed ? 'running' : 'starting',
    stage: billed ? 'scraping' : 'starting',
    error: null,
    finishedAt: null,
    // Cleared so the run rejoins the hold when it next reaches `review`, rather
    // than inheriting a deadline from an attempt that never got there.
    autoPushAt: null,
  });
}

/** A retry that has nothing to retry. */
export class RunNotRetryableError extends Error {
  constructor(message: string) {
    super(`${message} Only a failed run can be retried.`);
    this.name = 'RunNotRetryableError';
  }
}

/**
 * Retire a run so its (vertical × region) pair can be scraped again.
 *
 * This is how the ~1–2%/month top-up §8 calls for gets past the uniqueness
 * rule without weakening it. It is a deliberate operator act with a cost
 * attached, which is the point: the rule should be annoying to bypass.
 */
export async function supersedeRun(id: string): Promise<void> {
  await db
    .update(outreachListRuns)
    .set({ status: 'superseded', finishedAt: new Date() })
    .where(eq(outreachListRuns.id, id));
}

/**
 * Runs the Worker should pick back up after a restart.
 *
 * `review` is in the list because that status now carries a deadline. A run
 * holding for five minutes is waiting on a delayed job, and a deploy inside that
 * window drops it — which would leave the run parked forever, looking finished,
 * having sent nothing. A held run (no `auto_push_at`) ticks to a no-op, so
 * sweeping all of them costs one query.
 */
export async function resumableRuns(): Promise<OutreachListRun[]> {
  return db
    .select()
    .from(outreachListRuns)
    .where(inArray(outreachListRuns.status, ['starting', 'running', 'review', 'pushing']));
}
