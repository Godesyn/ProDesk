/**
 * NATIVE Support screen — KEYMASTR's own skin.
 *
 * Every Prodesk frontend ships its OWN Support UI so it reads as just another
 * screen rather than a foreign page dropped into a bespoke kit. What's shared is
 * the DATA layer, never the presentation:
 *   · @shared/pages/support/use-support — the tRPC/query hooks
 *   · @shared/pages/support/model       — types, labels, options, upload helper
 *
 * The backend (`trpc.support.*`) is shared and unchanged; tickets are
 * creator-scoped. Mounted for both /support and /support/:id, and it inspects
 * the URL itself.
 */
import { useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  FileText,
  LifeBuoy,
  Loader2,
  Paperclip,
  Plus,
  X,
} from 'lucide-react';
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
import { Ghost, PageHead, Primary, Specimen } from '../components/primitives';

const control =
  'h-9 w-full rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3.5 text-sm outline-none placeholder:text-[var(--ink-3)]';

export function Support() {
  const [detail, params] = useRoute('/support/:id');
  if (detail && params?.id) return <TicketDetail id={params.id} />;
  return <TicketList />;
}

/* ── List + create ────────────────────────────────────────────────────── */

function TicketList() {
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);
  const list = useSupportTickets();
  const tickets = list.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <PageHead
        eyebrow="HELP & SUPPORT"
        title="Support tickets"
        lede="Open a ticket and we’ll reply here and by email. Never put a password in one — use Send instead, and we’ll never ask for one."
        actions={
          !creating ? (
            <Primary onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New ticket
            </Primary>
          ) : undefined
        }
      />

      {creating ? (
        <CreateTicketForm
          onCancel={() => setCreating(false)}
          onCreated={(id) => navigate(`/support/${id}`)}
        />
      ) : list.isLoading ? (
        <p className="py-14 text-center text-sm text-[var(--ink-3)]">Loading…</p>
      ) : tickets.length === 0 ? (
        <Specimen className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <span
            className="grid h-12 w-12 place-items-center rounded-full"
            style={{ background: 'var(--pigment-soft)', color: 'var(--pigment)' }}
          >
            <LifeBuoy className="h-5 w-5" />
          </span>
          <p className="quill text-[17px]">You haven’t needed us yet.</p>
          <Primary onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> New ticket
          </Primary>
        </Specimen>
      ) : (
        <div
          className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
          style={{ background: 'var(--card)' }}
        >
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/support/${t.id}`)}
              className="ledger-row flex w-full items-center gap-3 px-4 py-3 text-left last:border-b-0"
            >
              <span className="spec w-14 flex-none">#{t.ticketNumber}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {t.subject}
                </span>
                <span className="spec">
                  UPDATED {formatTicketTime(t.updatedAt)}
                </span>
              </span>
              <span className="chip flex-none">{STATUS_LABEL[t.status]}</span>
              <ChevronRight className="h-4 w-4 flex-none text-[var(--ink-3)]" />
            </button>
          ))}
        </div>
      )}
    </div>
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
    <div
      className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-6"
      style={{ background: 'var(--card)' }}
    >
      <div className="flex flex-col gap-4">
        <label className="block">
          <span className="spec mb-1.5 block">Subject</span>
          <input
            className={control}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief summary of your issue"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="spec mb-1.5 block">Category</span>
            <select
              className={control}
              value={category}
              onChange={(e) => setCategory(e.target.value as TicketCategory)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="spec mb-1.5 block">Priority</span>
            <select
              className={control}
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="spec mb-1.5 block">Reply-to email</span>
          <input
            className={control}
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={user?.email ?? 'you@example.com'}
          />
          <span className="spec mt-1.5 block">
            LEAVE BLANK TO USE {user?.email ?? 'YOUR ACCOUNT EMAIL'}
          </span>
        </label>

        <div>
          <span className="spec mb-1.5 block">Message</span>
          <Composer
            submitLabel="Create ticket"
            placeholder="Describe your issue in detail…"
            sending={create.isPending}
            onSend={async ({ body, attachments }) => {
              if (subject.trim().length < 3) {
                toast.error('Please add a subject (at least 3 characters).');
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
          <Ghost onClick={onCancel}>Cancel</Ghost>
        </div>
      </div>
    </div>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);
  const reply = useSupportReply(id);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <button
        type="button"
        onClick={() => navigate('/support')}
        className="spec press mb-6 inline-flex items-center gap-1.5 hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-3 w-3" /> ALL TICKETS
      </button>

      {isLoading ? (
        <p className="py-14 text-center text-sm text-[var(--ink-3)]">Loading…</p>
      ) : isError || !data ? (
        <p className="py-14 text-center text-sm text-[var(--ink-3)]">
          Ticket not found.
        </p>
      ) : (
        <>
          <header className="rise mb-6 border-b border-[var(--hair)] pb-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="spec">#{data.ticket.ticketNumber}</span>
              <span className="chip">{STATUS_LABEL[data.ticket.status]}</span>
              <span className="spec">{PRIORITY_LABEL[data.ticket.priority]}</span>
              <span className="spec">{CATEGORY_LABEL[data.ticket.category]}</span>
            </div>
            <h1 className="mt-3 text-[26px] font-extrabold leading-tight tracking-[-0.02em]">
              {data.ticket.subject}
            </h1>
            <p className="spec mt-2">
              OPENED {formatTicketTime(data.ticket.createdAt)}
            </p>
          </header>

          <Thread comments={data.comments as TicketComment[]} />

          {data.ticket.status === 'closed' ? (
            <p className="mt-6 rounded-[var(--radius-md)] border border-[var(--hair-2)] px-4 py-4 text-center text-sm text-[var(--ink-3)]">
              This ticket is closed. Open a new one if you still need help.
            </p>
          ) : (
            <div className="mt-6">
              <Composer
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Thread + composer ────────────────────────────────────────────────── */

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--ink-3)]">
        No messages yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div
            key={c.id}
            className="rounded-[var(--radius-md)] border px-4 py-3.5"
            style={{
              background: isSupport ? 'var(--pigment-soft)' : 'var(--card)',
              borderColor: isSupport ? 'var(--pigment)' : 'var(--hair-2)',
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold">
                {isSupport ? 'Support' : 'You'}
              </span>
              <span className="spec">{formatTicketTime(c.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--ink-2)]">
              {c.body}
            </p>
            {c.attachments?.map((a) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs hover:underline"
                style={{ color: 'var(--pigment)' }}
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

function Composer({
  onSend,
  sending,
  placeholder = 'Write a reply…',
  pathId = 'drafts',
  submitLabel = 'Send',
}: {
  onSend: (input: {
    body: string;
    attachments: SupportAttachment[];
  }) => void | Promise<void>;
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
    <div
      className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-3"
      style={{ background: 'var(--card)' }}
    >
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y bg-transparent px-1 py-1 text-sm outline-none placeholder:text-[var(--ink-3)]"
      />
      {attachments.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {attachments.map((a, i) => (
            <span key={a.url} className="chip">
              <FileText className="h-3 w-3" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-[var(--ink-3)] transition hover:text-[var(--alarm)]"
              >
                <X className="h-3 w-3" />
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
          className="press inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-2)] transition hover:text-[var(--ink)] disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          {uploading ? 'Uploading…' : 'Attach'}
        </button>
        <Primary onClick={() => void submit()}>
          {sending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowUp className="h-3.5 w-3.5" />
          )}
          {submitLabel}
        </Primary>
      </div>
    </div>
  );
}
