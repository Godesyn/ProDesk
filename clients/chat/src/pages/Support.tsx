import { useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowUp, FileText, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useCurrentUser } from '@shared/auth/auth-context';
import {
  useSupportTickets,
  useSupportTicket,
  useCreateSupportTicket,
  useSupportReply,
} from '@shared/pages/support/use-support';
import {
  formatTicketTime,
  uploadTicketAttachment,
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  STATUS_LABEL,
  type SupportAttachment,
  type TicketCategory,
  type TicketComment,
  type TicketPriority,
} from '@shared/pages/support/model';
import { EmptyState, GhostButton, LiveButton, Spec } from '../components/primitives';

/**
 * NATIVE Support screen.
 *
 * Every Prodesk frontend ships its OWN Support UI so it reads as just another
 * screen rather than a page from a different application. What is shared is the
 * DATA layer, never the presentation: `@shared/pages/support/use-support` for the
 * hooks and `@shared/pages/support/model` for types, labels and the upload
 * helper. The backend (`trpc.support.*`) is shared and never changes.
 *
 * The re-skin matters more here than in the paper-stage frontends: the shared
 * page paints `text-ink-100` on `bg-card`, which inside `.cx-ui` on the Night
 * ground is near-black text on a near-black room.
 *
 * Mounted for both `/support` and `/support/:id`; it inspects the URL itself,
 * which is the same shape every other frontend uses.
 */
export function Support() {
  const [detail, params] = useRoute('/support/:id');
  if (detail && params?.id) return <TicketDetail id={params.id} />;
  return <TicketList />;
}

/* ---------------------------------------------------------------- surfaces */

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pb-20 pt-8">{children}</div>
    </div>
  );
}

function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`cx-card p-5 ${className}`}>{children}</div>;
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block">
      <Spec>{children}</Spec>
    </label>
  );
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--room-3)',
  border: '1px solid var(--wire)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--voice)',
};

/* ------------------------------------------------------------ list + create */

