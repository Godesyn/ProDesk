import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Upload, Loader2, FileBox } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { formatDate } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { RefreshButton } from '../../components/ui/refresh-button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { Field, Select, Chip } from '../agency/form-bits';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { LockerGrid, FileGlyph, extOf } from '../../components/file-locker/locker-grid';
import { uploadBrandFile, fileTypeOf } from './storage';

type Tab = 'agency' | 'public' | 'private';
const TABS: { id: Tab; label: string }[] = [
  { id: 'agency', label: 'Agency Documents' },
  { id: 'public', label: 'Public Brand Assets' },
  { id: 'private', label: 'Private Documents' },
];

/** Every agency a file belongs to — a doc shared in a group chat can span several. */
const agenciesOf = (f: any): string[] => (Array.isArray(f.agencyIds) && f.agencyIds.length ? f.agencyIds : f.agencyId ? [f.agencyId] : []);

/** Document Locker — 3 tabs, folders, breadcrumbs, upload, move. Ports document_locker_screen.dart. */
export function BrandDocumentsPage() {
  const { brandId } = useActiveContext();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('agency');
  const [search, setSearch] = useState('');
  const query = search.trim();

  // Re-pull everything the locker shows (files, folders, search, agency names).
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: trpc.files.list.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.files.folders.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.files.search.queryKey() }),
      qc.invalidateQueries({ queryKey: trpc.connections.brandAgencies.queryKey() }),
    ]);

  return (
    <div>
      <PageHeader
        title="Document Locker"
        description="Organise your brand documents, public assets and private files."
        action={<RefreshButton onRefresh={refresh} title="Refresh documents" />}
      />
      {/* Global search — spans every tab (Agency, Public, Private) at once. */}
      <div className="mb-4 max-w-sm">
        <Input placeholder="Search all documents…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {!query && (
        <div className="mb-4 flex gap-1 border-b border-[color:var(--color-border-default)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.id ? 'border-accent text-accent' : 'border-transparent text-ink-60 hover:text-ink-100'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {!brandId ? (
        <EmptyState icon={FileBox} title="No brand selected" description="Create a brand profile to use the document locker." />
      ) : query ? (
        <SearchResults brandId={brandId} query={query} />
      ) : (
        // All three tabs stay mounted; switching is pure show/hide. Each tab keeps
        // its own queries (loaded once) and folder navigation, so changing tabs
        // never refetches — only the Refresh button / mutations invalidate.
        TABS.map((t) => (
          <div key={t.id} className={tab === t.id ? '' : 'hidden'}>
            <LockerTab brandId={brandId} tab={t.id} />
          </div>
        ))
      )}
    </div>
  );
}

