import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Check, Search, Package as PackageIcon, Sparkles } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { formatCurrency } from '../../lib/utils';
import { Input } from '../../components/ui/input';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { isBillingCycleWeekly, type ServiceType } from '@server/lib/service-type';
import { catalogGroups, organizedGroups, sortByInfin8, type CatalogGroup } from '../agency/catalog-grouping';
import type { MarketplaceService } from '../marketplace/types';

type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  type: ServiceType;
  price: string | null;
  upfrontFee: string | null;
  recurringFee: string | null;
  agencyId?: string;
  agencyName?: string | null;
  // Drives the Infin8 / custom-order grouping.
  stage?: string | null;
  subStage?: string | null;
  sortOrder?: number | null;
};
type PackageRow = { id: string; name: string; description: string | null; agencyName?: string | null };

export interface AddServicePayload {
  serviceId: string;
  description: string;
  amount: number;
  isRecurring: boolean;
  billingCycle?: string;
  upfrontFee?: number;
  serviceType: ServiceType;
  // Sales/inter-agency mode: the service's owning agency (tags the line item).
  agencyId?: string;
  agencyName?: string | null;
  /**
   * The full service row, so callers can detect options / add-ons and open the
   * configuration dialog before adding (mirrors the Flutter proposal catalog).
   */
  service: MarketplaceService;
}

interface Props {
  agencyId: string;
  /** Sales/inter-agency mode: browse services across ALL agencies, not just one. */
  salesMode?: boolean;
  /**
   * Services-only mode (package builder): hide the packages tab + custom-item
   * action and show all of the agency's services (active or not), matching the
   * Flutter `ServicesCatalogWidget` the package dialog reuses.
   */
  servicesOnly?: boolean;
  addedServiceIds: Set<string>;
  onAddService: (p: AddServicePayload) => void;
  onAddPackage?: (packageId: string) => void;
  onAddCustom?: () => void;
}

