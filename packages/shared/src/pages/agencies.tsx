import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, MessageSquare, Eye, Search } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { useChatNav } from './chat/chat-nav-context';
import { formatDate, initialsOf } from '../lib/utils';
import { AgencyProfileView } from '../components/profile-views';
import { AgencyVerifiedBadge } from '../components/agency-verified-badge';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select } from './agency/form-bits';
import type { RouterOutputs } from '@server/trpc/router';

type Sort = 'unverified' | 'alpha' | 'created';
type AgencyRow = RouterOutputs['connections']['brandAgenciesWithStats'][number];
type RequestAgency = RouterOutputs['connections']['brandPendingRequests'][number]['agency'];

/**
 * Brand view: agencies serving this brand + incoming connection requests, with
 * per-agency project stats, verified badges, View Details, Chat, search/sort, a
 * recommended-agencies empty state, and an Add-New-Agency search-and-connect
 * dialog (brand self-initiates). Ports agencies_screen.dart.
 */
export function BrandAgenciesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { navigateToChat } = useChatNav();
  const { brandId } = useActiveContext();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('unverified');
  const [addOpen, setAddOpen] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  const [reqAgency, setReqAgency] = useState<RequestAgency | null>(null);

  const reqKey = trpc.connections.brandPendingRequests.queryKey();
  const statsKey = trpc.connections.brandAgenciesWithStats.queryKey();
  const requests = useQuery({ ...trpc.connections.brandPendingRequests.queryOptions({ brandId: brandId! }), enabled: !!brandId });
  const list = useQuery({ ...trpc.connections.brandAgenciesWithStats.queryOptions({ brandId: brandId! }), enabled: !!brandId });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: reqKey });
    qc.invalidateQueries({ queryKey: statsKey });
  };
  const accept = useMutation({
    ...trpc.connections.acceptBrandRequest.mutationOptions(),
    onSuccess: () => { toast.success('Connected'); invalidate(); },
    onError: (e) => toastError(e),
  });

  const pending = requests.data ?? [];
  const rows = useMemo(() => {
    let r = list.data ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter((a) => a.businessName.toLowerCase().includes(q) || (a.disciplines ?? []).some((d) => d.toLowerCase().includes(q)));
    }
    return [...r].sort((a, b) => {
      if (sort === 'alpha') return a.businessName.localeCompare(b.businessName);
      if (sort === 'created') return new Date(b.connectedAt).getTime() - new Date(a.connectedAt).getTime();
      // unverified-first: unverified before verified, then alpha.
      if (a.emailVerified !== b.emailVerified) return a.emailVerified ? 1 : -1;
      return a.businessName.localeCompare(b.businessName);
    });
  }, [list.data, search, sort]);

  // Brand viewing an agency → open the brand↔agency conversation
  // (agencies_screen.dart:_navigateToChat, target agencyThread).
  const openChat = (agencyId: string) => {
    if (!brandId) return;
    void navigateToChat({ brandId, agencyId, target: 'agencyThread' });
  };

  const detailAgency = rows.find((a) => a.id === details) ?? null;

  return (
    <div>
      <PageHeader
        title="Agencies"
        description="All your top verified agencies in one place."
        action={
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild><Button variant="accent" disabled={!brandId}><Plus className="h-4 w-4" /> Add New Agency</Button></DialogTrigger>
            {brandId && addOpen && <SearchAgenciesDialog brandId={brandId} onDone={() => { setAddOpen(false); invalidate(); }} />}
          </Dialog>
        }
      />

      {pending.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle>Pending requests</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pending.map((r) => (
              <div key={r.id} className="flex flex-col gap-3 rounded-[var(--radius-sm)] bg-inset/50 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-8 w-8 shrink-0">{r.agency.logoUrl && <AvatarImage src={r.agency.logoUrl} />}<AvatarFallback>{initialsOf(r.agency.businessName)}</AvatarFallback></Avatar>
                  <div className="min-w-0">
                    <span className="font-medium text-ink-100">{r.agency.businessName}</span>
                    <span className="ml-2 text-xs text-ink-40">Wants to connect</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setReqAgency(r.agency)}><Eye className="h-4 w-4" /> View details</Button>
                  <Button size="sm" variant="accent" disabled={accept.isPending} onClick={() => accept.mutate({ requestId: r.id })}>Accept Request</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Search + sort toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input className="pl-9" placeholder="Search agencies…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={sort} onChange={(v) => setSort(v as Sort)}>
          <option value="unverified">Unverified first</option>
          <option value="alpha">Alphabetical</option>
          <option value="created">Recently connected</option>
        </Select>
      </div>

      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 && pending.length === 0 ? (
          brandId ? <RecommendedAgencies brandId={brandId} onConnected={invalidate} /> : <EmptyState icon={Building2} title="No agencies yet" description="Connected agencies appear here." />
        ) : (
          <>
            {/* Mobile: stacked cards (the 6-column table is too wide for a phone). */}
            <div className="divide-y divide-[color:var(--color-border-default)] md:hidden">
              {rows.map((a) => (
                <div key={a.connectionId} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">{a.logoUrl && <AvatarImage src={a.logoUrl} />}<AvatarFallback>{initialsOf(a.businessName)}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-medium text-ink-100">
                        <span className="truncate">{a.businessName}</span>
                        <AgencyVerifiedBadge platformVerified={a.platformVerified} className="h-3.5 w-3.5 shrink-0" />
                      </div>
                      <div className="truncate text-xs text-ink-40">{(a.disciplines ?? []).slice(0, 2).join(' · ') || 'Connected ' + formatDate(a.connectedAt)}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex gap-4 text-xs text-ink-60">
                      <span><span className="font-semibold text-ink-100">{a.stats.total}</span> purchases</span>
                      <span><span className="font-semibold text-ink-100">{a.stats.active}</span> active</span>
                      <span><span className="font-semibold text-ink-100">{a.stats.done}</span> done</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="icon" variant="ghost" title="Chat" onClick={() => openChat(a.id)}><MessageSquare className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="View details" onClick={() => setDetails(a.id)}><Eye className="h-4 w-4" /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: full table. */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agency</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Purchases</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Done</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((a) => (
                    <TableRow key={a.connectionId}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">{a.logoUrl && <AvatarImage src={a.logoUrl} />}<AvatarFallback>{initialsOf(a.businessName)}</AvatarFallback></Avatar>
                          <div>
                            <span className="font-medium text-ink-100">{a.businessName}</span>
                            <div className="text-xs text-ink-40">{(a.disciplines ?? []).slice(0, 2).join(' · ') || 'Connected ' + formatDate(a.connectedAt)}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {/* Verification = the platform-verified mark only (the icon);
                            nothing shows for a non-platform-verified agency. */}
                        <AgencyVerifiedBadge platformVerified={a.platformVerified} />
                      </TableCell>
                      <TableCell className="text-right text-ink-80">{a.stats.total}</TableCell>
                      <TableCell className="text-right text-ink-80">{a.stats.active}</TableCell>
                      <TableCell className="text-right text-ink-80">{a.stats.done}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="icon" variant="ghost" title="Chat" onClick={() => openChat(a.id)}><MessageSquare className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="View details" onClick={() => setDetails(a.id)}><Eye className="h-4 w-4" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Card>

      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        {detailAgency && <AgencyDetailsDialog agency={detailAgency} />}
      </Dialog>

      <Dialog open={!!reqAgency} onOpenChange={(o) => !o && setReqAgency(null)}>
        {reqAgency && <AgencyInfoDialog agency={reqAgency} />}
      </Dialog>
    </div>
  );
}

/**
 * Full agency profile for an incoming connection request — mirrors the agency
 * info screen (identity, contact, links, about, disciplines). No purchase stats
 * here: the brand isn't connected yet, so there's nothing to summarize.
 */
function AgencyInfoDialog({ agency }: { agency: RequestAgency }) {
  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
      <DialogHeader className="sr-only"><DialogTitle>{agency.businessName}</DialogTitle></DialogHeader>
      <AgencyProfileView agency={agency} />
    </DialogContent>
  );
}

function AgencyDetailsDialog({ agency }: { agency: AgencyRow }) {
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <div className="flex items-center gap-3">
          <Avatar className="h-12 w-12">{agency.logoUrl && <AvatarImage src={agency.logoUrl} />}<AvatarFallback>{initialsOf(agency.businessName)}</AvatarFallback></Avatar>
          <div>
            <DialogTitle className="flex items-center gap-2">
              {agency.businessName}
              <AgencyVerifiedBadge platformVerified={agency.platformVerified} />
            </DialogTitle>
            {agency.businessEmail && <DialogDescription>{agency.businessEmail}</DialogDescription>}
          </div>
        </div>
      </DialogHeader>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-ink-100">Purchase statistics</h4>
        <div className="grid grid-cols-3 gap-3">
          <StatBox label="Total" value={agency.stats.total} />
          <StatBox label="Active" value={agency.stats.active} />
          <StatBox label="Completed" value={agency.stats.done} />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-sm font-semibold text-ink-100">Active projects breakdown</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Brief {agency.stats.brief}</Badge>
          <Badge variant="outline">Allocate {agency.stats.allocate}</Badge>
          <Badge variant="outline">Production {agency.stats.production}</Badge>
          <Badge variant="outline">Approval {agency.stats.approval}</Badge>
        </div>
      </section>

      {agency.description && (
        <section>
          <h4 className="mb-1 text-sm font-semibold text-ink-100">About</h4>
          <p className="text-sm text-ink-60">{agency.description}</p>
        </section>
      )}

      {(agency.disciplines ?? []).length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-ink-100">Disciplines</h4>
          <div className="flex flex-wrap gap-2">
            {agency.disciplines!.map((d) => <Badge key={d} variant="muted">{d}</Badge>)}
          </div>
        </section>
      )}
    </DialogContent>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-3 text-center">
      <div className="text-h4 text-ink-100">{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink-40">{label}</div>
    </div>
  );
}

function RecommendedAgencies({ brandId, onConnected }: { brandId: string; onConnected: () => void }) {
  const trpc = useTRPC();
  // Recommendations are the platform DEFAULT agencies (top-ranked), not the full
  // agency directory — ports recommendedAgenciesProvider.
  const browse = useQuery(trpc.connections.recommendedAgencies.queryOptions({ brandId, limit: 6 }));
  const connect = useMutation({
    ...trpc.connections.requestAgencyConnection.mutationOptions(),
    onSuccess: () => { toast.success('Agency added'); onConnected(); },
    onError: (e) => toastError(e),
  });
  const items = browse.data ?? [];

  if (browse.isLoading) return <div className="space-y-2 p-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (items.length === 0) return <EmptyState icon={Building2} title="No Active Connections" description="Connect with an agency to start working together." />;

  return (
    <div className="p-6">
      <div className="mb-4">
        <p className="font-medium text-ink-100">No Active Connections</p>
        <p className="text-sm text-ink-60">Recommended agencies to get you started.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <Card key={a.id} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">{a.logoUrl && <AvatarImage src={a.logoUrl} />}<AvatarFallback>{initialsOf(a.businessName)}</AvatarFallback></Avatar>
              <div className="min-w-0">
                <div className="flex items-center gap-1 font-medium text-ink-100">{a.businessName}<AgencyVerifiedBadge platformVerified={a.platformVerified} className="h-3.5 w-3.5" /></div>
                <div className="truncate text-xs text-ink-40">{(a.disciplines ?? []).slice(0, 2).join(' · ')}</div>
              </div>
            </div>
            {a.shortDescription && <p className="line-clamp-2 text-sm text-ink-60">{a.shortDescription}</p>}
            <Button size="sm" variant="outline" disabled={connect.isPending} onClick={() => connect.mutate({ brandId, agencyId: a.id })}>
              <Plus className="h-4 w-4" /> Add Agency
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SearchAgenciesDialog({ brandId, onDone }: { brandId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const browse = useQuery(trpc.connections.browseAgencies.queryOptions({ brandId, search: search || undefined, limit: 20, offset: 0 }));
  const [connecting, setConnecting] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState<Set<string>>(new Set());
  const connect = useMutation(trpc.connections.requestAgencyConnection.mutationOptions());

  const onConnect = async (agencyId: string) => {
    setConnecting((s) => new Set(s).add(agencyId));
    try {
      await connect.mutateAsync({ brandId, agencyId });
      setConnected((s) => new Set(s).add(agencyId));
      toast.success('Agency added');
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setConnecting((s) => { const n = new Set(s); n.delete(agencyId); return n; });
    }
  };

  const items = browse.data?.items ?? [];
  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Add New Agency</DialogTitle>
        <DialogDescription>Search by name or discipline and connect instantly.</DialogDescription>
      </DialogHeader>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
        <Input className="pl-9" placeholder="Search agencies…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
      </div>
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">
        {browse.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-40">No agencies found.</p>
        ) : (
          items.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-9 w-9">{a.logoUrl && <AvatarImage src={a.logoUrl} />}<AvatarFallback>{initialsOf(a.businessName)}</AvatarFallback></Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-1 font-medium text-ink-100">{a.businessName}<AgencyVerifiedBadge platformVerified={a.platformVerified} className="h-3.5 w-3.5" /></div>
                  {a.businessEmail && <div className="truncate text-xs text-ink-40">{a.businessEmail}</div>}
                </div>
              </div>
              {connected.has(a.id) ? (
                <Badge variant="success">Connected</Badge>
              ) : (
                <Button size="sm" variant="outline" disabled={connecting.has(a.id)} onClick={() => onConnect(a.id)}>
                  {connecting.has(a.id) ? 'Connecting…' : 'Add Agency'}
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </DialogContent>
  );
}
