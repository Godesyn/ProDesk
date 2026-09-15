import { inArray, or } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { redis } from '../../../jobs/queues.js';
import { brands, outreachProspectState, type OutreachListRun } from '../../../db/schema.js';
import { completeOnce } from '../../ai/provider-config.js';
import { filterSuppressed } from '../suppression.js';
import { DETAIL_FIELD, HOOK_FIELD, RATING_FIELD, REVIEWS_FIELD } from '../campaigns.js';
import { resolveMergeValues } from '../merge-tags.js';
import {
  addLeadsToCampaign,
  applyDevRedirect,
  isDevRedirectActive,
  LEAD_UPLOAD_CHUNK,
  type SmartleadLeadInput,
} from '../smartlead.js';
import { cacheKeys, invalidate } from '../cache.js';
import { mapsProvider, verifier, type RawPlace, type VerifyResult } from './providers/index.js';
import {
  beginScrape,
  blockedBy,
  countsOf,
  getRun,
  patchRun,
  ScrapeClaimedError,
  type ListRunCounts,
  type ListRunStage,
} from './ledger.js';

/**
 * The List Builder pipeline.
 *
 * Runs in the Worker as a STATE MACHINE, one step per job invocation, rather
 * than as a single long-lived function. That shape is forced by the economics:
 * a Greater-Sydney-sized scrape legitimately takes tens of minutes, and a
 * function that sits inside that window holds a Worker the whole time and — the
 * part that actually matters — cannot survive a restart without risking a
 * second charge for the same scrape.
 *
 * So each call does the smallest amount of work that ends in a durable state,
 * and asks to be called again. `tick()` returns how long to wait.
 *
 * Stage order is not arbitrary. Verification runs BEFORE any enrichment, so we
 * never pay an LLM to enrich a dead address, and nothing is pushed unless the
 * five-minute hold at `review` passes without anyone stopping it.
 */

