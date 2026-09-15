import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { Paperclip, X, Plus, Trash2, Pencil, ArrowRight } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { uploadFile } from '../../lib/storage';
import { StorageBucket } from '../../lib/storage-buckets';
import { useCurrentUser } from '../../auth/auth-context';
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ContractorProfileView, AgencyProfileView } from '../../components/profile-views';
import { formatDate, cn } from '../../lib/utils';
import {
  isSystemTask,
  displayTitle,
  actionLabel,
  typeLabel,
  associationsFor,
  CATEGORY_DOT,
  TASK_TITLE_MAX,
  type TaskRow,
  type TaskCategory,
} from './task-utils';

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  inbox: 'Inbox',
  todo: 'To Do',
  completed: 'Completed',
  archived: 'Archived',
};

export function TaskDetailDialog({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [, navigate] = useLocation();
  const { data: me } = useCurrentUser();

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [attachments, setAttachments] = useState<string[]>(task.attachments ?? []);
  // The dialog renders off a task snapshot, so track the category locally to
  // reflect a status change immediately (the list refetches in the background).
  const [category, setCategoryLocal] = useState<TaskCategory>(task.category as TaskCategory);

  const isAssignee = me?.id === task.assigneeId;
  const isAssigner = me?.id === task.assignedBy;
  const system = isSystemTask(task);

  // Connection-request tasks carry a full contractor/agency profile so the user
  // can evaluate the request right here (parity with the contractors & agencies
  // screens). Only fetched for that task type.
  const connectionDetail = useQuery({
    ...trpc.tasks.connectionDetail.queryOptions({ taskId: task.id }),
    enabled: task.type === 'connectionRequest',
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.tasks.list.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.tasks.counts.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.tasks.teamMembers.queryKey() });
  };

  const update = useMutation({
    ...trpc.tasks.update.mutationOptions(),
    onSuccess: () => { invalidate(); toast.success('Task updated'); onClose(); },
    onError: (e) => toastError(e),
  });
  const setCategory = useMutation({
    ...trpc.tasks.setCategory.mutationOptions(),
    onSuccess: () => { invalidate(); },
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    ...trpc.tasks.delete.mutationOptions(),
    onSuccess: () => { invalidate(); toast.success('Task deleted'); onClose(); },
    onError: (e) => toastError(e),
  });
  const setAttachmentsM = useMutation({
    ...trpc.tasks.setAttachments.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toastError(e),
  });
  // Switching the active org context before navigating mirrors Flutter's
  // handleAgencyWorkflowAction / navigate-to-proposal role+context switch.
  const setActiveContext = useMutation(trpc.users.setActiveContext.mutationOptions());
  function switchContextThen(opts: { selectedAgencyId: string | null; selectedBrandId: string | null }, path: string) {
    setActiveContext.mutate(opts, {
      onSettled: () => { qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }); navigate(path); },
    });
  }

  const perform = useMutation({
    ...trpc.tasks.performAction.mutationOptions(),
    onSuccess: (res) => {
      invalidate();
      // Accepting an invitation can change the user's active role/context (e.g. a
      // staff invite activates the staff role + selected org server-side) — refresh
      // identity + the context selector so the app routes to the new workspace.
      qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.auth.contextOptions.queryKey() });
      onClose();
      if (!res) return;
      switch (res.kind) {
        case 'done':
          toast.success(res.message);
          break;
        case 'navigate':
          navigate(res.to);
          break;
        case 'navigateProposal':
          // Brand-side reviews switch into the brand context first.
          if (res.isBrandView && res.brandId) {
            switchContextThen({ selectedAgencyId: null, selectedBrandId: res.brandId }, res.proposalId ? `/proposal/${res.proposalId}` : '/proposals');
          } else if (res.proposalId) {
            navigate(`/proposal/${res.proposalId}`);
          }
          break;
        case 'navigateProject':
          // Switch into the owning agency context, then open the board.
          if (res.agencyId) {
            switchContextThen({ selectedAgencyId: res.agencyId, selectedBrandId: null }, '/agency-projects');
          } else {
            navigate('/contracts');
          }
          break;
        default:
          break;
      }
    },
    onError: (e) => toastError(e),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  async function onPickAttachment(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAttachment(true);
    try {
      const url = await uploadFile(StorageBucket.Uploads, `tasks/${task.id}`, file);
      const next = [...attachments, url];
      setAttachments(next);
      setAttachmentsM.mutate({ id: task.id, attachments: next });
    } catch (err) {
      toastError(err);
    } finally {
      setUploadingAttachment(false);
    }
  }
  function removeAttachment(url: string) {
    const next = attachments.filter((a) => a !== url);
    setAttachments(next);
    setAttachmentsM.mutate({ id: task.id, attachments: next });
  }

  const label = actionLabel(task);
  const associations = associationsFor(task);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[520px] gap-0 p-0">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[color:var(--color-border-hairline)] px-6 py-4">
          <DialogTitle className="text-base">{displayTitle(task)}</DialogTitle>
          {/* pr-7 reserves room for DialogContent's absolute close (X) button so
              the edit pencil sits to its left instead of underneath it. */}
          <div className="flex items-center gap-2 pr-7">
            {!system && isAssigner && !editing && (
              <button onClick={() => setEditing(true)} className="text-ink-40 hover:text-ink-100" aria-label="Edit">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[480px] overflow-y-auto px-6 py-4">
          {/* Category badge (changeable for non-system or owner) */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {(['inbox', 'todo', 'completed', 'archived'] as TaskCategory[]).map((c) => (
              <button
                key={c}
                onClick={() => {
                  if (c === category) return;
                  const prev = category;
                  setCategoryLocal(c);
                  setCategory.mutate({ id: task.id, category: c, position: 'top' }, { onError: () => setCategoryLocal(prev) });
                }}
                className={
                  'flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-[0.06em] ' +
                  (category === c ? 'border-accent/30 bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-40 hover:text-ink-80')
                }
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', CATEGORY_DOT[c])} />
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>

          {/* Title (editable) */}
          {editing ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TASK_TITLE_MAX} className="mb-4" />
          ) : (
            <h3 className="mb-4 text-lg font-semibold text-ink-100">{task.title}</h3>
          )}

          {/* Metadata */}
          <dl className="mb-4 space-y-2 text-sm">
            <MetaRow label="Type" value={typeLabel(task.type)} />
            <MetaRow label="Assigned by" value={task.assignedBy === 'system' ? 'System' : task.assignedBy === me?.id ? 'You' : (task.assignedByName ?? 'A team member')} />
            {task.organizationName && <MetaRow label="Organization" value={task.organizationName} />}
            {task.agencyName && <MetaRow label="Agency" value={task.agencyName} />}
            {task.brandName && <MetaRow label="Brand" value={task.brandName} />}
            <MetaRow label="Created" value={formatDate(task.createdAt)} />
          </dl>

          {/* Description */}
          {(editing || (task.description && task.description.length > 0)) && (
            <div className="mb-4">
              <p className="mb-1.5 text-sm font-semibold text-ink-100">Description</p>
              {editing ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Add a description..."
                  className="flex w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
                />
              ) : (
                <p className="text-sm text-ink-60">{task.description}</p>
              )}
            </div>
          )}

          {/* Connection request → full contractor/agency profile. */}
          {connectionDetail.data && (
            <div className="mb-4 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] p-4">
              {connectionDetail.data.kind === 'contractor' ? (
                <ContractorProfileView c={connectionDetail.data.contractor} />
              ) : (
                <AgencyProfileView agency={connectionDetail.data.agency} />
              )}
            </div>
          )}

          {/* Attachments */}
          {(isAssigner || attachments.length > 0) && (
            <div className="mb-2">
              <p className="mb-1.5 text-sm font-semibold text-ink-100">Attachments</p>
              <div className="space-y-2">
                {attachments.map((url) => (
                  <div key={url} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-accent/10 px-3 py-2 text-sm">
                    <Paperclip className="h-4 w-4 text-accent" />
                    <a href={url} target="_blank" rel="noreferrer" className="flex-1 truncate text-accent hover:underline">
                      {fileName(url)}
                    </a>
                    <button onClick={() => removeAttachment(url)} aria-label="Remove" className="text-danger">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <input ref={fileRef} type="file" className="hidden" onChange={onPickAttachment} />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingAttachment}
                  className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-accent px-3 py-2 text-sm text-accent hover:bg-accent/5 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> {uploadingAttachment ? 'Uploading…' : 'Add File'}
                </button>
              </div>
            </div>
          )}

          {/* Associations (system task linkage) — clickable where navigable. */}
          {system && isAssignee && associations.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-ink-40">Associated with</p>
              <div className="flex flex-wrap gap-1.5">
                {associations.map((a) =>
                  a.to ? (
                    <button
                      key={a.label}
                      onClick={() => { onClose(); navigate(a.to!); }}
                      className="flex items-center gap-1 rounded-[6px] border border-[color:var(--color-border-default)] bg-accent/5 px-2.5 py-1 text-xs text-ink-80 hover:bg-accent/10"
                    >
                      {a.label}
                      <ArrowRight className="h-3 w-3 text-accent" />
                    </button>
                  ) : (
                    <span key={a.label} className="rounded-[6px] border border-[color:var(--color-border-default)] bg-accent/5 px-2.5 py-1 text-xs text-ink-60">
                      {a.label}
                    </span>
                  ),
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer action bar */}
        <div className="flex items-center justify-between gap-2 border-t border-[color:var(--color-border-hairline)] px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:bg-danger/10"
            disabled={!(isAssignee || isAssigner)}
            onClick={async () => {
              if (!(await confirm({
                title: 'Delete task?',
                description: <>Permanently delete <span className="font-medium text-ink-100">{displayTitle(task)}</span>? This cannot be undone.</>,
                confirmLabel: 'Delete',
                destructive: true,
              }))) return;
              del.mutate({ id: task.id });
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                <Button size="sm" onClick={() => update.mutate({ id: task.id, title, description })} disabled={update.isPending}>Save</Button>
              </>
            ) : (
              system && isAssignee && label && (
                <>
                  {/* Secondary "view" buttons mirror the two-button Flutter footers. */}
                  {task.type === 'agencyApproval' && (
                    <Button variant="outline" size="sm" onClick={() => { onClose(); navigate('/super-admin/agencies'); }}>
                      View Agency
                    </Button>
                  )}
                  {task.type === 'componentApproval' && (
                    <Button variant="outline" size="sm" onClick={() => { onClose(); navigate('/info-hub'); }}>
                      Review
                    </Button>
                  )}
                  <Button variant="accent" size="sm" onClick={() => perform.mutate({ id: task.id })} disabled={perform.isPending}>
                    {task.type === 'agencyApproval' ? 'Accept Agency' : task.type === 'componentApproval' ? 'Make Public' : label}
                  </Button>
                </>
              )
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-ink-40">{label}</dt>
      <dd className="text-ink-80">{value}</dd>
    </div>
  );
}

function fileName(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    if (last.length > 37 && last[36] === '_') return last.slice(37);
    return last || 'File';
  } catch {
    return 'File';
  }
}