function TicketList() {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const list = useSupportTickets();
  const tickets = list.data?.items ?? [];

  return (
    <Sheet>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Spec>Help</Spec>
          <h1 className="mt-1.5 text-[26px] font-bold tracking-tight" style={{ color: 'var(--voice)' }}>
            Support
          </h1>
          <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--voice-2)' }}>
            Open a ticket and we’ll reply here and by email.
          </p>
        </div>
        {!creating && (
          <LiveButton onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New ticket
          </LiveButton>
        )}
      </header>

      {creating ? (
        <CreateTicketForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => navigate(`/support/${id}`)}
        />
      ) : list.isLoading ? (
        <p className="py-12 text-center">
          <Spec>Loading…</Spec>
        </p>
      ) : tickets.length === 0 ? (
        <EmptyState
          line="Nothing open. That’s the good outcome."
          action={
            <LiveButton onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> New ticket
            </LiveButton>
          }
        />
      ) : (
        <div className="flex flex-col">
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/support/${t.id}`)}
              className="cx-listrow flex items-center gap-3 rounded-[var(--radius-sm)] px-3 py-3 text-left"
              style={{ borderBottom: '1px solid var(--wire)' }}
            >
              <Spec>#{t.ticketNumber}</Spec>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-semibold"
                  style={{ color: 'var(--voice)' }}
                >
                  {t.subject}
                </span>
                <span className="spec mt-0.5 block normal-case tracking-normal">
                  Updated {formatTicketTime(t.updatedAt)}
                </span>
              </span>
              <Spec>{STATUS_LABEL[t.status]}</Spec>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function CreateTicketForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const { data: user } = useCurrentUser();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('general');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [contactEmail, setContactEmail] = useState('');
  const create = useCreateSupportTicket();

  return (
    <Panel className="flex flex-col gap-5">
      <div>
        <Label htmlFor="ticket-subject">Subject</Label>
        <input
          id="ticket-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="What’s wrong?"
          className="h-10 w-full px-3 text-sm outline-none"
          style={fieldStyle}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ticket-category">Category</Label>
          <select
            id="ticket-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketCategory)}
            className="h-10 w-full px-3 text-sm outline-none"
            style={fieldStyle}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="ticket-priority">Priority</Label>
          <select
            id="ticket-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TicketPriority)}
            className="h-10 w-full px-3 text-sm outline-none"
            style={fieldStyle}
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label htmlFor="ticket-email">Reply-to email</Label>
        <input
          id="ticket-email"
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder={user?.email ?? 'you@example.com'}
          className="h-10 w-full px-3 text-sm outline-none"
          style={fieldStyle}
        />
      </div>

      <div>
        <Label>Message</Label>
        <TicketComposer
          submitLabel="Create ticket"
          placeholder="Describe what happened…"
          sending={create.isPending}
          onSend={async ({ body, attachments }) => {
            if (subject.trim().length < 3) {
              toast.error('Add a subject — at least three characters.');
              throw new Error('missing subject');
            }
            try {
              const ticket = await create.mutateAsync({
                subject: subject.trim(),
                category,
                priority,
                body,
                attachments,
                contactEmail: contactEmail.trim() || undefined,
              });
              toast.success(`Ticket #${ticket.ticketNumber} created`);
              onCreated(ticket.id);
            } catch (e) {
              toastError(e);
              throw e;
            }
          }}
        />
      </div>

      <div className="flex justify-end">
        <GhostButton onClick={onCancel} disabled={create.isPending}>
          Cancel
        </GhostButton>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ detail */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);
  const reply = useSupportReply(id);

  return (
    <Sheet>
      <button
        type="button"
        onClick={() => navigate('/support')}
        className="press -ml-1 mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
        style={{ color: 'var(--voice-2)' }}
      >
        <ArrowLeft className="h-4 w-4" /> All tickets
      </button>

      {isLoading ? (
        <p className="py-12 text-center">
          <Spec>Loading…</Spec>
        </p>
      ) : isError || !data ? (
        <EmptyState line="That ticket isn’t here." />
      ) : (
        <>
          <header className="pb-5" style={{ borderBottom: '1px solid var(--wire)' }}>
            <div className="flex flex-wrap items-center gap-3">
              <Spec>#{data.ticket.ticketNumber}</Spec>
              <Spec>{STATUS_LABEL[data.ticket.status]}</Spec>
              <Spec>{PRIORITY_LABEL[data.ticket.priority]}</Spec>
              <Spec>{CATEGORY_LABEL[data.ticket.category]}</Spec>
            </div>
            <h1
              className="mt-2 text-[22px] font-bold tracking-tight"
              style={{ color: 'var(--voice)' }}
            >
              {data.ticket.subject}
            </h1>
            <span className="spec mt-1.5 block normal-case tracking-normal">
              Opened {formatTicketTime(data.ticket.createdAt)}
            </span>
          </header>

          <Thread comments={data.comments as TicketComment[]} />

          {data.ticket.status === 'closed' ? (
            <p className="cx-card px-4 py-3 text-center text-sm" style={{ color: 'var(--voice-2)' }}>
              This ticket is closed. Open a new one if you still need help.
            </p>
          ) : (
            <TicketComposer
              pathId={id}
              submitLabel="Reply"
              placeholder="Write a reply…"
              sending={reply.isPending}
              onSend={async ({ body, attachments }) => {
                try {
                  await reply.mutateAsync({ ticketId: id, body, attachments });
                } catch (e) {
                  toastError(e);
                  throw e;
                }
              }}
            />
          )}
        </>
      )}
    </Sheet>
  );
}

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="py-10 text-center">
        <Spec>No messages yet</Spec>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6 py-7">
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div key={c.id}>
            <div className="mb-1 flex items-baseline gap-2.5">
              <span
                className="text-[12.5px] font-bold tracking-tight"
                style={{ color: 'var(--voice)' }}
              >
                {isSupport ? 'Support' : 'You'}
              </span>
              <Spec>{formatTicketTime(c.createdAt)}</Spec>
            </div>
            <p className="speech whitespace-pre-wrap" style={{ color: 'var(--voice)' }}>
              {c.body}
            </p>
            {c.attachments?.map((a) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs hover:underline"
                style={{ color: 'var(--live)' }}
              >
                <FileText className="h-3.5 w-3.5" /> {a.name}
              </a>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- composer */

function TicketComposer({
  onSend,
  sending,
  placeholder = 'Write a reply…',
  pathId = 'drafts',
  submitLabel = 'Send',
}: {
  onSend: (input: { body: string; attachments: SupportAttachment[] }) => void | Promise<void>;
  sending?: boolean;
  placeholder?: string;
  pathId?: string;
  submitLabel?: string;
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
    <div className="cx-composer p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="cx-textarea w-full px-1 py-1"
      />
      {attachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={a.url} className="cx-chip" style={{ height: 26 }}>
              <FileText className="h-3.5 w-3.5" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
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
          className="press inline-flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
          style={{ color: 'var(--voice-2)' }}
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          {uploading ? 'Uploading…' : 'Attach'}
        </button>
        <LiveButton armed={canSend} onClick={submit} disabled={!canSend}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          {submitLabel}
        </LiveButton>
      </div>
    </div>
  );
}
