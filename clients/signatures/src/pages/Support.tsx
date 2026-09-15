/*
 * SIGKITT — Support. Every Prodesk frontend ships its OWN Support UI so it blends
 * in as just another screen, rather than mounting the shared support page (styled
 * for the main Prodesk app). What's shared is the DATA layer, not the look:
 *   - `@shared/pages/support/use-support` — the tRPC/query hooks (they run on the
 *     shared tRPC context, which SIGKITT also provides).
 *   - `@shared/pages/support/model`       — types, labels, options, upload helper.
 * This page is re-skinned with SIGKITT's shadcn/lime kit and renders inside the
 * DashboardLayout. It owns both the list/create view and the ticket thread,
 * deciding which to show from the wouter route. See clients/_template/src/pages/
 * Support.tsx for the behavioural reference.
 */
import { useRef, useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import {
  ArrowLeft,
  ChevronRight,
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
  type TicketStatus,
} from '@shared/pages/support/model';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const LIME = 'bg-primary text-[#0E0E0C] hover:bg-primary/85';

/** Status pill — lime while the ticket is live, neutral once it's done. */
function StatusBadge({ status }: { status: TicketStatus }) {
  const live = status === 'open' || status === 'in_progress';
  return live ? (
    <Badge className="bg-primary text-[#0E0E0C] hover:bg-primary">
      {STATUS_LABEL[status]}
    </Badge>
  ) : (
    <Badge variant="secondary">{STATUS_LABEL[status]}</Badge>
  );
}

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
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0E0E0C]">
            Support
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Get help from our team. Open a ticket and we&rsquo;ll reply by email
            and here.
          </p>
        </div>
        <Button
          className={`shrink-0 ${LIME}`}
          onClick={() => setCreating(true)}
        >
          <Plus className="h-4 w-4" />
          New ticket
        </Button>
      </div>

      {list.isLoading ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center text-muted-foreground">
          Loading…
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center">
          <LifeBuoy className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-semibold text-[#0E0E0C]">No tickets yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a ticket and our team will get back to you.
          </p>
          <Button className={`mt-4 ${LIME}`} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New ticket
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => navigate(`/support/${t.id}`)}
              className="flex items-center gap-3 rounded-xl border border-[#0E0E0C]/10 bg-card px-4 py-3 text-left transition-colors hover:bg-muted"
            >
              <span className="font-mono text-xs text-muted-foreground">
                #{t.ticketNumber}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {t.subject}
                </span>
                <span className="text-xs text-muted-foreground">
                  Updated {formatTicketTime(t.updatedAt)}
                </span>
              </span>
              <StatusBadge status={t.status} />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      <CreateTicketDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(id) => {
          setCreating(false);
          navigate(`/support/${id}`);
        }}
      />
    </div>
  );
}

