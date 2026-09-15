import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Search, ShoppingCart, Heart, Receipt, Store, ChevronDown, BadgeCheck, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { reserveNewTab } from '../lib/redirect';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { CardRail } from '../components/ui/card-rail';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Popover } from '../components/ui/popover';
import { CartProvider, useCart } from './marketplace/cart-store';
import { SortSelect, type SortKey } from './marketplace/sort-select';
import { ServiceCard } from './marketplace/service-card';
import { PackageCard } from './marketplace/package-card';
import { CartDrawer } from './marketplace/cart-drawer';
import { ServiceDetailDialog } from './marketplace/service-detail-dialog';
import { PackageDetailDialog } from './marketplace/package-detail-dialog';
import { OrderHistory } from './marketplace/order-history';
import type { MarketplaceService } from './marketplace/types';

type View = 'services' | 'favourites' | 'orders';

export function MarketplacePage() {
  const { brandId } = useActiveContext();
  return (
    <CartProvider brandId={brandId}>
      <MarketplaceInner brandId={brandId} />
    </CartProvider>
  );
}

function MarketplaceInner({ brandId }: { brandId: string | null }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const cart = useCart();

  const [view, setView] = useState<View>('services');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('custom');
  const [discipline, setDiscipline] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<MarketplaceService | null>(null);
  const [detailPackage, setDetailPackage] = useState<{ id: string; agencyName?: string | null } | null>(null);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  const list = useQuery(
    trpc.marketplace.browse.queryOptions({
      limit: 200,
      offset: 0,
      search: search || undefined,
      discipline: discipline || undefined,
      sort,
      brandId: brandId ?? undefined,
    }),
  );
  const packages = useQuery(trpc.marketplace.packages.queryOptions({ limit: 12 }));
  const disciplines = useQuery(trpc.marketplace.disciplines.queryOptions());

  // Adding to the cart pops the drawer open (mirrors the auto-opening cart
  // panel in marketplace_cart_panel.dart).
  const quickAdd = (s: MarketplaceService) => {
    cart.add({ service: s });
    toast.success('Added to cart');
    setCartOpen(true);
  };
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

  const buyNow = useMutation({
    ...trpc.purchases.checkoutServices.mutationOptions(),
    onError: (e) => toastError(e),
  });

  const stages = (list.data?.stages ?? []) as unknown as StageGroup[];
  const flat = (list.data?.items ?? []) as unknown as MarketplaceService[];

  const onToggleFav = (serviceId: string) => {
    if (!brandId) return toast.error('Select a brand to save favourites');
    toggleFav.mutate({ brandId, serviceId });
  };

  const toggleStage = (stage: string) =>
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const showFilters = view === 'services';
  // Search now lives in its own visible field; the popover dot reflects only the
  // filters that remain inside it (discipline / sort).
  const filtersActive = !!discipline || (view === 'services' && sort !== 'custom');

  return (
    <div>
      <PageHeader
        title="infin8 Marketplace"
        description="Incubate, create and accelerate your business along the infin8 framework."
        action={
          showFilters ? (
            <Popover
              align="end"
              className="w-[18rem]"
              trigger={({ open, toggle }) => (
                <Button variant="outline" size="sm" onClick={toggle} aria-expanded={open} className="relative">
                  <SlidersHorizontal className="h-4 w-4" /> Filters
                  {filtersActive && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent" />}
                </Button>
              )}
            >
              {(close) => (
                <div className="flex flex-col gap-3">
                  {view === 'services' && (
                    <>
                      <div>
                        <Label className="mb-1.5 block text-xs text-ink-60">Discipline</Label>
                        <select
                          aria-label="Filter by discipline"
                          className="w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-2.5 py-2 text-sm text-ink-80"
                          value={discipline}
                          onChange={(e) => setDiscipline(e.target.value)}
                        >
                          <option value="">All disciplines</option>
                          {(disciplines.data ?? []).map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <Label className="mb-1.5 block text-xs text-ink-60">Sort</Label>
                        <SortSelect value={sort} onChange={setSort} />
                      </div>
                    </>
                  )}

                  {brandId && (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => { close(); setInviteOpen(true); }}>
                      <Store className="h-4 w-4" /> Invite Agency
                    </Button>
                  )}
                </div>
              )}
            </Popover>
          ) : undefined
        }
      />

      {/* View chips + cart button */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ViewChip active={view === 'services'} onClick={() => setView('services')} icon={Store}>Services</ViewChip>
        <ViewChip active={view === 'favourites'} onClick={() => setView('favourites')} icon={Heart}>
          Favourites{favSet.size > 0 ? ` (${favSet.size})` : ''}
        </ViewChip>
        <ViewChip active={view === 'orders'} onClick={() => setView('orders')} icon={Receipt}>Order history</ViewChip>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => setCartOpen(true)} className="relative">
            <ShoppingCart className="mr-1.5 h-4 w-4" /> Cart
            {cart.count > 0 && (
              <span className="ml-1.5 rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{cart.count}</span>
            )}
          </Button>
        </div>
      </div>

      {/* Always-visible search (mobile + desktop) — discipline/sort stay in the
          Filters popover; search is primary so it gets its own full-width field. */}
      {showFilters && (
        <div className="relative mb-4 max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input className="pl-9" placeholder="Search services, agencies…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      <InviteAgencyDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      {view === 'services' && (
        <ServicesView
          loading={list.isLoading}
          stages={stages}
          flat={flat}
          packages={packages.data ?? []}
          expandedStages={expandedStages}
          onToggleStage={toggleStage}
          favSet={favSet}
          onOpen={setDetail}
          onOpenPackage={(p) => setDetailPackage(p)}
          onToggleFav={onToggleFav}
          searching={!!search}
          onQuickAdd={quickAdd}
        />
      )}

      {view === 'favourites' && (
        <FavouritesView brandId={brandId} favSet={favSet} onOpen={setDetail} onToggleFav={onToggleFav} onQuickAdd={quickAdd} />
      )}

      {view === 'orders' && <OrderHistory brandId={brandId} />}

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

type StageGroup = { stage: string; count: number; subStages: { subStage: string; services: MarketplaceService[] }[] };

function ServicesView({
  loading,
  stages,
  flat,
  packages,
  expandedStages,
  onToggleStage,
  favSet,
  onOpen,
  onOpenPackage,
  onToggleFav,
  onQuickAdd,
  searching,
}: {
  loading: boolean;
  stages: StageGroup[];
  flat: MarketplaceService[];
  packages: Parameters<typeof PackageCard>[0]['pkg'][];
  expandedStages: Set<string>;
  onToggleStage: (s: string) => void;
  favSet: Set<string>;
  onOpen: (s: MarketplaceService) => void;
  onOpenPackage: (p: { id: string; agencyName?: string | null }) => void;
  onToggleFav: (id: string) => void;
  onQuickAdd: (s: MarketplaceService) => void;
  searching: boolean;
}) {
  if (loading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}</div>;
  if (!flat.length) return <EmptyState icon={ShoppingBag} title="Nothing found" description="Try a different search or filter." />;

  // While searching, show a flat result grid; otherwise the stage-grouped IA.
  if (searching) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {flat.map((s) => (
          <ServiceCard key={s.id} service={s} isFavourite={favSet.has(s.id)} onOpen={() => onOpen(s)} onToggleFavourite={() => onToggleFav(s.id)} onQuickAdd={() => onQuickAdd(s)} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Featured packages rail */}
      {packages.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-4 w-1 rounded bg-gradient-to-b from-purple-500 to-purple-800" />
            <h3 className="font-semibold text-ink-100">Featured Packages</h3>
          </div>
          <CardRail>
            {packages.map((p) => (
              <PackageCard key={p.id} pkg={p} onOpen={() => onOpenPackage(p)} layout="rail" />
            ))}
          </CardRail>
        </div>
      )}

      {stages.map((st) => {
        const open = expandedStages.has(st.stage);
        return (
          <div key={st.stage} className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card shadow-sm">
            <button type="button" onClick={() => onToggleStage(st.stage)} className="flex w-full items-center gap-2 p-4 text-left md:gap-3 md:p-5">
              <span className="min-w-0 flex-1 truncate text-base font-bold text-ink-100 md:text-lg">{st.stage}</span>
              <Badge variant="muted" className="shrink-0">{st.count}<span className="hidden sm:inline">&nbsp;Services</span></Badge>
              <ChevronDown className={`h-5 w-5 shrink-0 text-ink-40 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <div className="border-t border-[color:var(--color-border-hairline)]">
                {st.subStages.map((sub) => (
                  <div key={sub.subStage} className="p-4">
                    <div className="mb-2 border-l-2 border-ink-100 pl-3 text-sm font-semibold text-ink-100">{sub.subStage}</div>
                    <CardRail>
                      {sub.services.map((s) => (
                        <ServiceCard key={s.id} service={s} isFavourite={favSet.has(s.id)} onOpen={() => onOpen(s)} onToggleFavourite={() => onToggleFav(s.id)} onQuickAdd={() => onQuickAdd(s)} layout="rail" />
                      ))}
                    </CardRail>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Invite a prospective agency to the platform by email — ports
 * invite_agency_dialog.dart (calls auth.sendAgencyInvite). Shows a success state
 * once the invitation email is enqueued.
 */
function InviteAgencyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const trpc = useTRPC();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const invite = useMutation({
    ...trpc.auth.sendAgencyInvite.mutationOptions(),
    onSuccess: () => setSent(true),
    onError: (e) => toastError(e),
  });
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) { setSent(false); setEmail(''); }
  };
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Store className="h-4 w-4" /> Invite an Agency</DialogTitle>
        </DialogHeader>
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success"><BadgeCheck className="h-6 w-6" /></div>
            <p className="text-sm text-ink-80">An invitation email has been sent to<br /><span className="font-medium text-ink-100">{email.trim()}</span></p>
            <Button variant="accent" onClick={() => close(false)}>Done</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-ink-60">Send a personal invitation via email to invite an agency to join the platform.</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-agency-email">Agency email</Label>
              <Input id="invite-agency-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="agency@example.com" />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button variant="accent" disabled={!valid || invite.isPending} onClick={() => invite.mutate({ email: email.trim() })}>
                {invite.isPending ? 'Sending…' : 'Send Invitation'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FavouritesView({
  brandId,
  favSet,
  onOpen,
  onToggleFav,
  onQuickAdd,
}: {
  brandId: string | null;
  favSet: Set<string>;
  onOpen: (s: MarketplaceService) => void;
  onToggleFav: (id: string) => void;
  onQuickAdd: (s: MarketplaceService) => void;
}) {
  const trpc = useTRPC();
  const list = useQuery({ ...trpc.marketplace.favouriteServices.queryOptions({ brandId: brandId! }), enabled: !!brandId });
  if (!brandId) return <EmptyState icon={Heart} title="No brand selected" description="Switch to a brand to save favourites." />;
  if (list.isLoading) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-56 w-full" />)}</div>;
  const services = (list.data ?? []) as MarketplaceService[];
  if (!services.length) return <EmptyState icon={Heart} title="No favourites yet" description="Tap the heart on a service to save it." />;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {services.map((s) => (
        <ServiceCard
          key={s.id}
          service={s}
          isFavourite={favSet.has(s.id)}
          onOpen={() => onOpen(s)}
          onToggleFavourite={() => onToggleFav(s.id)}
          onQuickAdd={() => onQuickAdd(s)}
        />
      ))}
    </div>
  );
}

function ViewChip({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Store; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${active ? 'border-ink-100 bg-ink-100 text-paper' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset'}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
