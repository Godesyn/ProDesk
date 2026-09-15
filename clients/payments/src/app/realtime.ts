import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { supabase } from '@shared/lib/supabase';
import { subscribeResilient } from '@shared/lib/resilient-channel';
import { useCurrentUser } from '@shared/auth/auth-context';

/**
 * Payments (EziQuotes) realtime: one Supabase channel subscribed to every table
 * the payments workspace reads, invalidating the React Query keys backed by each.
 * Mounted once in PaymentsApp (the AUTHENTICATED router) — never in App.tsx — so
 * it never runs on the public payer surfaces (/p/:slug, chase, surveys).
 * Mirrors clients/links/src/app/realtime.ts.
 *
 * The event is only a trigger — data is refetched through tRPC (auth-enforced).
 * Delivery is gated by the RLS policies + publication membership in
 * `servers/backend/sql/rls.sql` (the payment_* read tables were added there);
 * a table missing those simply won't emit. Payer-facing proposals live in the
 * canonical `proposals` table (published for the marketplace pipeline), so it's
 * mapped here too — it starts emitting for payer rows once WS2 lands.
 *
 * Query keys use the procedure-level prefix (no input), invalidating every cached
 * instance of that query regardless of its arguments (brandId, slug, cursor…).
 */
export function usePaymentsRealtime() {
  const qc = useQueryClient();
  const trpc = useTRPC();
  // Gate on the authenticated user. postgres_changes bindings are authorized
  // ONCE, at subscribe time, against whatever token the Realtime socket holds
  // then. Waiting for a user id means auth-context has already run
  // supabase.realtime.setAuth with the session JWT, so the feed is authorized as
  // the brand member (RLS payment_*_visible require app_is_brand_member) instead
  // of the anon role — else every event is silently dropped for the whole
  // session. The dep also re-subscribes after a context switch (new id).
  const { data: user } = useCurrentUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    const map: Record<string, ReadonlyArray<readonly unknown[]>> = {
      // Proposals (canonical table; payer rows land here post-WS2) drive the
      // list, detail, dashboard KPIs/queues/charts, the chase queue and the
      // client's proposal roll-up.
      proposals: [
        trpc.payments.proposals.list.queryKey(),
        trpc.payments.proposals.get.queryKey(),
        trpc.payments.accounts.recentProposals.queryKey(),
        trpc.payments.accounts.dashboardFullKpis.queryKey(),
        trpc.payments.accounts.dashboardActionQueue.queryKey(),
        trpc.payments.accounts.dashboardRevenueChart.queryKey(),
        trpc.payments.chase.queue.queryKey(),
        trpc.payments.clients.getWithProposals.queryKey(),
      ],
      // Clients (CRM): the list, per-client detail, health score.
      payment_clients: [
        trpc.payments.clients.list.queryKey(),
        trpc.payments.clients.getWithProposals.queryKey(),
        trpc.payments.analytics.clientHealthScore.queryKey(),
      ],
      // Transactions (inbound ledger): revenue KPIs, billing summary, forecast.
      payment_transactions: [
        trpc.payments.accounts.billingSummary.queryKey(),
        trpc.payments.accounts.dashboardFullKpis.queryKey(),
        trpc.payments.accounts.dashboardRevenueChart.queryKey(),
        trpc.payments.analytics.revenueForecast.queryKey(),
      ],
      // Installment schedules + recurring invoices feed the recurring screen.
      payment_installment_schedules: [
        trpc.payments.installments.listBySlug.queryKey(),
        trpc.payments.recurringInvoices.list.queryKey(),
      ],
      payment_recurring_invoices: [trpc.payments.recurringInvoices.list.queryKey()],
      // Catalog: products / add-ons / pricing tables / quick sets / categories
      // all render on the Pricing screen; templates on the Templates screen.
      payment_products: [trpc.payments.pricing.listProducts.queryKey()],
      payment_addons: [trpc.payments.pricing.listAddons.queryKey()],
      payment_pricing_tables: [trpc.payments.pricing.listProducts.queryKey()],
      payment_quick_sets: [trpc.payments.pricing.listQuickSets.queryKey()],
      payment_categories: [
        trpc.payments.categories.list.queryKey(),
        trpc.payments.pricing.listProducts.queryKey(),
      ],
      payment_templates: [
        trpc.payments.templates.list.queryKey(),
        trpc.payments.templates.get.queryKey(),
      ],
      // Brand kit → the brand-kit editor + proposal branding.
      payment_brand_kits: [trpc.payments.accounts.getBrandKit.queryKey()],
      // Account record: settings/me, billing summary, integration + accounting
      // status, thank-you config.
      payment_accounts: [
        trpc.payments.accounts.me.queryKey(),
        trpc.payments.accounts.billingSummary.queryKey(),
        trpc.payments.accounts.getAccountingStatus.queryKey(),
        trpc.payments.accounts.getThankYouConfig.queryKey(),
        trpc.payments.integrations.stripe.status.queryKey(),
        trpc.payments.integrations.pipedrive.status.queryKey(),
      ],
      // Client surveys → the reminders list on the dashboard/inbox.
      payment_client_surveys: [trpc.payments.surveys.listReminders.queryKey()],
      // Activity feed → recent activity, dashboard activity, merged timeline.
      payment_activity_log: [
        trpc.payments.accounts.recentActivity.queryKey(),
        trpc.payments.accounts.dashboardActivity.queryKey(),
        trpc.payments.accounts.dashboardActionQueue.queryKey(),
        trpc.payments.analyticsExtra.mergedTimeline.queryKey(),
      ],
      // Chase sequences: definitions + per-proposal runs and the queue.
      payment_sequence_definitions: [trpc.payments.sequences.getDefinition.queryKey()],
      payment_sequence_runs: [
        trpc.payments.sequences.listRunsForProposal.queryKey(),
        trpc.payments.sequences.getRunLog.queryKey(),
        trpc.payments.chase.queue.queryKey(),
      ],
      // Payer-lifecycle events → the lifecycle panel + merged timeline.
      payment_payer_lifecycle_events: [
        trpc.payments.lifecycle.getProposalLifecycle.queryKey(),
        trpc.payments.analyticsExtra.mergedTimeline.queryKey(),
      ],
    };

    // Coalesce a burst of postgres_changes into one invalidation pass (~200 ms):
    // a bulk write triggers a single refetch per query instead of one per row.
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
      topic: 'rt-payments',
      build: () => {
        const channel = supabase.channel('rt-payments');
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