function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const { data: user } = useCurrentUser();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('general');
  const [priority, setPriority] = useState<TicketPriority>('medium');
  const [contactEmail, setContactEmail] = useState('');
  const [body, setBody] = useState('');
  const attach = useAttachments('drafts');
  const create = useCreateSupportTicket();

  const reset = () => {
    setSubject('');
    setCategory('general');
    setPriority('medium');
    setContactEmail('');
    setBody('');
    attach.reset();
  };

  const canSubmit =
    subject.trim().length >= 3 &&
    body.trim().length > 0 &&
    !create.isPending &&
    !attach.uploading;

  const submit = async () => {
    if (subject.trim().length < 3) {
      toast.error('Please add a subject (at least 3 characters).');
      return;
    }
    if (body.trim().length === 0) {
      toast.error('Please add a message.');
      return;
    }
    try {
      const ticket = await create.mutateAsync({
        subject: subject.trim(),
        category,
        priority,
        body: body.trim(),
        attachments: attach.attachments,
        contactEmail: contactEmail.trim() || undefined,
      });
      toast.success(`Ticket #${ticket.ticketNumber} created`);
      reset();
      onCreated(ticket.id);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              autoFocus
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of your issue"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as TicketCategory)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TicketPriority)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-email">Reply-to email</Label>
            <Input
              id="ticket-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder={user?.email ?? 'you@example.com'}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use {user?.email ?? 'your account email'}.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ticket-body">Message</Label>
            <Textarea
              id="ticket-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your issue in detail…"
              rows={5}
            />
            <AttachmentBar attach={attach} />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            Cancel
          </Button>
          <Button
            className={LIME}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const { data, isLoading, isError } = useSupportTicket(id);
  const reply = useSupportReply(id);

  return (
    <div className="mx-auto max-w-5xl">
      <button
        type="button"
        onClick={() => navigate('/support')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All tickets
      </button>

      {isLoading ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center text-muted-foreground">
          Loading…
        </div>
      ) : isError || !data ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center text-muted-foreground">
          Ticket not found.
        </div>
      ) : (
        <>
          <header className="mb-6 border-b border-[#0E0E0C]/10 pb-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">#{data.ticket.ticketNumber}</span>
              <StatusBadge status={data.ticket.status} />
              <span>{PRIORITY_LABEL[data.ticket.priority]}</span>
              <span>·</span>
              <span>{CATEGORY_LABEL[data.ticket.category]}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0E0E0C]">
              {data.ticket.subject}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Opened {formatTicketTime(data.ticket.createdAt)}
            </p>
          </header>

          <Thread comments={data.comments as TicketComment[]} />

          {data.ticket.status === 'closed' ? (
            <p className="mt-6 rounded-xl border border-[#0E0E0C]/10 bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
              This ticket is closed. Open a new ticket if you still need help.
            </p>
          ) : (
            <div className="mt-6">
              <ReplyComposer
                pathId={id}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Thread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No messages yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {comments.map((c) => {
        const isSupport = c.authorRole === 'support';
        return (
          <Card
            key={c.id}
            className={
              isSupport
                ? 'gap-2 border-primary bg-primary/15 py-4'
                : 'gap-2 bg-card py-4'
            }
          >
            <CardContent className="px-4">
              <div className="mb-1.5 flex items-center gap-2 text-xs">
                <span className="font-medium text-[#0E0E0C]">
                  {isSupport ? 'Support' : 'You'}
                </span>
                <span className="text-muted-foreground">
                  {formatTicketTime(c.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {c.body}
              </p>
              {c.attachments?.map((a) => (
                <a
                  key={a.url}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#0E0E0C] underline-offset-4 hover:underline"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  {a.name}
                </a>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* ── Reply composer + shared attachment logic ─────────────────────────── */

/** Attachment upload state, shared by the create dialog and the reply composer. */
function useAttachments(pathId: string) {
  const [attachments, setAttachments] = useState<SupportAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (files: FileList | null) => {
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

  const remove = (index: number) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));

  const reset = () => {
    setAttachments([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  return { attachments, uploading, pick, remove, reset, inputRef };
}

type AttachState = ReturnType<typeof useAttachments>;

/** Attach button + selected-file chips, reused across both composers. */
function AttachmentBar({ attach }: { attach: AttachState }) {
  return (
    <div className="flex flex-col gap-2">
      {attach.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attach.attachments.map((a, i) => (
            <span
              key={a.url}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#0E0E0C]/12 bg-muted px-2 py-1 text-xs text-foreground"
            >
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[160px] truncate">{a.name}</span>
              <button
                type="button"
                aria-label={`Remove ${a.name}`}
                onClick={() => attach.remove(i)}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={attach.inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void attach.pick(e.target.files)}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit text-muted-foreground"
        disabled={attach.uploading}
        onClick={() => attach.inputRef.current?.click()}
      >
        {attach.uploading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Paperclip className="h-4 w-4" />
        )}
        {attach.uploading ? 'Uploading…' : 'Attach files'}
      </Button>
    </div>
  );
}

function ReplyComposer({
  onSend,
  sending,
  pathId,
}: {
  onSend: (input: {
    body: string;
    attachments: SupportAttachment[];
  }) => void | Promise<void>;
  sending?: boolean;
  pathId: string;
}) {
  const [body, setBody] = useState('');
  const attach = useAttachments(pathId);

  const canSend = body.trim().length > 0 && !sending && !attach.uploading;

  const submit = async () => {
    if (!canSend) return;
    await onSend({ body: body.trim(), attachments: attach.attachments });
    setBody('');
    attach.reset();
  };

  return (
    <div className="rounded-xl border border-[#0E0E0C]/10 bg-card p-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write a reply…"
        rows={3}
        className="border-0 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <AttachmentBar attach={attach} />
        <Button
          className={`shrink-0 ${LIME}`}
          disabled={!canSend}
          onClick={() => void submit()}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Reply
        </Button>
      </div>
    </div>
  );
}
