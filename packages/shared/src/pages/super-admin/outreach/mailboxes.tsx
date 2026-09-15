import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Unplug } from 'lucide-react';
import type { RouterOutputs } from '@server/trpc/router';
import { useTRPC } from '../../../lib/trpc';
import { getErrorMessage, toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { RefreshButton } from '../../../components/ui/refresh-button';
import { MailboxRow, MailboxRowSkeleton, localPart, mailboxRisk } from './mailbox-row';
import { useReducedMotion, useTickingInt } from './motion';
import { OutreachShell } from './shell';
import { MonitoringPanel, slidingDomains } from './monitoring';

/**
 * THE SENDING FLOOR — /super-admin/outreach/mailboxes
 *
 * A live view of every mailbox we send from, grouped by domain, because domain
 * reputation is the unit of risk: one bad mailbox costs a mailbox, one bad
 * domain costs a quarter of our sending capacity.
 *
 * Nothing here is stored. Everything is read live from Smartlead through a short
 * Redis cache, so what you see is what the sending backend currently believes.
 *
 * Two views, because the floor answers two questions at two different speeds.
 * **Emails** is the estate as it stands right now — every mailbox, what it has
 * sent today, and the controls that stop it. **Monitoring** is the trend behind
 * that: deliverability per domain and volume over weeks. Splitting them keeps a
 * 90-day chart from sitting under the thing you came here to stop, and the
 * Monitoring tab carries a mark when a domain is sliding, so putting it behind a
 * switch never hides the one number that has to interrupt.
 */

type Floor = RouterOutputs['outreach']['floor'];
type FloorDomain = Floor['domains'][number];
type FloorMailbox = FloorDomain['mailboxes'][number];

const CAP_CHOICES = [20, 21, 22, 23, 24, 25];

/* ──────────────────────────────────────────────────────────────────────────
 * Small parts
 * ────────────────────────────────────────────────────────────────────────── */

const BRAND_LABEL: Record<FloorDomain['brand'], string> = {
  prodesk: 'ProDesk',
  noize: 'NOIZE',
  unknown: 'Unassigned',
};

/** Which voice this domain speaks in — it decides where replies are routed. */
function BrandChip({ brand }: { brand: FloorDomain['brand'] }) {
  return (
    <span
      className={cn(
        'text-ui-xs rounded-[var(--radius-pill)] border px-2 py-0.5',
        brand === 'unknown'
          ? 'border-dashed border-[color:var(--color-ink-20)] text-ink-40'
          : 'border-[color:var(--color-border-hairline)] bg-inset text-ink-60',
      )}
    >
      {BRAND_LABEL[brand]}
    </span>
  );
}

function pct(v: number | null, decimals = 1): string {
  return v === null ? '—' : `${(v * 100).toFixed(decimals)}%`;
}

/**
 * Deliverability, and whether it is moving.
 *
 * Only a fall gets colour. A rise is good news and good news doesn't need to
 * shout — if every direction were coloured, neither would read.
 */
function Deliverability({ health }: { health: NonNullable<FloorDomain['health']> }) {
  const trend = health.deliverabilityTrend;
  const falling = trend !== null && trend <= -0.5;
  const rising = trend !== null && trend >= 0.5;

  return (
    <div>
      <div className="eyebrow">Deliverability</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tnum text-ui-lg text-ink-100">{pct(health.deliverability)}</span>
        {trend !== null && (
          <span
            className={cn(
              'tnum text-ui-xs inline-flex items-center gap-0.5',
              falling ? 'text-danger' : 'text-ink-40',
            )}
          >
            {falling && <ArrowDown className="h-3 w-3" />}
            {rising && <ArrowUp className="h-3 w-3" />}
            {falling || rising ? `${Math.abs(trend).toFixed(1)} pts` : 'steady'}
          </span>
        )}
      </div>
    </div>
  );
}

/** One fact in the mailbox detail strip. */
function Fact({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warn' }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          'tnum text-ui-sm mt-1',
          tone === 'danger' ? 'text-danger' : tone === 'warn' ? 'text-warn' : 'text-ink-100',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Mailbox detail
 * ────────────────────────────────────────────────────────────────────────── */

function MailboxDetail({
  mailbox,
  onStop,
  onResume,
  onSetCap,
  busy,
}: {
  mailbox: FloorMailbox;
  onStop: () => void;
  onResume: () => void;
  onSetCap: (cap: number) => void;
  busy: boolean;
}) {
  const risk = mailboxRisk(mailbox);
  const reduced = useReducedMotion();

  return (
    <div
      className="border-t border-[color:var(--color-border-hairline)] bg-card/60 px-5 py-4"
      style={
        reduced
          ? undefined
          : { animation: 'reveal var(--duration-standard) var(--ease-click) both' }
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="mono truncate text-ui-sm text-ink-100">{mailbox.email}</div>
          <div
            className={cn(
              'text-ui-xs mt-1',
              risk.level === 'risk'
                ? 'text-danger'
                : risk.level === 'watch'
                  ? 'text-warn'
                  : 'text-ink-40',
            )}
          >
            {!mailbox.connected && <Unplug className="mr-1 inline h-3 w-3" />}
            {risk.reason}
            {mailbox.stopped && ' · not sending'}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {mailbox.stopped ? (
            <Button size="sm" variant="default" disabled={busy} onClick={onResume}>
              Resume sending
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={onStop}>
              Stop sending
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label="Sent today" value={String(mailbox.sentToday)} />
        <Fact label="Remaining" value={mailbox.stopped ? '—' : String(mailbox.remaining)} />
        <Fact
          label="Warmup"
          value={mailbox.warmup.status ? mailbox.warmup.status.toLowerCase() : 'unknown'}
        />
        <Fact
          label="Warmup spam"
          value={pct(mailbox.warmup.spamRate)}
          tone={
            mailbox.warmup.spamRate !== null && mailbox.warmup.spamRate > 0.02 ? 'danger' : undefined
          }
        />
        <Fact
          label="Min gap"
          value={mailbox.minWaitMins === null ? '—' : `${mailbox.minWaitMins} min`}
        />
        <Fact label="Last send" value={relativeTime(mailbox.lastSentAt)} />
      </dl>

      {/* Per-mailbox cap override. Changing it here overrides the global policy
          for this mailbox only, and the next global change leaves it alone. */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="eyebrow">Daily cap</span>
        <CapChoice value={mailbox.cap} disabled={busy || mailbox.stopped} onChange={onSetCap} />
        {mailbox.stopped && (
          <span className="text-ui-xs text-ink-40">Resume the mailbox to change its cap.</span>
        )}
      </div>
    </div>
  );
}

/** The 20–25 range, as six discrete choices rather than a number field. */
function CapChoice({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (cap: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Daily cap"
      className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
    >
      {CAP_CHOICES.map((cap) => (
        <button
          key={cap}
          type="button"
          disabled={disabled}
          aria-pressed={cap === value}
          onClick={() => onChange(cap)}
          className={cn(
            'tnum press h-8 w-10 text-ui-xs transition-colors duration-[var(--duration-quick)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
            'disabled:pointer-events-none disabled:opacity-50',
            cap === value ? 'bg-ink-100 text-paper' : 'bg-transparent text-ink-60 hover:bg-inset',
          )}
        >
          {cap}
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Domain block
 * ────────────────────────────────────────────────────────────────────────── */

function DomainBlock({
  domain,
  index,
  selectedId,
  onSelect,
  onStop,
  onResume,
  onSetCap,
  busy,
}: {
  domain: FloorDomain;
  index: number;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onStop: (m: FloorMailbox) => void;
  onResume: (m: FloorMailbox) => void;
  onSetCap: (m: FloorMailbox, cap: number) => void;
  busy: boolean;
}) {
  const sent = useTickingInt(domain.sentToday);
  const reduced = useReducedMotion();
  const nearCeiling = domain.ceiling > 0 && domain.utilisation >= 0.9;

  return (
    <section
      className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card shadow-[var(--shadow-1)]"
      // The four blocks reveal in order, so the page resolves top-down into a
      // structure rather than appearing all at once.
      style={
        reduced
          ? undefined
          : {
              animation: `reveal var(--duration-statement) var(--ease-click) ${index * 70}ms both`,
            }
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 px-5 pb-4 pt-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="mono truncate text-[15px] text-ink-100">{domain.domain}</h2>
            <BrandChip brand={domain.brand} />
          </div>
          <p className="text-ui-xs mt-1.5 text-ink-40">
            {domain.mailboxes.length === 0
              ? 'No mailboxes connected'
              : `${domain.activeCount} of ${domain.mailboxes.length} sending`}
            {domain.warmupReputation !== null && (
              <> · warmup {Math.round(domain.warmupReputation)}</>
            )}
            {domain.disconnectedCount > 0 && (
              <span className="text-danger">
                {' '}
                · {domain.disconnectedCount} unreachable
              </span>
            )}
          </p>
        </div>

        <div className="flex items-end gap-8">
          <div>
            <div className="eyebrow">Sent today</div>
            <div className="mt-1 flex items-baseline">
              <span className={cn('text-kpi tnum', nearCeiling ? 'text-warn' : 'text-ink-100')}>
                {sent}
              </span>
              <span className="tnum text-ui-md ml-0.5 text-ink-40">/{domain.ceiling}</span>
            </div>
          </div>
          {domain.health && <Deliverability health={domain.health} />}
        </div>
      </header>

      {domain.mailboxes.length === 0 ? (
        <div className="px-4 pb-5">
          <div className="rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-ink-20)] px-4 py-8 text-center">
            <p className="text-ui-sm text-ink-60">This domain has no mailboxes in Smartlead yet.</p>
            <p className="text-ui-xs mt-1 text-ink-40">
              Connect its five Workspace accounts to start warming them.
            </p>
          </div>
        </div>
      ) : (
        /* The detail opens under the row it belongs to rather than at the foot of
           the block. In a grid it could only ever go at the bottom, which meant
           the panel and the thing it described were never next to each other. */
        <ul className="border-t border-[color:var(--color-border-hairline)]">
          {domain.mailboxes.map((m, i) => (
            <li key={m.id} className="border-b border-[color:var(--color-border-hairline)] last:border-0">
              <MailboxRow
                mailbox={m}
                index={i}
                selected={m.id === selectedId}
                onSelect={() => onSelect(m.id === selectedId ? null : m.id)}
              />
              {m.id === selectedId && (
                <MailboxDetail
                  mailbox={m}
                  busy={busy}
                  onStop={() => onStop(m)}
                  onResume={() => onResume(m)}
                  onSetCap={(cap) => onSetCap(m, cap)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DomainBlockSkeleton() {
  return (
    <section className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
      <header className="flex items-start justify-between gap-8 px-5 pb-4 pt-5">
        <div className="w-48">
          <div className="pd-shimmer h-[15px] w-40 rounded-full" />
          <div className="pd-shimmer mt-2 h-[12px] w-28 rounded-full" />
        </div>
        <div className="pd-shimmer h-[32px] w-24 rounded-[var(--radius-sm)]" />
      </header>
      <div className="border-t border-[color:var(--color-border-hairline)]">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="border-b border-[color:var(--color-border-hairline)] last:border-0"
          >
            <MailboxRowSkeleton />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Views
 * ────────────────────────────────────────────────────────────────────────── */

const VIEWS = [
  { key: 'emails', label: 'Emails' },
  { key: 'monitoring', label: 'Monitoring' },
] as const;

type View = (typeof VIEWS)[number]['key'];

/**
 * Emails / Monitoring.
 *
 * Not two entries in the Outreach nav: the floor is one surface reading from one
 * live query, and both halves describe the same twenty mailboxes. The alarm dot
 * is what makes the switch safe — a domain losing deliverability is the reason
 * anyone opens Monitoring at all, so the tab says so from the other side.
 */
function ViewSwitch({
  view,
  onChange,
  mailboxCount,
  alarms,
}: {
  view: View;
  onChange: (v: View) => void;
  mailboxCount: number;
  alarms: number;
}) {
  return (
    <div
      role="group"
      aria-label="Sending floor view"
      className="mb-5 inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
    >
      {VIEWS.map((v) => {
        const active = view === v.key;
        return (
          <button
            key={v.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v.key)}
            className={cn(
              'press text-ui-xs flex h-8 items-center gap-1.5 px-3 transition-colors duration-[var(--duration-quick)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
              active ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
            )}
          >
            {v.label}
            {v.key === 'emails' && mailboxCount > 0 && (
              <span className={cn('tnum', active ? 'text-paper/60' : 'text-ink-40')}>
                {mailboxCount}
              </span>
            )}
            {v.key === 'monitoring' && alarms > 0 && (
              <span
                aria-label={`${alarms} domain${alarms === 1 ? '' : 's'} losing deliverability`}
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger motion-safe:animate-pulse"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Page
 * ────────────────────────────────────────────────────────────────────────── */

export function OutreachMailboxesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('emails');

  const floorKey = trpc.outreach.floor.queryKey();
  const floorQuery = useQuery({
    ...trpc.outreach.floor.queryOptions(),
    // The Redis cache holds for 45s, so polling faster only costs renders.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const floor = floorQuery.data;

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Read before the mutations so resuming a mailbox can optimistically restore
  // the cap it is actually about to get, not a guess.
  const policyQuery = useQuery(trpc.outreach.capPolicy.queryOptions());

  /* ── Optimistic mailbox edits ──────────────────────────────────────────
   * Every mutation lands instantly and rolls back on failure. Domain
   * aggregates are recomputed alongside the mailbox so the block header can't
   * disagree with the columns underneath it for a second and a half. */

  /**
   * Pre-mutation snapshots, one per MAILBOX.
   *
   * This was a single ref shared by all three mutations, and one slot is one
   * too few: stopping two mailboxes in quick succession had the second
   * `onMutate` overwrite the first's snapshot, so a failure on the first rolled
   * the screen back to a state that already contained the second change —
   * visibly undoing a stop that had actually worked. Keyed by account id,
   * each rollback restores its own mailbox's row and nothing else.
   */
  const snapshots = useRef(new Map<number, Floor>());

  const patchMailbox = async (id: number, fn: (m: FloorMailbox) => FloorMailbox) => {
    await qc.cancelQueries({ queryKey: floorKey });
    const prev = qc.getQueryData<Floor>(floorKey);
    if (!prev) return undefined;
    snapshots.current.set(id, prev);

    qc.setQueryData<Floor>(floorKey, {
      ...prev,
      domains: prev.domains.map((d) => {
        if (!d.mailboxes.some((m) => m.id === id)) return d;
        const mailboxes = d.mailboxes.map((m) => (m.id === id ? fn(m) : m));
        const sentToday = mailboxes.reduce((s, m) => s + m.sentToday, 0);
        const ceiling = mailboxes.reduce((s, m) => s + m.cap, 0);
        return {
          ...d,
          mailboxes,
          activeCount: mailboxes.filter((m) => !m.stopped).length,
          sentToday,
          ceiling,
          utilisation: ceiling > 0 ? Math.min(1, sentToday / ceiling) : 0,
        };
      }),
    });
    return undefined;
  };

  /**
   * Put back only the mailbox that failed.
   *
   * Restoring the whole snapshot would also revert anything else that changed
   * while this mutation was in flight, so the failed row is lifted out of its
   * own snapshot and merged into whatever the cache holds now.
   */
  const rollback = (e: unknown, vars: { accountId: number }) => {
    const prev = snapshots.current.get(vars.accountId);
    snapshots.current.delete(vars.accountId);
    const before = prev?.domains
      .flatMap((d) => d.mailboxes)
      .find((m) => m.id === vars.accountId);
    if (before) void patchMailbox(vars.accountId, () => before);
    toastError(e);
  };
  const settle = (_d: unknown, _e: unknown, vars: { accountId: number }) => {
    snapshots.current.delete(vars.accountId);
    qc.invalidateQueries({ queryKey: floorKey });
  };

  const resume = useMutation({
    ...trpc.outreach.startMailbox.mutationOptions(),
    onMutate: (vars) =>
      patchMailbox(vars.accountId, (m) => {
        // The server restores this mailbox to the cap policy, so show that.
        const policy = policyQuery.data;
        const cap =
          policy?.overrides[String(vars.accountId)] ?? policy?.global ?? m.cap ?? 20;
        return {
          ...m,
          stopped: false,
          suspended: false,
          cap,
          remaining: Math.max(0, cap - m.sentToday),
        };
      }),
    onError: rollback,
    onSettled: settle,
  });

  const stop = useMutation({
    ...trpc.outreach.stopMailbox.mutationOptions(),
    onMutate: (vars) =>
      patchMailbox(vars.accountId, (m) => ({ ...m, stopped: true, remaining: 0 })),
    onError: rollback,
    onSuccess: (result, vars) => {
      const mailbox = floor?.domains
        .flatMap((d) => d.mailboxes)
        .find((m) => m.id === vars.accountId);
      toast('Stopped sending.', {
        description:
          result.mechanism === 'suspend'
            ? 'Smartlead would not take a zero cap, so the mailbox is suspended — its warmup is paused too.'
            : mailbox
              ? `${localPart(mailbox.email)} will send nothing more today. Warmup keeps running.`
              : undefined,
        action: {
          label: 'Undo',
          onClick: () =>
            resume.mutate({
              accountId: vars.accountId,
              suspended: result.mechanism === 'suspend',
            }),
        },
      });
    },
    onSettled: settle,
  });

  const setCap = useMutation({
    ...trpc.outreach.setMailboxCap.mutationOptions(),
    onMutate: (vars) =>
      patchMailbox(vars.accountId, (m) => ({
        ...m,
        cap: vars.cap,
        remaining: Math.max(0, vars.cap - m.sentToday),
      })),
    onError: rollback,
    onSettled: settle,
  });

  /* ── Cap policy + fan-out ──────────────────────────────────────────────── */

  const [runId, setRunId] = useState<string | null>(null);
  const [draftCap, setDraftCap] = useState<number | null>(null);

  const progressQuery = useQuery({
    ...trpc.outreach.fanoutProgress.queryOptions({ runId: runId ?? '' }),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.finishedAt ? false : 1000),
  });
  const progress = progressQuery.data;

  useEffect(() => {
    if (!progress?.finishedAt) return;
    qc.invalidateQueries({ queryKey: floorKey });
    qc.invalidateQueries({ queryKey: trpc.outreach.capPolicy.queryKey() });
    if (progress.failures.length === 0) {
      toast(`Daily cap applied to ${progress.total} mailboxes.`);
    } else {
      toast.error(
        `${progress.failures.length} of ${progress.total} mailboxes did not update.`,
        { description: progress.failures[0]?.message },
      );
    }
    setRunId(null);
    setDraftCap(null);
    // Only ever fires on the transition into a finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.finishedAt]);

  const applyPolicy = useMutation({
    ...trpc.outreach.applyCapPolicy.mutationOptions(),
    onSuccess: (result) => setRunId(result.runId),
    onError: (e) => {
      setDraftCap(null);
      toastError(e);
    },
  });

  const globalCap = draftCap ?? policyQuery.data?.global ?? 20;
  const fanningOut = !!runId && !progress?.finishedAt;

  /* ── Render ────────────────────────────────────────────────────────────── */

  const summary = floor?.configured
    ? `${floor.totals.mailboxes} mailboxes across ${floor.domains.length} domains · ${floor.totals.sentToday} of ${floor.totals.ceiling} sent today`
    : 'Our own outbound sending, live from Smartlead.';

  return (
    <OutreachShell
      title="Sending Floor"
      description={summary}
      action={<RefreshButton onRefresh={() => qc.invalidateQueries({ queryKey: floorKey })} />}
    >
      {floorQuery.isError && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-[color:var(--color-danger)] bg-card px-5 py-4">
          <p className="text-ui-sm text-danger">Smartlead did not answer.</p>
          <p className="text-ui-xs mt-1 text-ink-60">{getErrorMessage(floorQuery.error)}</p>
        </div>
      )}

      {(floorQuery.isPending || floor?.configured) && (
        <ViewSwitch
          view={view}
          onChange={setView}
          mailboxCount={floor?.totals.mailboxes ?? 0}
          alarms={floor ? slidingDomains(floor).length : 0}
        />
      )}

      {floorQuery.isPending &&
        (view === 'emails' ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2, 3].map((i) => (
              <DomainBlockSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="pd-shimmer h-[22rem] w-full rounded-[var(--radius-md)]" />
        ))}

      {floor && !floor.configured && (
        <div className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] bg-card px-6 py-10 text-center">
          <h2 className="text-panel-title text-ink-100">Smartlead isn&rsquo;t connected</h2>
          <p className="text-ui-sm mx-auto mt-2 max-w-md text-ink-60">
            The floor reads every mailbox live from Smartlead. Add{' '}
            <code className="mono text-ink-100">SMARTLEAD_API_KEY</code> to the environment and
            reload — one key covers all twenty mailboxes.
          </p>
        </div>
      )}

      {floor?.configured && view === 'emails' && (
        <>
          <div className="flex flex-col gap-4">
            {floor.domains.map((d, i) => (
              <DomainBlock
                key={d.domain}
                domain={d}
                index={i}
                selectedId={selectedId}
                onSelect={setSelectedId}
                busy={stop.isPending || resume.isPending || setCap.isPending}
                onStop={(m) => stop.mutate({ accountId: m.id })}
                onResume={(m) => resume.mutate({ accountId: m.id, suspended: m.suspended })}
                onSetCap={(m, cap) => setCap.mutate({ accountId: m.id, cap })}
              />
            ))}
          </div>

          {/* ── Limits ──────────────────────────────────────────────────────
              The global cap is the main throttle on the whole estate, so it
              sits below the floor it governs rather than behind a menu. */}
          <section className="mt-6 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-5 py-5">
            <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
              <div className="max-w-md">
                <h2 className="text-panel-title text-ink-100">Limits</h2>
                <p className="text-ui-xs mt-1.5 text-ink-60">
                  The cap every mailbox gets. Mailboxes you have set individually keep their own
                  cap, and stopped mailboxes stay stopped.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <CapChoice value={globalCap} disabled={fanningOut} onChange={setDraftCap} />
                <Button
                  size="sm"
                  disabled={
                    fanningOut ||
                    applyPolicy.isPending ||
                    draftCap === null ||
                    draftCap === policyQuery.data?.global
                  }
                  onClick={() =>
                    applyPolicy.mutate({
                      global: globalCap,
                      overrides: policyQuery.data?.overrides ?? {},
                    })
                  }
                >
                  Apply to all mailboxes
                </Button>
              </div>
            </div>

            {(fanningOut || progress) && (
              <div className="mt-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-ui-xs text-ink-60">
                    {progress?.finishedAt
                      ? 'Finished'
                      : `Updating ${progress?.done ?? 0} of ${progress?.total ?? 0} mailboxes`}
                  </span>
                  <span className="tnum text-ui-xs text-ink-40">
                    {progress?.total ? Math.round((progress.done / progress.total) * 100) : 0}%
                  </span>
                </div>
                <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-inset">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-[var(--duration-standard)] ease-[var(--ease-click)]"
                    style={{
                      width: progress?.total
                        ? `${(progress.done / progress.total) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
                {progress?.failures.map((f) => (
                  <p key={f.email} className="text-ui-xs mt-2 text-danger">
                    <span className="mono">{f.email}</span> — {f.message}
                  </p>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {floor?.configured && view === 'monitoring' && <MonitoringPanel floor={floor} />}
    </OutreachShell>
  );
}
