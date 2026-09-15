import { and, asc, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db as defaultDb, type DB } from '../../../db/index.js';
import { outreachProspectState } from '../../../db/schema.js';
import type {
  OutreachClassification,
  OutreachFulfilmentStatus,
  OutreachListRun,
} from '../../../db/schema.js';
import { getRun } from './ledger.js';
import { loadSet, type Candidate } from './run.js';
import { sourceOfRun } from './prospects.js';

/**
 * Who is actually in a run.
 *
 * The run panel could always show a slice of a run's contacts, but only a slice
 * (200), only while the run sat at `review`, and only the six fields that fitted
 * on a line. Everything else we know about a business — its category, its
 * address, its phone, whether verification passed, which campaign it went to,
 * what it said back — was reachable only by leaving the screen, going to
 * Prospects and searching for it by name, one business at a time. For a 400-row
 * region that is not a path anybody takes.
 *
 * So this is the run's roster, paginated, with every column we hold on the row.
 *
 * ── WHY TWO SOURCES ────────────────────────────────────────────────────────
 * A run's contacts live in one of two places depending on whether it has sent,
 * and the difference is not incidental:
 *
 *  • **Before the push** they are the candidate set in Redis (run.ts). That set
 *    is the FULL one, rejects included, so it is the only place that can answer
 *    "who did verification throw out" — a question that stops existing the
 *    moment the run is done.
 *  • **After the push** they are `outreach_prospect_state` rows, and the set is
 *    dropped. Those rows are the durable record, and they carry everything the
 *    candidate set could not know yet: the Smartlead lead id, what was sent,
 *    what came back, how it was read, whether an account was created.
 *
 * Neither is a subset of the other, so this module reads whichever one the run
 * has and says which it used. The caller renders different cuts for each,
 * because "who will we email" and "who replied" are questions about different
 * halves of a run's life.
 *
 * ── WHY OFFSET PAGING ──────────────────────────────────────────────────────
 * The prospects list is keyset-paginated and says so loudly: it grows while you
 * page through it, and offset paging skips or repeats rows when that happens.
 * A run's roster is the opposite — it is fixed the moment the run finishes, and
 * nothing adds to it afterwards. Offset paging is therefore both safe and
 * better here, because the number that matters while sweeping 400 businesses is
 * "where am I", and a cursor cannot tell you that.
 *
 * The sort is the one the run itself uses — fewest reviews first, `byNeed` in
 * run.ts — so a row's position in this list IS its position in the send order.
 * A tiebreak on email is added on top, which `byNeed` does not need and this
 * does: without one, two businesses on the same review count could swap places
 * between two page fetches and one of them would never be seen.
 */

export type RunBusinessSource = 'candidates' | 'prospects';

/**
 * The cuts. Named for what happens to the business, not for the column:
 * `will_send` and `rejected` are about a run that hasn't gone yet, `replied` and
 * `yes` about one that has.
 */
export type RunBusinessCut = 'all' | 'will_send' | 'rejected' | 'replied' | 'yes';

export interface RunBusiness {
  /**
   * Stable for as long as the row is on screen. The prospect row id once
   * pushed; before that the place id or the email, because a candidate has no
   * id of its own — it is a JSON object in a Redis blob.
   */
  key: string;
  email: string;
  businessName: string | null;
  website: string | null;
  category: string | null;
  address: string | null;
  /** Null on anything pushed before migration 0109. */
  phone: string | null;
  placeId: string | null;
  reviewsCount: number | null;
  rating: number | null;
  /** The composed review-count opener, as stored — never recomputed. */
  hook: string | null;
  detail: string | null;
  /**
   * What the verifier said. Candidates only: everything that reached the
   * prospect table was `valid` at push time, so a null here on a pushed row
   * means "passed", not "unknown".
   */
  verdict: string | null;
  vertical: string | null;
  sendingDomain: string | null;
  campaignId: number | null;
  leadId: string | null;
  classification: OutreachClassification | null;
  manualClassification: OutreachClassification | null;
  classificationReasoning: string | null;
  classificationConfidence: number | null;
  fulfilmentStatus: OutreachFulfilmentStatus | null;
  fulfilmentEmail: string | null;
  lastSentAt: string | null;
  repliedAt: string | null;
  createdAt: string | null;
  /**
   * Is there a Smartlead thread worth fetching for this one? False for every
   * candidate — nothing has been sent yet — so the caller can offer the emails
   * only where emails can exist.
   */
  hasThread: boolean;
}

