import { useState } from 'react';
import { useLocation, useRoute } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Plus, LifeBuoy, ChevronRight, Loader2 } from 'lucide-react';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useCreateSupportTicket } from './use-support';
import { useCurrentUser } from '../../auth/auth-context';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Field, Select } from '../agency/form-bits';
import {
  TicketThread,
  TicketComposer,
  StatusBadge,
  PriorityBadge,
  formatTicketTime,
  CATEGORY_LABEL,
  CATEGORY_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  type TicketCategory,
  type TicketPriority,
  type TicketComment,
} from './components';

/**
 * Shared customer Support page — mounted at `/support` (list + create) and
 * `/support/:id` (thread) in every frontend. Creator-scoped: a user only sees
 * the tickets they opened. Super-admins triage from /super-admin/tickets.
 */
/**
 * Whether the current ticket detail was reached by tapping a row in OUR list
 * (vs. a deep link, e.g. a support-email link straight to /support/:id). The
 * list PUSHES the detail entry, so "All tickets" can simply POP it — pushing a
 * fresh /support entry instead made the list's Back arrow (history.back) pop
 * right back into the detail, trapping the user cycling inside /support.
 */
let cameFromList = false;

export function SupportPage() {
  const [detail, params] = useRoute('/support/:id');
  if (detail && params?.id) return <TicketDetail id={params.id} />;
  return <TicketList />;
}

/* ── List + create ────────────────────────────────────────────────────── */

function TicketList() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const [creating, setCreating] = useState(false);

  const list = useQuery(trpc.support.list.queryOptions({ limit: 50, offset: 0 }));
  const tickets = list.data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <div className="flex flex-col gap-6 pt-2">
        <header>
          <button
            type="button"
            onClick={() => window.history.back()}
            aria-label="Back"
            className="press mb-3 -ml-1 inline-flex text-ink-60 transition-colors hover:text-ink-100 md:mb-5"
          >
            <ArrowLeft className="h-7 w-7" />
          </button>
          <div className="text-eyebrow mb-1 text-accent md:mb-2">Help &amp; support</div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-section-title text-ink-100">
              Support <span className="text-serif-italic text-accent">tickets</span>
            </h1>
            {!creating && (
              <Button variant="accent" onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" /> New ticket
              </Button>
            )}
          </div>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-60 max-md:hidden">
            Get help from our team. Open a ticket and we'll reply by email and here.
          </p>
        </header>

        {creating ? (
          <CreateTicketForm
            onCancel={() => setCreating(false)}
            onCreated={(id) => {
              cameFromList = true;
              navigate(`/support/${id}`);
            }}
          />
        ) : list.isLoading ? (
          <p className="py-10 text-center text-sm text-ink-40">Loading…</p>
        ) : tickets.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/10 text-accent">
                <LifeBuoy className="h-6 w-6" />
              </span>
              <p className="text-sm text-ink-60">You haven't opened any tickets yet.</p>
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
                onClick={() => {
                  cameFromList = true;
                  navigate(`/support/${t.id}`);
                }}
                className="press flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card px-4 py-3 text-left transition-colors hover:bg-inset"
              >
                <span className="font-mono text-xs text-ink-40">#{t.ticketNumber}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-100">{t.subject}</span>
                  <span className="text-xs text-ink-40">
                    Updated {formatTicketTime(t.updatedAt)}
                  </span>
                </span>
                <StatusBadge status={t.status} />
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

  // Shared hook — it attaches origin URL + device/console diagnostics for us.
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
            <Select id="ticket-category" value={category} onChange={(v) => setCategory(v as TicketCategory)}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="ticket-priority">
            <Select id="ticket-priority" value={priority} onChange={(v) => setPriority(v as TicketPriority)}>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
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
          <span className="mb-1.5 block text-sm font-medium text-ink-100">Message</span>
          <TicketComposer
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
          <Button variant="ghost" onClick={onCancel} disabled={create.isPending}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Detail thread ────────────────────────────────────────────────────── */

function TicketDetail({ id }: { id: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // Return to the list by POPPING the entry the list pushed when opening this
  // ticket — never by pushing another /support entry (that let the list's Back
  // arrow bounce straight back here, so the two controls cycled and the user
  // could never leave /support). A deep-linked ticket has no list behind it, so
  // fall back to a replace-nav that still lands on the list without stacking.
  const backToList = () => {
    if (cameFromList) {
      cameFromList = false;
      window.history.back();
    } else {
      navigate('/support', { replace: true });
    }
  };

  const detailKey = trpc.support.get.queryKey({ id });
  const { data, isLoading, isError } = useQuery(trpc.support.get.queryOptions({ id }));

  const reply = useMutation({
    ...trpc.support.reply.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: trpc.support.list.queryKey() });
    },
    onError: (e) => toastError(e),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16">
      <div className="flex flex-col gap-5 pt-2">
        <button
          type="button"
          onClick={backToList}
          className="press -ml-1 inline-flex items-center gap-1.5 text-sm text-ink-60 transition-colors hover:text-ink-100"
        >
          <ArrowLeft className="h-4 w-4" /> All tickets
        </button>

        {isLoading ? (
          <p className="py-10 text-center text-sm text-ink-40">Loading…</p>
        ) : isError || !data ? (
          <p className="py-10 text-center text-sm text-ink-40">Ticket not found.</p>
        ) : (
          <>
            <header className="flex flex-col gap-2 border-b border-[color:var(--color-border-default)] pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-40">#{data.ticket.ticketNumber}</span>
                <StatusBadge status={data.ticket.status} />
                <PriorityBadge priority={data.ticket.priority} />
                <span className="text-xs text-ink-40">{CATEGORY_LABEL[data.ticket.category]}</span>
              </div>
              <h1 className="text-xl font-semibold text-ink-100">{data.ticket.subject}</h1>
              <span className="text-xs text-ink-40">Opened {formatTicketTime(data.ticket.createdAt)}</span>
            </header>

            <TicketThread comments={data.comments as TicketComment[]} />

            {data.ticket.status === 'closed' ? (
              <p className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-inset px-4 py-3 text-center text-sm text-ink-40">
                This ticket is closed. Open a new ticket if you still need help.
              </p>
            ) : (
              <TicketComposer
                pathId={id}
                submitLabel="Reply"
                placeholder="Write a reply…"
                sending={reply.isPending}
                onSend={async ({ body, attachments }) => {
                  await reply.mutateAsync({ ticketId: id, body, attachments });
                }}
              />
            )}
          </>
        )}

        {reply.isPending && (
          <p className="flex items-center justify-center gap-2 text-xs text-ink-40">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…
          </p>
        )}
      </div>
    </div>
  );
}
