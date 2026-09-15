import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Library, Link2, Upload, Check, X, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { cn, formatDate } from '../../lib/utils';
import { StorageBucket } from '../../lib/storage-buckets';
import { uploadFile } from '../../lib/storage';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { SearchBar } from './components';

const CATEGORIES = ['Templates', 'White Papers', 'Checklists', 'Guides', 'Legal', 'Financial', 'Marketing', 'Operations'];
const BUCKET = StorageBucket.Resources;
const LIMIT = 100;

type Resource = {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  linkUrl: string | null;
  categories: string[] | null;
  agencyId: string | null;
  acceptedAt: Date | null;
  uploadedAt: Date;
};

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'global', label: 'Global' },
  { key: 'agency', label: 'Agency' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function filterTab(rows: Resource[], tab: TabKey): Resource[] {
  switch (tab) {
    case 'pending':
      return rows.filter((r) => r.acceptedAt == null);
    case 'accepted':
      return rows.filter((r) => r.acceptedAt != null);
    case 'global':
      return rows.filter((r) => r.acceptedAt != null && !r.agencyId);
    case 'agency':
      return rows.filter((r) => r.acceptedAt != null && !!r.agencyId);
  }
}

function ResourceRow({ r, pending, onOpen, onAccept, onReject, onDelete, busy }: {
  r: Resource;
  pending: boolean;
  onOpen: () => void;
  onAccept: () => void;
  onReject: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const isGlobal = !r.agencyId;
  const hasLink = !!r.linkUrl;
  return (
    <Card className="flex items-start gap-4 p-4 max-md:flex-wrap md:p-5">
      <div className="rounded-[var(--radius-sm)] bg-inset p-3 text-ink-100">
        {hasLink ? <Link2 className="h-5 w-5" /> : <Library className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-ink-100">{r.title}</span>
          <Badge variant={isGlobal ? 'success' : 'warn'}>{isGlobal ? 'Global' : 'Agency'}</Badge>
        </div>
        {r.description && <p className="mt-1 line-clamp-2 text-sm text-ink-60">{r.description}</p>}
        {!!r.categories?.length && (
          <div className="mt-2 flex flex-wrap gap-1">
            {r.categories.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
          </div>
        )}
        <p className="mt-2 text-xs text-ink-40">Uploaded: {formatDate(r.uploadedAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-md:w-full max-md:justify-end">
        {(r.url || r.linkUrl) && (
          <Button variant="ghost" size="icon" onClick={onOpen} title="Open"><ExternalLink className="h-4 w-4" /></Button>
        )}
        {pending ? (
          <>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onAccept}><Check className="h-4 w-4 text-success" /> Accept</Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onReject}><X className="h-4 w-4 text-danger" /> Reject</Button>
          </>
        ) : (
          <Button variant="ghost" size="icon" disabled={busy} onClick={onDelete} title="Delete"><Trash2 className="h-4 w-4 text-danger" /></Button>
        )}
      </div>
    </Card>
  );
}

export function ResourcesManagementPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { openFile } = useFileViewer();
  const list = useQuery(trpc.resources.adminList.queryOptions({ limit: LIMIT, offset: 0 }));
  const key = trpc.resources.adminList.queryKey();
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const [tab, setTab] = useState<TabKey>('pending');
  const [search, setSearch] = useState('');

  // Upload form.
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [uploadType, setUploadType] = useState<'file' | 'link'>('file');
  const [linkUrl, setLinkUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set(['Templates']));
  const [uploading, setUploading] = useState(false);

  const createGlobal = useMutation({ ...trpc.resources.createGlobal.mutationOptions(), onError: (e) => toastError(e) });
  const accept = useMutation({ ...trpc.resources.accept.mutationOptions(), onSuccess: () => { toast.success('Resource request accepted'); invalidate(); }, onError: (e) => toastError(e) });
  const reject = useMutation({ ...trpc.resources.reject.mutationOptions(), onSuccess: () => { toast.success('Resource request rejected and deleted'); invalidate(); }, onError: (e) => toastError(e) });
  const remove = useMutation({ ...trpc.resources.remove.mutationOptions(), onSuccess: () => { toast.success('Resource deleted'); invalidate(); }, onError: (e) => toastError(e) });

  function toggleCat(c: string) {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(c)) { if (next.size > 1) next.delete(c); } else next.add(c);
      return next;
    });
  }

  async function onUpload() {
    if (!title.trim()) { toast.error('Please fill all required fields'); return; }
    if (uploadType === 'file' && !file) { toast.error('Please select a file'); return; }
    if (uploadType === 'link' && !linkUrl.trim()) { toast.error('Please provide a link'); return; }
    setUploading(true);
    try {
      let url: string | undefined;
      if (uploadType === 'file' && file) {
        url = await uploadFile(BUCKET, 'resources', file);
      }
      await createGlobal.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        url,
        linkUrl: uploadType === 'link' ? linkUrl.trim() : undefined,
        categories: [...selectedCats],
      });
      toast.success('Resource uploaded!');
      setTitle(''); setDescription(''); setLinkUrl(''); setFile(null);
      invalidate();
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  const all = (list.data?.items ?? []) as Resource[];
  const filtered = all.filter((r) => {
    const q = search.toLowerCase();
    return !q || r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q);
  });
  const rows = filterTab(filtered, tab);
  const busy = accept.isPending || reject.isPending || remove.isPending;

  function openResource(r: Resource) {
    const u = r.linkUrl || r.url;
    if (u) openFile({ url: u, title: r.title });
  }

  return (
    <div>
      <PageHeader title="Resources" description="Upload, categorize and moderate platform resources." />

      <Card className="mb-6 p-4 md:p-6">
        <h2 className="mb-4 text-base font-semibold text-ink-100">Upload Resource</h2>
        <div className="space-y-4">
          <div>
            <Label className="mb-1 block">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Resource title" />
          </div>
          <div>
            <Label className="mb-1 block">Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
          </div>
          <div>
            <Label className="mb-1 block">Categories</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCat(c)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs',
                    selectedCats.has(c) ? 'border-accent bg-accent/10 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60',
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-80">
              <input type="radio" checked={uploadType === 'file'} onChange={() => setUploadType('file')} /> File
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-80">
              <input type="radio" checked={uploadType === 'link'} onChange={() => setUploadType('link')} /> Link
            </label>
          </div>
          {uploadType === 'file' ? (
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          ) : (
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
          )}
          <Button variant="accent" disabled={uploading} onClick={onUpload}>
            <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </Card>

      <SearchBar value={search} onChange={setSearch} placeholder="Search resources..." />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-[color:var(--color-border-default)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'press -mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium',
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-ink-60 hover:text-ink-100',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-40">No resources in this view.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ResourceRow
              key={r.id}
              r={r}
              pending={tab === 'pending'}
              busy={busy}
              onOpen={() => openResource(r)}
              onAccept={() => accept.mutate({ id: r.id })}
              onReject={async () => {
                if (!(await confirm({
                  title: 'Reject this resource?',
                  description: <>Rejecting <span className="font-medium text-ink-100">{r.title}</span> permanently deletes the request. This cannot be undone.</>,
                  confirmLabel: 'Reject',
                  destructive: true,
                }))) return;
                reject.mutate({ id: r.id });
              }}
              onDelete={async () => {
                if (!(await confirm({
                  title: 'Delete this resource?',
                  description: <>Permanently delete <span className="font-medium text-ink-100">{r.title}</span>? This cannot be undone.</>,
                  confirmLabel: 'Delete',
                  destructive: true,
                }))) return;
                remove.mutate({ id: r.id });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