function LockerTab({ brandId, tab }: { brandId: string; tab: Tab }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { openFile } = useFileViewer();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [agencyChip, setAgencyChip] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingAgencyFile, setPendingAgencyFile] = useState<File | null>(null);
  const [moveFile, setMoveFile] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Each tab is a separate, always-mounted instance (see BrandDocumentsPage), so
  // this component's `tab` never changes and its queries load exactly once. Keep
  // the data fresh forever so returning to the page (within gcTime) is instant;
  // only mutations + the Refresh button invalidate.
  const cacheOpts = { staleTime: Infinity, gcTime: Infinity } as const;

  // Resolve owning-agency ids → names/logos so files and chips show the agency
  // (not a raw id) everywhere an agency owns a document.
  const agenciesQ = useQuery({ ...trpc.connections.brandAgencies.queryOptions({ brandId, limit: 100, offset: 0 }), ...cacheOpts });
  const agencyById = useMemo(() => {
    const m = new Map<string, { name: string; logoUrl: string | null }>();
    for (const a of agenciesQ.data?.items ?? []) m.set(a.id, { name: a.businessName, logoUrl: a.logoUrl ?? null });
    return m;
  }, [agenciesQ.data]);
  const agencyName = (id: string) => agencyById.get(id)?.name ?? 'Agency';

  // Folders honour the agency chip on the Agency tab: while filtering by an
  // agency, folders with none of that agency's files (in their subtree) drop out.
  const foldersQ = useQuery({ ...trpc.files.folders.queryOptions({ brandId, tab, agencyId: tab === 'agency' ? agencyChip : undefined }), ...cacheOpts });
  const filesKey = trpc.files.list.queryKey();
  const foldersKey = trpc.files.folders.queryKey();
  const filesQ = useQuery({
    ...trpc.files.list.queryOptions({ brandId, tab, folderId, agencyId: tab === 'agency' ? agencyChip : undefined, limit: 100, offset: 0 }),
    ...cacheOpts,
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: filesKey }); qc.invalidateQueries({ queryKey: foldersKey }); };
  const removeFile = useMutation({ ...trpc.files.remove.mutationOptions(), onSuccess: () => { toast.success('Deleted'); invalidate(); }, onError: (e) => toastError(e) });
  const removeFolder = useMutation({ ...trpc.files.removeFolder.mutationOptions(), onSuccess: () => { toast.success('Folder deleted'); invalidate(); }, onError: (e) => toastError(e) });
  const register = useMutation(trpc.files.register.mutationOptions());
  const moveMut = useMutation({ ...trpc.files.move.mutationOptions(), onSuccess: () => { toast.success('Moved'); invalidate(); }, onError: (e) => toastError(e) });
  const reorder = useMutation({ ...trpc.files.reorder.mutationOptions(), onSuccess: invalidate, onError: (e) => { toastError(e); invalidate(); } });
  const renameMut = useMutation({ ...trpc.files.rename.mutationOptions(), onSuccess: () => { toast.success('Renamed'); invalidate(); }, onError: (e) => toastError(e) });
  const copyToPublicMut = useMutation({ ...trpc.files.copyToPublic.mutationOptions(), onSuccess: () => { toast.success('Copied to Public Brand Assets'); invalidate(); }, onError: (e) => toastError(e) });
  const renameFolderMut = useMutation({ ...trpc.files.renameFolder.mutationOptions(), onSuccess: () => { toast.success('Folder renamed'); invalidate(); }, onError: (e) => toastError(e) });

  // Drag/drop + inline-rename interactions now live inside <LockerGrid>; this
  // component supplies the data and the mutation callbacks. The reorder is still
  // optimistic here (it owns the files.list cache entry it patches).
  const listInput = { brandId, tab, folderId, agencyId: tab === 'agency' ? agencyChip : undefined, limit: 100, offset: 0 };
  const reorderTo = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const items = filesQ.data?.items ?? [];
    const ids = items.map((f) => f.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const newIds = [...ids];
    newIds.splice(from, 1);
    newIds.splice(to, 0, draggedId);
    qc.setQueryData(trpc.files.list.queryKey(listInput), (old: any) => (old ? { ...old, items: newIds.map((id) => items.find((f) => f.id === id)) } : old));
    reorder.mutate({ brandId, orderedIds: newIds });
  };
  const moveToFolder = (fileId: string, destFolderId: string | null) => moveMut.mutate({ id: fileId, folderId: destFolderId });

  const allFolders = foldersQ.data ?? [];
  const childFolders = allFolders.filter((f) => (f.parentId ?? null) === folderId);

  // Breadcrumb chain from root → current.
  const crumbs = useMemo(() => {
    const chain: { id: string | null; name: string }[] = [{ id: null, name: 'Root' }];
    let cur = folderId;
    const stack: { id: string; name: string }[] = [];
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    while (cur) {
      const f = byId.get(cur);
      if (!f) break;
      stack.unshift({ id: f.id, name: f.name });
      cur = f.parentId ?? null;
    }
    return [...chain, ...stack];
  }, [folderId, allFolders]);

  // Agency chips (distinct agencies across files in this tab — a file shared in
  // a group chat can belong to several, so union each file's full set).
  const agencyIds = useMemo(() => {
    const set = new Set<string>();
    for (const f of filesQ.data?.items ?? []) for (const id of agenciesOf(f)) set.add(id);
    return [...set];
  }, [filesQ.data]);

  const files = filesQ.data?.items ?? [];

  // Connected agencies — the candidate owners for an Agency Documents upload.
  const connectedAgencies = useMemo(
    () => (agenciesQ.data?.items ?? []).map((a) => ({ id: a.id, name: a.businessName, logoUrl: a.logoUrl ?? null })),
    [agenciesQ.data],
  );

  // An Agency Documents upload needs an owning agency, else it lands as a
  // brand-owned Public asset and disappears from this tab. Resolve the owner:
  // a selected chip wins; with no chip use the sole connected agency; with
  // several connected agencies, prompt before uploading.
  const startUpload = (file: File) => {
    if (tab !== 'agency') { onUpload(file, undefined); return; }
    if (agencyChip) { onUpload(file, agencyChip); return; }
    if (connectedAgencies.length <= 1) { onUpload(file, connectedAgencies[0]?.id); return; }
    setPendingAgencyFile(file);
  };

  const onUpload = async (file: File, uploadAgencyId: string | undefined) => {
    setUploading(true);
    try {
      const url = await uploadBrandFile(brandId, tab, file);
      await register.mutateAsync({
        brandId,
        name: file.name,
        url,
        size: file.size,
        type: fileTypeOf(file.name),
        folderId: folderId ?? undefined,
        agencyId: uploadAgencyId,
        isPrivate: tab === 'private',
      });
      toast.success('Uploaded');
      invalidate();
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}><FolderPlus className="h-4 w-4" /> New Folder</Button>
        <Button size="sm" variant="accent" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload Document
        </Button>
        <input ref={fileInput} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) startUpload(f); e.target.value = ''; }} />
      </div>

      {/* Agency filter chips */}
      {tab === 'agency' && agencyIds.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Chip active={!agencyChip} onClick={() => setAgencyChip(null)}>All</Chip>
          {agencyIds.map((id) => {
            const a = agencyById.get(id);
            return (
              <Chip key={id} active={agencyChip === id} onClick={() => setAgencyChip(id)}>
                <span className="flex items-center gap-1.5">
                  {a?.logoUrl && <img src={a.logoUrl} alt="" className="h-4 w-4 rounded-full object-cover" />}
                  {agencyName(id)}
                </span>
              </Chip>
            );
          })}
        </div>
      )}

      <LockerGrid
        loading={filesQ.isLoading || foldersQ.isLoading}
        crumbs={crumbs}
        childFolders={childFolders}
        files={files}
        onNavigate={setFolderId}
        onOpenFile={(f) => openFile({ url: f.url, title: f.name, onRename: async (name) => { await renameMut.mutateAsync({ id: f.id, name }); } })}
        fileCaption={(f) =>
          agenciesOf(f).length > 0 ? (
            <span className="flex w-full items-center justify-center gap-1 truncate text-[10px] text-ink-60">
              {agencyById.get(agenciesOf(f)[0])?.logoUrl && <img src={agencyById.get(agenciesOf(f)[0])!.logoUrl!} alt="" className="h-3 w-3 rounded-full object-cover" />}
              <span className="truncate">{agenciesOf(f).map(agencyName).join(', ')}</span>
            </span>
          ) : null
        }
        onReorder={reorderTo}
        onMoveToFolder={moveToFolder}
        onCopyToPublic={tab === 'agency' ? (f) => copyToPublicMut.mutate({ id: f.id }) : undefined}
        onRenameFolder={(id, name) => renameFolderMut.mutate({ id, name })}
        onDeleteFolder={async (f) => {
          if (!(await confirm({
            title: 'Delete folder?',
            description: <>Delete the folder <span className="font-medium text-ink-100">{f.name}</span> and everything inside it? This cannot be undone.</>,
            confirmLabel: 'Delete',
            destructive: true,
          }))) return;
          removeFolder.mutate({ id: f.id });
        }}
        onMoveFile={setMoveFile}
        onDeleteFile={async (f) => {
          if (!(await confirm({
            title: 'Delete file?',
            description: <>Permanently delete <span className="font-medium text-ink-100">{f.name}</span>? This cannot be undone.</>,
            confirmLabel: 'Delete',
            destructive: true,
          }))) return;
          removeFile.mutate({ id: f.id });
        }}
      />

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        {newFolderOpen && (
          <NewFolderDialog
            brandId={brandId}
            tab={tab}
            parentId={folderId}
            onDone={() => { setNewFolderOpen(false); invalidate(); }}
          />
        )}
      </Dialog>

      <Dialog open={!!pendingAgencyFile} onOpenChange={(o) => !o && setPendingAgencyFile(null)}>
        {pendingAgencyFile && (
          <AgencyPickDialog
            agencies={connectedAgencies}
            saving={uploading}
            onPick={(id) => { const f = pendingAgencyFile; setPendingAgencyFile(null); if (f) onUpload(f, id); }}
          />
        )}
      </Dialog>

      <Dialog open={!!moveFile} onOpenChange={(o) => !o && setMoveFile(null)}>
        {moveFile && (
          <MoveFileDialog
            fileId={moveFile}
            folders={allFolders.map((f) => ({ id: f.id, name: f.name }))}
            onDone={() => { setMoveFile(null); invalidate(); }}
          />
        )}
      </Dialog>
    </div>
  );
}

