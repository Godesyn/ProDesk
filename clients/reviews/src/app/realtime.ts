import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { supabase } from '@shared/lib/supabase';
import { useCurrentUser } from '@shared/auth/auth-context';

/**
 * Reviews-app realtime: one Supabase channel subscribed to every table the
 * Verdiict workspace reads, invalidating the React Query keys backed by each.
 * Mounted once near the top of App so every list/detail/stat/billing screen is
 * live without per-screen wiring. Mirrors the links app's `useLinksRealtime`
 * and the Prodesk app's `GlobalRealtime` (packages/shared/src/lib/realtime-registry.ts),
 * scoped to the reviews queries.
 *
 * The event is only a trigger — data is refetched through tRPC (auth-enforced).
 * Delivery is gated by the RLS policies + publication membership in
 * `servers/backend/sql/rls.sql` (the review_* tables were added there for this);
 * a table missing those simply won't emit. review_embed_views is intentionally
 * excluded: it's write-only analytics — no client query reads it.
 *
 * Query keys use the procedure-level prefix (no input), invalidating every cached
 * instance of that query regardless of its arguments (brandId, locationId, …).
 * Invalidating a query that isn't mounted is a no-op, so the super-admin keys
 * cost nothing for regular brand users (RLS drops those events anyway).
 */
export function useReviewsRealtime() {
  const qc = useQueryClient();
  const trpc = useTRPC();
  // Gate the subscription on the authenticated user. postgres_changes bindings
  // are authorized ONCE, at subscribe time, against whatever token the Realtime
  // socket holds then. App calls this hook at its very top — before the session
  // resolves — so subscribing eagerly would bind the feed as the ANON role, and
  // RLS (review_locations_visible etc. require app_is_brand_member) would
  // silently drop every event for the whole session: lists would only refresh
  // on remount. Waiting for a user id means auth-context has already run
  // supabase.realtime.setAuth with the session JWT, so the feed is authorized
  // as the brand member. The dep also re-subscribes after an account switch.
  const { data: user } = useCurrentUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    // table → query-key prefixes to invalidate when any row in it changes.
    const map: Record<string, ReadonlyArray<readonly unknown[]>> = {
      // Locations drive the home grid, settings, trash, the industry-rank
      // insight (industry comes off the location), reward milestones, and the
      // location pickers inside collections. Admin keys cover the portal.
      review_locations: [
        trpc.reviews.locations.list.queryKey(),
        trpc.reviews.locations.get.queryKey(),
        trpc.reviews.locations.listDeleted.queryKey(),
        trpc.reviews.collections.detail.queryKey(),
        trpc.reviews.insights.industryRank.queryKey(),
        trpc.reviews.rewards.list.queryKey(),
        trpc.reviews.admin.overview.queryKey(),
        trpc.reviews.admin.brands.queryKey(),
        trpc.reviews.admin.brandDetail.queryKey(),
      ],
      // Per-location children shown on the settings screen.
      review_platforms: [trpc.reviews.locations.get.queryKey()],
      review_win_tags: [trpc.reviews.locations.get.queryKey()],
      // Captured reviews feed the log, stats, streak/rank insights, the embed +
      // collection previews, milestone progress, and the trial-usage entitlement.
      review_submissions: [
        trpc.reviews.dashboard.stats.queryKey(),
        trpc.reviews.dashboard.reviews.queryKey(),
        trpc.reviews.insights.streak.queryKey(),
        trpc.reviews.insights.industryRank.queryKey(),
        trpc.reviews.entitlement.queryKey(),
        trpc.reviews.embed.preview.queryKey(),
        trpc.reviews.collections.preview.queryKey(),
        trpc.reviews.rewards.list.queryKey(),
        trpc.reviews.directory.profile.queryKey(),
        trpc.reviews.directory.search.queryKey(),
        trpc.reviews.directory.leaderboard.queryKey(),
        trpc.reviews.admin.overview.queryKey(),
        trpc.reviews.admin.recentReviews.queryKey(),
        trpc.reviews.admin.brandActivity.queryKey(),
      ],
      // Manual outreach log.
      review_requests: [trpc.reviews.reviewRequests.listForBrand.queryKey()],
      // Embed theme config (per location) + account-wide collections.
      review_embed_configs: [trpc.reviews.embed.getForLocation.queryKey()],
      review_embed_collections: [
        trpc.reviews.collections.list.queryKey(),
        trpc.reviews.collections.detail.queryKey(),
      ],
      review_embed_collection_locations: [
        trpc.reviews.collections.list.queryKey(),
        trpc.reviews.collections.detail.queryKey(),
        trpc.reviews.collections.preview.queryKey(),
      ],
      // Milestone rewards (Progress + home banner; shipped by super-admins).
      review_milestone_rewards: [
        trpc.reviews.rewards.list.queryKey(),
        trpc.reviews.admin.listClaimedRewards.queryKey(),
      ],
      // Global industry + tag-preset catalogues (super-admin managed).
      review_industries: [
        trpc.reviews.industries.list.queryKey(),
        trpc.reviews.admin.listIndustries.queryKey(),
      ],
      review_tag_presets: [
        trpc.reviews.industries.tags.queryKey(),
        trpc.reviews.admin.getTagPresets.queryKey(),
      ],
      // Public directory profile (mine + the public search/leaderboard/profile).
      review_directory_profiles: [
        trpc.reviews.directory.myProfile.queryKey(),
        trpc.reviews.directory.profile.queryKey(),
        trpc.reviews.directory.search.queryKey(),
        trpc.reviews.directory.leaderboard.queryKey(),
      ],
      // Referral programme (Progress screen).
      review_referral_codes: [trpc.reviews.referrals.mine.queryKey()],
      review_referral_redemptions: [trpc.reviews.referrals.mine.queryKey()],
      // Admin audit trail (portal).
      review_admin_audit: [trpc.reviews.admin.auditLog.queryKey()],
      // Billing: subscription state + the trial/paid entitlement + invoice list.
      feature_subscriptions: [
        trpc.featureSubscriptions.myForBrand.queryKey(),
        trpc.reviews.entitlement.queryKey(),
        trpc.reviews.invoices.queryKey(),
      ],
      // Team tab + permission changes (auth.me re-derives the user's role/perms).
      staff: [trpc.staff.list.queryKey(), trpc.auth.me.queryKey()],
      // Brand record: switcher/footer name + logo.
      brands: [trpc.brands.mine.queryKey()],
      // The signed-in user's own row (profile + selected brand context).
      users: [trpc.auth.me.queryKey()],
    };

    // Coalesce a burst of postgres_changes into one invalidation pass (~200 ms):
    // a bulk write triggers a single refetch per query instead of one per row —
    // still effectively instant, but no refetch storm. Keys deduped by JSON form.
    const FLUSH_MS = 200;
    const pendingKeys = new Map<string, readonly unknown[]>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      flushTimer = null;
      const keys = [...pendingKeys.values()];
      pendingKeys.clear();
      for (const key of keys) qc.invalidateQueries({ queryKey: key });
    };
    const scheduleInvalidate = (keys: ReadonlyArray<readonly unknown[]>) => {
      for (const key of keys) pendingKeys.set(JSON.stringify(key), key);
      if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
    };

    const channel = supabase.channel('rt-reviews');
    for (const [table, keys] of Object.entries(map)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        scheduleInvalidate(keys);
      });
    }
    channel.subscribe();
    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      supabase.removeChannel(channel);
    };
    // trpc + qc are stable; re-run only when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
