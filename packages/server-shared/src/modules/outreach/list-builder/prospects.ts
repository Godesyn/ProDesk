import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { redis } from '../../../jobs/queues.js';
import { outreachProspectState } from '../../../db/schema.js';
import {
  deleteLeadFromCampaign,
  isSmartleadConfigured,
  leadByEmail,
  SmartleadError,
} from '../smartlead.js';

/**
 * Undoing a run.
 *
 * A list run is the only thing in this feature that creates prospects in bulk,
 * and it is therefore the only thing that can create a bulk MISTAKE: a search
 * term that turned out to mean something else, a region that resolved to the
 * wrong council, a vertical we decided not to sell into after all. Cleaning that
 * up one row at a time is not a real option at 400 rows.
 *
 * The hard part is not the delete. It is that by the time anyone regrets a run,
 * its contacts are in a Smartlead campaign with a sequence running, and deleting
 * OUR row does not stop a single email — it just means we no longer know who is
 * receiving them. A prospect table that has forgotten someone the campaign is
 * still emailing is worse than one that never knew about them.
 *
 * So the order is: take them out of the campaign first, delete the row second,
 * and keep the row when the first step fails. Anyone left behind is reported as
 * stranded rather than quietly dropped.
 */

/** What `push()` writes into `source`. The link between a run and its prospects. */
export const sourceOfRun = (runId: string) => `list-build:${runId}`;

export async function countRunProspects(runId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachProspectState)
    .where(eq(outreachProspectState.source, sourceOfRun(runId)));
  return row?.n ?? 0;
}