/** Global, cross-tab search results (files.search). Shows each match with the
 *  tab/owner it lives under and its provenance note. */
function SearchResults({ brandId, query }: { brandId: string; query: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { openFile } = useFileViewer();
  const resultsQ = useQuery(trpc.files.search.queryOptions({ brandId, query }));
  const renameMut = useMutation({
    ...trpc.files.rename.mutationOptions(),
    onSuccess: () => { toast.success('Renamed'); qc.invalidateQueries({ queryKey: trpc.files.search.queryKey() }); qc.invalidateQueries({ queryKey: trpc.files.list.queryKey() }); },
    onError: (e) => toastError(e),
  });
  const agenciesQ = useQuery(trpc.connections.brandAgencies.queryOptions({ brandId, limit: 100, offset: 0 }));
  const agencyById = useMemo(() => {
    const m = new Map<string, { name: string; logoUrl: string | null }>();
    for (const a of agenciesQ.data?.items ?? []) m.set(a.id, { name: a.businessName, logoUrl: a.logoUrl ?? null });
    return m;
  }, [agenciesQ.data]);
  const ownerLabel = (f: any) => (f.isPrivate ? 'Private' : f.agencyId ? agencyById.get(f.agencyId)?.name ?? 'Agency' : 'Public');

  if (resultsQ.isLoading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  const rows = resultsQ.data ?? [];
  if (rows.length === 0) return <EmptyState icon={FileBox} title="No matches" description={`No documents match “${query}”.`} />;
  return (
    <Card className="p-0">
      <ul className="divide-y divide-[color:var(--color-border-default)]">
        {rows.map((f: any) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-3">
            <FileGlyph type={f.type ?? 'file'} ext={extOf(f.name, f.type ?? 'file')} className="h-9 w-9 shrink-0" />
            <button type="button" onClick={() => openFile({ url: f.url, title: f.name, onRename: async (name) => { await renameMut.mutateAsync({ id: f.id, name }); } })} title={f.note ?? f.name} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-ink-100 hover:text-accent">{f.name}</span>
              {f.note && <span className="block truncate text-xs text-ink-50">{f.note}</span>}
            </button>
            <Badge variant="outline" className="shrink-0">{ownerLabel(f)}</Badge>
            <span className="shrink-0 text-xs text-ink-40">{formatDate(f.uploadedAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NewFolderDialog({ brandId, tab, parentId, onDone }: { brandId: string; tab: Tab; parentId: string | null; onDone: () => void }) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const create = useMutation({ ...trpc.files.createFolder.mutationOptions(), onSuccess: () => { toast.success('Folder created'); onDone(); }, onError: (e) => toastError(e) });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
      <Field label="Folder name" htmlFor="folder-name"><Input id="folder-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
      <DialogFooter>
        <Button
          variant="accent"
          disabled={!name || create.isPending}
          onClick={() => create.mutate({ brandId, name, parentId: parentId ?? undefined, isPublic: tab === 'public', isPrivate: tab === 'private' })}
        >
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function AgencyPickDialog({ agencies, saving, onPick }: { agencies: { id: string; name: string; logoUrl: string | null }[]; saving: boolean; onPick: (id: string) => void }) {
  const [sel, setSel] = useState(agencies[0]?.id ?? '');
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Which agency?</DialogTitle></DialogHeader>
      <Field label="Owning agency" htmlFor="upload-agency">
        <Select id="upload-agency" value={sel} onChange={setSel}>
          {agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <DialogFooter>
        <Button variant="accent" disabled={!sel || saving} onClick={() => sel && onPick(sel)}>
          {saving ? 'Uploading…' : 'Upload'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function MoveFileDialog({ fileId, folders, onDone }: { fileId: string; folders: { id: string; name: string }[]; onDone: () => void }) {
  const trpc = useTRPC();
  const [dest, setDest] = useState<string>('');
  const move = useMutation({ ...trpc.files.move.mutationOptions(), onSuccess: () => { toast.success('Moved'); onDone(); }, onError: (e) => toastError(e) });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Move File</DialogTitle></DialogHeader>
      <Field label="Destination folder" htmlFor="dest">
        <Select id="dest" value={dest} onChange={setDest}>
          <option value="">Root</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
      </Field>
      <DialogFooter>
        <Button variant="accent" disabled={move.isPending} onClick={() => move.mutate({ id: fileId, folderId: dest || null })}>
          {move.isPending ? 'Moving…' : 'Move'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
