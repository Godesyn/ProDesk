import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from './trpc';
import { supabase } from './supabase';
import { subscribeResilient } from './resilient-channel';

/**
 * App-wide realtime: one Supabase channel subscribed to every realtime-enabled
 * table, invalidating the React Query keys that read from each. Mounted once in
 * the authenticated shell (MainLayout) so every board/list/detail is live
 * without per-screen wiring.
 *
 * The event is only a trigger — data is refetched through tRPC (auth-enforced).
 * Delivery is gated by the RLS policies + publication in `server/sql/rls.sql`;
 * a table missing there simply won't emit. Financial ledgers (invoices/payouts)
 * are intentionally excluded (not multi-user-live).
 *
 * Query keys use the procedure-level prefix (no input), which invalidates every
 * cached instance of that query regardless of its arguments.
 */
export function GlobalRealtime() {
  useGlobalRealtime();
  return null;
}

function useGlobalRealtime() {
  const qc = useQueryClient();
  const trpc = useTRPC();

  useEffect(() => {
    // table → query-key prefixes to invalidate when any row in it changes.
    const map: Record<string, ReadonlyArray<readonly unknown[]>> = {
      tasks: [
        trpc.tasks.list.queryKey(),
        trpc.tasks.counts.queryKey(),
        trpc.tasks.teamMembers.queryKey(),
        trpc.tasks.unviewedCount.queryKey(),
      ],
      agency_contractor_connections: [
        trpc.connections.agencyContractors.queryKey(),
        trpc.connections.exploreContractors.queryKey(),
        trpc.contractor.myConnections.queryKey(),
        trpc.projects.assigneeOptions.queryKey(),
      ],
      brand_agency_connections: [
        trpc.connections.brandAgenciesWithStats.queryKey(),
        trpc.connections.agencyClients.queryKey(),
        trpc.resources.brandList.queryKey(),
        trpc.spot.listFormsForBrand.queryKey(),
      ],
      brand_agency_connection_requests: [
        trpc.connections.brandPendingRequests.queryKey(),
        trpc.connections.agencyClients.queryKey(),
      ],
      staff: [
        trpc.staff.list.queryKey(),
        trpc.projects.assigneeOptions.queryKey(),
        // A staff member's own row carries their permissions; refetch auth.me so
        // the nav re-derives live when an admin edits their permissions.
        trpc.auth.me.queryKey(),
      ],
      services: [
        trpc.services.list.queryKey(),
        trpc.marketplace.browse.queryKey(),
        trpc.marketplace.serviceById.queryKey(),
        trpc.marketplace.packages.queryKey(),
        trpc.marketplace.packageById.queryKey(),
      ],
      packages: [
        trpc.packages.list.queryKey(),
        trpc.packages.byId.queryKey(),
        trpc.marketplace.packages.queryKey(),
        trpc.marketplace.packageById.queryKey(),
      ],
      proposals: [
        trpc.proposals.list.queryKey(),
        trpc.proposals.byId.queryKey(),
        trpc.proposals.attentionCount.queryKey(),
      ],
      proposal_items: [trpc.proposals.byId.queryKey()],
      proposal_phases: [trpc.proposals.byId.queryKey()],
      proposal_comments: [trpc.proposals.byId.queryKey()],
      proposal_documents: [trpc.proposals.byId.queryKey()],
      purchases: [trpc.purchases.list.queryKey(), trpc.purchases.byId.queryKey()],
      projects: [
        trpc.projects.board.queryKey(),
        trpc.projects.list.queryKey(),
        trpc.projects.byId.queryKey(),
      ],
      project_deliverables: [trpc.projects.byId.queryKey()],
      project_revisions: [trpc.projects.byId.queryKey()],
      project_notes: [trpc.projects.byId.queryKey()],
      spot_forms: [trpc.spot.listForms.queryKey(), trpc.spot.listFormsForBrand.queryKey()],
      spot_components: [
        trpc.spot.listComponents.queryKey(),
        trpc.spot.publicProfile.queryKey(),
        trpc.spot.publicComponent.queryKey(),
      ],
      resources: [
        trpc.resources.list.queryKey(),
        trpc.resources.adminList.queryKey(),
        trpc.resources.brandList.queryKey(),
      ],
      meetings: [trpc.meetings.list.queryKey()],
      files: [trpc.files.list.queryKey()],
      folders: [trpc.files.folders.queryKey()],
      discipline_requests: [trpc.superAdmin.disciplineRequests.queryKey()],
    };

    // Coalesce a burst of postgres_changes into one invalidation pass: collect the
    // affected query keys and flush ~200 ms later, so a bulk write triggers a single
    // refetch per query instead of one per row — still effectively instant, but no
    // refetch storm. Keys are deduped by their JSON form (arrays aren't Set-friendly).
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
      // Serialises a rebuild behind the async removeChannel of the same topic —
      // re-subscribing a topic whose teardown is still in flight throws.
      topic: 'rt-global',
      build: () => {
        const channel = supabase.channel('rt-global');
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
