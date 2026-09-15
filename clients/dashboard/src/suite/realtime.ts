import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { supabase } from '@shared/lib/supabase';
import { subscribeResilient } from '@shared/lib/resilient-channel';

/**
 * Dashboard-wide realtime: one Supabase channel subscribed to every table the
 * brand workspace reads, invalidating the React Query keys backed by each. Mounted
 * once in the suite shell (SuiteApp) so every tool/list/stat is live without
 * per-screen wiring. Mirrors the Prodesk app's `GlobalRealtime` registry
 * (packages/shared/src/lib/realtime-registry.ts), scoped to the dashboard's queries.
 *
 * The event is only a trigger — data is refetched through tRPC (auth-enforced).
 * Delivery is gated by the RLS policies + publication membership in
 * `servers/backend/sql/rls.sql`; a table missing there simply won't emit.
 *
 * Chat is intentionally excluded: MessagePanel owns its own per-thread channel,
 * and a second subscription to the same topic throws (supabase reuses channels by
 * topic — see the dock/strategy suppression note in SuiteApp).
 *
 * Query keys use the procedure-level prefix (no input), which invalidates every
 * cached instance of that query regardless of its arguments (brandId, search, …).
 */
export function useDashboardRealtime() {
  const qc = useQueryClient();
  const trpc = useTRPC();

  useEffect(() => {
    // table → query-key prefixes to invalidate when any row in it changes.
    const map: Record<string, ReadonlyArray<readonly unknown[]>> = {
      // Brand record: the switcher list, the company-info form, the dashboard KPIs.
      brands: [
        trpc.brands.mine.queryKey(),
        trpc.brands.byId.queryKey(),
        trpc.brands.dashboardStats.queryKey(),
      ],
      // Services catalogue (published via the brand's derived agency).
      services: [trpc.services.list.queryKey()],
      // Team & people — and the team-member count on the dashboard.
      staff: [
        trpc.staff.list.queryKey(),
        trpc.brands.dashboardStats.queryKey(),
      ],
      // Proposals drive the "to action" signal + the dashboard's pending count.
      proposals: [
        trpc.proposals.attentionCount.queryKey(),
        trpc.brands.dashboardStats.queryKey(),
      ],
      // dashboardStats also counts active projects + connected agencies.
      projects: [trpc.brands.dashboardStats.queryKey()],
      brand_agency_connections: [trpc.brands.dashboardStats.queryKey()],
      // Document Locker — files + their folders (any tab/folder/agency variant).
      files: [trpc.files.list.queryKey(), trpc.files.search.queryKey()],
      folders: [trpc.files.folders.queryKey()],
      // Billing / AI feature entitlements (Strategy + Account → Billing).
      feature_subscriptions: [trpc.featureSubscriptions.myForBrand.queryKey()],
      // The signed-in user's own row: profile + notification preferences. Refetch
      // auth.me so the top bar / account screen re-derive live across tabs/devices.
      users: [
        trpc.auth.me.queryKey(),
        trpc.users.unsubscribedChannels.queryKey(),
      ],
    };

    // Coalesce a burst of postgres_changes into one invalidation pass: collect the
    // affected query keys and flush ~200 ms later. A bulk write (or several rapid
    // edits) then triggers a single refetch per query instead of one per row —
    // still effectively instant to a human, but no refetch storm. Keys are deduped
    // by their JSON form (query keys are arrays, not Set-friendly).
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
      topic: 'rt-dashboard',
      build: () => {
        const channel = supabase.channel('rt-dashboard');
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
    // trpc + qc are stable; we want a single session-long subscription.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
