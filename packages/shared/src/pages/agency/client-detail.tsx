import { useMemo, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FolderOpen, FileText, MessageSquare } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { cn, initialsOf } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { RefreshButton } from '../../components/ui/refresh-button';
import { LockerGrid } from '../../components/file-locker/locker-grid';
import { BrandBillingView } from '../brand/brand-billing';
import { BrandSubscriptionsView } from '../brand/brand-subscriptions';
import { InfoHubManager } from '../brand/info-hub';
import { projectPriceSummary } from '../projects/cycle-price';

type Tab = 'overview' | 'projects' | 'billing' | 'subscriptions' | 'infohub' | 'files';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'projects', label: 'Projects' },
  { id: 'billing', label: 'Billing' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'infohub', label: 'Info Hub' },
  { id: 'files', label: 'Files' },
];

/** Client detail — ports client_detail_screen.dart (brand profile + projects + files). */
export function ClientDetailPage() {
  const trpc = useTRPC();
  const [, params] = useRoute('/clients/:id');
  const [, navigate] = useLocation();
  const { agencyId, role } = useActiveContext();
  const brandId = params?.id ?? null;
  const [tab, setTab] = useState<Tab>('overview');

  const brand = useQuery({ ...trpc.brands.byId.queryOptions({ id: brandId! }), enabled: !!brandId });

  if (!brandId) return <PageHeader title="Client" description="No client selected." />;
  if (brand.isLoading || !brand.data) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate('/clients')}><ArrowLeft className="h-4 w-4" /> Clients</Button>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const b = brand.data;

  return (
    <div>
      <Button variant="ghost" size="sm" className="mb-3" onClick={() => navigate('/clients')}><ArrowLeft className="h-4 w-4" /> Clients</Button>
      <div className="mb-5 flex items-center gap-4">
        <Avatar className="h-14 w-14 rounded-[var(--radius-md)]">
          {b.logoUrl && <AvatarImage src={b.logoUrl} />}
          <AvatarFallback>{initialsOf(b.businessName)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-xl font-semibold text-ink-100">{b.businessName}</h1>
          <p className="text-sm text-ink-60">{b.industry ?? 'Client'}{b.website ? ` · ${b.website}` : ''}</p>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => navigate('/chat')}><MessageSquare className="h-4 w-4" /> Message</Button>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-[color:var(--color-border-default)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'relative shrink-0 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'text-ink-100' : 'text-ink-40 hover:text-ink-60',
            )}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview brand={b} />}
      {tab === 'projects' && agencyId && <ProjectsTab agencyId={agencyId} brandId={brandId} />}
      {tab === 'billing' && <BrandBillingView brandId={brandId} />}
      {tab === 'subscriptions' && <BrandSubscriptionsView brandId={brandId} agencyId={agencyId ?? undefined} />}
      {tab === 'infohub' && (
        <InfoHubManager
          brandId={brandId}
          title="Info Hub"
          description="Sections shown on this client's brand profile."
          actingAgencyId={agencyId ?? undefined}
          canSetDefault={role === 'agencyOwner'}
        />
      )}
      {tab === 'files' && <FilesTab brandId={brandId} agencyId={agencyId ?? null} />}
    </div>
  );
}

function Overview({ brand }: { brand: any }) {
  // Email and Contact always render (showing a dash when empty); every other
  // field is hidden entirely when it has no value.
  const fields: { label: string; val: string | null | undefined; always?: boolean }[] = [
    { label: 'Email', val: brand.email, always: true },
    { label: 'Contact', val: brand.contactName, always: true },
    { label: 'Phone', val: brand.phone },
    { label: 'Website', val: brand.website },
    { label: 'Industry', val: brand.industry },
    { label: 'Year founded', val: brand.yearFounded },
    { label: 'Target audience', val: brand.targetAudience },
    { label: 'USP', val: brand.usp },
    { label: 'Tone of voice', val: brand.toneOfVoice },
    { label: 'Brand values', val: brand.brandValues },
  ];
  const visible = fields.filter((f) => f.always || (f.val != null && f.val !== ''));
  return (
    <Card className="p-5">
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {visible.map(({ label, val }) => (
          <div key={label}>
            <dt className="text-xs uppercase tracking-wide text-ink-40">{label}</dt>
            <dd className="mt-0.5 text-sm text-ink-100">{val || '—'}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function ProjectsTab({ agencyId, brandId }: { agencyId: string; brandId: string }) {
  const trpc = useTRPC();
  const list = useQuery(trpc.projects.list.queryOptions({ agencyId, limit: 50, offset: 0 }));
  const rows = (list.data?.items ?? []).filter((p: any) => p.brandId === brandId);

  if (list.isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (rows.length === 0) return <EmptyState icon={FolderOpen} title="No projects" description="Projects with this client appear here." />;
  return (
    <Card className="p-0">
      <Table>
        <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
        <TableBody>
          {rows.map((p: any) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium text-ink-100">{p.serviceName ?? p.title ?? 'Project'}</TableCell>
              <TableCell><Badge variant="outline">{p.status}</Badge></TableCell>
              <TableCell className="text-right tabular-nums">{projectPriceSummary(p)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function FilesTab({ brandId, agencyId }: { brandId: string; agencyId: string | null }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { openFile } = useFileViewer();
  const [folderId, setFolderId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.files.clientView.queryKey() });
  // Read-only, folder-aware agency view: this client's public assets + this
  // agency's own docs only. Folders surface only when they contain this
  // agency's files. The agency cannot create/move/reorder/delete anything here.
  const q = useQuery({
    ...trpc.files.clientView.queryOptions({ brandId, agencyId: agencyId!, folderId }),
    enabled: !!agencyId,
    retry: false,
  });

  const tree: any[] = q.data?.tree ?? [];
  const crumbs = useMemo(() => {
    const chain: { id: string | null; name: string }[] = [{ id: null, name: 'Files' }];
    const byId = new Map(tree.map((f) => [f.id, f]));
    const stack: { id: string; name: string }[] = [];
    let cur: string | null = folderId;
    while (cur) {
      const f = byId.get(cur);
      if (!f) break;
      stack.unshift({ id: f.id, name: f.name });
      cur = f.parentId ?? null;
    }
    return [...chain, ...stack];
  }, [folderId, tree]);

  if (!agencyId) return <EmptyState icon={FileText} title="No agency context" description="Switch to an agency to view client files." />;
  if (q.isError) return <EmptyState icon={FileText} title="Files unavailable" description="You don't have access to this client's documents." />;
  const folders: any[] = q.data?.folders ?? [];
  const files: any[] = q.data?.items ?? [];
  return (
    <div>
      <div className="mb-3 flex justify-end"><RefreshButton onRefresh={refresh} title="Refresh files" /></div>
      {/* Same grid as the brand Document Locker, but read-only — no create / move
          / reorder / rename / delete; folders open, files open in the viewer. */}
      <LockerGrid
        readOnly
        loading={q.isLoading}
        crumbs={crumbs}
        childFolders={folders}
        files={files}
        onNavigate={setFolderId}
        onOpenFile={(f) => openFile({ url: f.url, title: f.name })}
        fileCaption={(f) => {
          const ours = f.agencyId === agencyId || (f.agencyIds ?? []).includes(agencyId);
          return <Badge variant="outline" className="text-[10px]">{ours ? 'Your document' : 'Public'}</Badge>;
        }}
        emptyDescription="The client's public assets and the documents you've shared appear here."
      />
    </div>
  );
}