/** Prospect counts for many runs at once — the ledger renders one per row. */
export async function countProspectsByRun(runIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (runIds.length === 0) return out;
  const rows = await db
    .select({ source: outreachProspectState.source, n: sql<number>`count(*)::int` })
    .from(outreachProspectState)
    .where(inArray(outreachProspectState.source, runIds.map(sourceOfRun)))
    .groupBy(outreachProspectState.source);
  for (const r of rows) {
    if (r.source?.startsWith('list-build:')) out.set(r.source.slice('list-build:'.length), r.n);
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The Smartlead lead id
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * This prospect's Smartlead lead id, looked up and remembered.
 *
 * The id is NOT captured at push time and deliberately so: the upload returns
 * ids as a bare array with no documented pairing to the leads that were sent,
 * so zipping them by position risks attaching one business's thread to
 * another's row. Looking it up by the address we already know is one API call
 * and cannot be wrong.
 *
 * That left a gap nothing filled. `smartlead_lead_id` was only ever written on
 * the withdraw path, so the conversation view — §7's "render a real thread",
 * and the thread above every draft in the Reply Queue — had no id to fetch
 * with and rendered empty for every prospect who had ever been emailed. So the
 * lookup happens on first read instead, and the answer is written back: one
 * call per prospect, ever.
 *
 * Null on any failure. A thread we cannot fetch must not take the prospect
 * down with it.
 */
export async function resolveLeadId(prospect: {
  id: string;
  email: string;
  smartleadLeadId: string | null;
}): Promise<string | null> {
  if (prospect.smartleadLeadId) return prospect.smartleadLeadId;
  if (!isSmartleadConfigured()) return null;
  try {
    const lead = await leadByEmail(prospect.email);
    if (lead?.id === undefined || lead.id === null) return null;
    const leadId = String(lead.id);
    await db
      .update(outreachProspectState)
      .set({ smartleadLeadId: leadId })
      .where(eq(outreachProspectState.id, prospect.id));
    return leadId;
  } catch {
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Taking one person out of a campaign
 * ────────────────────────────────────────────────────────────────────────── */

export type WithdrawOutcome =
  /** Removed from the campaign, or never in one. Safe to delete. */
  | { ok: true }
  /** Still in the campaign, still being emailed. The row must stay. */
  | { ok: false; reason: string };

/**
 * Stop the rest of someone's sequence.
 *
 * The lead id is looked up by address rather than read off our row, because the
 * row's copy is usually null: the upload returns ids as a bare array with no
 * documented pairing to the leads that were sent, so we never stored them. When
 * a lookup does produce an id it is written back, which makes the second attempt
 * on the same person cheap and fixes the conversation view for them as a side
 * effect.
 */
export async function withdrawFromCampaign(prospect: {
  id: string;
  email: string;
  smartleadCampaignId: number | null;
  smartleadLeadId: string | null;
}): Promise<WithdrawOutcome> {
  if (!prospect.smartleadCampaignId) return { ok: true };
  // Nothing is sending, so nothing needs stopping. Refusing to delete here
  // would be pedantry about a campaign that cannot be running.
  if (!isSmartleadConfigured()) return { ok: true };

  try {
    let leadId = prospect.smartleadLeadId;
    if (!leadId) {
      const lead = await leadByEmail(prospect.email);
      if (lead?.id === undefined || lead.id === null) {
        // Smartlead does not know this address. Either the upload never landed
        // or they have already been removed — either way no sequence is running.
        return { ok: true };
      }
      leadId = String(lead.id);
      await db
        .update(outreachProspectState)
        .set({ smartleadLeadId: leadId })
        .where(eq(outreachProspectState.id, prospect.id));
    }
    await deleteLeadFromCampaign(prospect.smartleadCampaignId, leadId);
    return { ok: true };
  } catch (e) {
    // A 404 means the lead is not in that campaign, which is the state we were
    // trying to reach. Everything else is a genuine failure to stop the sending.
    if (e instanceof SmartleadError && e.status === 404) return { ok: true };
    return { ok: false, reason: (e as Error).message };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Purging a whole run
 * ────────────────────────────────────────────────────────────────────────── */

export interface PurgeState {
  runId: string;
  total: number;
  /** Rows processed so far, stranded ones included. */
  done: number;
  deleted: number;
  /** Left in place because they could not be taken out of their campaign. */
  stranded: number;
  /** The first few reasons, so the UI can say what went wrong without a log dive. */
  errors: string[];
  /** Bumped on every progress flush — how a crashed purge is told from a slow one. */
  updatedAt: string;
  finishedAt: string | null;
}

const purgeKey = (runId: string) => `outreach:listrun:${runId}:purge`;
/** Long enough to read the result the next morning. */
const PURGE_TTL_SECONDS = 24 * 3600;
/** Enough reasons to see a pattern; not enough to fill Redis with one. */
const MAX_ERRORS = 5;

async function writeState(state: PurgeState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await redis.set(purgeKey(state.runId), JSON.stringify(state), 'EX', PURGE_TTL_SECONDS);
}

/**
 * A purge that stopped reporting is a purge that died with the Worker.
 *
 * Without this a crashed job would hold the lock for the whole 24-hour TTL, and
 * the one operation the operator reaches for when something went wrong would be
 * the one they can't retry.
 */
const ABANDONED_MS = 3 * 60_000;

const isAbandoned = (state: PurgeState): boolean =>
  !state.finishedAt && Date.now() - new Date(state.updatedAt).getTime() > ABANDONED_MS;

export async function readPurge(runId: string): Promise<PurgeState | null> {
  const raw = await redis.get(purgeKey(runId)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PurgeState;
  } catch {
    return null;
  }
}

/**
 * Claim the purge for a run, so two clicks can't run it twice.
 *
 * Returns the state the UI should start polling, or null when one is already
 * in flight. Writing the state here rather than in the Worker means the progress
 * bar exists from the moment the button is pressed.
 */
export async function beginPurge(runId: string): Promise<PurgeState | null> {
  const existing = await readPurge(runId);
  if (existing && !existing.finishedAt && !isAbandoned(existing)) return null;
  const state: PurgeState = {
    runId,
    total: await countRunProspects(runId),
    done: 0,
    deleted: 0,
    stranded: 0,
    errors: [],
    updatedAt: new Date().toISOString(),
    finishedAt: null,
  };
  await writeState(state);
  return state;
}

/** How often the progress state is flushed to Redis while a purge runs. */
const PROGRESS_EVERY = 10;

/**
 * Delete every prospect a run created, stopping their sequences first.
 *
 * Runs in the Worker: each contact costs up to two Smartlead calls against a
 * paced client, so a 400-contact run is a minute of work — well past what a
 * request should hold open, and exactly the kind of job that must survive the
 * operator closing the tab.
 */
export async function purgeRunProspects(runId: string): Promise<PurgeState> {
  const rows = await db
    .select({
      id: outreachProspectState.id,
      email: outreachProspectState.email,
      smartleadCampaignId: outreachProspectState.smartleadCampaignId,
      smartleadLeadId: outreachProspectState.smartleadLeadId,
    })
    .from(outreachProspectState)
    .where(eq(outreachProspectState.source, sourceOfRun(runId)));

  const state: PurgeState = (await readPurge(runId)) ?? {
    runId,
    total: rows.length,
    done: 0,
    deleted: 0,
    stranded: 0,
    errors: [],
    updatedAt: new Date().toISOString(),
    finishedAt: null,
  };
  // A resumed purge starts over on whatever is LEFT, so the totals describe this
  // pass rather than an earlier one that died halfway.
  state.total = rows.length;
  state.done = 0;
  state.deleted = 0;
  state.stranded = 0;
  state.errors = [];
  state.finishedAt = null;
  await writeState(state);

  const deletable: string[] = [];
  for (const row of rows) {
    const outcome = await withdrawFromCampaign(row);
    if (outcome.ok) {
      deletable.push(row.id);
    } else {
      state.stranded += 1;
      if (state.errors.length < MAX_ERRORS) {
        state.errors.push(`${row.email}: ${outcome.reason}`);
      }
    }
    state.done += 1;
    if (state.done % PROGRESS_EVERY === 0) await writeState(state);
  }

  // Deleted in chunks rather than one statement per row, and only after the
  // whole sweep: a row deleted early in a pass that then dies would be a person
  // removed from the campaign and forgotten in the same breath.
  for (let i = 0; i < deletable.length; i += 500) {
    const chunk = deletable.slice(i, i + 500);
    await db.delete(outreachProspectState).where(inArray(outreachProspectState.id, chunk));
    state.deleted += chunk.length;
  }

  state.finishedAt = new Date().toISOString();
  await writeState(state);
  console.log('[outreach] purged run prospects', {
    runId,
    deleted: state.deleted,
    stranded: state.stranded,
  });
  return state;
}
