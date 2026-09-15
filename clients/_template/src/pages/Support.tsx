/**
 * NATIVE Support screen — reference implementation.
 *
 * Every Prodesk frontend ships its OWN Support UI so it blends in as just another
 * screen, instead of mounting the shared `@shared/pages/support/support` page
 * (which is styled for the main Prodesk app and looks foreign inside a bespoke
 * skin). What is shared is the DATA layer, not the presentation:
 *   - `@shared/pages/support/use-support` — the tRPC/query hooks.
 *   - `@shared/pages/support/model`       — types, labels, options, upload helper.
 *
 * When you build a real frontend from this template, COPY this file and re-skin it
 * with your app's own components/classes (see clients/links, clients/reviews for
 * worked examples). Keep the hooks + model; only the markup should change. The
 * backend (`trpc.support.*`) is shared and never changes.
 *
 * This template has no design system of its own, so the reference uses the shared
 * design tokens/primitives. It renders the ticket list, the "new ticket" form and
 * a single ticket thread; it is mounted for both `/support` and `/support/:id` and
 * inspects the URL itself.
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
import { Button } from '@shared/components/ui/button';
import { Card, CardContent } from '@shared/components/ui/card';
import { Input } from '@shared/components/ui/input';
import { Field, Select } from '@shared/pages/agency/form-bits';
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
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <div className="flex flex-col gap-6 pt-2">
        <header>
          <div className="text-eyebrow mb-1 text-accent md:mb-2">
            Help &amp; support
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold text-ink-100">
              Support tickets
            </h1>
            {!creating && (
              <Button variant="accent" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New ticket
              </Button>
            )}
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-60">
            Get help from our team. Open a ticket and we'll reply by email and
            here.
          </p>
        </header>

        {creating ? (
          <CreateTicketForm
            onCancel={() => setCreating(false)}
            onCreated={(id) => navigate(`/support/${id}`)}
          />
        ) : list.isLoading ? (
          <p className="py-10 text-center text-sm text-ink-40">Loading…</p>
        ) : tickets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent">
                <LifeBuoy className="h-6 w-6" />
              </span>
              <p className="text-sm text-ink-60">
                You haven't opened any tickets yet.
              </p>
              <Button variant="accent" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New ticket
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {tickets.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => navigate(`/support/${t.id}`)}
                className="press flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card px-4 py-3 text-left transition-colors hover:bg-inset"
              >
                <span className="font-mono text-xs text-ink-40">
                  #{t.ticketNumber}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-100">
                    {t.subject}
                  </span>
                  <span className="text-xs text-ink-40">
                    Updated {formatTicketTime(t.updatedAt)}
                  </span>
                </span>
                <span className="rounded-[var(--radius-sm)] bg-inset px-2 py-0.5 text-xs text-ink-60">
                  {STATUS_LABEL[t.status]}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-40" />
              </button>
            ))}
          </div>
        )}
      </div>
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
    <Card>
      <CardContent className="flex flex-col gap-4 py-6">
        <Field label="Subject" htmlFor="ticket-subject">
          <Input
            id="ticket-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief summary of your issue"
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="ticket-category">
            <Select
              id="ticket-category"
              value={category}
              onChange={(v) => setCategory(v as TicketCategory)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="ticket-priority">
            <Select
              id="ticket-priority"
              value={priority}
              onChange={(v) => setPriority(v as TicketPriority)}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Reply-to email"
          htmlFor="ticket-email"
          hint={`Leave blank to use ${user?.email ?? 'your account email'}.`}
        >
          <Input
            id="ticket-email"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder={user?.email ?? 'you@example.com'}
          />
        </Field>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-ink-100">
            Message
          </span>
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
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={create.isPending}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);
  const reply = useSupportReply(id);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <div className="flex flex-col gap-5 pt-2">
        <button
          type="button"
          onClick={() => navigate('/support')}
          className="press -ml-1 inline-flex items-center gap-1.5 text-sm text-ink-60 transition-colors hover:text-ink-100"
        >
          <ArrowLeft className="h-4 w-4" /> All tickets
        </button>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-ink-40">Loading…</p>
        ) : isError || !data ? (
          <p className="py-10 text-center text-sm text-ink-40">
            Ticket not found.
          </p>
        ) : (
          <>
            <header className="flex flex-col gap-2 border-b border-[color:var(--color-border-default)] pb-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-40">
                <span className="font-mono">#{data.ticket.ticketNumber}</span>
                <span className="rounded-[var(--radius-sm)] bg-inset px-2 py-0.5 text-ink-60">
                  {STATUS_LABEL[data.ticket.status]}
                </span>
                <span>{PRIORITY_LABEL[data.ticket.priority]}</span>
                <span>{CATEGORY_LABEL[data.ticket.category]}</span>
              </div>
              <h1 className="text-xl font-semibold text-ink-100">
                {data.ticket.subject}
              </h1>
              <span className="text-xs text-ink-40">
                Opened {formatTicketTime(data.ticket.createdAt)}
              </span>
            </header>

            <Thread comments={data.comments as TicketComment[]} />

            {data.ticket.status === 'closed' ? (
              <p className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-inset px-4 py-3 text-center text-sm text-ink-40">
                This ticket is closed. Open a new ticket if you still need help.
              </p>
            ) : (
              <Composer
                pathId={id}
                submitLabel="Reply"
                placeholder="Write a reply…"
                sending={reply.isPending}
                onSend={async ({ body, attachments }) => {
                  try {
                    await reply.mutateAsync({
                      ticketId: id,
                      body,
                      attachments,
                    });
                  } catch (e) {
                    toastError(e);
                    throw e;
                  }
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Thread + composer (re-skin these for your frontend) ──────────────── */

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-40">No messages yet.</p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <div
            key={c.id}
            className={
              'rounded-[var(--radius-md)] border px-4 py-3 ' +
              (isSupport
                ? 'border-accent/25 bg-accent/10'
                : 'border-[color:var(--color-border-default)] bg-card')
            }
          >
            <div className="mb-1.5 flex items-center gap-2 text-xs">
              <span className="font-medium text-ink-100">
                {isSupport ? 'Support' : 'You'}
              </span>
              <span className="text-ink-40">
                {formatTicketTime(c.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-80">
              {c.body}
            </p>
            {c.attachments?.map((a) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
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
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-y bg-transparent px-1 py-1 text-sm text-ink-100 outline-none placeholder:text-ink-40"
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
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, j) => j !== i))
                }
                className="text-ink-40 transition-colors hover:text-danger"
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
          className="press inline-flex items-center gap-1.5 text-xs font-medium text-ink-60 transition-colors hover:text-ink-100 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
          {uploading ? 'Uploading…' : 'Attach'}
        </button>
        <Button variant="accent" onClick={submit} disabled={!canSend}>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowUp className="h-4 w-4" />
          )}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
