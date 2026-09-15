import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { SearchBar, PillToggle } from './components';
import { Field, Select } from '../agency/form-bits';
import {
  TicketThread,
  TicketComposer,
  StatusBadge,
  PriorityBadge,
  formatTicketTime,
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_OPTIONS,
  PRIORITY_LABEL,
  PRIORITY_OPTIONS,
  type TicketStatus,
  type TicketPriority,
  type TicketComment,
} from '../support/components';

const LIMIT = 20;

const STATUS_FILTERS: { key: TicketStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

/**
 * The two surfaces that write to `support_tickets`. Product feedback (the floating
 * panel every frontend mounts) is a ticket underneath, so it is triaged here — but
 * it's a distinct queue with a different job, hence its own tab rather than being
 * mixed into the support list.
 */
const SOURCE_TABS: {
  key: 'support' | 'feedback';
  label: string;
  title: string;
  description: string;
  empty: string;
}[] = [
  {
    key: 'support',
    label: 'Support',
    title: 'Support Tickets',
    description: 'Customer support requests across every Prodesk frontend.',
    empty: 'No tickets found.',
  },
  {
    key: 'feedback',
    label: 'Feedback',
    title: 'Product Feedback',
    description:
      'Feedback submitted from the in-app panel. Replies reach the customer the same way — they see it as a response to their feedback, not a support ticket.',
    empty: 'No feedback yet.',
  },
];

/**
 * Super-admin support console (Accounts → Tickets). Lists every customer ticket
 * and opens a triage panel: full thread (incl. internal notes), a reply composer
 * that emails the customer, and status/priority controls.
 *
 * Two tabs over one table: Support requests and product Feedback (see SOURCE_TABS).
 */
export function TicketsAdminPage() {
  const trpc = useTRPC();
  const [source, setSource] = useState<'support' | 'feedback'>('support');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const tab = SOURCE_TABS.find((t) => t.key === source)!;

  const list = useQuery(
    trpc.support.adminList.queryOptions({
      source,
      status: statusFilter === 'all' ? undefined : statusFilter,
      search: search || undefined,
      limit: LIMIT,
      offset,
    }),
  );
  const rows = list.data?.items ?? [];

  return (
    <div className="px-4 py-6 md:px-8">
      <PageHeader title={tab.title} description={tab.description} />

      {/* Queue switch — sits above the status filters because it changes which
          queue you're triaging, not how it's filtered. */}
      <div className="mb-4 inline-flex rounded-lg border border-ink-8 bg-surface p-1">
        {SOURCE_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setSource(t.key);
              setStatusFilter('all');
              setOffset(0);
            }}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              source === t.key
                ? 'bg-ink-100 text-paper'
                : 'text-ink-60 hover:text-ink-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <PillToggle
            key={f.key}
            label={f.label}
            checked={statusFilter === f.key}
            onChange={() => {
              setStatusFilter(f.key);
              setOffset(0);
            }}
          />
        ))}
      </div>

      <SearchBar
        value={search}
        onChange={(v) => {
          setSearch(v);
          setOffset(0);
        }}
        placeholder={
          source === 'feedback' ? 'Search feedback or email…' : 'Search subject or email…'
        }
      />

      <Card className="overflow-hidden">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-40">{tab.empty}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => setOpenId(t.id)}
                  >
                    <TableCell className="font-mono text-xs text-ink-40">#{t.ticketNumber}</TableCell>
                    <TableCell>
                      <span className="block max-w-[280px] truncate font-medium text-ink-100">{t.subject}</span>
                      <span className="text-xs text-ink-40">{CATEGORY_LABEL[t.category]}</span>
                    </TableCell>
                    <TableCell className="text-ink-60">
                      <span className="block text-sm">{t.creatorName ?? '—'}</span>
                      <span className="text-xs text-ink-40">{t.contactEmail}</span>
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-ink-40">
                      {formatTicketTime(t.updatedAt)}
                      {t.lastActorRole && (
                        <span className="block">
                          {t.lastActorRole === 'customer' ? 'Customer replied' : 'You replied'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-3">
              <Pagination total={list.data?.total ?? 0} limit={LIMIT} offset={offset} onChange={setOffset} />
            </div>
          </>
        )}
      </Card>

      {openId && <TicketDetailDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function TicketDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [internal, setInternal] = useState(false);

  const detailKey = trpc.support.adminGet.queryKey({ id });
  const { data, isLoading } = useQuery(trpc.support.adminGet.queryOptions({ id }));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: detailKey });
    qc.invalidateQueries({ queryKey: trpc.support.adminList.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.support.adminOpenCount.queryKey() });
  };

  const reply = useMutation({
    ...trpc.support.adminReply.mutationOptions(),
    onSuccess: () => invalidate(),
    onError: (e) => toastError(e),
  });
  const updateStatus = useMutation({
    ...trpc.support.adminUpdateStatus.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast.success('Ticket updated');
    },
    onError: (e) => toastError(e),
  });

  const ticket = data?.ticket;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        {isLoading || !ticket ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-40">#{ticket.ticketNumber}</span>
                <span className="truncate">{ticket.subject}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-60">
                <span>{ticket.creatorName ?? ticket.contactEmail}</span>
                <span className="text-ink-30">·</span>
                <span>{ticket.contactEmail}</span>
                <span className="text-ink-30">·</span>
                <span>{CATEGORY_LABEL[ticket.category]}</span>
                {ticket.appOrigin && (
                  <>
                    <span className="text-ink-30">·</span>
                    <span className="truncate">{ticket.appOrigin}</span>
                  </>
                )}
              </div>

              <DiagnosticsPanel ticket={ticket} />

              <SubscriptionsPanel subscriptions={data.subscriptions} />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Status">
                  <Select
                    value={ticket.status}
                    disabled={updateStatus.isPending}
                    onChange={(v) => updateStatus.mutate({ ticketId: id, status: v as TicketStatus })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select
                    value={ticket.priority}
                    disabled={updateStatus.isPending}
                    onChange={(v) => updateStatus.mutate({ ticketId: id, priority: v as TicketPriority })}
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="max-h-[40vh] overflow-y-auto pr-1">
                <TicketThread comments={data.comments as TicketComment[]} customerLabel="Customer" />
              </div>

              <TicketComposer
                pathId={id}
                submitLabel={internal ? 'Add note' : 'Send reply'}
                placeholder={internal ? 'Internal note (not emailed)…' : 'Reply to the customer…'}
                sending={reply.isPending}
                onSend={async ({ body, attachments }) => {
                  await reply.mutateAsync({ ticketId: id, body, attachments, isInternal: internal });
                  setInternal(false);
                }}
              >
                <PillToggle
                  label="Internal note"
                  activeClass="text-warn"
                  checked={internal}
                  onChange={setInternal}
                />
              </TicketComposer>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Diagnostics ──────────────────────────────────────────────────────────
 * Origin URL, who/where the ticket came from, the caller's device + network
 * fingerprint, and a tail of their browser console — captured at creation
 * (support.create → supportTickets.metadata). Admin-only; read-only.
 */
type AdminTicket = {
  userId: string | null;
  creatorName: string | null;
  creatorEmail: string | null;
  contactEmail: string;
  appOrigin: string | null;
  brandName?: string | null;
  agencyName?: string | null;
  metadata?: {
    pageUrl?: string | null;
    origin?: string | null;
    referrer?: string | null;
    userAgent?: string | null;
    ip?: string | null;
    client?: string | null;
    platform?: string | null;
    language?: string | null;
    languages?: string[] | null;
    timezone?: string | null;
    timezoneOffsetMinutes?: number | null;
    screen?: { width: number; height: number } | null;
    viewport?: { width: number; height: number } | null;
    devicePixelRatio?: number | null;
    console?: { level: string; message: string; at: string }[] | null;
  } | null;
};

function DiagRow({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 py-1">
      <span className="w-28 shrink-0 text-ink-40">{label}</span>
      <span className={`min-w-0 flex-1 break-words text-ink-80 ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/* ── Subscriptions ────────────────────────────────────────────────────────
 * The ticket creator's feature subscriptions, resolved LIVE by adminGet at view
 * time (never snapshotted onto the ticket). Read-only.
 */
type AdminSubscription = {
  id: string;
  productName: string | null;
  productSlug: string | null;
  status: string;
  interval: string;
  amount: string;
  currency: string;
  quantity: number;
  currentPeriodEnd: string | Date | null;
  cancelAtPeriodEnd: boolean;
};

function SubStatusBadge({ status }: { status: string }) {
  const tone =
    status === 'active' || status === 'trialing'
      ? 'bg-accent/12 text-accent'
      : status === 'past_due' || status === 'unpaid'
        ? 'bg-danger/12 text-danger'
        : 'bg-inset text-ink-40';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${tone}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function SubscriptionsPanel({ subscriptions }: { subscriptions: AdminSubscription[] }) {
  return (
    <details className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-inset/50">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-ink-60">
        Subscriptions ({subscriptions.length})
      </summary>
      <div className="border-t border-[color:var(--color-border-default)] px-3 py-2 text-xs">
        {subscriptions.length === 0 ? (
          <p className="text-ink-40">No feature subscriptions.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {subscriptions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium text-ink-100">
                  {s.productName ?? s.productSlug ?? 'Unknown product'}
                </span>
                <SubStatusBadge status={s.status} />
                <span className="text-ink-60">
                  {s.currency} {Number(s.amount).toFixed(2)}
                  {s.quantity > 1 ? ` ×${s.quantity}` : ''}/{s.interval === 'week' ? 'wk' : 'mo'}
                </span>
                {s.cancelAtPeriodEnd && <span className="text-warn">cancels at period end</span>}
                {s.currentPeriodEnd && (
                  <span className="text-ink-40">
                    · renews {formatTicketTime(s.currentPeriodEnd)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function DiagnosticsPanel({ ticket }: { ticket: AdminTicket }) {
  const m = ticket.metadata ?? undefined;
  const consoleLog = m?.console ?? [];
  const screen = m?.screen ? `${m.screen.width}×${m.screen.height}` : null;
  const viewport = m?.viewport ? `${m.viewport.width}×${m.viewport.height}` : null;
  const dpr = m?.devicePixelRatio ? `@${m.devicePixelRatio}x` : '';

  return (
    <details className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-inset/50">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-ink-60">
        Diagnostics &amp; device info
      </summary>
      <div className="border-t border-[color:var(--color-border-default)] px-3 py-2 text-xs">
        <DiagRow label="User" value={ticket.creatorName ?? ticket.contactEmail} />
        <DiagRow label="Email" value={ticket.creatorEmail ?? ticket.contactEmail} />
        <DiagRow label="User ID" value={ticket.userId} mono />
        <DiagRow label="Brand" value={ticket.brandName} />
        <DiagRow label="Agency" value={ticket.agencyName} />
        <DiagRow label="App origin" value={ticket.appOrigin} mono />
        <DiagRow label="Page URL" value={m?.pageUrl} mono />
        <DiagRow label="Referrer" value={m?.referrer} mono />
        <DiagRow label="Frontend" value={m?.client} />
        <DiagRow label="IP address" value={m?.ip} mono />
        <DiagRow label="User agent" value={m?.userAgent} mono />
        <DiagRow label="Platform" value={m?.platform} />
        <DiagRow
          label="Language"
          value={m?.languages?.length ? m.languages.join(', ') : m?.language}
        />
        <DiagRow
          label="Timezone"
          value={
            m?.timezone
              ? `${m.timezone}${
                  typeof m.timezoneOffsetMinutes === 'number'
                    ? ` (UTC${m.timezoneOffsetMinutes <= 0 ? '+' : '-'}${Math.abs(m.timezoneOffsetMinutes) / 60})`
                    : ''
                }`
              : null
          }
        />
        <DiagRow
          label="Screen"
          value={screen ? `${screen}${dpr}${viewport ? ` · viewport ${viewport}` : ''}` : viewport}
        />

        {consoleLog.length > 0 && (
          <div className="mt-2 border-t border-[color:var(--color-border-default)] pt-2">
            <div className="mb-1 text-ink-40">Console log ({consoleLog.length})</div>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded bg-inset p-2 font-mono text-[10.5px] leading-relaxed">
              {consoleLog.map((e, i) => (
                <div
                  key={i}
                  className={
                    e.level === 'error' || e.level === 'exception' || e.level === 'rejection'
                      ? 'text-danger'
                      : e.level === 'warn'
                        ? 'text-warn'
                        : 'text-ink-60'
                  }
                >
                  <span className="text-ink-30">[{e.level}]</span> {e.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
