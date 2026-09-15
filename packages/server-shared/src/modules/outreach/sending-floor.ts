import { redis } from '../../jobs/queues.js';
import { cached, cacheKeys } from './cache.js';
import {
  getDomainHealth,
  isSmartleadConfigured,
  listEmailAccounts,
  type DomainHealthRow,
  type SmartleadEmailAccount,
} from './smartlead.js';

/**
 * The Sending Floor's read model.
 *
 * Domain reputation is the unit of risk, so the domain — not the mailbox — is the
 * primary object here. Everything is derived live from Smartlead; nothing on this
 * screen is mirrored into our database.
 */

/* ──────────────────────────────────────────────────────────────────────────
 * Domain configuration
 *
 * Which voice a domain speaks in. This drives reply routing, so it is recorded
 * against the prospect at send time rather than re-derived later.
 * ────────────────────────────────────────────────────────────────────────── */

export type SendingBrand = 'prodesk' | 'noize' | 'unknown';

const DOMAIN_BRANDS: Record<string, SendingBrand> = {
  // Free-listing first-touch campaigns.
  'useprodesk.com': 'prodesk',
  'tryprodesk.com': 'prodesk',
  // Anything further down the ladder that speaks as the agency.
  'usenoize.com': 'noize',
  'trynoize.com': 'noize',
};

export const SENDING_DOMAINS = Object.keys(DOMAIN_BRANDS);

export function brandForDomain(domain: string): SendingBrand {
  return DOMAIN_BRANDS[domain.toLowerCase()] ?? 'unknown';
}

function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/* ──────────────────────────────────────────────────────────────────────────
 * Shapes
 * ────────────────────────────────────────────────────────────────────────── */

export interface FloorMailbox {
  id: number;
  email: string;
  name: string | null;
  domain: string;
  brand: SendingBrand;
  /** Today's cap. 0 means stopped. */
  cap: number;
  sentToday: number;
  remaining: number;
  /** Stopped by either mechanism — a zeroed cap, or a Smartlead suspension. */
  stopped: boolean;
  /** True only when Smartlead's own suspend flag is set, which also pauses warmup. */
  suspended: boolean;
  /** Minimum minutes between sends from this mailbox. */
  minWaitMins: number | null;
  warmup: {
    status: string | null;
    /** 0–100. Null when warmup has produced no data yet. */
    reputation: number | null;
    sent: number;
    spam: number;
    /** Warmup spam as a share of warmup sends, 0–1. Null when nothing has sent. */
    spamRate: number | null;
    replyRate: number | null;
    blockedReason: string | null;
  };
  /** A mailbox Smartlead can't reach sends nothing — silently lost throughput. */
  connected: boolean;
  campaignCount: number;
  /**
   * Last observed send, from the EMAIL_SENT webhook. Null until the webhook
   * endpoint is live (step 5) or if the mailbox hasn't sent since.
   */
  lastSentAt: string | null;
}

export interface FloorDomain {
  domain: string;
  brand: SendingBrand;
  mailboxes: FloorMailbox[];
  /** Mailboxes not stopped — the ones actually carrying load. */
  activeCount: number;
  sentToday: number;
  /** Today's ceiling: the summed caps of every mailbox on the domain. */
  ceiling: number;
  /** 0–1. The domain block's headline figure. */
  utilisation: number;
  /** Mean warmup reputation across the domain's mailboxes. Null when unknown. */
  warmupReputation: number | null;
  /** Warmup spam share across the domain, 0–1. Null when nothing has sent. */
  spamRate: number | null;
  /** Any mailbox Smartlead can't currently reach. */
  disconnectedCount: number;
  /** Campaign deliverability over the trailing window; null when unreported. */
  health: DomainHealth | null;
}

export interface DomainHealth {
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  /** Delivered share, 0–1. The number that decides whether a domain is in trouble. */
  deliverability: number | null;
  bounceRate: number | null;
  replyRate: number | null;
  /**
   * Change in deliverability against the preceding window of equal length, in
   * percentage points. Negative means the domain is sliding.
   */
  deliverabilityTrend: number | null;
}

