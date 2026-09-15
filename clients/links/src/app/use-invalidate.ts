/**
 * One place that knows which cached queries a write invalidates.
 *
 * Every screen used to keep its own `invalidate()` helper listing two or three
 * keys by hand, so a query added later (the campaign date preview, a link's own
 * analytics) was simply missing from all of them and its screen kept showing a
 * pre-mutation answer until a remount. The lists below are the ONE definition of
 * "what a link/campaign/billing write can change", so adding a query means
 * touching a single site.
 *
 * This is the write-side twin of `useLinksRealtime` (realtime.ts), which maps the
 * same queries by TABLE for changes made elsewhere — another user, the Stripe
 * webhook, the redirector counting a click. Both are needed: realtime covers
 * writes we didn't make, this covers our own the instant they return, without
 * waiting on a socket that may be reconnecting or gated by RLS. When you add a
 * query here, check whether realtime.ts needs the same key.
 *
 * ─── Use pathFilter(), NEVER queryKey() ──────────────────────────────────────
 * `trpc.x.y.queryKey()` builds `[['x','y'], { type: 'query' }]`, and React Query
 * matches filters by partial deep equality — so that key does NOT match an
 * INFINITE query, whose key carries `{ type: 'infinite' }` instead. Both list
 * screens here are `useInfiniteQuery`, so every `list.queryKey()` invalidation
 * silently matched nothing: deleting, toggling or creating left the list exactly
 * as it was until a full remount. `pathFilter()` keys on the path alone
 * (`[['x','y']]`), matching the plain AND infinite forms of the procedure, which
 * is what "this data changed, refetch it" always means here.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';

/** The shape of a tRPC procedure's `pathFilter()` — a ready React Query filter. */
type PathFilter = { queryKey: readonly unknown[] };

export function useLinksInvalidate() {
  const qc = useQueryClient();
  const trpc = useTRPC();

  const drop = (...filters: PathFilter[]) => {
    for (const filter of filters) qc.invalidateQueries(filter);
  };

  /** Aggregate click/scan analytics + the billable active-link count. */
  const shared = (): PathFilter[] => [
    // Totals and the series both count links, so creating/deleting one moves them.
    trpc.shortLinks.analytics.pathFilter(),
    // entitled/activeCount drive the pay-on-enable gate and the billing screen.
    trpc.shortLinks.entitlement.pathFilter(),
  ];

  return {
    /** A plain link was created, edited, toggled, or deleted. */
    afterLinkChange: () =>
      drop(
        trpc.shortLinks.list.pathFilter(),
        trpc.shortLinks.byId.pathFilter(),
        // The link's own analytics panel on the detail screen.
        trpc.shortLinks.linkAnalytics.pathFilter(),
        ...shared(),
      ),

    /**
     * A campaign, or one of its destination windows, changed. Also refreshes the
     * plain-link queries: campaigns are `short_links` rows (kind='campaign'), so
     * they share the list/entitlement counts.
     */
    afterCampaignChange: () =>
      drop(
        trpc.linkCampaigns.list.pathFilter(),
        trpc.linkCampaigns.byId.pathFilter(),
        // "Preview a date" asks the server what a given instant resolves to —
        // stale the moment a window or the fallback is edited.
        trpc.linkCampaigns.preview.pathFilter(),
        trpc.shortLinks.list.pathFilter(),
        trpc.shortLinks.byId.pathFilter(),
        // A campaign's detail screen shows the same Performance card a link does
        // (link-performance.tsx), reading shortLinks.linkAnalytics for its id.
        trpc.shortLinks.linkAnalytics.pathFilter(),
        ...shared(),
      ),

    /** A subscription started/cancelled/resumed, or the card on file changed. */
    afterBillingChange: () =>
      drop(
        trpc.featureSubscriptions.myForBrand.pathFilter(),
        // Cancelling or resuming issues/voids an invoice, so the history moves too.
        trpc.shortLinks.invoices.pathFilter(),
        trpc.shortLinks.paymentMethod.pathFilter(),
        // A subscription lapsing or starting flips what the lists may enable.
        trpc.shortLinks.list.pathFilter(),
        trpc.linkCampaigns.list.pathFilter(),
        ...shared(),
      ),

    /** The brand itself changed (name, logo, default QR design). */
    afterBrandChange: () =>
      drop(
        trpc.brands.mine.pathFilter(),
        trpc.shortLinks.defaultQrConfig.pathFilter(),
      ),

    /** Staff was invited/removed or had permissions changed. */
    afterTeamChange: () =>
      drop(trpc.staff.list.pathFilter(), trpc.auth.me.pathFilter()),
  };
}
