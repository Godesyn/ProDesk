import { env } from '../../lib/env.js';
import { cached, cacheKeys, invalidate } from './cache.js';
import { renderEmailHtml, type EmailShellOptions } from './email-shell.js';
import { findUnknownTags } from './merge-tags.js';
import {
  addEmailAccountsToCampaign,
  createCampaign,
  getCampaign,
  getCampaignEmailAccounts,
  listCampaigns,
  listEmailAccounts,
  setCampaignSchedule,
  setCampaignSequences,
  setCampaignStatus,
  type CampaignSequenceStep,
} from './smartlead.js';

/**
 * Campaign orchestration.
 *
 * Two things live here rather than in the router: the one-campaign rule, and
 * the pause/resume dance that Smartlead forces on sequence edits.
 */

/** Normalise a name for comparison: lowercase, collapsed whitespace. */
export function normaliseVertical(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, ' ');
}

/* ──────────────────────────────────────────────────────────────────────────
 * The one campaign
 *
 * There is exactly one campaign per environment and its name comes from
 * OUTREACH_CAMPAIGN_NAME. Verticals used to be campaigns — the campaign name
 * WAS the vertical — which meant every new vertical started a campaign with no
 * sequence, no mailboxes and no schedule, and the operator had to remember to
 * build all three again. Sending is one thing; the vertical is a property of
 * the list, and it still travels with the prospect and the ledger row.
 *
 * The name is the identity rather than a stored id, because the id is
 * Smartlead's and nothing here owns a table to keep it in. It also survives the
 * campaign being looked at (or the environment being rebuilt) from the other
 * side: whatever is called this, in this Smartlead account, is our campaign.
 * ────────────────────────────────────────────────────────────────────────── */

/** Raised when OUTREACH_CAMPAIGN_NAME is unset — there is nothing to send with. */
export class CampaignNotConfiguredError extends Error {
  constructor() {
    super(
      'No outreach campaign is configured for this environment. ' +
        'Set OUTREACH_CAMPAIGN_NAME to the name this environment should send under.',
    );
    this.name = 'CampaignNotConfiguredError';
  }
}

/** The configured campaign name, or null when this environment has none. */
export function configuredCampaignName(): string | null {
  return env.OUTREACH_CAMPAIGN_NAME?.trim() || null;
}

export interface EnsuredCampaign {
  id: number;
  name: string;
  status: string;
  createdAt: string | null;
  /** True when this call is what brought the campaign into existence. */
  created: boolean;
}

/**
 * In-flight ensure, shared by every concurrent caller.
 *
 * The Sending Email page and a list run starting can both reach for the
 * campaign in the same second, and Smartlead will happily create two campaigns
 * with identical names — after which "the one campaign" is a coin flip. One
 * promise at a time makes the duplicate impossible within a process; across
 * processes the create is still a race, but a rare one, and the name match
 * settles it on the next read.
 */
let ensuring: Promise<EnsuredCampaign> | null = null;

/**
 * The environment's campaign, created if Smartlead doesn't have it yet.
 *
 * Called on every read of the Sending Email screen and before any list run
 * starts, so "create it if missing" needs no separate button and no setup step
 * anyone can forget.
 */
export function ensureCampaign(): Promise<EnsuredCampaign> {
  if (!ensuring) {
    ensuring = resolveCampaign().finally(() => {
      ensuring = null;
    });
  }
  return ensuring;
}

async function resolveCampaign(): Promise<EnsuredCampaign> {
  const name = configuredCampaignName();
  if (!name) throw new CampaignNotConfiguredError();

  const wanted = normaliseVertical(name);
  const existing = (await cached(cacheKeys.campaigns, listCampaigns)).find(
    (c) => normaliseVertical(c.name ?? '') === wanted,
  );
  if (existing) {
    return {
      id: existing.id,
      name: existing.name ?? name,
      status: (existing.status ?? 'DRAFTED').toUpperCase(),
      createdAt: existing.created_at ?? null,
      created: false,
    };
  }

  const created = await createCampaign(name);
  // A fresh campaign is DRAFTED and unusable until it has a schedule, so give
  // it the safe default now rather than leaving a half-built object behind.
  await setCampaignSchedule(created.id, {
    ...DEFAULT_SCHEDULE,
    days_of_the_week: [...DEFAULT_SCHEDULE.days_of_the_week],
  });
  await invalidate(cacheKeys.campaigns);
  return { id: created.id, name, status: 'DRAFTED', createdAt: null, created: true };
}

