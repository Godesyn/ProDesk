import { env } from '../../lib/env.js';

/**
 * Smartlead API client — the only place in the repo that talks to Smartlead.
 *
 * Smartlead is headless for us: after the API key is in place, every action
 * happens in our own admin. It is also the SYSTEM OF RECORD for mailboxes,
 * campaigns, sequences, schedules, message bodies and deliverability — none of
 * that is mirrored into our database, it is read live through here and cached
 * briefly in Redis (see cache.ts).
 *
 * Verified against the API on 2026-08-10; see docs/agents/outreach-api-findings.md
 * for the endpoint map and the two behaviours that still need a runtime check.
 *
 * Auth is a query parameter (`?api_key=`), not a header — Smartlead has no
 * bearer form. The key is password-equivalent, so it never leaves the server.
 */

const BASE_URL = 'https://server.smartlead.ai/api/v1';

/** Smartlead rejected the call. `message` is THEIR text, passed through unedited. */
export class SmartleadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = 'SmartleadError';
  }
}

/** Smartlead isn't configured — no API key. Surfaced to the UI as a setup prompt. */
export class SmartleadNotConfiguredError extends Error {
  constructor() {
    super('Smartlead is not connected. Add SMARTLEAD_API_KEY to the environment.');
    this.name = 'SmartleadNotConfiguredError';
  }
}

