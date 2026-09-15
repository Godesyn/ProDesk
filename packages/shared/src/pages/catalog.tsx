import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Plus, Search, ArrowUpDown, ListOrdered, Pencil, ChevronDown } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { useIsMobile } from '../hooks/use-is-mobile';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Dialog, DialogTrigger } from '../components/ui/dialog';
import { Select } from './agency/form-bits';
import { CATALOG_SORTS, type CatalogSort } from './agency/constants';
import { catalogGroups, organizedGroups, sortByInfin8 } from './agency/catalog-grouping';
import { ServiceEditorDialog, draftFromService } from './agency/service-editor';
import { PackageEditorDialog } from './agency/package-editor';
import { OrganizeServicesDialog } from './agency/organize-services';
import { CardRail } from '../components/ui/card-rail';
import { ServiceCard } from './marketplace/service-card';
import { PackageCard } from './marketplace/package-card';
import { ServiceDetailDialog } from './marketplace/service-detail-dialog';
import { PackageDetailDialog } from './marketplace/package-detail-dialog';
import type { MarketplaceService } from './marketplace/types';

const LIMIT = 200;

/**
 * Agency catalog — ports `services_screen.dart`. Services and packages render as
 * the SAME marketplace cards the brand sees (stage-grouped rails for the Infin8
 * sort, a responsive grid otherwise). Each card opens the shared service detail
 * dialog (`isFromCatalog`, not purchasable) and carries an Edit action that
 * opens the editor (where Visibility / Delete live).
 */
