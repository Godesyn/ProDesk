/**
 * The caller's beta state, for any frontend.
 *
 * One hook drives every beta surface: the countdown banner, the post-expiry report
 * takeover, and whether the feedback panel is offered.
 *
 * COST: zero extra requests for users who aren't in the beta — which is almost
 * everyone. `auth.me` already returns the beta columns off the `users` row, so
 * enrolment, the deadline and the acknowledgement are derived from a query every
 * frontend already runs. Only an actual beta member additionally fetches
 * `beta.myStatus`, and only for its cohort label. `<BetaProgram />` is mounted on
 * every page of every frontend, so "one more query per page load" would have been a
 * platform-wide cost paid for a feature most users never see.
 *
 * The `active` computation deliberately mirrors `entitlements.isBetaUser()` on the
 * server — the same two columns, the same comparison — so the UI and the paid gates
 * flip at the same instant rather than one lagging a cache behind the other.
 */
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from '../auth/auth-context';

export type BetaStatusView = {
  /** Resolved — false only while the user query is still in flight. */
  ready: boolean;
  /** In the beta programme at all, live or lapsed. */
  enrolled: boolean;
  /** Beta access is live right now. */
  active: boolean;
  /** Beta had a deadline and it has passed. */
  expired: boolean;
  endsAt: Date | null;
  /** Whole days left (0 on the final day); null when unlimited or lapsed. */
  daysRemaining: number | null;
  /** Inside the final week — the banner escalates from here. */
  endingSoon: boolean;
  /** Set once they've seen the post-expiry report screen. */
  acknowledged: boolean;
  versionCode: string | null;
  versionLabel: string | null;
};

const NOT_ENROLLED: Omit<BetaStatusView, 'ready'> = {
  enrolled: false,
  active: false,
  expired: false,
  endsAt: null,
  daysRemaining: null,
  endingSoon: false,
  acknowledged: false,
  versionCode: null,
  versionLabel: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Lead time at which the banner escalates — mirrors BETA_NOTICE_DAYS[0] server-side. */
const ENDING_SOON_DAYS = 7;

/**
 * Whole days until `endsAt`, rounded UP — mirrors `daysUntil` in
 * modules/beta/dates.ts. Rounding up matters: a deadline six hours away must read
 * "1 day left", never "0", which a member would read as already cut off.
 */
function daysUntil(endsAt: Date, now: number): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY_MS));
}

export function useBetaStatus(): BetaStatusView {
  const trpc = useTRPC();
  const { data: user, isLoading, sessionLoading } = useCurrentUser();

  const enrolled = !!user?.isBetaUser;

  // Cohort label only — gated on enrolment so non-members never issue this.
  const detail = useQuery({
    ...trpc.beta.myStatus.queryOptions(),
    enabled: enrolled,
    // A deadline moves at most once a day, and an admin extension arrives via a
    // cache invalidation, so per-focus refetching would buy nothing.
    staleTime: 5 * 60_000,
  });

  const ready = !sessionLoading && !isLoading;
  if (!user || !enrolled) return { ...NOT_ENROLLED, ready };

  const endsAt = user.betaEndsAt ? new Date(user.betaEndsAt) : null;
  const now = Date.now();
  // No deadline = the legacy unlimited grant: permanently active, never warned.
  const active = endsAt == null || endsAt.getTime() > now;
  const daysRemaining = active && endsAt ? daysUntil(endsAt, now) : null;

  return {
    ready,
    enrolled: true,
    active,
    expired: !active,
    endsAt,
    daysRemaining,
    endingSoon: daysRemaining != null && daysRemaining <= ENDING_SOON_DAYS,
    acknowledged: user.betaExpiryAcknowledgedAt != null,
    versionCode: detail.data?.version?.code ?? null,
    versionLabel: detail.data?.version?.label ?? null,
  };
}

/** `12 Sep 2026` — the one date format every beta surface uses. */
export function formatBetaDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "3 days left" / "Ends today" — the countdown phrase, singular-aware. */
export function betaCountdownLabel(daysRemaining: number | null): string {
  if (daysRemaining == null) return 'Beta access';
  if (daysRemaining <= 0) return 'Beta ends today';
  if (daysRemaining === 1) return '1 day of beta left';
  return `${daysRemaining} days of beta left`;
}
