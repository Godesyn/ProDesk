import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Building2, ExternalLink, Search } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { formatDate } from '../../lib/utils';
import { AgencyProfileView } from '../../components/profile-views';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Select, Chip } from '../agency/form-bits';

const LIMIT = 12;
const CATEGORIES = ['Templates', 'White Papers', 'Checklists', 'Guides', 'Legal', 'Financial', 'Marketing', 'Operations', 'AI Prompts'];
type SortOpt = 'newest' | 'oldest' | 'az' | 'za';

/** Brand Resources & Templates browse — global + connected-agency resources. Ports resources_templates_screen.dart. */
export function BrandResourcesPage() {
  const trpc = useTRPC();
  const { brandId } = useActiveContext();
  const { openFile } = useFileViewer();
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOpt>('newest');
  const [cats, setCats] = useState<string[]>([]);
  const [agencyView, setAgencyView] = useState<string | null>(null);

  const list = useQuery({ ...trpc.resources.brandList.queryOptions({ brandId: brandId!, search: search || undefined, limit: LIMIT, offset }), enabled: !!brandId });

  const rows = useMemo(() => {
    let r = list.data?.items ?? [];
    if (cats.length) r = r.filter((x) => (x.categories ?? []).some((c) => cats.includes(c)));
    return [...r].sort((a, b) => {
      if (sort === 'az') return a.title.localeCompare(b.title);
      if (sort === 'za') return b.title.localeCompare(a.title);
      const da = new Date(a.uploadedAt).getTime(), db = new Date(b.uploadedAt).getTime();
      return sort === 'oldest' ? da - db : db - da;
    });
  }, [list.data, cats, sort]);

  const toggleCat = (c: string) => setCats((x) => (x.includes(c) ? x.filter((v) => v !== c) : [...x, c]));

  return (
    <div>
      <PageHeader title="Resources & Templates" description="Curated documents, templates and guides from the platform and your agencies." />

      {/* Search + sort share one row on mobile (no wrap); search flexes, select stays. */}
      <div className="mb-4 flex items-center gap-3 md:flex-wrap">
        <div className="relative flex-1 min-w-0 md:min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input className="pl-9" placeholder="Search resources…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
        </div>
        <Select className="shrink-0" value={sort} onChange={(v) => setSort(v as SortOpt)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="az">Title A–Z</option>
          <option value="za">Title Z–A</option>
        </Select>
      </div>

      {/* Category chips: single horizontally-scrollable strip on mobile; wraps on desktop. */}
      <div className="mb-4 flex gap-2 overflow-x-auto md:flex-wrap">
        <Chip className="shrink-0 md:shrink" active={cats.length === 0} onClick={() => setCats([])}>All</Chip>
        {CATEGORIES.map((c) => <Chip key={c} className="shrink-0 md:shrink" active={cats.includes(c)} onClick={() => toggleCat(c)}>{c}</Chip>)}
      </div>

      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No resources found" description="Try a different search or category." />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const href = r.linkUrl ?? r.url;
              return (
                <Card key={r.id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-ink-100">{r.title}</div>
                    {r.agencyId ? (
                      <button
                        type="button"
                        onClick={() => setAgencyView(r.agencyId!)}
                        title={`View ${r.agencyName ?? 'agency'}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
                      >
                        <Building2 className="h-3 w-3" />
                        <span className="max-w-[120px] truncate">{r.agencyName ?? 'Agency'}</span>
                      </button>
                    ) : (
                      <Badge variant="muted">Platform</Badge>
                    )}
                  </div>
                  {r.description && <p className="line-clamp-3 text-sm text-ink-60">{r.description}</p>}
                  {(r.categories ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">{r.categories!.slice(0, 3).map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</div>
                  )}
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-xs text-ink-40">{formatDate(r.uploadedAt)}</span>
                    {href && (
                      <Button size="sm" variant="outline" onClick={() => openFile({ url: href, title: r.title })}><ExternalLink className="h-4 w-4" /> Open</Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-4"><Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} /></div>
        </>
      )}

      <Dialog open={!!agencyView} onOpenChange={(o) => !o && setAgencyView(null)}>
        {agencyView && <AgencyInfoDialog agencyId={agencyView} />}
      </Dialog>
    </div>
  );
}

/** Agency info screen for the uploading agency — opened from a resource's agency chip. */
function AgencyInfoDialog({ agencyId }: { agencyId: string }) {
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.agencies.byId.queryOptions({ id: agencyId }));
  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader className="sr-only"><DialogTitle>{data?.businessName ?? 'Agency'}</DialogTitle></DialogHeader>
      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : data ? (
        <AgencyProfileView agency={data} />
      ) : (
        <p className="py-8 text-center text-sm text-ink-40">Agency not found.</p>
      )}
    </DialogContent>
  );
}