export function CatalogPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { agencyId, activeAgency } = useActiveContext();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<CatalogSort>('infin8');
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [createPackageOpen, setCreatePackageOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [editingService, setEditingService] = useState<ReturnType<typeof draftFromService> | null>(null);
  const [editingPackage, setEditingPackage] = useState<any | null>(null);
  const [detail, setDetail] = useState<MarketplaceService | null>(null);
  const [detailPackage, setDetailPackage] = useState<{ id: string; agencyName?: string | null } | null>(null);

  const servicesKey = trpc.services.list.queryKey();
  const packagesKey = trpc.packages.list.queryKey();
  const headingsKey = trpc.services.headings.queryKey();
  const services = useQuery({
    ...trpc.services.list.queryOptions({ agencyId: agencyId!, limit: LIMIT, offset: 0, includeInactive: true }),
    enabled: !!agencyId,
  });
  const packages = useQuery({
    ...trpc.packages.list.queryOptions({ agencyId: agencyId!, limit: LIMIT, offset: 0, includeInactive: true }),
    enabled: !!agencyId,
  });
  // Section headings interleave with services in the "Organized" view only.
  const headings = useQuery({
    ...trpc.services.headings.queryOptions({ agencyId: agencyId! }),
    enabled: !!agencyId,
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: servicesKey });
    qc.invalidateQueries({ queryKey: packagesKey });
    qc.invalidateQueries({ queryKey: headingsKey });
  };

  // Attach the agency's own name/logo so the catalog cards + detail dialog match
  // what a brand would see in the marketplace.
  const toMarketplace = (s: any): MarketplaceService => ({
    ...s,
    agencyName: activeAgency?.businessName ?? null,
    agencyLogo: activeAgency?.logoUrl ?? null,
  });

  const serviceRows = services.data?.items ?? [];
  const packageRows = packages.data?.items ?? [];
  const headingRows = headings.data ?? [];

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matched = q
      ? serviceRows.filter(
          (s: any) =>
            s.name?.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q),
        )
      : serviceRows;
    return sortServices(matched, sort);
  }, [serviceRows, search, sort]);

  const filteredPackages = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? packageRows.filter(
          (p: any) =>
            p.name?.toLowerCase().includes(q) || (p.description ?? '').toLowerCase().includes(q),
        )
      : packageRows;
  }, [packageRows, search, sort]);

  const grouped = sort === 'infin8';
  const groups = useMemo(() => (grouped ? catalogGroups(filteredServices) : []), [grouped, filteredServices]);
  const organizedView = sort === 'organized';
  const organized = useMemo(
    () => (organizedView ? organizedGroups(filteredServices, headingRows, !!search.trim()) : []),
    [organizedView, filteredServices, headingRows, search],
  );
  const loading = services.isLoading || packages.isLoading;
  const empty = !loading && filteredServices.length === 0 && filteredPackages.length === 0;

  const editAction = (onClick: () => void) => (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Pencil className="h-3.5 w-3.5" /> Edit
    </Button>
  );

  const renderServiceCard = (s: any, layout: 'grid' | 'square' | 'rail' = 'grid') => {
    const ms = toMarketplace(s);
    return (
      <ServiceCard
        key={s.id}
        service={ms}
        isFromCatalog
        onOpen={() => setDetail(ms)}
        trailingActions={editAction(() => setEditingService(draftFromService(s)))}
        layout={layout}
      />
    );
  };

  const renderPackageCard = (p: any, layout: 'grid' | 'rail' = 'grid') => (
    <PackageCard
      key={p.id}
      pkg={{ ...p, agencyName: activeAgency?.businessName ?? null, agencyLogo: activeAgency?.logoUrl ?? null }}
      onOpen={() => setDetailPackage({ id: p.id, agencyName: activeAgency?.businessName ?? null })}
      trailingActions={editAction(() => setEditingPackage(p))}
      layout={layout}
    />
  );

  return (
    <div>
      <PageHeader title="Catalog" description="Services and packages your agency offers to clients." />

      {/* Controls: search · sort · organize · add package · new service.
          On mobile the search takes its own full-width row (the controls wrap
          below it); on desktop it sits inline at the start of the row as before. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full md:w-auto md:max-w-sm md:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input className="pl-9" placeholder="Search services…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="h-4 w-4 text-ink-40" />
          <Select value={sort} onChange={(v) => setSort(v as CatalogSort)}>
            {CATALOG_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        {sort === 'organized' && (
          <Button variant="ghost" className="max-md:w-10 max-md:px-0" disabled={!agencyId} onClick={() => setOrganizeOpen(true)}>
            <ListOrdered className="h-4 w-4" /> <span className="max-md:hidden">Organize</span>
          </Button>
        )}
        <Dialog open={createPackageOpen} onOpenChange={setCreatePackageOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="max-md:w-10 max-md:px-0" disabled={!agencyId}>
              <Package className="h-4 w-4" /> <span className="max-md:hidden">Add package</span>
            </Button>
          </DialogTrigger>
          {agencyId && createPackageOpen && (
            <PackageEditorDialog agencyId={agencyId} onDone={() => { setCreatePackageOpen(false); invalidate(); }} />
          )}
        </Dialog>
        <Dialog open={createServiceOpen} onOpenChange={setCreateServiceOpen}>
          <DialogTrigger asChild>
            <Button variant="accent" className="max-md:w-10 max-md:px-0" disabled={!agencyId}>
              <Plus className="h-4 w-4" /> <span className="max-md:hidden">New service</span>
            </Button>
          </DialogTrigger>
          {agencyId && createServiceOpen && (
            <ServiceEditorDialog agencyId={agencyId} onDone={() => { setCreateServiceOpen(false); invalidate(); }} />
          )}
        </Dialog>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] w-full" />)}
        </div>
      ) : empty ? (
        <EmptyState icon={Package} title="No catalog items yet" description="Create your first service or package to start selling." />
      ) : (
        <div className="space-y-4 md:space-y-8">
          {/* Packages rail (mirrors the marketplace "Featured Packages"). */}
          {filteredPackages.length > 0 && (
            <section>
              <SectionHeading title="Packages" />
              <CardRail>{filteredPackages.map((p) => renderPackageCard(p, 'rail'))}</CardRail>
            </section>
          )}

          {/* Services: stage-grouped rails for Infin8, heading-split sections for
              Organized, a flat grid for every other sort. On mobile each titled
              section is a collapsible accordion (mirrors the marketplace stage
              accordions) so the catalog is scannable instead of one long scroll;
              desktop keeps the always-expanded heading + rail. */}
          {grouped ? (
            groups.map((g) => (
              <CatalogSection key={g.heading} title={g.heading} count={g.items.length}>
                <CardRail>{g.items.map((s) => renderServiceCard(s, 'rail'))}</CardRail>
              </CatalogSection>
            ))
          ) : organizedView ? (
            organized.map((g, i) => (
              <CatalogSection key={g.heading ?? `lead-${i}`} title={g.heading} count={g.items.length}>
                <CardRail>{g.items.map((s) => renderServiceCard(s, 'rail'))}</CardRail>
              </CatalogSection>
            ))
          ) : filteredServices.length > 0 ? (
            <section>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {filteredServices.map((s) => renderServiceCard(s, 'square'))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {/* Detail preview (catalog: not purchasable, exposes the copy-prompt action). */}
      {detail && (
        <ServiceDetailDialog
          service={detail}
          open={!!detail}
          onOpenChange={(v) => !v && setDetail(null)}
          purchasable={false}
          isFromCatalog
        />
      )}
      {detailPackage && (
        <PackageDetailDialog
          packageId={detailPackage.id}
          agencyName={detailPackage.agencyName}
          open={!!detailPackage}
          onOpenChange={(v) => !v && setDetailPackage(null)}
          purchasable={false}
          isFromCatalog
        />
      )}

      {/* Editors / organize. */}
      <Dialog open={!!editingService} onOpenChange={(o) => !o && setEditingService(null)}>
        {editingService && agencyId && (
          <ServiceEditorDialog agencyId={agencyId} initial={editingService} onDone={() => { setEditingService(null); invalidate(); }} />
        )}
      </Dialog>
      <Dialog open={!!editingPackage} onOpenChange={(o) => !o && setEditingPackage(null)}>
        {editingPackage && agencyId && (
          <PackageEditorDialog agencyId={agencyId} initial={editingPackage} onDone={() => { setEditingPackage(null); invalidate(); }} />
        )}
      </Dialog>
      <Dialog open={organizeOpen} onOpenChange={setOrganizeOpen}>
        {organizeOpen && agencyId && (
          <OrganizeServicesDialog agencyId={agencyId} services={serviceRows} onDone={() => { setOrganizeOpen(false); invalidate(); }} />
        )}
      </Dialog>
    </div>
  );
}

/* ── Layout bits ────────────────────────────────────────────────────────────── */

function SectionHeading({ title }: { title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="h-6 w-1 rounded bg-ink-100" />
      <h3 className="text-lg font-bold text-ink-100">{title}</h3>
    </div>
  );
}

/**
 * A catalog services group. On desktop it's the always-expanded
 * `SectionHeading` + rail (unchanged). On mobile it becomes a collapsible
 * accordion (title · count · chevron, collapsed by default) — a 1:1 match for
 * the marketplace stage accordions, so the catalog is scannable on a phone
 * instead of an endless scroll of expanded rails. An untitled group (the
 * organized view's leading section) renders its cards directly, no accordion.
 */
function CatalogSection({ title, count, children }: { title: string | null; count: number; children: ReactNode }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (!isMobile) {
    return (
      <section>
        {title != null && <SectionHeading title={title} />}
        {children}
      </section>
    );
  }

  if (title == null) return <section>{children}</section>;

  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 p-4 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1 truncate text-base font-bold text-ink-100">{title}</span>
        <Badge variant="muted" className="shrink-0">{count}</Badge>
        <ChevronDown className={`h-5 w-5 shrink-0 text-ink-40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-[color:var(--color-border-hairline)] p-4">{children}</div>}
    </div>
  );
}

/* ── Sort / grouping helpers (port services_screen.dart sort modes) ──────────── */

function sortServices(rows: any[], sort: CatalogSort): any[] {
  const arr = [...rows];
  const price = (s: any) => Number(s.price ?? s.upfrontFee ?? 0);
  switch (sort) {
    case 'organized':
      return arr.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    case 'newest':
      return arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case 'oldest':
      return arr.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    case 'nameAsc':
      return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'nameDesc':
      return arr.sort((a, b) => b.name.localeCompare(a.name));
    case 'priceAsc':
      return arr.sort((a, b) => price(a) - price(b));
    case 'priceDesc':
      return arr.sort((a, b) => price(b) - price(a));
    case 'infin8':
    default:
      // Stage order → sub-stage (alpha) → custom sort order.
      return sortByInfin8(arr);
  }
}