export interface SendingFloor {
  /** False when SMARTLEAD_API_KEY is unset — the UI shows a setup prompt, not an error. */
  configured: boolean;
  domains: FloorDomain[];
  totals: {
    mailboxes: number;
    activeMailboxes: number;
    sentToday: number;
    ceiling: number;
    utilisation: number;
  };
  /** The window `health` was measured over, so the UI can say so out loud. */
  healthWindow: { start: string; end: string } | null;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Last-send tracking
 *
 * Smartlead's email-accounts payload has no "last sent" field, so it is recorded
 * from the EMAIL_SENT webhook into a Redis hash. Redis is the right home: it is
 * a live-view detail, worthless if lost, and not worth a table.
 * ────────────────────────────────────────────────────────────────────────── */

const LAST_SENT_KEY = 'outreach:last-sent';

export async function recordLastSent(fromEmail: string, at: Date): Promise<void> {
  try {
    await redis.hset(LAST_SENT_KEY, fromEmail.toLowerCase(), at.toISOString());
  } catch (e) {
    console.error('[outreach] recordLastSent failed', (e as Error).message);
  }
}

async function readLastSent(): Promise<Record<string, string>> {
  try {
    return await redis.hgetall(LAST_SENT_KEY);
  } catch (e) {
    console.error('[outreach] readLastSent failed', (e as Error).message);
    return {};
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Assembly
 * ────────────────────────────────────────────────────────────────────────── */

/** YYYY-MM-DD in UTC — the format Smartlead's analytics endpoints expect. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * A number Smartlead may have written as a percentage string.
 *
 * `warmup_reputation` comes back as `"0%"` — a string, with the sign attached.
 * Verified against the live account; see outreach-api-findings.md §"Warmup is
 * the blocking problem". `Number("98%")` is NaN, so a plain parse turned every
 * real reputation into null, and null is what the health strip renders as "No
 * warmup data yet". The failure was invisible while nothing was warming, because
 * "no data" was the truth; the moment warmup produced numbers, the floor went on
 * insisting there weren't any.
 *
 * The sign is stripped rather than the value being divided: Smartlead's scale is
 * already 0–100, which is what `REPUTATION_OK` and the domain average compare
 * against.
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const raw = v.trim().replace(/%$/, '').trim();
  // `Number('')` is 0, not NaN. Without this an empty reputation would read as
  // a reputation of ZERO — which is not "unknown", it is the worst possible
  // score, and it renders as a red mailbox nobody should be trusting.
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function toMailbox(a: SmartleadEmailAccount, lastSent: Record<string, string>): FloorMailbox {
  const email = a.from_email ?? '';
  const domain = domainOf(email);
  const cap = a.message_per_day ?? 0;
  const sentToday = a.daily_sent_count ?? 0;
  const suspended = a.is_suspended === true;
  const w = a.warmup_details ?? {};
  const warmupSent = w.total_sent_count ?? 0;
  const warmupSpam = w.total_spam_count ?? 0;

  return {
    id: a.id,
    email,
    name: a.from_name ?? null,
    domain,
    brand: brandForDomain(domain),
    cap,
    sentToday,
    remaining: Math.max(0, cap - sentToday),
    // Either mechanism reads as stopped — which one was used is an
    // implementation detail the operator shouldn't have to hold in their head.
    stopped: cap === 0 || suspended,
    suspended,
    minWaitMins: a.minTimeToWaitInMins ?? null,
    warmup: {
      status: w.status ?? null,
      reputation: toNumber(w.warmup_reputation),
      sent: warmupSent,
      spam: warmupSpam,
      spamRate: ratio(warmupSpam, warmupSent),
      replyRate: w.reply_rate ?? null,
      blockedReason: w.blocked_reason ?? null,
    },
    // Only treat as disconnected when Smartlead has actually reported a failure;
    // an absent flag means "not tested", not "broken".
    connected: a.is_smtp_success !== false && a.is_imap_success !== false,
    campaignCount: a.campaign_count ?? 0,
    lastSentAt: lastSent[email.toLowerCase()] ?? null,
  };
}

function healthFrom(row: DomainHealthRow | undefined, prior: DomainHealthRow | undefined): DomainHealth | null {
  if (!row) return null;
  const sent = row.sent ?? 0;
  const bounced = row.bounced ?? 0;
  const deliverability = ratio(sent - bounced, sent);

  let trend: number | null = null;
  if (prior) {
    const priorSent = prior.sent ?? 0;
    const priorDeliverability = ratio(priorSent - (prior.bounced ?? 0), priorSent);
    if (deliverability !== null && priorDeliverability !== null) {
      trend = (deliverability - priorDeliverability) * 100;
    }
  }

  return {
    sent,
    opened: row.opened ?? 0,
    replied: row.replied ?? 0,
    bounced,
    deliverability,
    bounceRate: ratio(bounced, sent),
    replyRate: ratio(row.replied ?? 0, sent),
    deliverabilityTrend: trend,
  };
}

function indexByDomain(rows: DomainHealthRow[]): Map<string, DomainHealthRow> {
  const map = new Map<string, DomainHealthRow>();
  // Guarded: this feeds a render path, and a shape change upstream should
  // degrade to "no health data" rather than throwing mid-assembly.
  if (!Array.isArray(rows)) return map;
  for (const r of rows) {
    if (r?.domain) map.set(r.domain.toLowerCase(), r);
  }
  return map;
}

/**
 * Everything the Mailboxes screen renders, in one call.
 *
 * Three Smartlead reads — the accounts, this week's domain health and last
 * week's for the trend — each cached, so a page view costs at most three API
 * calls and usually none.
 *
 * `now` is injectable so the week boundaries are testable.
 */
export async function getSendingFloor(now = new Date()): Promise<SendingFloor> {
  if (!isSmartleadConfigured()) {
    return {
      configured: false,
      domains: [],
      totals: { mailboxes: 0, activeMailboxes: 0, sentToday: 0, ceiling: 0, utilisation: 0 },
      healthWindow: null,
    };
  }

  const end = isoDate(now);
  const start = isoDate(new Date(now.getTime() - 6 * 86_400_000));
  const priorEnd = isoDate(new Date(now.getTime() - 7 * 86_400_000));
  const priorStart = isoDate(new Date(now.getTime() - 13 * 86_400_000));

  const [accounts, lastSent, health, priorHealth] = await Promise.all([
    cached(cacheKeys.emailAccounts, listEmailAccounts),
    readLastSent(),
    // Health is a trailing-week aggregate — it moves slowly, so it can cache for
    // far longer than the live capacity numbers.
    cached(cacheKeys.domainHealth(start, end), () => getDomainHealth(start, end), 300).catch(
      (e: Error) => {
        console.error('[outreach] domain health failed', e.message);
        return [] as DomainHealthRow[];
      },
    ),
    cached(
      cacheKeys.domainHealth(priorStart, priorEnd),
      () => getDomainHealth(priorStart, priorEnd),
      3600,
    ).catch(() => [] as DomainHealthRow[]),
  ]);

  const healthByDomain = indexByDomain(health);
  const priorByDomain = indexByDomain(priorHealth);

  // Start from the configured domains so a domain whose mailboxes aren't
  // connected yet still shows up as an empty block rather than vanishing.
  const grouped = new Map<string, FloorMailbox[]>();
  for (const d of SENDING_DOMAINS) grouped.set(d, []);
  for (const a of accounts) {
    const mailbox = toMailbox(a, lastSent);
    if (!mailbox.domain) continue;
    const bucket = grouped.get(mailbox.domain);
    if (bucket) bucket.push(mailbox);
    else grouped.set(mailbox.domain, [mailbox]);
  }

  const domains: FloorDomain[] = [...grouped.entries()].map(([domain, mailboxes]) => {
    const sorted = [...mailboxes].sort((a, b) => a.email.localeCompare(b.email));
    const sentToday = sorted.reduce((s, m) => s + m.sentToday, 0);
    const ceiling = sorted.reduce((s, m) => s + m.cap, 0);
    const reputations = sorted
      .map((m) => m.warmup.reputation)
      .filter((r): r is number => r !== null);
    const warmupSent = sorted.reduce((s, m) => s + m.warmup.sent, 0);
    const warmupSpam = sorted.reduce((s, m) => s + m.warmup.spam, 0);

    return {
      domain,
      brand: brandForDomain(domain),
      mailboxes: sorted,
      activeCount: sorted.filter((m) => !m.stopped).length,
      sentToday,
      ceiling,
      utilisation: ratio(sentToday, ceiling) ?? 0,
      warmupReputation: reputations.length
        ? reputations.reduce((s, r) => s + r, 0) / reputations.length
        : null,
      spamRate: ratio(warmupSpam, warmupSent),
      disconnectedCount: sorted.filter((m) => !m.connected).length,
      health: healthFrom(healthByDomain.get(domain), priorByDomain.get(domain)),
    };
  });

  // Configured domains first, in their declared order; anything unexpected after.
  domains.sort((a, b) => {
    const ai = SENDING_DOMAINS.indexOf(a.domain);
    const bi = SENDING_DOMAINS.indexOf(b.domain);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.domain.localeCompare(b.domain);
  });

  const allMailboxes = domains.flatMap((d) => d.mailboxes);
  const sentToday = allMailboxes.reduce((s, m) => s + m.sentToday, 0);
  const ceiling = allMailboxes.reduce((s, m) => s + m.cap, 0);

  return {
    configured: true,
    domains,
    totals: {
      mailboxes: allMailboxes.length,
      activeMailboxes: allMailboxes.filter((m) => !m.stopped).length,
      sentToday,
      ceiling,
      utilisation: ratio(sentToday, ceiling) ?? 0,
    },
    healthWindow: { start, end },
  };
}
