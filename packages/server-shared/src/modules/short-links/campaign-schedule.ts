/**
 * Campaign schedule resolution — the single rule deciding what a campaign link
 * serves at a given instant.
 *
 * A campaign has a DEFAULT (a URL, or plain text shown instead of redirecting)
 * plus any number of dated windows that override it. Windows may overlap, so this
 * is a total order rather than a validation error: among the windows containing
 * `now`, the one with the LATEST `startsAt` wins (the most recently begun promo is
 * the most specific), tie-broken by the newest `createdAt`, then by id so the
 * result is stable even for rows written in the same transaction.
 *
 * Dependency-free and pure: the redirector calls it on the hot path, the tRPC
 * layer calls it to preview "what's live right now", and the unit test pins the
 * precedence — so the dashboard can never disagree with what visitors get.
 *
 * Window bounds are half-open: [startsAt, endsAt). An end instant belongs to
 * whatever comes next, so back-to-back windows never both match.
 */

/** The minimum window shape this module needs. Extra fields are ignored. */
export interface ScheduleWindow {
  id: string;
  destinationUrl: string;
  startsAt: Date;
  endsAt: Date;
  createdAt?: Date | null;
  label?: string | null;
}

/** What a campaign serves right now: a redirect, or a plain-text page. */
export type CampaignResolution =
  | { type: 'redirect'; url: string; windowId: string | null; label: string | null }
  | { type: 'text'; text: string };

/** True when `at` falls inside the half-open range [startsAt, endsAt). */
export function windowContains(w: ScheduleWindow, at: Date): boolean {
  const t = at.getTime();
  return t >= w.startsAt.getTime() && t < w.endsAt.getTime();
}

/**
 * The window in effect at `at`, or null when none is. Ties resolve by latest
 * start → newest createdAt → highest id (see the module comment).
 */
export function activeWindow(
  windows: readonly ScheduleWindow[],
  at: Date,
): ScheduleWindow | null {
  let best: ScheduleWindow | null = null;
  for (const w of windows) {
    if (!windowContains(w, at)) continue;
    if (!best || compareWindowPrecedence(w, best) > 0) best = w;
  }
  return best;
}

/** >0 when `a` outranks `b`. Latest start, then newest createdAt, then id. */
function compareWindowPrecedence(a: ScheduleWindow, b: ScheduleWindow): number {
  const byStart = a.startsAt.getTime() - b.startsAt.getTime();
  if (byStart !== 0) return byStart;
  const byCreated = (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  if (byCreated !== 0) return byCreated;
  return a.id > b.id ? 1 : a.id < b.id ? -1 : 0;
}

/**
 * Resolve what a campaign serves at `at`: the active window's URL, else the
 * campaign's own default URL, else its fallback text.
 *
 * Returns null only when the campaign has NO window in effect and neither a
 * default URL nor fallback text — which the `short_links_destination_ck` check
 * constraint forbids, so callers treat null as "not found / misconfigured".
 */
export function resolveCampaignDestination(
  campaign: { destinationUrl: string | null; fallbackText: string | null },
  windows: readonly ScheduleWindow[],
  at: Date,
): CampaignResolution | null {
  const w = activeWindow(windows, at);
  if (w) {
    return { type: 'redirect', url: w.destinationUrl, windowId: w.id, label: w.label ?? null };
  }
  if (campaign.destinationUrl) {
    return { type: 'redirect', url: campaign.destinationUrl, windowId: null, label: null };
  }
  if (campaign.fallbackText) return { type: 'text', text: campaign.fallbackText };
  return null;
}

/**
 * The next instant this campaign's resolution could change — the soonest upcoming
 * window start or the end of the active window. Null when nothing is scheduled
 * ahead. Used to label campaigns in the UI ("switches on in 3 days") and to bound
 * how long a redirect may be cached.
 */
export function nextScheduleChange(
  windows: readonly ScheduleWindow[],
  at: Date,
): Date | null {
  const t = at.getTime();
  let soonest: number | null = null;
  const consider = (ms: number) => {
    if (ms > t && (soonest === null || ms < soonest)) soonest = ms;
  };
  for (const w of windows) {
    consider(w.startsAt.getTime());
    consider(w.endsAt.getTime());
  }
  return soonest === null ? null : new Date(soonest);
}
