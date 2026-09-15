import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { UploadButton } from '../../components/upload-button';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { StorageBucket } from '../../lib/storage-buckets';
import { Field } from './form-bits';

const LIMIT = 10;

/** Agency resource library — ports the agency manageResources view (create + list). */
export function ManageResourcesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { agencyId } = useActiveContext();
  const { openFile } = useFileViewer();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);

  const key = trpc.resources.list.queryKey();
  const list = useQuery({ ...trpc.resources.list.queryOptions({ agencyId: agencyId ?? undefined, limit: LIMIT, offset }), enabled: !!agencyId });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const remove = useMutation({ ...trpc.resources.remove.mutationOptions(), onSuccess: () => { toast.success('Removed'); invalidate(); }, onError: (e) => toastError(e) });
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Resources"
        description="Documents and links shared with your team and clients."
        action={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button variant="accent" disabled={!agencyId}><Plus className="h-4 w-4" /> Add resource</Button></DialogTrigger>
            {agencyId && open && <CreateResourceDialog agencyId={agencyId} onDone={() => { setOpen(false); invalidate(); }} />}
          </Dialog>
        }
      />
      {list.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={BookOpen} title="No resources yet" description="Add documents or helpful links." />
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <Card key={r.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="font-medium text-ink-100">{r.title}</div>
                {r.description && <div className="truncate text-sm text-ink-60">{r.description}</div>}
              </div>
              <div className="flex items-center gap-1">
                {(r.linkUrl || r.url) && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openFile({ url: (r.linkUrl ?? r.url)!, title: r.title })}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={async () => {
                    if (!(await confirm({
                      title: 'Delete resource?',
                      description: <>Permanently delete <span className="font-medium text-ink-100">{r.title}</span>? This cannot be undone.</>,
                      confirmLabel: 'Delete',
                      destructive: true,
                    }))) return;
                    remove.mutate({ id: r.id });
                  }}
                ><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
          <Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </div>
      )}
    </div>
  );
}

function CreateResourceDialog({ agencyId, onDone }: { agencyId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const create = useMutation({ ...trpc.resources.create.mutationOptions(), onSuccess: () => { toast.success('Resource added'); onDone(); }, onError: (e) => toastError(e) });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add resource</DialogTitle>
        <DialogDescription>Custom agency resources are reviewed before going live.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="res-title"><Input id="res-title" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Description" htmlFor="res-desc"><Input id="res-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Link or file" htmlFor="res-link" hint="Upload a file or paste a link URL">
          <div className="flex items-end gap-2">
            <Input id="res-link" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
            <UploadButton bucket={StorageBucket.Resources} pathPrefix={`agency/${agencyId}`} label="Upload" onUploaded={(url) => setLinkUrl(url)} />
          </div>
        </Field>
      </div>
      <DialogFooter>
        <Button variant="accent" disabled={!title || create.isPending} onClick={() => create.mutate({ agencyId, title, description: description || undefined, linkUrl: linkUrl || undefined })}>
          {create.isPending ? 'Saving…' : 'Add resource'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