export interface Candidate {
  /** Google's stable identity, and the cross-run dedupe key. */
  placeId: string | null;
  email: string;
  businessName: string | null;
  website: string | null;
  category: string | null;
  phone: string | null;
  address: string | null;
  rating: number | null;
  reviewsCount: number | null;
  /** Null until verification has actually run on this row — the resume cursor. */
  verdict: VerifyResult | null;
  /** The free review-count opener. Null when the numbers don't support one. */
  hook: string | null;
  /** The optional Haiku homepage detail. Null is a first-class value. */
  detail: string | null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The working set
 *
 * Candidates live in Redis, not in the ledger row. Deliberately: the ledger is
 * the durable record of what we PAID for and what we DECIDED, and it must stay
 * small enough to update on every checkpoint. The candidate list is neither —
 * it is derived data, and every input to it is free to re-read. Losing it costs
 * one dataset re-read (not a billable event) and one re-verification pass
 * (fractions of a cent), which is a much better trade than rewriting a
 * half-megabyte jsonb column every 50 rows.
 * ────────────────────────────────────────────────────────────────────────── */

const setKey = (id: string) => `outreach:listrun:${id}:candidates`;
/** Long enough to survive a review pause over a long weekend. */
const SET_TTL_SECONDS = 10 * 24 * 3600;

async function saveSet(id: string, rows: Candidate[]): Promise<void> {
  await redis.set(setKey(id), JSON.stringify(rows), 'EX', SET_TTL_SECONDS);
}

export async function loadSet(id: string): Promise<Candidate[] | null> {
  const raw = await redis.get(setKey(id)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Candidate[];
  } catch {
    return null;
  }
}

async function dropSet(id: string): Promise<void> {
  await redis.del(setKey(id)).catch(() => undefined);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Politeness — only used by the OPTIONAL homepage crawl
 * ────────────────────────────────────────────────────────────────────────── */

const USER_AGENT =
  'ProDeskBot/1.0 (+https://prodesk.com/bot; business listing research; contact hello@prodesk.com)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ~1 request/second, tracked per hostname. */
const lastHit = new Map<string, number>();
async function politeDelay(host: string): Promise<void> {
  const last = lastHit.get(host) ?? 0;
  const wait = 1000 - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/**
 * Whether robots.txt permits us. On any doubt — unreachable file, parse failure
 * — we proceed, because an absent robots.txt is permission by convention; on an
 * explicit disallow we stop.
 */
async function robotsAllows(origin: string, path: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return true;
    const text = await res.text();

    // Only the wildcard group binds us; a rule aimed at Googlebot is not ours.
    let inWildcard = false;
    for (const line of text.split('\n')) {
      const [rawKey, ...rest] = line.split('#')[0].split(':');
      const key = rawKey.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') inWildcard = value === '*';
      else if (inWildcard && key === 'disallow' && value && path.startsWith(value)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * 1. Collect — drain the finished dataset
 * ────────────────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 1000;

/**
 * Free and repeatable. Paging an Apify dataset is not a billable event, which
 * is precisely why the pipeline re-reads rather than mirroring — "store the
 * dataset id, not a copy of the dataset".
 */
async function collect(datasetId: string, cap: number): Promise<RawPlace[]> {
  const provider = mapsProvider();
  const out: RawPlace[] = [];
  for (let offset = 0; out.length < cap; offset += PAGE_SIZE) {
    const page = await provider.fetchPage(datasetId, offset, PAGE_SIZE);
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────────
 * 2. Dedupe
 * ────────────────────────────────────────────────────────────────────────── */

function toCandidate(p: RawPlace): Candidate {
  return {
    placeId: p.placeId,
    email: p.email!.trim().toLowerCase(),
    businessName: p.name,
    website: p.website,
    category: p.category,
    phone: p.phone,
    address: p.address,
    rating: p.rating,
    reviewsCount: p.reviewsCount,
    verdict: null,
    hook: null,
    detail: null,
  };
}

/**
 * Collapse the scrape, then check it against everything we already know.
 *
 * Two identities, used for different jobs. `placeId` is the BUSINESS — stable
 * across an email change, which is why it's the cross-run key. `email` is the
 * RECIPIENT — the thing suppression and "have we already contacted them" are
 * actually about. A row has to clear both.
 *
 * Emailing an existing ProDesk customer as a cold prospect is worse than a
 * wasted send, so `brands.email` is checked too.
 */
async function dedupe(places: RawPlace[], counts: ListRunCounts, cap: number): Promise<Candidate[]> {
  const seenPlace = new Set<string>();
  const seenEmail = new Set<string>();
  const candidates: Candidate[] = [];

  // Assigned, never accumulated. This stage is re-entered whenever the working
  // set was lost, and a `+=` against counts already persisted on the ledger row
  // would report a run that dropped twice as many contacts as it did.
  counts.noEmail = 0;
  counts.duplicate = 0;
  counts.suppressed = 0;

  for (const p of places) {
    if (p.permanentlyClosed) continue;
    // §11: never guess at info@. No email means no contact, full stop.
    if (!p.email) {
      counts.noEmail += 1;
      continue;
    }
    const email = p.email.trim().toLowerCase();
    if (p.placeId && seenPlace.has(p.placeId)) continue;
    if (seenEmail.has(email)) continue;
    if (p.placeId) seenPlace.add(p.placeId);
    seenEmail.add(email);
    candidates.push(toCandidate(p));
  }

  if (candidates.length === 0) return [];

  const emails = candidates.map((c) => c.email);
  const placeIds = candidates.map((c) => c.placeId).filter((v): v is string => !!v);

  const [known, existingBrands, suppressed] = await Promise.all([
    db
      .select({
        email: outreachProspectState.email,
        placeId: outreachProspectState.placeId,
      })
      .from(outreachProspectState)
      .where(
        placeIds.length
          ? or(
              inArray(outreachProspectState.email, emails),
              inArray(outreachProspectState.placeId, placeIds),
            )
          : inArray(outreachProspectState.email, emails),
      ),
    db.select({ email: brands.email }).from(brands).where(inArray(brands.email, emails)),
    filterSuppressed(emails),
  ]);

  const knownEmails = new Set([
    ...known.map((k) => k.email),
    ...existingBrands.map((b) => (b.email ?? '').toLowerCase()).filter(Boolean),
  ]);
  const knownPlaces = new Set(known.map((k) => k.placeId).filter((v): v is string => !!v));

  const kept = candidates.filter((c) => {
    if (suppressed.has(c.email)) {
      counts.suppressed += 1;
      return false;
    }
    if (knownEmails.has(c.email) || (c.placeId && knownPlaces.has(c.placeId))) {
      counts.duplicate += 1;
      return false;
    }
    return true;
  });

  return kept.slice(0, cap);
}

/* ──────────────────────────────────────────────────────────────────────────
 * 3. Verify — the deliverability gate
 * ────────────────────────────────────────────────────────────────────────── */

/** Enough to get through ~1,300 addresses in minutes; low enough to be polite. */
const VERIFY_CONCURRENCY = 8;
const VERIFY_CHECKPOINT = 100;

/**
 * Runs before any enrichment, so we never pay to enrich a dead address, and a
 * missing key fails the run rather than letting unverified addresses through.
 *
 * Resumable by construction: `verdict` is null exactly on the rows that haven't
 * been checked, so a restart re-verifies only those. That matters less for cost
 * (MillionVerifier is ~$0.0008 an address) than for time — a run that dies at
 * 90% shouldn't spend another twenty minutes proving what it already knew.
 */
async function verify(runId: string, rows: Candidate[], counts: ListRunCounts): Promise<Candidate[]> {
  if (!verifier.configured) {
    throw new Error(
      'No email verifier is configured. Verification is mandatory before any address reaches Smartlead — add MILLIONVERIFIER_API_KEY.',
    );
  }

  const pending = rows.filter((c) => c.verdict === null);
  let sinceCheckpoint = 0;

  for (let i = 0; i < pending.length; i += VERIFY_CONCURRENCY) {
    const batch = pending.slice(i, i + VERIFY_CONCURRENCY);
    await Promise.all(
      batch.map(async (c) => {
        // A thrown request is not a verdict of "invalid" — see verifier.ts.
        c.verdict = await verifier.verify(c.email).catch(() => 'unknown' as VerifyResult);
      }),
    );
    sinceCheckpoint += batch.length;
    if (sinceCheckpoint >= VERIFY_CHECKPOINT) {
      await saveSet(runId, rows);
      sinceCheckpoint = 0;
    }
  }

  counts.unverified = rows.filter((c) => c.verdict === 'invalid').length;
  counts.unknown = rows.filter((c) => c.verdict === 'unknown').length;
  return rows.filter((c) => c.verdict === 'valid');
}

/* ──────────────────────────────────────────────────────────────────────────
 * 4. The hook
 * ────────────────────────────────────────────────────────────────────────── */

/** Below this many peers the median isn't a fact, it's an anecdote. */
const MIN_PEER_SET = 20;
/** How far below typical a business has to be for the comparison to land. */
const HOOK_RATIO = 0.6;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * The free personalisation hook.
 *
 * `reviewsCount` and `totalScore` arrive in the Apify base item at no extra
 * cost, and for a reviews product they are the whole pitch in two integers: a
 * business on 11 reviews when the typical dentist in their council area is on
 * 84 is a sharper, more credible and more RELEVANT opener than any named
 * service a homepage crawl produces.
 *
 * The benchmark is computed from THIS run's own scrape — the same search term,
 * the same region — so the comparison is true by construction rather than by
 * assertion. That matters: the sentence is a factual claim about a named
 * market, sent to someone who knows that market better than we do.
 *
 * A null hook is a normal outcome, not a failure. A business already at or
 * above typical has nothing to be shown, and inventing a comparison for them
 * would be both dishonest and unpersuasive.
 */
export function buildHooks(
  rows: Candidate[],
  allPlaces: Pick<RawPlace, 'reviewsCount'>[],
  region: string,
  vertical: string,
): number {
  // The peer set is every place the scrape saw with at least one review — not
  // just the ones that survived to become candidates. A business with no
  // website was still a competitor on the map.
  const peers = allPlaces
    .map((p) => p.reviewsCount)
    .filter((n): n is number => typeof n === 'number' && n > 0);

  if (peers.length < MIN_PEER_SET) return 0;
  const typical = median(peers);
  if (typical <= 0) return 0;

  // No plural-stripping. The vertical is the search term now, and search terms
  // are singular by construction — "dentist", "hair salon", "mechanic". The
  // `/s$/i` strip this used to do was a guess that got "real estate agencies"
  // wrong ("agencie") and mangled every compound label it was aimed at.
  const noun = vertical.toLowerCase();
  let hooked = 0;

  for (const c of rows) {
    const n = c.reviewsCount;
    if (n === null || n >= typical * HOOK_RATIO) continue;
    const stars = c.rating !== null ? ` at ${c.rating.toFixed(1)} stars` : '';
    c.hook =
      n === 0
        ? `you don't have any Google reviews yet, and the typical ${noun} in ${region} is on ${typical}`
        : `you're on ${n} Google review${n === 1 ? '' : 's'}${stars} — the typical ${noun} in ${region} is on ${typical}`;
    hooked += 1;
  }
  return hooked;
}

const PERSONALISE_SYSTEM = `You read a business's website copy and name ONE concrete thing they offer.

Return only that thing as a short noun phrase, 2-6 words, lowercase, no punctuation.
Good: "same-day denture repairs", "school holiday coding camps"
Bad: "great service", "quality workmanship", "a range of solutions"

If the text contains nothing concrete and specific, return exactly: NONE`;

/**
 * The OPTIONAL Haiku homepage crawl — off unless the run asks for it, and then
 * only over the rows the caller has already qualified (those with a hook).
 *
 * §5 demoted this from a pipeline stage to a seam. It costs ~$8–10/mo, a
 * rate-limited crawler, robots.txt exposure and a null-detail fallback in every
 * template, for a hook that is weaker than the review comparison we now get for
 * free. Build the review hook first, ship a campaign on it, and turn this on
 * only if reply rates say it's needed. The code stays because the seam does.
 *
 * A blocked site, a timeout, or nothing usable stores a NULL detail and KEEPS
 * the contact — templates carry a fallback for exactly this case, and dropping
 * otherwise-good contacts because their website was slow would quietly shrink
 * every list.
 */
async function personalise(rows: Candidate[]): Promise<number> {
  let enriched = 0;
  for (const c of rows) {
    // Already done. This stage sits inside the `running` branch, which is
    // re-entered whenever a tick dies between saving the working set and moving
    // the run to `review` — a redeploy is enough. Without this guard that
    // re-entry re-crawled every qualified homepage and paid for every LLM call
    // a second time, for details already sitting in the set it just loaded.
    if (c.detail) {
      enriched += 1;
      continue;
    }
    if (!c.website) continue;
    try {
      const url = new URL(c.website.startsWith('http') ? c.website : `https://${c.website}`);
      if (!(await robotsAllows(url.origin, url.pathname))) continue;

      await politeDelay(url.host);
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;

      const html = await res.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000);
      if (text.length < 200) continue;

      const detail = (
        await completeOnce({
          db,
          source: 'outreach_personalise',
          system: PERSONALISE_SYSTEM,
          prompt: text,
          maxTokens: 40,
          // Once per QUALIFIED contact — not per verified one — for a 2-6 word
          // noun phrase. Defaults to the cheapest model; changeable on the AI
          // Models screen.
        })
      )
        .trim()
        .replace(/^["']|["']$/g, '');

      if (detail && detail.toUpperCase() !== 'NONE' && detail.length <= 80) {
        c.detail = detail.toLowerCase();
        enriched += 1;
      }
    } catch {
      // Blocked, slow, or malformed — keep the contact, lose the detail.
    }
  }
  return enriched;
}

/* ──────────────────────────────────────────────────────────────────────────
 * 5. Push
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Fewest reviews first.
 *
 * `reviewsCount` is the best prospect score this pipeline will ever produce: a
 * business on 8 reviews needs a reviews product and a business on 900 does not.
 * Since a campaign's daily cap means the tail of a long list may not be reached
 * for weeks, the order the list is pushed in IS the prioritisation — so the
 * people most likely to say yes go first.
 *
 * Unknown review counts sort last: we know nothing about them, and "unknown" is
 * not evidence of need.
 */
function byNeed(a: Candidate, b: Candidate): number {
  const av = a.reviewsCount ?? Number.POSITIVE_INFINITY;
  const bv = b.reviewsCount ?? Number.POSITIVE_INFINITY;
  return av - bv;
}


async function push(row: OutreachListRun, rows: Candidate[], counts: ListRunCounts): Promise<void> {
  if (!row.campaignId) throw new Error('This run has no campaign to push into.');
  if (rows.length === 0) return;

  /*
   * Suppression, again, at the last possible moment.
   *
   * Not redundant with the dedupe stage. Time passes between the two — five
   * minutes on a run that pushes itself, days on one somebody skipped and came
   * back to — and in that window a bounce, an unsubscribe or an operator can
   * add any of these addresses to the list. The Reply Queue already re-checks
   * immediately before a single reply goes out; this is the same rule applied
   * to the path that emails several hundred strangers at once, which is the
   * one where getting it wrong costs a domain.
   */
  const blocked = await filterSuppressed(rows.map((c) => c.email));
  const allowed = blocked.size === 0 ? rows : rows.filter((c) => !blocked.has(c.email));
  if (blocked.size > 0) {
    // Taken out of the stored set too, not just out of this call. A push that
    // dies halfway is retried from the top, and `+=` against a count already on
    // the ledger row would report the same people dropped twice — the same trap
    // `counts.pushed` avoids by assigning from the position.
    const stored = (await loadSet(row.id)) ?? [];
    await saveSet(
      row.id,
      stored.filter((c) => !blocked.has(c.email)),
    );
    counts.suppressed += blocked.size;
    await patchRun(row.id, { counts });
    console.warn(
      `[outreach] run ${row.id}: ${blocked.size} contacts were suppressed after the review and will not be pushed.`,
    );
  }
  if (allowed.length === 0) return;

  let ordered = [...allowed].sort(byNeed);

  // Under OUTREACH_DEV_REDIRECT the batch is collapsed HERE, before the prospect
  // rows are written, not just at the Smartlead wire. The wire alone would leave
  // our table holding the real addresses while Smartlead holds the redirect one,
  // and every webhook that came back would fail to match a prospect — which
  // takes the reply queue, the whole point of a dev run, out of the test. One
  // business, carried through with its real name and personalisation, is what
  // makes the round trip observable.
  const first = ordered[0];
  if (isDevRedirectActive() && first) {
    console.log(
      `[outreach:dev-redirect] run ${row.id}: ${ordered.length} candidates collapsed to 1 ` +
        `(${first.businessName ?? first.email}) — they would all redirect to the same inbox.`,
    );
    ordered = [{ ...first, email: applyDevRedirect(first.email, `run ${row.id} lead`) }];
  }

  // Our record first, Smartlead second — the same ordering as suppression, and
  // for the same reason: a row we know about is one we can reconcile.
  //
  // Bare onConflictDoNothing rather than a targeted one: there are now TWO
  // unique keys (email and place_id), and a business that changed its email
  // must collide on place_id rather than slip through as a new prospect.
  await db
    .insert(outreachProspectState)
    .values(
      ordered.map((c) => ({
        email: c.email,
        placeId: c.placeId,
        businessName: c.businessName,
        website: c.website,
        // Stored from 0106 so the template preview can render `{{location}}`
        // against the same value the lead is uploaded with.
        address: c.address,
        // Kept from 0109 for the same reason as the address above: it goes to
        // Smartlead as `phone_number` either way, and dropping it here made the
        // number unreadable anywhere but inside Smartlead's own lead view.
        phone: c.phone,
        category: c.category,
        reviewsCount: c.reviewsCount,
        rating: c.rating === null ? null : String(c.rating),
        reviewHook: c.hook,
        vertical: row.vertical,
        personalisationDetail: c.detail,
        source: `list-build:${row.id}`,
        sendingDomain: row.sendingDomain,
        smartleadCampaignId: row.campaignId,
      })),
    )
    .onConflictDoNothing();

  const campaignId = row.campaignId;
  for (let i = 0; i < ordered.length; i += LEAD_UPLOAD_CHUNK) {
    const chunk = ordered.slice(i, i + LEAD_UPLOAD_CHUNK);
    const leads: SmartleadLeadInput[] = chunk.map((c) => {
      // EVERY tag is resolved here, through the same function the editor
      // previews with. Fallbacks are written at UPLOAD time so a template
      // degrades gracefully by construction rather than by discipline: there is
      // no way to forget one, and no way for a stranger to receive a sentence
      // with a hole in it. It used to cover {{hook}} and {{detail}} only, which
      // left `Hi {{first_name}},` going out as `Hi ,` on every single lead.
      //
      // The fallbacks go into Smartlead's NATIVE fields, not alongside them,
      // because those are the fields Smartlead substitutes from — so a lead with
      // no site reads "your website" in Smartlead's own lead view. That is the
      // honest rendering of what we know; `outreach_prospect_state` above keeps
      // the true nulls, and it is the table anything analytical should read.
      const v = resolveMergeValues(c);
      return {
        email: c.email,
        first_name: v.first_name,
        company_name: v.company_name,
        website: v.website,
        phone_number: c.phone ?? undefined,
        location: v.location,
        custom_fields: {
          [DETAIL_FIELD]: v.detail,
          [HOOK_FIELD]: v.hook,
          [REVIEWS_FIELD]: v.reviews,
          [RATING_FIELD]: v.rating,
        },
      };
    });
    await addLeadsToCampaign(campaignId, leads);
    // Assigned from the position, not accumulated: a push that dies halfway and
    // is retried restarts from the top, and `+=` would then report more
    // contacts pushed than exist. Re-uploading a chunk is harmless — the
    // prospect insert is conflict-safe and Smartlead dedupes within a campaign.
    counts.pushed = i + chunk.length;
    await patchRun(row.id, { counts });
  }
  await invalidate(cacheKeys.campaigns);
}

/* ──────────────────────────────────────────────────────────────────────────
 * The driver
 * ────────────────────────────────────────────────────────────────────────── */

export interface TickResult {
  status: OutreachListRun['status'];
  stage: ListRunStage;
  /** Milliseconds until this run wants to be ticked again. Null = it doesn't. */
  requeueMs: number | null;
  counts: ListRunCounts;
}

/** How often to ask Apify whether a scrape has finished. */
const POLL_MS = 20_000;
/** A scrape that has run this long is stuck, not slow. */
const SCRAPE_DEADLINE_MS = 90 * 60_000;

/**
 * How long a finished run sits at `review` before pushing itself.
 *
 * Five minutes is chosen to be long enough to read the list and press Hold, and
 * short enough that nobody has to babysit a run to get it out the door. It is
 * the whole difference between a gate and a hold: the gate blocked on a decision
 * that was always yes, and its real effect was runs sitting reviewed-but-unsent
 * because the person who started them had moved on.
 */
export const REVIEW_HOLD_MS = 5 * 60_000;

/**
 * How often a run that is ready but not at the front of the queue looks again.
 *
 * It is waiting on another run to finish, which is an event nothing notifies it
 * about, so it asks. Twenty seconds is short enough that the queue visibly
 * moves when the run ahead lands and long enough that a queue of ten costs
 * nothing to hold.
 */
const QUEUE_POLL_MS = 20_000;

export type HoldDecision =
  /** No deadline: an operator pressed Hold, or the row predates the column. */
  | { kind: 'held' }
  /** Nowhere to push. Held, and the reason is worth saying out loud. */
  | { kind: 'no-campaign' }
  | { kind: 'waiting'; remainingMs: number }
  | { kind: 'due' };

/**
 * Should this run push itself yet?
 *
 * Pulled out of `tick` and kept pure because of what the `due` branch does:
 * everything downstream of it is email to strangers, and a decision that reads
 * a clock and a nullable column is exactly the kind that is easy to get subtly
 * backwards and impossible to notice afterwards.
 */
export function holdDecision(
  row: Pick<OutreachListRun, 'autoPushAt' | 'campaignId'>,
  now = Date.now(),
): HoldDecision {
  if (!row.autoPushAt) return { kind: 'held' };
  if (!row.campaignId) return { kind: 'no-campaign' };
  const remainingMs = row.autoPushAt.getTime() - now;
  return remainingMs > 0 ? { kind: 'waiting', remainingMs } : { kind: 'due' };
}

/**
 * Advance a run by one step.
 *
 * Every branch ends in a durable state, so it is always safe to stop here and
 * be called again later — including after a process restart. The `review` stop
 * is the human gate: §11 puts a person between a scrape and 400 strangers
 * getting email, and confirming re-enqueues the run into `pushing`.
 */
export async function tick(runId: string): Promise<TickResult> {
  const row = await getRun(runId);
  if (!row) throw new Error(`List run ${runId} no longer exists.`);
  const counts = countsOf(row);

  const fail = async (message: string): Promise<TickResult> => {
    await patchRun(row.id, {
      status: 'failed',
      stage: 'failed',
      error: message,
      finishedAt: new Date(),
      counts,
    });
    console.error('[outreach] list build failed', { runId, message });
    return { status: 'failed', stage: 'failed', requeueMs: null, counts };
  };

  try {
    /* ── starting → running. The only step that spends money. ───────────── */
    if (row.status === 'starting') {
      let started: OutreachListRun;
      try {
        started = await beginScrape(row);
      } catch (e) {
        // Losing the start claim is not a failure — another worker holds it and
        // is spending the money exactly once. Come back and watch, rather than
        // marking a run failed for a race it was never in.
        if (e instanceof ScrapeClaimedError) {
          return { status: 'starting', stage: 'starting', requeueMs: POLL_MS, counts };
        }
        throw e;
      }
      return {
        status: started.status,
        stage: 'scraping',
        requeueMs: POLL_MS,
        counts,
      };
    }

    /* ── running: wait on the scraper, then run everything that's free. ─── */
    if (row.status === 'running') {
      if (!row.runId || !row.datasetId) {
        return fail('This run reached `running` without a scraper run id, which should be impossible.');
      }

      const provider = mapsProvider();
      const poll = await provider.pollRun(row.runId);

      // Recorded on every poll, not just at the end, so an aborted run still
      // says what it cost. This figure is what will eventually replace the
      // $3.00/1k estimate the whole cost model currently rests on.
      if (poll.costUsd !== null) await patchRun(row.id, { costActualUsd: poll.costUsd });

      if (poll.status === 'failed') {
        return fail(`The scraper run ended as ${poll.detail ?? 'failed'}.`);
      }
      if (poll.status === 'running') {
        const age = Date.now() - (row.startedAt ?? row.createdAt).getTime();
        if (age > SCRAPE_DEADLINE_MS) {
          return fail(
            'The scraper run has been going for over 90 minutes. It is still billing — abort it in the provider console.',
          );
        }
        return { status: 'running', stage: 'scraping', requeueMs: POLL_MS, counts };
      }

      /* Everything below here is free to repeat. */

      await patchRun(row.id, { stage: 'collecting' });
      const places = await collect(poll.datasetId ?? row.datasetId, row.maxRecords);
      counts.found = places.length;

      await patchRun(row.id, { stage: 'deduping', counts });
      // Resume mid-verification if a previous tick got that far; otherwise
      // re-derive from the dataset, which costs nothing.
      const cached = await loadSet(row.id);
      const candidates =
        cached && cached.length ? cached : await dedupe(places, counts, row.maxRecords);
      await saveSet(row.id, candidates);

      await patchRun(row.id, { stage: 'verifying', counts });
      // `valid` shares element references with `candidates`, so enriching it
      // enriches the stored set too.
      const valid = await verify(row.id, candidates, counts);

      await patchRun(row.id, { stage: 'hooking', counts });
      // The LABEL, never the key. The key is lowercased so the uniqueness index
      // can't be fooled by capitalisation; this string ends up mid-sentence in
      // an email to a stranger — "the typical dentist in inner west" reads as
      // careless in exactly the place we're asking them to trust the number.
      counts.hooked = buildHooks(valid, places, row.regionLabel ?? row.regionKey, row.vertical);
      // Only the qualified get crawled. A business already at or above typical
      // for its area has no hook, is being emailed a generic opener, and is the
      // least likely of the list to buy a reviews product — paying for a
      // homepage fetch and an LLM call on them is the worst money in the run.
      // Filtering preserves object references, so the enrichment still lands on
      // the stored set.
      if (row.personalise) counts.enriched = await personalise(valid.filter((c) => c.hook !== null));

      // The FULL set is stored, rejects included. Storing only the survivors
      // would make the reject counts unrecoverable if this tick died before the
      // status moved, and a re-tick would then report a clean run that wasn't.
      await saveSet(row.id, candidates);
      // The hold starts here, and it is a DEADLINE rather than a pause: the run
      // is asking to be called back when it expires, so the push happens whether
      // or not anyone is looking at the screen.
      await patchRun(row.id, {
        status: 'review',
        stage: 'review',
        counts,
        autoPushAt: new Date(Date.now() + REVIEW_HOLD_MS),
      });
      return { status: 'review', stage: 'review', requeueMs: REVIEW_HOLD_MS, counts };
    }

    /* ── review: the hold. Pushes itself unless someone stops it. ────────── */
    if (row.status === 'review') {
      const decision = holdDecision(row);
      const parked = { status: 'review', stage: 'review', requeueMs: null, counts } as const;

      if (decision.kind === 'held') return parked;
      if (decision.kind === 'no-campaign') {
        // Holding indefinitely is the only honest response: failing would
        // suggest the scrape was wasted, and it wasn't — the contacts are still
        // in the working set, waiting on a campaign.
        await patchRun(row.id, {
          autoPushAt: null,
          error: 'This run has no campaign to push into, so the auto-push is on hold.',
        });
        return parked;
      }
      if (decision.kind === 'waiting') {
        return { status: 'review', stage: 'review', requeueMs: decision.remainingMs, counts };
      }

      // Due — but the queue decides the ORDER, not the countdown. Every run
      // lands in the same campaign, so whichever region reaches this line first
      // would otherwise be the region emailed first, which is exactly the
      // accident `queue_position` exists to replace. Anything ahead that hasn't
      // sent holds this one, including a run still scraping; skipping the
      // blocker is how the operator overrules that.
      //
      // Checked HERE rather than in `holdDecision` because it is a database
      // question, and because it has to be true at the moment it is acted on:
      // the run ahead may have landed a second ago.
      const ahead = await blockedBy(row);
      if (ahead) {
        return { status: 'review', stage: 'review', requeueMs: QUEUE_POLL_MS, counts };
      }

      // Clear to go. Moving to `pushing` here and returning rather than pushing
      // inline keeps every tick ending in one durable state — the push itself
      // is the branch below, reached on the immediate re-tick.
      await patchRun(row.id, { status: 'pushing', stage: 'pushing', autoPushAt: null });
      return { status: 'pushing', stage: 'pushing', requeueMs: 0, counts };
    }

    /* ── pushing: the human said yes. ────────────────────────────────────── */
    if (row.status === 'pushing') {
      // The stored set is the FULL one, rejects included, so the reject counts
      // survive a restart. Only the verified survivors may be pushed — this
      // filter is the last thing standing between a `catch_all` address and a
      // burned sending domain.
      const stored = (await loadSet(row.id)) ?? [];
      const rows = stored.filter((c) => c.verdict === 'valid');
      if (rows.length === 0) {
        return fail(
          stored.length === 0
            ? 'The reviewed contact list has expired from the cache. Re-run this region — the scrape itself is still on file and the dataset can be re-read for free.'
            : 'Nothing in this run survived verification, so there is nothing to push.',
        );
      }
      await push(row, rows, counts);
      await patchRun(row.id, {
        status: 'done',
        stage: 'done',
        counts,
        finishedAt: new Date(),
      });
      await dropSet(row.id);
      return { status: 'done', stage: 'done', requeueMs: null, counts };
    }

    return { status: row.status, stage: row.stage as ListRunStage, requeueMs: null, counts };
  } catch (e) {
    return fail((e as Error).message);
  }
}
