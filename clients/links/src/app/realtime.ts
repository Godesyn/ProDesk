import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { supabase } from '@shared/lib/supabase';
import { subscribeResilient } from '@shared/lib/resilient-channel';
import { useCurrentUser } from '@shared/auth/auth-context';

/**
 * Links-app realtime: one Supabase channel subscribed to every table the Links &
 * QR workspace reads, invalidating the React Query keys backed by each. Mounted
 * once near the top of App so every list/detail/analytics/billing screen is live
 * without per-screen wiring. Mirrors the dashboard's `useDashboardRealtime` and the
 * Prodesk app's `GlobalRealtime`, scoped to the links queries.
 *
 * The event is only a trigger — data is refetched through tRPC (auth-enforced).
 * Delivery is gated by the RLS policies + publication membership in
 * `servers/backend/sql/rls.sql` (short_links / link_events were added there for
 * this); a table missing those simply won't emit.
 *
 * Keys come from `pathFilter()`, i.e. the procedure path alone, so every cached
 * instance of a query is invalidated regardless of its arguments (brandId,
 * search, cursor…). It must NOT be `queryKey()`: that bakes `{ type: 'query' }`
 * into the key, and React Query's partial match then skips INFINITE queries,
 * whose keys say `{ type: 'infinite' }`. Both list screens are infinite, so the
 * earlier `queryKey()` map never refreshed a single list from a realtime event.
 * See the same warning in use-invalidate.ts.
 */

/** Minimal shape of a tRPC procedure helper — just what `key()` needs. */
type ProcedureUtils = { pathFilter: () => { queryKey: readonly unknown[] } };

/** Path-only query key: matches a procedure's plain AND infinite cached forms. */
const key = (proc: ProcedureUtils) => proc.pathFilter().queryKey;

export function useLinksRealtime() {
  const qc = useQueryClient();
  const trpc = useTRPC();
  // Gate the subscription on the authenticated user. postgres_changes bindings
  // are authorized ONCE, at subscribe time, against whatever token the Realtime
  // socket holds then. App calls useLinksRealtime at its very top — before the
  // session resolves — so subscribing eagerly binds the feed as the ANON role,
  // and RLS (short_links_visible etc. require app_is_brand_member) silently drops
  // every event for the whole session: lists only refresh on remount. Waiting for
  // a user id means auth-context has already run supabase.realtime.setAuth with
  // the session JWT, so the feed is authorized as the brand member. The dep also
  // re-subscribes after an account switch (new id → teardown + rejoin).
  const { data: user } = useCurrentUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const map: Record<string, ReadonlyArray<readonly unknown[]>> = {
      // Links themselves drive the list, detail, analytics totals, and the
      // billable active-link count (entitlement).
      short_links: [
        key(trpc.shortLinks.list),
        key(trpc.shortLinks.byId),
        key(trpc.shortLinks.analytics),
        // A single link's own analytics panel on its detail screen.
        key(trpc.shortLinks.linkAnalytics),
        key(trpc.shortLinks.entitlement),
        // Campaigns are short_links rows with kind='campaign', so any write here
        // can change the campaigns screens too — including the date preview,
        // whose answer depends on the campaign's fallback.
        key(trpc.linkCampaigns.list),
        key(trpc.linkCampaigns.byId),
        key(trpc.linkCampaigns.preview),
      ],
      // Scheduled destination windows: the campaign list's "now serving" column,
      // the detail screen's schedule, and what any previewed instant resolves to.
      link_destination_windows: [
        key(trpc.linkCampaigns.list),
        key(trpc.linkCampaigns.byId),
        key(trpc.linkCampaigns.preview),
      ],
      // Click events feed the windowed analytics (series + breakdowns), both the
      // brand-wide screen and the per-link panel.
      link_events: [
        key(trpc.shortLinks.analytics),
        key(trpc.shortLinks.linkAnalytics),
      ],
      // Billing: subscription state + the entitlement summary (entitled/activeCount).
      feature_subscriptions: [
        key(trpc.featureSubscriptions.myForBrand),
        key(trpc.shortLinks.entitlement),
      ],
      // Team tab + permission changes (auth.me re-derives the user's role/perms).
      staff: [key(trpc.staff.list), key(trpc.auth.me)],
      // Brand record: switcher/footer name + the default QR design.
      brands: [
        key(trpc.brands.mine),
        key(trpc.shortLinks.defaultQrConfig),
      ],
      // The signed-in user's own row (profile + selected brand context).
      users: [key(trpc.auth.me)],
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

    // Resilient subscription (resilient-channel.ts): detects dead channels, hard-
    // resubscribes when the tab wakes / network returns, and on every re-join
    // invalidates ALL mapped keys — postgres_changes has no replay, so that
    // refetch is the only way to recover whatever changed while the socket was down.
    const handle = subscribeResilient({
      // Serialises a rebuild behind the same topic's async teardown.
      topic: 'rt-links',
      build: () => {
        const channel = supabase.channel('rt-links');
        for (const [table, keys] of Object.entries(map)) {
          channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
            scheduleInvalidate(keys);
          });
        }
        return channel;
      },
      onCatchUp: () => scheduleInvalidate(Object.values(map).flat()),
    });
    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      handle.dispose();
    };
    // trpc + qc are stable; re-run only when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
