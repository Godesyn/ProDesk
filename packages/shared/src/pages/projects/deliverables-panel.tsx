import { useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Type, Pencil, Trash2, Upload, Eye, Check, X, GripVertical, Highlighter } from 'lucide-react';
import { toast } from 'sonner';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { Badge, type BadgeProps } from '../../components/ui/badge';
import { UploadProgressBar } from '../../components/upload-progress';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { type UploadProgress } from '../../lib/storage';
import { isAnnotatable } from '../../components/file-annotator/annotatable';
import { uploadProjectFile, kindOf } from './storage';

export type Deliverable = {
  id: string;
  type: 'text' | 'document' | 'image';
  content: string | null;
  fileName: string | null;
  description: string | null;
  status: string;
  rejectionReason: string | null;
  /** Deliverable cycle the row belongs to (cycling projects; null = legacy → current). */
  cycle?: number | null;
};

const DELIVERABLE_STATUS: Record<string, BadgeProps['variant']> = { approved: 'success', rejected: 'danger', pending: 'warn' };

function DeliverableRow({
  d,
  editable,
  selectable,
  selected,
  onToggle,
  onRemove,
  onRename,
  onAnnotate,
  dragHandle,
  optimistic,
  pendingLabel,
  pendingBadge,
}: {
  d: Deliverable;
  editable: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  onRename?: (patch: { content?: string; fileName?: string }) => void;
  onAnnotate?: () => void;
  dragHandle?: React.ReactNode;
  /** Optimistic/in-flight row: faded, actions disabled, shows a pending hint. */
  optimistic?: boolean;
  /** Hint shown on an optimistic row (e.g. "Uploading…", "Saving…"). */
  pendingLabel?: string;
  /** Badge shown on status:'pending' rows (normally hidden) — e.g. "Staged". */
  pendingBadge?: string;
}) {
  const { openFile } = useFileViewer();
  const confirm = useConfirm();
  const isHeadline = d.type === 'text' && (d.content ?? '').startsWith('# ');
  const title = d.fileName ?? (d.type === 'image' ? 'Image' : d.type === 'document' ? 'Document' : '');
  const Icon = d.type === 'image' ? ImageIcon : d.type === 'document' ? FileText : Type;

  // Inline rename (manage_deliverables_dialog edit action): text deliverables edit
  // their content (headline keeps its "# " marker), file deliverables rename the
  // displayed fileName. Seeded from the current value when editing begins.
  const [editing, setEditing] = useState(false);
  const initial = d.type === 'text' ? (isHeadline ? (d.content ?? '').slice(2) : (d.content ?? '')) : title;
  const [draft, setDraft] = useState(initial);

  const beginEdit = () => { setDraft(initial); setEditing(true); };
  const commit = () => {
    const v = draft.trim();
    if (v) {
      if (d.type === 'text') onRename?.({ content: isHeadline ? `# ${v}` : v });
      else onRename?.({ fileName: v });
    }
    setEditing(false);
  };

  // Headlines act as section headers (transparent, bold); notes and files sit in
  // cards. Optimistic/in-flight rows fade out and drop their edit affordances.
  const containerClass = cn(
    'flex items-center gap-3 rounded-[var(--radius-sm)]',
    isHeadline ? 'border-0 bg-transparent px-1 pb-1 pt-3' : 'border border-[color:var(--color-border-hairline)] bg-card p-3',
    selected && 'ring-1 ring-accent/50',
    optimistic && 'pointer-events-none opacity-60',
  );
  const showActions = editable && !optimistic;

  return (
    <div className={containerClass}>
      {dragHandle}
      {selectable && !optimistic && (
        <input type="checkbox" checked={!!selected} onChange={onToggle} className="h-4 w-4 accent-[var(--color-accent)]" />
      )}
      {editing ? (
        <>
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
            className="flex-1"
          />
          <Button size="icon" variant="ghost" onClick={commit} aria-label="Save"><Check className="h-4 w-4 text-success" /></Button>
          <Button size="icon" variant="ghost" onClick={() => setEditing(false)} aria-label="Cancel"><X className="h-4 w-4 text-ink-40" /></Button>
        </>
      ) : (
        <>
          {d.type === 'text' ? (
            isHeadline ? (
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight text-ink-100">{(d.content ?? '').slice(2)}</span>
            ) : (
              <span className="line-clamp-3 min-w-0 flex-1 whitespace-pre-line break-words text-sm leading-relaxed text-ink-60">{d.content}</span>
            )
          ) : (
            <button
              type="button"
              onClick={() => d.content && openFile({ url: d.content, title, fileType: d.type === 'image' ? 'image' : undefined })}
              className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-accent"
              disabled={!d.content}
            >
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]', d.type === 'image' ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn')}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="min-w-0 truncate text-sm font-medium text-ink-100">{title}</span>
                <span className="text-xs text-ink-40">{d.type === 'image' ? 'Image' : 'Document'}</span>
              </span>
              {d.content && <Eye className="h-4 w-4 shrink-0 text-ink-40" />}
            </button>
          )}
          {optimistic ? (
            <span className="shrink-0 text-xs italic text-ink-40">{pendingLabel ?? 'Saving…'}</span>
          ) : (
            <>
              {d.status && d.status !== 'pending' && <Badge className="shrink-0" variant={DELIVERABLE_STATUS[d.status] ?? 'muted'}>{d.status}</Badge>}
              {pendingBadge && d.status === 'pending' && !isHeadline && <Badge className="shrink-0" variant="muted">{pendingBadge}</Badge>}
              {onAnnotate && d.content && isAnnotatable(d.fileName ?? d.content, d.type) && (
                <Button size="icon" variant="ghost" className="shrink-0" onClick={onAnnotate} aria-label="Annotate" title="Annotate & attach">
                  <Highlighter className="h-4 w-4 text-accent" />
                </Button>
              )}
              {showActions && (
                <div className="flex shrink-0 items-center gap-1">
                  {onRename && (
                    <Button size="icon" variant="ghost" onClick={beginEdit} aria-label="Rename"><Pencil className="h-4 w-4 text-accent" /></Button>
                  )}
                  {onRemove && (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove"
                      onClick={async () => {
                        if (!(await confirm({
                          title: 'Delete deliverable?',
                          description: <>Permanently delete <span className="font-medium text-ink-100">{title || 'this deliverable'}</span>? This cannot be undone.</>,
                          confirmLabel: 'Delete',
                          destructive: true,
                        }))) return;
                        onRemove();
                      }}
                    ><Trash2 className="h-4 w-4 text-danger" /></Button>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Reusable deliverable list with upload (image/document), add-headline, add-note,
 * and remove. Mirrors manage_deliverables_dialog. `onAdd` and `onRemove` are
 * mutations supplied by the caller so the same panel serves both the agency
 * detail screen and the contractor workspace.
 */
export function DeliverablesPanel({
  projectId,
  deliverables,
  editable,
  selectable,
  selectedIds,
  onToggleSelect,
  onAdd,
  onRemove,
  onRename,
  onReorder,
  onAnnotate,
  pending,
  pendingBadge,
  emptyLabel,
}: {
  projectId: string;
  deliverables: Deliverable[];
  editable: boolean;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onAdd?: (input: { type: 'text' | 'document' | 'image'; content?: string; fileName?: string }) => void;
  onRemove?: (id: string) => void;
  onRename?: (id: string, patch: { content?: string; fileName?: string }) => void;
  onReorder?: (orderedIds: string[]) => void;
  onAnnotate?: (d: Deliverable) => void;
  pending?: boolean;
  /** Badge shown on status:'pending' rows (normally hidden) — e.g. "Staged". */
  pendingBadge?: string;
  /** Copy for the empty list (defaults to "No deliverables yet."). */
  emptyLabel?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  // Files currently uploading — rendered as faded placeholder rows so the
  // deliverable appears immediately ("being uploaded") before the server stores it.
  const [pendingUploads, setPendingUploads] = useState<{ id: string; name: string; kind: 'document' | 'image' }[]>([]);
  const [text, setText] = useState('');
  const [headline, setHeadline] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const reorderable = editable && !!onReorder && deliverables.length > 1;

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = deliverables.map((d) => d.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder?.(arrayMove(ids, from, to));
  }

  function addHeadline() {
    const v = headline.trim();
    if (!v || pending || !onAdd) return;
    onAdd({ type: 'text', content: `# ${v}` });
    setHeadline('');
  }
  function addNote() {
    const v = text.trim();
    if (!v || pending || !onAdd) return;
    onAdd({ type: 'text', content: v });
    setText('');
  }

  async function handleFiles(files: FileList | null) {
    if (!files || !onAdd) return;
    setUploading(true);
    setProgress(null);
    try {
      for (const file of Array.from(files)) {
        const placeholderId = `upload-${crypto.randomUUID()}`;
        const kind = kindOf(file.name); // 'image' | 'document'
        // Show the file immediately (faded, "Uploading…") while it transfers.
        setPendingUploads((u) => [...u, { id: placeholderId, name: file.name, kind }]);
        try {
          const url = await uploadProjectFile(projectId, 'deliverables', file, setProgress);
          // Hand off to the optimistic add (a faded "Saving…" row) and drop the
          // upload placeholder in the same render so there's no flicker.
          setPendingUploads((u) => u.filter((p) => p.id !== placeholderId));
          onAdd({ type: kind, content: url, fileName: file.name });
        } catch (e) {
          setPendingUploads((u) => u.filter((p) => p.id !== placeholderId));
          throw e;
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // An optimistic row is one the server hasn't confirmed yet (temp id).
  const isOptimistic = (d: Deliverable) => d.id.startsWith('temp-');

  return (
    <div className="flex flex-col gap-3">
      {deliverables.length === 0 && pendingUploads.length === 0 ? (
        <p className="rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border-hairline)] p-6 text-center text-sm text-ink-40">{emptyLabel ?? 'No deliverables yet.'}</p>
      ) : reorderable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={deliverables.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {deliverables.map((d) => (
                <SortableDeliverable
                  key={d.id}
                  d={d}
                  editable={editable}
                  optimistic={isOptimistic(d)}
                  selectable={selectable}
                  selected={selectedIds?.has(d.id)}
                  onToggle={() => onToggleSelect?.(d.id)}
                  onRemove={onRemove ? () => onRemove(d.id) : undefined}
                  onRename={onRename ? (patch) => onRename(d.id, patch) : undefined}
                  onAnnotate={onAnnotate ? () => onAnnotate(d) : undefined}
                  pendingBadge={pendingBadge}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="flex flex-col gap-2">
          {deliverables.map((d) => (
            <DeliverableRow
              key={d.id}
              d={d}
              editable={editable}
              optimistic={isOptimistic(d)}
              selectable={selectable}
              selected={selectedIds?.has(d.id)}
              onToggle={() => onToggleSelect?.(d.id)}
              onRemove={onRemove ? () => onRemove(d.id) : undefined}
              onRename={onRename ? (patch) => onRename(d.id, patch) : undefined}
              onAnnotate={onAnnotate ? () => onAnnotate(d) : undefined}
              pendingBadge={pendingBadge}
            />
          ))}
        </div>
      )}

      {/* Files mid-upload: faded placeholder rows so the deliverable shows
          immediately, before the upload + server store finish. */}
      {pendingUploads.length > 0 && (
        <div className="flex flex-col gap-2">
          {pendingUploads.map((u) => (
            <DeliverableRow
              key={u.id}
              d={{ id: u.id, type: u.kind, content: null, fileName: u.name, description: null, status: 'pending', rejectionReason: null }}
              editable={false}
              optimistic
              pendingLabel="Uploading…"
            />
          ))}
        </div>
      )}

      {editable && onAdd && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-inset/40 p-3">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
          <Button variant="outline" size="sm" disabled={uploading || pending} onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" />{' '}
            {uploading
              ? progress?.phase === 'compressing'
                ? `Compressing… ${Math.round((progress.progress ?? 0) * 100)}%`
                : 'Uploading…'
              : 'Upload image / document'}
          </Button>
          {uploading && <UploadProgressBar progress={progress} />}
          <div className="flex gap-2">
            <Input
              placeholder="Add a headline…"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addHeadline(); } }}
            />
            <Button variant="ghost" size="sm" disabled={!headline.trim() || pending} onClick={addHeadline}>
              <Check className="h-4 w-4" /> Add
            </Button>
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add a note…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } }}
            />
            <Button variant="ghost" size="sm" disabled={!text.trim() || pending} onClick={addNote}>
              <Check className="h-4 w-4" /> Note
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A DeliverableRow wrapped for drag-to-reorder (dnd-kit), with a grab handle. */
function SortableDeliverable(props: {
  d: Deliverable;
  editable: boolean;
  optimistic?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  onRemove?: () => void;
  onRename?: (patch: { content?: string; fileName?: string }) => void;
  onAnnotate?: () => void;
  pendingBadge?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.d.id, disabled: props.optimistic });
  // Inline the CSS transform (avoids a dependency on @dnd-kit/utilities).
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 1 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <DeliverableRow
        {...props}
        dragHandle={
          <button {...attributes} {...listeners} className="cursor-grab touch-none text-ink-30 hover:text-ink-60" aria-label="Drag to reorder">
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

export { DeliverableRow };