/**
 * Attach every mailbox on the floor to the campaign.
 *
 * There is one campaign, so "which mailboxes does it send from" has one honest
 * answer: all of them. The screen used to ask, and the question had exactly one
 * failure mode — a campaign attached to nothing, which starts, reports ACTIVE
 * and sends precisely nothing. Choosing per campaign only made sense when there
 * were campaigns to choose between; now the choice that matters is per MAILBOX,
 * on the Sending Floor, where stopping one sets its cap to zero.
 *
 * Add-only. It never detaches, because a mailbox that disappears from this list
 * has been removed from Smartlead entirely, and detaching mid-sequence would
 * orphan the threads it owns.
 *
 * Called on every visit to the Sending Email screen and before any list run
 * starts, so a mailbox connected this morning is sending by this afternoon
 * without anyone going back to tick a box.
 */
export async function attachAllMailboxes(campaignId: number): Promise<number[]> {
  const [all, attached] = await Promise.all([
    cached(cacheKeys.emailAccounts, listEmailAccounts),
    getCampaignEmailAccounts(campaignId),
  ]);
  const have = attached.map((a) => a.id);
  const missing = all.map((a) => a.id).filter((id) => !have.includes(id));
  if (missing.length === 0) return have;
  await addEmailAccountsToCampaign(campaignId, missing);
  await invalidate(cacheKeys.campaigns);
  return [...have, ...missing];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Templates
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Merge tags, their fallbacks and the checks over them now live in one
 * dependency-free module, because the sequence editor needs the same list and a
 * second copy of it in the client had already drifted on three tags. Re-exported
 * here so existing importers keep working.
 */
export {
  MERGE_TAGS,
  NUMERIC_TAGS,
  fallbackFor,
  findUnknownTags,
  findBlankableTags,
  resolveMergeValues,
  renderTemplate,
} from './merge-tags.js';
export type { MergeTag, MergeSource, MergeValues } from './merge-tags.js';

/**
 * The custom field the scraped personalisation detail is uploaded under, so
 * `{{detail}}` resolves. A lead with no detail gets the fallback written into
 * this field at upload time rather than an empty string — see
 * `resolveMergeValues`.
 */
export const DETAIL_FIELD = 'detail';

/**
 * The review-count opener, composed server-side at list-build time.
 *
 * It ships as ONE tag rather than three, because the sentence it forms is a
 * factual claim about a named local market — "the typical dentist in Inner West
 * is on 84" — and the only place that claim can be checked against the data
 * that produced it is where it is built. A template that assembled it from
 * {{reviews}} and a hardcoded benchmark would be a template that can go stale
 * and lie. The raw numbers are exposed too, but for colour, not for arithmetic.
 *
 * See docs/agents/outreach-apify.md §5.
 */
export const HOOK_FIELD = 'hook';
export const REVIEWS_FIELD = 'reviews';
export const RATING_FIELD = 'rating';

/* ──────────────────────────────────────────────────────────────────────────
 * Authored step → sent letter
 * ────────────────────────────────────────────────────────────────────────── */

/** A sequence step as the operator wrote it: plain body, no HTML. */
export interface AuthoredStep {
  /** null for a new step; Smartlead's id to update one. */
  id: number | null;
  seqNumber: number;
  subject: string;
  /** The small markup documented in `email-shell.ts`. */
  body: string;
  delayInDays: number;
}

/**
 * Turn what was typed into what Smartlead sends.
 *
 * Two things happen here, and both used to happen nowhere. The body is CHECKED
 * — an unknown `{{tag}}` is a typo that Smartlead would have substituted to
 * nothing and mailed to several hundred strangers, and there was no point
 * between the textarea and the API at which anybody looked. Then it is
 * RENDERED, because `email_body` is an HTML field and a plain body posted into
 * one arrives as a single run-on paragraph with every line break gone.
 *
 * Throws on the first step with an unknown tag, naming the step and the tag, so
 * the save fails loudly at the editor instead of quietly at the inbox.
 */
export function toSequenceSteps(
  steps: AuthoredStep[],
  shell: EmailShellOptions = {},
): CampaignSequenceStep[] {
  for (const s of steps) {
    const unknown = [...findUnknownTags(s.subject), ...findUnknownTags(s.body)];
    if (unknown.length > 0) {
      const where = s.seqNumber === 1 ? 'the first touch' : `follow-up ${s.seqNumber - 1}`;
      throw new Error(
        `${unknown.join(', ')} ${unknown.length === 1 ? 'is not a merge tag' : 'are not merge tags'} — ` +
          `check ${where} against the tag list. Smartlead would send it blank.`,
      );
    }
  }

  return steps.map((s) => ({
    id: s.id,
    seq_number: s.seqNumber,
    // A follow-up with no subject threads under the first email, which is what
    // we want — so an empty subject is omitted, not sent as "".
    ...(s.subject.trim() ? { subject: s.subject.trim() } : {}),
    email_body: renderEmailHtml(s.body, shell),
    seq_delay_details: { delay_in_days: s.delayInDays },
  }));
}

/* ──────────────────────────────────────────────────────────────────────────
 * Sequence saves
 * ────────────────────────────────────────────────────────────────────────── */

/** A campaign in this state refuses sequence edits. */
const ACTIVE = 'ACTIVE';

export interface SaveSequencesResult {
  /** True when the campaign was paused and resumed around the save. */
  pausedAndResumed: boolean;
  /**
   * Set when the save succeeded but resuming afterwards failed — the campaign is
   * left PAUSED and someone must restart it. Loud on purpose: a campaign that
   * silently stopped sending is worse than a failed edit.
   */
  resumeError: string | null;
}

/**
 * Save a sequence, pausing the campaign first if it is running.
 *
 * Verified: Smartlead rejects sequence edits while a campaign is ACTIVE. Rather
 * than surface that as a raw API error, we pause → save → resume as one action.
 *
 * The failure mode that matters is a successful save followed by a failed
 * resume, which leaves a live campaign paused. That is reported explicitly
 * instead of being swallowed, because nothing else would ever notice.
 */
export async function saveSequences(
  campaignId: number,
  sequences: CampaignSequenceStep[],
): Promise<SaveSequencesResult> {
  const campaign = await getCampaign(campaignId);
  const wasActive = (campaign?.status ?? '').toUpperCase() === ACTIVE;

  if (!wasActive) {
    await setCampaignSequences(campaignId, sequences);
    await invalidate(cacheKeys.campaigns);
    return { pausedAndResumed: false, resumeError: null };
  }

  await setCampaignStatus(campaignId, 'PAUSED');

  let saveError: unknown = null;
  try {
    await setCampaignSequences(campaignId, sequences);
  } catch (e) {
    saveError = e;
  }

  // Resume whether or not the save worked — leaving a working campaign paused
  // because an edit failed would silently cost a day of sending.
  let resumeError: string | null = null;
  try {
    await setCampaignStatus(campaignId, ACTIVE);
  } catch (e) {
    resumeError = (e as Error).message;
    console.error(
      '[outreach] failed to resume campaign after sequence save',
      campaignId,
      resumeError,
    );
  }
  await invalidate(cacheKeys.campaigns);

  // A failed save still surfaces, but only after the campaign is running again.
  if (saveError) throw saveError;
  return { pausedAndResumed: true, resumeError };
}

/**
 * Default cadence: first touch plus three follow-ups, spaced 4–7 days.
 *
 * Follow-ups carry no subject so Smartlead threads them under the original —
 * a reply lands in the same conversation rather than starting a new one.
 */
export function defaultSequence(): CampaignSequenceStep[] {
  return [
    { id: null, seq_number: 1, subject: '', email_body: '', seq_delay_details: { delay_in_days: 0 } },
    { id: null, seq_number: 2, email_body: '', seq_delay_details: { delay_in_days: 4 } },
    { id: null, seq_number: 3, email_body: '', seq_delay_details: { delay_in_days: 6 } },
    { id: null, seq_number: 4, email_body: '', seq_delay_details: { delay_in_days: 7 } },
  ];
}

/**
 * Mon–Fri, business hours, in the recipient's timezone.
 *
 * `max_new_leads_per_day` is the floor's daily capacity, not a throttle we want:
 * 20 mailboxes at the default cap of 20 is 400 sends a day, and holding new
 * leads back below that would leave paid-for capacity idle. The real limiter
 * stays where it belongs — the per-mailbox caps on the Sending Floor.
 */
export const DEFAULT_SCHEDULE = {
  timezone: 'Australia/Sydney',
  days_of_the_week: [1, 2, 3, 4, 5],
  start_hour: '09:00',
  end_hour: '17:00',
  min_time_btw_emails: 12,
  max_new_leads_per_day: 400,
} as const;