/** Left-pane catalog: agency services + packages, with sort tabs and added badges. */
export function CatalogPanel({ agencyId, salesMode, servicesOnly, addedServiceIds, onAddService, onAddPackage, onAddCustom }: Props) {
  const trpc = useTRPC();
  const [tab, setTab] = useState<'services' | 'packages'>('services');
  // Service ordering, mirroring the catalog page: Infin8 stage grouping (default)
  // or the agency's custom section-heading order.
  const [order, setOrder] = useState<'infin8' | 'custom'>('infin8');
  const [search, setSearch] = useState('');
  // Packages are addable in every mode; sales mode pulls them across agencies so a
  // sales proposal can bundle other agencies' packages (each item stays priced by
  // its owning agency). Only the package-builder's services-only view hides them.
  const showPackages = !servicesOnly;
  // Custom order is keyed off THIS agency's section headings, so it only applies in
  // single-agency mode — cross-agency sales mode always groups by Infin8 stage.
  const showOrderToggle = tab === 'services' && !salesMode;

  // Sales mode browses every verified agency's catalogue (marketplace.browse +
  // marketplace.packages); normal mode lists the building agency's own catalogue.
  const services = useQuery({ ...trpc.services.list.queryOptions({ agencyId, limit: 100, offset: 0, search: search || undefined, includeInactive: servicesOnly }), enabled: !salesMode });
  const browse = useQuery({ ...trpc.marketplace.browse.queryOptions({ limit: 200, offset: 0, search: search || undefined }), enabled: !!salesMode });
  const packages = useQuery({ ...trpc.packages.list.queryOptions({ agencyId, limit: 100, offset: 0, search: search || undefined }), enabled: showPackages && !salesMode });
  const salesPackages = useQuery({ ...trpc.marketplace.packages.queryOptions({ search: search || undefined, limit: 200 }), enabled: showPackages && !!salesMode });
  // Section headings drive the "Custom order" grouping (own-agency catalogue only).
  const headings = useQuery({ ...trpc.services.headings.queryOptions({ agencyId }), enabled: !salesMode && order === 'custom' });

  const svcRows = (salesMode ? browse.data?.items : services.data?.items) as ServiceRow[] | undefined ?? [];
  const pkgRows = (salesMode ? salesPackages.data : packages.data?.items) as PackageRow[] | undefined ?? [];
  const svcLoading = salesMode ? browse.isLoading : services.isLoading;
  const pkgLoading = salesMode ? salesPackages.isLoading : packages.isLoading;

  // Group the service list: custom section-heading order (own agency only) or the
  // Infin8 stage → sub-stage grouping (default, and the only option in sales mode).
  const svcGroups = useMemo<CatalogGroup<ServiceRow>[]>(() => {
    if (order === 'custom' && !salesMode) {
      const sorted = [...svcRows].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return organizedGroups(sorted, (headings.data ?? []) as { text: string; sortOrder?: number | null }[], !!search.trim());
    }
    return catalogGroups(sortByInfin8(svcRows));
  }, [svcRows, order, salesMode, headings.data, search]);

  const serviceTile = (s: ServiceRow) => {
    const weekly = isBillingCycleWeekly(s.type);
    const amount = weekly ? Number(s.recurringFee ?? 0) : Number(s.price ?? 0);
    const upfront = Number(s.upfrontFee ?? 0);
    const added = addedServiceIds.has(s.id);
    // Price line (ports `CatalogServiceTile`): weekly → "$x / Weekly", else price; "+$y setup" when upfront > 0.
    const priceLine = [
      weekly ? `${formatCurrency(amount)} / Weekly` : formatCurrency(amount),
      upfront > 0 ? `+${formatCurrency(upfront)} setup` : '',
    ].filter(Boolean).join(' ');
    return (
      // The name wraps to 2 full-width lines on top; the subtitles (agency + price)
      // share their row with a compact icon-only Add button on the right.
      <div key={s.id} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-2">
        <div className="text-sm font-medium leading-snug text-ink-100 line-clamp-2">{s.name}</div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <div className="min-w-0">
            {salesMode && s.agencyName && <div className="truncate text-[11px] leading-snug text-ink-40">{s.agencyName}</div>}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs tabular-nums text-ink-60">{priceLine}</span>
              {weekly && <Badge variant="accent">Weekly</Badge>}
            </div>
          </div>
          <Button
            size="icon"
            variant={added ? 'ghost' : 'outline'}
            disabled={added}
            className="h-7 w-7 shrink-0"
            title={added ? 'Added' : 'Add'}
            onClick={() =>
              onAddService({
                serviceId: s.id,
                description: s.description ?? s.name,
                amount,
                isRecurring: weekly,
                billingCycle: weekly ? 'Weekly' : undefined,
                upfrontFee: weekly ? Number(s.upfrontFee ?? 0) : undefined,
                serviceType: s.type,
                agencyId: s.agencyId,
                agencyName: s.agencyName,
                // Rows from services.list / marketplace.browse are full
                // service rows at runtime (incl. options / variants / add-ons).
                service: s as unknown as MarketplaceService,
              })
            }
          >
            {added ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    );
  };

  const segBtn = (active: boolean) =>
    `flex-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11px] font-medium transition-colors ${active ? 'bg-accent/10 text-accent' : 'text-ink-60 hover:text-ink-100'}`;

  return (
    <div className="flex h-full flex-col gap-2">
      {servicesOnly ? (
        <div className="text-[12px] font-bold uppercase tracking-[0.2px] text-ink-60">Catalog</div>
      ) : (
        <div className="flex gap-1.5">
          <button
            onClick={() => setTab('services')}
            className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium ${tab === 'services' ? 'bg-accent text-white' : 'bg-inset text-ink-60'}`}
          >
            {salesMode ? 'All agencies' : 'Services'}
          </button>
          {showPackages && (
            <button
              onClick={() => setTab('packages')}
              className={`flex-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium ${tab === 'packages' ? 'bg-accent text-white' : 'bg-inset text-ink-60'}`}
            >
              Packages
            </button>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-ink-40" />
        <Input className="pl-8" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Service ordering tab bar (ports the catalog page's Infin8 / Custom order). */}
      {showOrderToggle && (
        <div className="flex gap-1.5 rounded-[var(--radius-sm)] bg-inset p-0.5">
          <button onClick={() => setOrder('infin8')} className={segBtn(order === 'infin8')}>Infin8 stages</button>
          <button onClick={() => setOrder('custom')} className={segBtn(order === 'custom')}>Custom order</button>
        </div>
      )}

      {onAddCustom && !servicesOnly && (
        <Button variant="outline" size="sm" onClick={onAddCustom}>
          <Sparkles className="h-4 w-4" /> Custom item
        </Button>
      )}

      <div className="-mr-1 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {tab === 'services' ? (
          svcLoading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : svcRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-40">No services.</p>
          ) : (
            svcGroups.map((g, i) => (
              <div key={g.heading ?? `lead-${i}`} className="space-y-1.5">
                {g.heading && (
                  <div className="px-0.5 pt-1 text-[11px] font-bold uppercase tracking-[0.2px] text-ink-40">{g.heading}</div>
                )}
                {g.items.map(serviceTile)}
              </div>
            ))
          )
        ) : pkgLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
        ) : pkgRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-40">No packages.</p>
        ) : (
          pkgRows.map((p) => (
            <div key={p.id} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-2">
              <div className="flex items-start gap-2">
                <PackageIcon className="mt-0.5 h-4 w-4 shrink-0 text-ink-40" />
                <div className="text-sm font-medium leading-snug text-ink-100 line-clamp-2">{p.name}</div>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  {salesMode && p.agencyName && <div className="truncate text-[11px] leading-snug text-ink-40">{p.agencyName}</div>}
                </div>
                <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" title="Add" onClick={() => onAddPackage?.(p.id)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