export function isSmartleadConfigured(): boolean {
  return !!env.SMARTLEAD_API_KEY;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Dev redirect
 *
 * OUTREACH_DEV_REDIRECT rewrites every recipient on its way out. It lives
 * HERE, at the wire, rather than at the two call sites that happen to send
 * today, because this file is the only place in the repo that talks to
 * Smartlead: anything that can put mail in a stranger's inbox has to come
 * through `request`, so a guard here cannot be bypassed by a future caller that
 * forgets it exists.
 *
 * One consequence worth knowing while testing: every lead in a push collapses
 * onto a single address, so a chunk of 400 prospects uploads as ONE lead.
 * That is the point — one real end-to-end thread rather than 400 copies of it.
 * The List Builder applies the same collapse to its own prospect rows before it
 * gets here (see list-builder/run.ts) so the two stay in step and the replies
 * webhook still finds a prospect to attach to.
 * ────────────────────────────────────────────────────────────────────────── */

export function isDevRedirectActive(): boolean {
  return !!env.OUTREACH_DEV_REDIRECT;
}

/**
 * The address this send should actually go to. Logs the substitution once per
 * call so the terminal says who was meant to receive it. Idempotent — an address
 * that has already been redirected passes through without a second line, which
 * is what lets the List Builder redirect early (so its prospect rows match) and
 * still hand the lead through this file.
 */
export function applyDevRedirect(intended: string, context: string): string {
  const to = env.OUTREACH_DEV_REDIRECT;
  if (!to) return intended;
  if (intended.trim().toLowerCase() === to.toLowerCase()) return to;
  console.log(
    `[outreach:dev-redirect] ${context}: email is to be sent to ${intended} ` +
      `but is being sent to ${to} (OUTREACH_DEV_REDIRECT)`,
  );
  return to;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Rate limiting
 *
 * Limits are per API KEY across all endpoints combined — Pro is 120/min,
 * 3,000/hour, burst 20/s. Smartlead's own guidance is to self-limit to 80% of
 * the ceiling, so we pace at 90 req/min (1.5/s) with a small burst.
 *
 * This limiter is per PROCESS, and the API server and Worker each run one. That
 * is acceptable because the two barely overlap: page views are served from the
 * Redis cache, and every bulk operation is queued to the Worker. If they ever do
 * contend, the 429 handling below is the real backstop — it reads Retry-After
 * rather than guessing.
 * ────────────────────────────────────────────────────────────────────────── */

const MIN_INTERVAL_MS = 1000 / 1.5;
const MAX_BURST = 5;

let tokens = MAX_BURST;
let lastRefill = Date.now();
let queue: Promise<void> = Promise.resolve();

async function takeToken(): Promise<void> {
  const now = Date.now();
  tokens = Math.min(MAX_BURST, tokens + (now - lastRefill) / MIN_INTERVAL_MS);
  lastRefill = now;
  if (tokens < 1) {
    const waitMs = Math.ceil((1 - tokens) * MIN_INTERVAL_MS);
    await new Promise((r) => setTimeout(r, waitMs));
    tokens = 1;
    lastRefill = Date.now();
  }
  tokens -= 1;
}

/** Serialise token acquisition so concurrent callers can't both see the same token. */
function pace(): Promise<void> {
  const next = queue.then(takeToken);
  // Keep the chain alive even if a waiter rejects.
  queue = next.catch(() => {});
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ──────────────────────────────────────────────────────────────────────────
 * Transport
 * ────────────────────────────────────────────────────────────────────────── */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Query parameters, excluding api_key (added here). Undefined values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Retries on 429 / 5xx. Bulk callers in the Worker can afford more. */
  retries?: number;
}

/**
 * Pull the human-readable message out of Smartlead's error body. We surface it
 * verbatim — the operator has no other place to check what went wrong, so our
 * error copy is the only error surface that exists.
 */
function extractMessage(payload: unknown, status: number): string {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (payload && typeof payload === 'object') {
    const o = payload as Record<string, unknown>;

    // `message` FIRST. Smartlead's validation errors are
    // {statusCode, error: "Bad Request", message: '"min_time_btw_emails" must
    // be larger than or equal to 3', validation: {keys: [...]}} — so reading
    // `error` first returns the HTTP status text and throws away the only
    // sentence that says what is actually wrong. That cost an hour once.
    for (const key of ['message', 'msg', 'detail']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }

    // Some endpoints send the detail as `error` instead — a bare string on the
    // campaign-status route, an object elsewhere.
    const err = o.error;
    if (typeof err === 'string' && err.trim()) return err.trim();
    if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }

    // The field name, when Joi gave us one and nothing above was readable.
    const keys = (o.validation as { keys?: unknown } | undefined)?.keys;
    if (Array.isArray(keys) && keys.length) return `Rejected: ${keys.join(', ')}.`;
  }
  return `Smartlead returned ${status}.`;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const apiKey = env.SMARTLEAD_API_KEY;
  if (!apiKey) throw new SmartleadNotConfiguredError();

  const { method = 'GET', query, body, retries = 2 } = options;

  const url = new URL(`${BASE_URL}${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  let attempt = 0;
  for (;;) {
    await pace();

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      // Network-level failure. Retry, then give up with something the operator
      // can act on rather than a raw fetch error.
      if (attempt < retries) {
        await sleep(backoffMs(attempt++));
        continue;
      }
      throw new SmartleadError(
        `Could not reach Smartlead: ${(e as Error).message}`,
        0,
        endpoint,
      );
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < retries) {
        // Retry-After is authoritative when present; otherwise back off with jitter.
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffMs(attempt);
        attempt += 1;
        await sleep(waitMs);
        continue;
      }
    }

    const text = await res.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!res.ok) {
      throw new SmartleadError(extractMessage(payload, res.status), res.status, endpoint);
    }
    return payload as T;
  }
}

/** Exponential backoff with jitter: ~1s, 2s, 4s, 8s. */
function backoffMs(attempt: number): number {
  const base = Math.min(8000, 1000 * 2 ** attempt);
  return base + Math.floor(Math.random() * 250);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Email accounts — the Sending Floor's data
 * ────────────────────────────────────────────────────────────────────────── */

export interface SmartleadWarmupDetails {
  status?: string | null;
  total_sent_count?: number | null;
  total_spam_count?: number | null;
  warmup_reputation?: number | string | null;
  reply_rate?: number | null;
  blocked_reason?: string | null;
}

export interface SmartleadEmailAccount {
  id: number;
  from_email: string;
  from_name: string | null;
  username?: string | null;
  type?: string | null;
  /** The daily cap. This is what "Stop sending" sets to 0. */
  message_per_day: number | null;
  /** Sent so far today — the numerator of the capacity meter. */
  daily_sent_count: number | null;
  /** Minimum spacing between sends, in minutes. */
  minTimeToWaitInMins?: number | null;
  smtp_host?: string | null;
  smtp_port?: number | null;
  is_smtp_success?: boolean | null;
  imap_host?: string | null;
  imap_port?: number | null;
  is_imap_success?: boolean | null;
  is_suspended?: boolean | null;
  campaign_count?: number | null;
  campaign_ids?: number[] | null;
  tags?: { id: number; name: string; color?: string | null }[] | null;
  warmup_details?: SmartleadWarmupDetails | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Every connected mailbox. Smartlead caps `limit` at 100 and we run 20, so this
 * pages defensively but will realistically make one call.
 */
export async function listEmailAccounts(): Promise<SmartleadEmailAccount[]> {
  const out: SmartleadEmailAccount[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const page = await request<SmartleadEmailAccount[]>('/email-accounts/', {
      query: { limit: pageSize, offset },
    });
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
    // Hard stop — we run 20 mailboxes; anything past 500 is a runaway.
    if (out.length >= 500) break;
  }
  return out;
}

export function getEmailAccount(accountId: number): Promise<SmartleadEmailAccount> {
  return request(`/email-accounts/${accountId}`);
}

export interface UpdateEmailAccountInput {
  from_name?: string;
  /** The daily cap, warmup included. Setting 0 is how a mailbox is stopped. */
  max_email_per_day?: number;
  /** Minimum minutes between sends from this mailbox. */
  time_to_wait_in_mins?: number;
  signature?: string;
  bcc?: string;
  custom_tracking_url?: string;
}

export function updateEmailAccount(
  accountId: number,
  input: UpdateEmailAccountInput,
): Promise<unknown> {
  return request(`/email-accounts/${accountId}`, { method: 'POST', body: input });
}

/**
 * The daily cap for one mailbox. `0` stops it.
 *
 * Verified live on 2026-08-10: Smartlead accepts `max_email_per_day: 0`, returns
 * ok, and the value persists on read-back. This is the mechanism behind "Stop
 * sending" — one field, immediate, reversible, and it leaves warmup running.
 */
export function setDailyCap(accountId: number, cap: number): Promise<unknown> {
  return updateEmailAccount(accountId, { max_email_per_day: cap });
}

/**
 * Purpose-built stop: halts campaign sending immediately, preserves the account's
 * data and its campaign associations, and is reversible.
 *
 * DEFENSIVE FALLBACK only. A zero cap is confirmed working, so this should never
 * fire — it exists in case Smartlead tightens that validation later. It differs
 * in one way the operator must be told about if it ever does fire: suspension
 * also pauses warmup, which a zero cap does not.
 */
export function suspendEmailAccount(accountId: number): Promise<unknown> {
  return request(`/email-accounts/suspend/${accountId}`, { method: 'PUT' });
}

export function unsuspendEmailAccount(accountId: number): Promise<unknown> {
  return request(`/email-accounts/unsuspend/${accountId}`, { method: 'PUT' });
}

export interface SmartleadWarmupStats {
  total_sent?: number | null;
  spam_count?: number | null;
  reputation_score?: number | null;
  daily_stats?: {
    date: string;
    sent?: number | null;
    spam?: number | null;
    delivered?: number | null;
    opened?: number | null;
    replied?: number | null;
  }[];
}

/** Rolling 7-day warmup detail for one mailbox. */
export function getWarmupStats(accountId: number): Promise<SmartleadWarmupStats> {
  return request(`/email-accounts/${accountId}/warmup-stats`);
}

export interface AddSmtpAccountInput {
  from_name: string;
  from_email: string;
  user_name: string;
  password: string;
  smtp_host: string;
  smtp_port: number;
  imap_host: string;
  imap_port: number;
  warmup_enabled: boolean;
  max_email_per_day?: number;
  time_to_wait_in_mins?: number;
  total_warmup_per_day?: number;
  daily_rampup?: number;
  imap_user_name?: string;
  imap_password?: string;
  type?: 'GMAIL' | 'OUTLOOK' | 'SMTP';
  signature?: string;
  different_reply_to_address?: string;
}

/**
 * Connect a mailbox by SMTP/IMAP credentials. Smartlead validates the connection
 * synchronously, so a bad app password fails here rather than silently later.
 */
export function addSmtpAccount(input: AddSmtpAccountInput): Promise<{ id?: number }> {
  return request('/email-accounts/save', { method: 'POST', body: input });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Analytics — the monitoring panel
 * ────────────────────────────────────────────────────────────────────────── */

export interface DomainHealthRow {
  domain?: string | null;
  sent?: number | null;
  opened?: number | null;
  replied?: number | null;
  bounced?: number | null;
}

/**
 * The analytics family wraps its payload — `{success, message, data: {...}}` —
 * unlike `/email-accounts` and `/campaigns`, which return bare arrays. Verified
 * live 2026-08-10. Unwrapping defensively (rather than trusting the shape) keeps
 * a wrapper change from throwing a TypeError deep inside a render path.
 */
function unwrap<T>(payload: unknown, key: string, fallback: T): T {
  if (Array.isArray(payload)) return payload as unknown as T;
  if (payload && typeof payload === 'object') {
    const data = (payload as Record<string, unknown>).data;
    if (Array.isArray(data)) return data as unknown as T;
    if (data && typeof data === 'object') {
      const inner = (data as Record<string, unknown>)[key];
      if (inner !== undefined && inner !== null) return inner as T;
    }
    const direct = (payload as Record<string, unknown>)[key];
    if (direct !== undefined && direct !== null) return direct as T;
  }
  return fallback;
}

/**
 * Sent / opened / replied / bounced per sending domain over an arbitrary window.
 *
 * Because the window is arbitrary, week-over-week trending works by querying two
 * windows and diffing — no snapshot table needed, which is better than the build
 * plan assumed. There is no per-domain DAILY series, only aggregates per window.
 */
export async function getDomainHealth(
  startDate: string,
  endDate: string,
): Promise<DomainHealthRow[]> {
  const res = await request<unknown>('/analytics/mailbox/domain-wise-health-metrics', {
    query: { start_date: startDate, end_date: endDate },
  });
  return unwrap<DomainHealthRow[]>(res, 'domain_health_metrics', []);
}

export interface DayWiseStat {
  date: string;
  dayName: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  unsubscribed: number;
}

/**
 * Account-wide engagement, one row per day.
 *
 * This is the only genuinely DAILY series Smartlead exposes — the domain-health
 * endpoint gives window aggregates only. So volume over time can be charted
 * honestly for the estate as a whole, but not per domain.
 */
export async function getDayWiseStats(
  startDate: string,
  endDate: string,
): Promise<DayWiseStat[]> {
  const res = await request<unknown>('/analytics/day-wise-overall-stats', {
    query: { start_date: startDate, end_date: endDate },
  });
  const rows = unwrap<Record<string, unknown>[]>(res, 'day_wise_stats', []);
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const m = (r.email_engagement_metrics ?? {}) as Record<string, number>;
    return {
      date: String(r.date ?? ''),
      dayName: String(r.day_name ?? ''),
      sent: Number(m.sent ?? 0),
      opened: Number(m.opened ?? 0),
      replied: Number(m.replied ?? 0),
      bounced: Number(m.bounced ?? 0),
      unsubscribed: Number(m.unsubscribed ?? 0),
    };
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Campaigns, leads, suppression, replies
 *
 * Declared here so the whole Smartlead surface lives in one file; the screens
 * that use them are built in later steps.
 * ────────────────────────────────────────────────────────────────────────── */

export interface SmartleadCampaign {
  id: number;
  name: string | null;
  status: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  max_leads_per_day?: number | null;
  min_time_btwn_emails?: number | null;
  /**
   * The saved schedule, read back under DIFFERENT names than it was written —
   * `days_of_the_week` goes in, `scheduler_cron_value.days` comes out, and
   * `max_new_leads_per_day` comes back as `max_leads_per_day`. Verified against
   * the live API; see `setCampaignSchedule`.
   */
  scheduler_cron_value?: {
    tz?: string | null;
    days?: number[] | null;
    startHour?: string | null;
    endHour?: string | null;
  } | null;
}

export function listCampaigns(): Promise<SmartleadCampaign[]> {
  return request('/campaigns/');
}

export function getCampaign(campaignId: number): Promise<SmartleadCampaign> {
  return request(`/campaigns/${campaignId}`);
}

export function createCampaign(name: string): Promise<{ id: number }> {
  return request('/campaigns/create', { method: 'POST', body: { name } });
}

/**
 * Start, pause or stop a campaign.
 *
 * Two corrections from the live API, either of which alone breaks every
 * start/pause in the product:
 *
 *  • The method is **POST**. `PATCH` 404s with "Cannot PATCH …" — Express's
 *    no-such-route page, not a Smartlead error, which is why it doesn't look
 *    like a contract problem at first glance.
 *  • The value to start is **START**, not ACTIVE. `{"status":"ACTIVE"}` is a
 *    400: "Allowed values are - START,STOPPED,PAUSED". ACTIVE is what the
 *    campaign READS BACK as once started, which is presumably how it got into
 *    our client in the first place.
 *
 * The caller's vocabulary stays ACTIVE/PAUSED/STOPPED — that is what the
 * campaign object reports and what the UI reasons about — and the translation
 * happens here, at the wire, where the asymmetry belongs.
 */
export function setCampaignStatus(
  campaignId: number,
  status: 'ACTIVE' | 'PAUSED' | 'STOPPED',
): Promise<unknown> {
  return request(`/campaigns/${campaignId}/status`, {
    method: 'POST',
    body: { status: status === 'ACTIVE' ? 'START' : status },
  });
}

export interface CampaignSchedule {
  /** IANA, e.g. "Australia/Sydney". */
  timezone: string;
  /** 0 = Sunday … 6 = Saturday. Mon–Fri is [1,2,3,4,5]. */
  days_of_the_week: number[];
  /** 24-hour, e.g. "09:00". */
  start_hour: string;
  end_hour: string;
  /** Minutes. Smartlead has no MAX-delay field — per-mailbox spacing is time_to_wait_in_mins. */
  min_time_btw_emails: number;
  /**
   * How many NEW leads this campaign may start per day. Required — the endpoint
   * rejects a schedule without it, so it is not optional here either.
   */
  max_new_leads_per_day: number;
}

/**
 * Save a campaign's schedule.
 *
 * The body is FLAT and every field is required — verified against the live API,
 * because the published reference is wrong on both counts. It documents a
 * `{ schedule: { … } }` wrapper with a `days` array and an optional
 * `min_time_btw_emails`, and that shape is rejected outright:
 *
 *   { schedule: { timezone, days, … } }        → 400 "timezone" is required
 *   { timezone, days, … }                      → 400 "days_of_the_week" is required
 *   { …, max_leads_per_day }                   → 400 "max_new_leads_per_day" is required
 *
 * Note the asymmetry: `max_new_leads_per_day` is written but reads back off the
 * campaign as `max_leads_per_day`, and the rest reads back under
 * `scheduler_cron_value`. Don't "tidy" these names to match each other.
 */
export function setCampaignSchedule(
  campaignId: number,
  schedule: CampaignSchedule,
): Promise<unknown> {
  return request(`/campaigns/${campaignId}/schedule`, { method: 'POST', body: schedule });
}

export interface CampaignSequenceStep {
  /** null for a new step; the existing id to update one. */
  id: number | null;
  seq_number: number;
  /** Omit on a follow-up and Smartlead threads it as "Re:". */
  subject?: string;
  email_body: string;
  seq_delay_details: { delay_in_days: number };
}

/**
 * Save a campaign's sequence.
 *
 * Smartlead REJECTS this while the campaign is ACTIVE — the caller must pause,
 * save, then resume. Don't let that surface as a raw API error.
 */
export function setCampaignSequences(
  campaignId: number,
  sequences: CampaignSequenceStep[],
): Promise<unknown> {
  return request(`/campaigns/${campaignId}/sequences`, { method: 'POST', body: { sequences } });
}

export interface SmartleadSequenceStep {
  id: number;
  seq_number: number;
  subject: string | null;
  email_body: string | null;
  /**
   * Both spellings, because the write and the read do not agree — same
   * asymmetry as the schedule above. Use `sequenceStepDelayDays` rather than
   * reaching in for one of them.
   */
  seq_delay_details?: { delay_in_days?: number | null; delayInDays?: number | null } | null;
}

/**
 * The wait before a step, whichever name Smartlead answered under.
 *
 * `setCampaignSequences` is only accepted with `delay_in_days`, but the read
 * comes back camelCased. Parsing only the written name yields `undefined`,
 * which reads as "no delay set" and lets a caller's default overwrite a real
 * saved value. Returns null when the step genuinely carries no delay.
 */
export function sequenceStepDelayDays(step: SmartleadSequenceStep): number | null {
  const d = step.seq_delay_details;
  return d?.delay_in_days ?? d?.delayInDays ?? null;
}

export function getCampaignSequences(campaignId: number): Promise<SmartleadSequenceStep[]> {
  return request(`/campaigns/${campaignId}/sequences`);
}

/** Which mailboxes a campaign sends from — this is what fixes its sending domain. */
export function getCampaignEmailAccounts(
  campaignId: number,
): Promise<{ id: number; from_email: string }[]> {
  return request(`/campaigns/${campaignId}/email-accounts`);
}

export function addEmailAccountsToCampaign(
  campaignId: number,
  emailAccountIds: number[],
): Promise<unknown> {
  return request(`/campaigns/${campaignId}/email-accounts`, {
    method: 'POST',
    body: { email_account_ids: emailAccountIds },
  });
}

/** Verified live: `DELETE` on the same path, same body — `{ok:true,result:1}`. */
export function removeEmailAccountsFromCampaign(
  campaignId: number,
  emailAccountIds: number[],
): Promise<unknown> {
  return request(`/campaigns/${campaignId}/email-accounts`, {
    method: 'DELETE',
    body: { email_account_ids: emailAccountIds },
  });
}

export interface SmartleadLeadInput {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone_number?: string;
  website?: string;
  location?: string;
  linkedin_profile?: string;
  company_url?: string;
  /** Where the scraped personalisation detail goes. Max 200 keys. */
  custom_fields?: Record<string, string>;
}

/** Smartlead's hard per-request ceiling — the Worker chunks uploads at this size. */
export const LEAD_UPLOAD_CHUNK = 400;

export interface AddLeadsResult {
  upload_count?: number;
  total_leads?: number;
  already_added_to_campaign?: number;
  duplicate_count?: number;
  invalid_emails?: string[];
  unsubscribed_leads?: string[];
  lead_ids?: (number | string)[];
}

/**
 * Push leads into a campaign. Max 400 per call.
 *
 * Every `ignore_*` setting stays false on purpose: they exist to bypass exactly
 * the block-list, unsubscribe and bounce protections the whole feature is built
 * around. `return_lead_ids` is on so each prospect row can store its Smartlead id.
 */
export function addLeadsToCampaign(
  campaignId: number,
  leads: SmartleadLeadInput[],
): Promise<AddLeadsResult> {
  if (leads.length > LEAD_UPLOAD_CHUNK) {
    throw new Error(
      `Smartlead accepts at most ${LEAD_UPLOAD_CHUNK} leads per call; chunk before calling.`,
    );
  }

  // Under the dev redirect the whole batch aims at one inbox, so it has to be
  // deduped before it goes: Smartlead treats the repeats as duplicates within
  // the campaign and the upload is rejected rather than partially accepted.
  // The first lead wins, keeping its personalisation intact so the template
  // still renders against real scraped data.
  let lead_list = leads;
  if (isDevRedirectActive()) {
    const seen = new Set<string>();
    lead_list = [];
    for (const lead of leads) {
      const email = applyDevRedirect(lead.email, `campaign ${campaignId} lead`);
      if (seen.has(email)) continue;
      seen.add(email);
      lead_list.push({ ...lead, email });
    }
    if (lead_list.length < leads.length) {
      console.log(
        `[outreach:dev-redirect] campaign ${campaignId}: ${leads.length} leads ` +
          `collapsed to ${lead_list.length} — they all redirect to the same inbox.`,
      );
    }
  }

  return request(`/campaigns/${campaignId}/leads`, {
    method: 'POST',
    body: {
      lead_list,
      settings: {
        ignore_global_block_list: false,
        ignore_unsubscribe_list: false,
        ignore_duplicate_leads_in_other_campaign: false,
        ignore_community_bounce_list: false,
        return_lead_ids: true,
      },
    },
  });
}

export interface SmartleadLead {
  id?: number | string;
  email?: string | null;
}

/**
 * Find a lead by address, across campaigns.
 *
 * The lead id is needed twice — to read a conversation, and to take someone out
 * of a campaign — and neither path can rely on having stored it: the upload
 * response returns ids as a bare array with no documented pairing to the leads
 * that were sent, so zipping them by position would risk attaching one
 * business's thread to another's row. Looking the id up by the address we
 * already know is slower and correct.
 */
export async function leadByEmail(email: string): Promise<SmartleadLead | null> {
  const payload = await request<SmartleadLead | { lead?: SmartleadLead } | null>('/leads/by-email', {
    query: { email },
  });
  if (!payload) return null;
  const lead = 'lead' in payload ? payload.lead : (payload as SmartleadLead);
  return lead?.id === undefined ? null : lead;
}

/**
 * Take one lead out of one campaign, stopping the rest of their sequence.
 *
 * NOT in docs/agents/outreach-api-findings.md — unlike every other endpoint in
 * this file, this one has not been exercised against the live API. Callers must
 * treat a throw as an expected outcome and report it rather than assume the
 * person has stopped receiving email.
 */
export function deleteLeadFromCampaign(
  campaignId: number,
  leadId: string | number,
): Promise<unknown> {
  return request(`/campaigns/${campaignId}/leads/${leadId}`, { method: 'DELETE' });
}

export interface SmartleadMessage {
  id?: number | string;
  type?: string | null;
  message_id?: string | null;
  stats_id?: string | null;
  email_body?: string | null;
  subject?: string | null;
  time?: string | null;
  sent_time?: string | null;
  open_count?: number | null;
  click_count?: number | null;
}

/** The full conversation with one lead, as Smartlead has it. */
export function getLeadMessageHistory(
  campaignId: number,
  leadId: string | number,
): Promise<{ history?: SmartleadMessage[] } | SmartleadMessage[]> {
  return request(`/campaigns/${campaignId}/leads/${leadId}/message-history`);
}

export interface ReplyToThreadInput {
  /** The only genuinely required identifier. */
  email_stats_id: string;
  email_body: string;
  reply_message_id?: string;
  reply_email_time?: string;
  cc?: string;
  bcc?: string;
  to_email?: string;
  add_signature?: boolean;
  /** ISO 8601. Lets an approved reply land in business hours without us scheduling it. */
  scheduled_time?: string;
}

export function replyToThread(campaignId: number, input: ReplyToThreadInput): Promise<unknown> {
  let body = input;
  if (isDevRedirectActive()) {
    // A reply normally goes wherever the thread already points, which means an
    // omitted `to_email` is the dangerous case, not the safe one — there is no
    // address here to rewrite and Smartlead would answer the real lead. So the
    // redirect is asserted rather than substituted: under redirect the
    // recipient is always stated explicitly.
    const to = applyDevRedirect(input.to_email ?? '(the thread’s lead)', `campaign ${campaignId} reply`);
    body = { ...input, to_email: to, cc: undefined, bcc: undefined };
  }
  return request(`/campaigns/${campaignId}/reply-email-thread`, { method: 'POST', body });
}

/**
 * Add to the GLOBAL block list. Despite the field name it accepts full email
 * addresses as well as bare domains.
 */
export function addToBlockList(values: string[]): Promise<unknown> {
  return request('/leads/add-domain-block-list', {
    method: 'POST',
    body: { domain_block_list: values },
  });
}

/* ──────────────────────────────────────────────────────────────────────────
 * Webhooks
 * ────────────────────────────────────────────────────────────────────────── */

export type SmartleadWebhookEvent =
  | 'EMAIL_SENT'
  | 'FIRST_EMAIL_SENT'
  | 'EMAIL_OPEN'
  | 'EMAIL_LINK_CLICK'
  | 'EMAIL_REPLY'
  | 'EMAIL_BOUNCE'
  | 'LEAD_UNSUBSCRIBED'
  | 'LEAD_CATEGORY_UPDATED'
  | 'CAMPAIGN_STATUS_CHANGED'
  | 'UNTRACKED_REPLIES'
  | 'MANUAL_STEP_REACHED'
  | 'EMAIL_ACCOUNT_DISCONNECTED'
  | 'LINKEDIN_DISCONNECTED';

/**
 * Register one USER-level webhook and it covers every campaign — no per-campaign
 * wiring. Smartlead does not sign its callbacks, so the URL itself carries an
 * unguessable secret and must be treated as a credential.
 */
export function createWebhook(input: {
  name: string;
  webhook_url: string;
  event_type_map: Partial<Record<SmartleadWebhookEvent, boolean>>;
}): Promise<unknown> {
  return request('/webhook/create', {
    method: 'POST',
    body: { ...input, association_type: 'user' },
  });
}

/**
 * Fetch one webhook by id.
 *
 * There is NO account-level list: `/webhook` 404s and `/webhook/{anything}`
 * validates the segment as a numeric id (verified live 2026-08-10). Webhooks are
 * otherwise only enumerable per campaign, via `/campaigns/{id}/webhooks`. Since
 * we register a single user-level webhook, record its id at registration time
 * rather than expecting to discover it later.
 */
export function getWebhook(webhookId: number): Promise<unknown> {
  return request(`/webhook/${webhookId}`);
}
