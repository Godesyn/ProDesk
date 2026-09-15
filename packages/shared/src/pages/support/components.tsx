import { useRef, useState, type ReactNode } from 'react';
import { Paperclip, X, FileText, Loader2, ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '../../lib/utils';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { Badge } from '../../components/ui/badge';
import {
  STATUS_LABEL,
  PRIORITY_LABEL,
  formatTicketTime,
  uploadTicketAttachment,
  type SupportAttachment,
  type TicketStatus,
  type TicketPriority,
  type TicketComment,
} from './model';

/* ── Re-exports ────────────────────────────────────────────────────────
   The pure model (types, labels, option lists, formatTicketTime, upload
   helper) lives in `model.ts` so native per-frontend Support pages can import
   it without pulling in these shared-token components. Re-exported here so the
   shared SupportPage and the super-admin console keep their existing imports. */
export {
  formatTicketTime,
  STATUS_LABEL,
  PRIORITY_LABEL,
  CATEGORY_LABEL,
  STATUS_OPTIONS,
  PRIORITY_OPTIONS,
  CATEGORY_OPTIONS,
  type SupportAttachment,
  type TicketStatus,
  type TicketPriority,
  type TicketCategory,
  type TicketComment,
} from './model';

/* ── Badge variant maps (shared-token specific, stay here) ─────────────── */

const STATUS_VARIANT: Record<TicketStatus, 'accent' | 'warn' | 'success' | 'muted'> = {
  open: 'accent',
  in_progress: 'warn',
  resolved: 'success',
  closed: 'muted',
};
const PRIORITY_VARIANT: Record<TicketPriority, 'muted' | 'accent' | 'warn' | 'danger'> = {
  low: 'muted',
  medium: 'accent',
  high: 'warn',
  urgent: 'danger',
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}
export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return <Badge variant={PRIORITY_VARIANT[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

/* ── Attachment chips (click to preview) ──────────────────────────────── */

export function AttachmentChips({ attachments }: { attachments: SupportAttachment[] | null }) {
  const { openFile } = useFileViewer();
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <button
          key={a.url}
          type="button"
          onClick={() => openFile({ url: a.url, title: a.name })}
          className="press inline-flex max-w-[220px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-2.5 py-1.5 text-xs text-ink-80 transition-colors hover:bg-inset"
        >
          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-40" />
          <span className="truncate">{a.name}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Comment thread ───────────────────────────────────────────────────── */

export function TicketThread({
  comments,
  customerLabel = 'You',
}: {
  comments: TicketComment[];
  /** How to label customer messages — "You" for the customer view, "Customer" for admins. */
  customerLabel?: string;
}) {
  if (comments.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-40">No messages yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div
            key={c.id}
            className={cn(
              'rounded-[var(--radius-md)] border px-4 py-3',
              c.isInternal
                ? 'border-warn/35 bg-warn/10'
                : isSupport
                  ? 'border-accent/25 bg-accent/10'
                  : 'border-[color:var(--color-border-default)] bg-card',
            )}
          >
            <div className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="font-medium text-ink-100">
                {isSupport ? 'Support' : customerLabel}
              </span>
              {c.isInternal && <Badge variant="warn">Internal note</Badge>}
              <span className="text-ink-40">{formatTicketTime(c.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-80">{c.body}</p>
            <AttachmentChips attachments={c.attachments} />
          </div>
        );
      })}
    </div>
  );
}

/* ── Composer (textarea + attachment upload + send) ───────────────────── */

export function TicketComposer({
  onSend,
  sending,
  placeholder = 'Write a reply…',
  pathId = 'drafts',
  submitLabel = 'Send',
  children,
}: {
  onSend: (input: { body: string; attachments: SupportAttachment[] }) => void | Promise<void>;
  sending?: boolean;
  placeholder?: string;
  /** Storage sub-path (ticket id, or 'drafts' before the ticket exists). */
  pathId?: string;
  submitLabel?: string;
  /** Extra footer controls (e.g. an internal-note toggle). */
  children?: ReactNode;
}) {
  const [body, setBody] = useState('');
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const attachment = await uploadTicketAttachment(pathId, file);
        setAttachments((prev) => [...prev, attachment]);
      }
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const canSend = body.trim().length > 0 && !sending && !uploading;

  const submit = async () => {
    if (!canSend) return;
    await onSend({ body: body.trim(), attachments });
    setBody('');
    setAttachments([]);
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y rounded-[var(--radius-sm)] bg-transparent px-1 py-1 text-sm text-ink-100 outline-none placeholder:text-ink-40"
      />
      {attachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span
              key={a.url}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset px-2 py-1 text-xs text-ink-80"
            >
              <FileText className="h-3.5 w-3.5 text-ink-40" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="text-ink-40 transition-colors hover:text-danger"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onPick(e.target.files)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="press inline-flex items-center gap-1.5 text-xs font-medium text-ink-60 transition-colors hover:text-ink-100 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            {uploading ? 'Uploading…' : 'Attach'}
          </button>
          {children}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend}
          className="press inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:bg-accent-hover disabled:opacity-40"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