export interface RunBusinessPage {
  source: RunBusinessSource;
  /** The run's own status, so an empty page can say WHY it is empty. */
  runStatus: string;
  /** Everything in the run, before the search box and the cut. */
  total: number;
  /** What the search and the cut match — the number the pager counts against. */
  matched: number;
  offset: number;
  limit: number;
  items: RunBusiness[];
  /** Per-cut totals, so a cut that matches nothing can say so before it's picked. */
  tallies: { all: number; willSend: number; rejected: number; replied: number; yes: number };
  /**
   * The run is still at `review` but its candidate set has aged out of Redis.
   * The distinction the empty state needs: nothing was deleted, the list simply
   * cannot be rebuilt, and the run has to be re-run (for free — see
   * `isResumable`).
   */
  expired: boolean;
}

export interface RunBusinessQuery {
  runId: string;
  limit: number;
  offset: number;
  search?: string;
  cut: RunBusinessCut;
}

const emptyTallies = () => ({ all: 0, willSend: 0, rejected: 0, replied: 0, yes: 0 });

/**
 * Null means no such run.
 *
 * `database` is injectable with the singleton as its default — the convention
 * test/db.ts documents, and what lets the prospect-side SQL below be exercised
 * against a real Postgres rather than only read.
 */
export async function runBusinesses(
  input: RunBusinessQuery,
  database: DB = defaultDb,
): Promise<RunBusinessPage | null> {
  const row = await getRun(input.runId);
  if (!row) return null;

  // A done run's set is already dropped, and its prospect rows are strictly
  // better than the set was — so don't even ask Redis for it.
  const set = row.status === 'done' ? null : await loadSet(input.runId);
  return set ? pageCandidates(set, row.status, input) : pageProspects(database, row, input);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Before the push — the candidate set
 * ────────────────────────────────────────────────────────────────────────── */

/** Fewest reviews first, no reviews last, email breaking ties. See the header. */
function byNeedThenEmail(a: RunBusiness, b: RunBusiness): number {
  const av = a.reviewsCount ?? Number.POSITIVE_INFINITY;
  const bv = b.reviewsCount ?? Number.POSITIVE_INFINITY;
  if (av !== bv) return av - bv;
  return a.email.localeCompare(b.email);
}

function candidateRow(c: Candidate): RunBusiness {
  return {
    key: c.placeId ?? c.email,
    email: c.email,
    businessName: c.businessName,
    website: c.website,
    category: c.category,
    address: c.address,
    phone: c.phone,
    placeId: c.placeId,
    reviewsCount: c.reviewsCount,
    rating: c.rating,
    hook: c.hook,
    detail: c.detail,
    verdict: c.verdict,
    vertical: null,
    sendingDomain: null,
    campaignId: null,
    leadId: null,
    classification: null,
    manualClassification: null,
    classificationReasoning: null,
    classificationConfidence: null,
    fulfilmentStatus: null,
    fulfilmentEmail: null,
    lastSentAt: null,
    repliedAt: null,
    createdAt: null,
    hasThread: false,
  };
}

/** `valid` is the only verdict that gets emailed — see the filter in `tick`. */
const willSend = (c: Candidate) => c.verdict === 'valid';
/** Verified and turned down. A null verdict is "not verified yet", not a reject. */
const rejected = (c: Candidate) => c.verdict !== null && c.verdict !== 'valid';

/**
 * The candidate path, kept pure and exported so the paging contract can be
 * tested without a Redis or a Postgres: given the same set, page 2 must
 * continue exactly where page 1 stopped, with nothing repeated and nothing
 * skipped. That is the whole claim offset paging makes, and it is the one thing
 * here worth a test.
 */
export function pageCandidates(
  set: Candidate[],
  runStatus: string,
  input: RunBusinessQuery,
): RunBusinessPage {
  const tallies = {
    ...emptyTallies(),
    all: set.length,
    willSend: set.filter(willSend).length,
    rejected: set.filter(rejected).length,
  };

  let cut = set;
  if (input.cut === 'will_send') cut = cut.filter(willSend);
  else if (input.cut === 'rejected') cut = cut.filter(rejected);

  const q = input.search?.toLowerCase();
  if (q) {
    cut = cut.filter((c) =>
      [c.businessName, c.email, c.address, c.category, c.website].some((v) =>
        v?.toLowerCase().includes(q),
      ),
    );
  }

  const sorted = cut.map(candidateRow).sort(byNeedThenEmail);
  return {
    source: 'candidates',
    runStatus,
    total: set.length,
    matched: sorted.length,
    offset: input.offset,
    limit: input.limit,
    items: sorted.slice(input.offset, input.offset + input.limit),
    tallies,
    expired: false,
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * After the push — the prospect rows
 * ────────────────────────────────────────────────────────────────────────── */

/** The classification that stands: a correction wins over the model's call. */
const effectiveClassification = sql`coalesce(${outreachProspectState.manualClassification}, ${outreachProspectState.classification})`;

function prospectRow(p: typeof outreachProspectState.$inferSelect): RunBusiness {
  return {
    key: p.id,
    email: p.email,
    businessName: p.businessName,
    website: p.website,
    category: p.category,
    address: p.address,
    phone: p.phone,
    placeId: p.placeId,
    reviewsCount: p.reviewsCount,
    rating: p.rating === null ? null : Number(p.rating),
    hook: p.reviewHook,
    detail: p.personalisationDetail,
    verdict: null,
    vertical: p.vertical,
    sendingDomain: p.sendingDomain,
    campaignId: p.smartleadCampaignId,
    leadId: p.smartleadLeadId,
    classification: p.classification,
    manualClassification: p.manualClassification,
    classificationReasoning: p.classificationReasoning,
    classificationConfidence:
      p.classificationConfidence === null ? null : Number(p.classificationConfidence),
    fulfilmentStatus: p.fulfilmentStatus,
    fulfilmentEmail: p.fulfilmentEmail,
    lastSentAt: p.lastSentAt?.toISOString() ?? null,
    repliedAt: p.repliedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    // The lead id is resolved lazily on first read of a thread, so its absence
    // here says nothing about whether a conversation exists. The campaign does.
    hasThread: !!p.smartleadCampaignId,
  };
}

/**
 * The prospect path, with the connection passed in.
 *
 * Exported and db-injectable so businesses.integration.test.ts can drive this
 * exact function — the ordering (`asc nulls last` plus the email tiebreak), the
 * `filter (where …)` tallies and the `coalesce(manual, model)` precedence are
 * claims about SQL, and reading SQL is not the same as running it.
 */
export async function pageProspects(
  database: DB,
  row: Pick<OutreachListRun, 'id' | 'status'>,
  input: RunBusinessQuery,
): Promise<RunBusinessPage> {
  const mine = eq(outreachProspectState.source, sourceOfRun(row.id));

  // One aggregate for every chip, rather than a count query per chip.
  const [t] = await database
    .select({
      all: sql<number>`count(*)::int`,
      replied: sql<number>`count(*) filter (where ${outreachProspectState.repliedAt} is not null)::int`,
      yes: sql<number>`count(*) filter (where ${effectiveClassification} = 'yes')::int`,
    })
    .from(outreachProspectState)
    .where(mine);

  const tallies = {
    ...emptyTallies(),
    all: t?.all ?? 0,
    replied: t?.replied ?? 0,
    yes: t?.yes ?? 0,
  };

  const narrow: (SQL | undefined)[] = [
    mine,
    input.cut === 'replied' ? isNotNull(outreachProspectState.repliedAt) : undefined,
    input.cut === 'yes' ? sql`${effectiveClassification} = 'yes'` : undefined,
    input.search
      ? or(
          ilike(outreachProspectState.businessName, `%${input.search}%`),
          ilike(outreachProspectState.email, `%${input.search}%`),
          ilike(outreachProspectState.address, `%${input.search}%`),
          ilike(outreachProspectState.category, `%${input.search}%`),
          ilike(outreachProspectState.website, `%${input.search}%`),
        )
      : undefined,
  ];
  const where = and(...narrow.filter((c): c is SQL => !!c));

  const [m] = await database
    .select({ n: sql<number>`count(*)::int` })
    .from(outreachProspectState)
    .where(where);

  const rows = await database
    .select()
    .from(outreachProspectState)
    .where(where)
    // The send order, and the same tiebreak the in-memory comparator uses —
    // `nulls last` because a business with no review count sorted first would
    // put the least useful rows at the front of a list ordered by need.
    .orderBy(sql`${outreachProspectState.reviewsCount} asc nulls last`, asc(outreachProspectState.email))
    .limit(input.limit)
    .offset(input.offset);

  return {
    source: 'prospects',
    runStatus: row.status,
    total: tallies.all,
    matched: m?.n ?? 0,
    offset: input.offset,
    limit: input.limit,
    items: rows.map(prospectRow),
    tallies,
    /*
     * Nothing in Redis and nothing in the table, at a status where a candidate
     * set is supposed to EXIST: it aged out.
     *
     * Pinned to those two statuses rather than to `!== 'done'`, which was wrong
     * at both ends. A run still scraping has no set yet and never had one, so
     * "aged out of the cache" would be a made-up explanation for a run that is
     * simply not finished; and a `done` run with no rows had its prospects
     * purged, which is a different sentence again. Three empty states, three
     * causes, and only this one means the list cannot be rebuilt.
     */
    expired: tallies.all === 0 && (row.status === 'review' || row.status === 'pushing'),
  };
}
