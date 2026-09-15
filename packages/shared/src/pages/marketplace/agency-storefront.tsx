import { useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, ShoppingBag, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { initialsOf } from '../../lib/utils';
import { reserveNewTab } from '../../lib/redirect';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { CardRail } from '../../components/ui/card-rail';
import { CartProvider, useCart } from './cart-store';
import { ServiceCard } from './service-card';
import { PackageCard } from './package-card';
import { PackageDetailDialog } from './package-detail-dialog';
import { CartDrawer } from './cart-drawer';
import { ServiceDetailDialog } from './service-detail-dialog';
import { AgencyVerifiedBadge } from '../../components/agency-verified-badge';
import { SortSelect, type SortKey } from './sort-select';
import type { MarketplaceService } from './types';

/**
 * Single-agency storefront — the drill-down from an agency card in the
 * marketplace "Agencies" view. Ports `MarketplaceAgencyServicesScreen`:
 * the agency's own searchable + sortable service grid plus its featured
 * packages, with the shared cart + service-detail dialog.
 */
export function AgencyStorefrontPage() {
  const [, params] = useRoute('/marketplace/agency/:agencyId');
  const { brandId } = useActiveContext();
  const agencyId = params?.agencyId ?? '';
  return (
    <CartProvider brandId={brandId}>
      <Inner agencyId={agencyId} brandId={brandId} />
    </CartProvider>
  );
}

function Inner({ agencyId, brandId }: { agencyId: string; brandId: string | null }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const cart = useCart();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('custom');
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<MarketplaceService | null>(null);
  const [detailPackage, setDetailPackage] = useState<{ id: string; agencyName?: string | null } | null>(null);

  const list = useQuery(
    trpc.marketplace.browse.queryOptions({ limit: 200, offset: 0, agencyId, search: search || undefined, sort }),
  );
  const packages = useQuery(trpc.marketplace.packages.queryOptions({ agencyId, limit: 24 }));
  const favourites = useQuery({ ...trpc.marketplace.favourites.queryOptions({ brandId: brandId! }), enabled: !!brandId });
  const favSet = useMemo(() => new Set(favourites.data ?? []), [favourites.data]);

  const toggleFav = useMutation({
    ...trpc.marketplace.toggleFavourite.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.marketplace.favourites.queryKey({ brandId: brandId! }) });
      qc.invalidateQueries({ queryKey: trpc.marketplace.favouriteServices.queryKey({ brandId: brandId! }) });
    },
    onError: (e) => toastError(e),
  });
  const onToggleFav = (serviceId: string) => {
    if (!brandId) return toast.error('Select a brand to save favourites');
    toggleFav.mutate({ brandId, serviceId });
  };

  const buyNow = useMutation({
    ...trpc.purchases.checkoutServices.mutationOptions(),
    onError: (e) => toastError(e),
  });

  const items = (list.data?.items ?? []) as unknown as MarketplaceService[];
  // The agency name/logo come off the rows the storefront already loaded.
  const agencyName = items[0]?.agencyName ?? (packages.data?.[0] as { agencyName?: string } | undefined)?.agencyName ?? 'Agency';
  const agencyLogo = items[0]?.agencyLogo ?? (packages.data?.[0] as { agencyLogo?: string } | undefined)?.agencyLogo ?? null;

  const onQuickAdd = (s: MarketplaceService) => {
    cart.add({ service: s });
    toast.success('Added to cart');
    setCartOpen(true);
  };

  return (
    <div>
      <button onClick={() => history.back()} className="mb-4 flex items-center gap-1 text-sm text-ink-60 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </button>

      <div className="mb-2 flex items-center gap-2">
        <Avatar className="h-9 w-9">
          {agencyLogo && <AvatarImage src={agencyLogo} />}
          <AvatarFallback className="text-xs">{initialsOf(agencyName)}</AvatarFallback>
        </Avatar>
        <AgencyVerifiedBadge platformVerified={items[0]?.isPlatformVerifiedAgency} />
      </div>
      <PageHeader
        title={agencyName}
        description="Browse this agency's services and packages."
        action={
          <Button variant="outline" size="sm" onClick={() => setCartOpen(true)} className="relative">
            <ShoppingCart className="mr-1.5 h-4 w-4" /> Cart
            {cart.count > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{cart.count}</span>}
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 md:gap-3">
        <div className="relative w-full md:max-w-sm md:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input className="pl-9" placeholder="Search this agency…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <SortSelect value={sort} onChange={setSort} />
      </div>

      {/* Featured packages rail */}
      {(packages.data?.length ?? 0) > 0 && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-4 w-1 rounded bg-gradient-to-b from-purple-500 to-purple-800" />
            <h3 className="font-semibold text-ink-100">Featured Packages</h3>
          </div>
          <CardRail>
            {packages.data!.map((p) => (
              <PackageCard key={p.id} pkg={p} onOpen={() => setDetailPackage(p)} layout="rail" />
            ))}
          </CardRail>
        </div>
      )}

      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}</div>
      ) : !items.length ? (
        <EmptyState icon={ShoppingBag} title="No services" description="This agency has no buyable services yet." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <ServiceCard key={s.id} service={s} isFavourite={favSet.has(s.id)} onOpen={() => setDetail(s)} onToggleFavourite={() => onToggleFav(s.id)} onQuickAdd={() => onQuickAdd(s)} />
          ))}
        </div>
      )}

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />

      {detail && (
        <ServiceDetailDialog
          service={detail}
          open={!!detail}
          onOpenChange={(v) => !v && setDetail(null)}
          onBuyNow={(line) => {
            if (!brandId) return toast.error('Select a brand to buy');
            const tab = reserveNewTab();
            buyNow.mutate(
              { brandId, items: [line], successUrl: `${window.location.origin}/payment-success`, cancelUrl: `${window.location.origin}/payment-cancel` },
              {
                onSuccess: (res) => {
                  if (res.checkoutUrl) tab.go(res.checkoutUrl);
                  else { tab.cancel(); navigate(`/payment-success?purchaseId=${res.purchaseId}`); }
                },
                onError: () => tab.cancel(),
              },
            );
          }}
        />
      )}

      {detailPackage && (
        <PackageDetailDialog
          packageId={detailPackage.id}
          agencyName={detailPackage.agencyName}
          open={!!detailPackage}
          onOpenChange={(v) => !v && setDetailPackage(null)}
          onBuyNow={(lines) => {
            if (!brandId) return toast.error('Select a brand to buy');
            const tab = reserveNewTab();
            buyNow.mutate(
              { brandId, items: lines, successUrl: `${window.location.origin}/payment-success`, cancelUrl: `${window.location.origin}/payment-cancel` },
              {
                onSuccess: (res) => {
                  if (res.checkoutUrl) tab.go(res.checkoutUrl);
                  else { tab.cancel(); navigate(`/payment-success?purchaseId=${res.purchaseId}`); }
                },
                onError: () => tab.cancel(),
              },
            );
          }}
        />
      )}
    </div>
  );
}
