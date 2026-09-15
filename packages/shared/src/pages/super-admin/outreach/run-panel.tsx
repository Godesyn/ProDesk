import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTRPC } from '../../../lib/trpc';
import { toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { useConfirm } from '../../../components/ui/confirm-dialog';
import { useReducedMotion, useTickingInt } from './motion';
import { RunBusinesses } from './run-businesses';

/**
 * ONE RUN — the panel, and the hook that follows it.
 *
 * Lifted out of lists.tsx when runs got their own screen. Two surfaces render
 * this now and they arrive at it from opposite directions: the New run view
 * follows whatever is in flight, because the person watching it started it a
 * minute ago; the run screen opens whichever run you asked for by URL, which may
 * be one from three months back. A run at `review` is pushable and holdable
 * either way, so the polling, the cache invalidation it triggers and both
 * actions live here rather than being written twice.
 *
 * The polling is the reason this is a hook and not just a component: a run
 * counting down to its own push changes state on a timer with nobody touching
 * the page, so whoever is looking at it has to keep asking.
 */

export const STAGES = [
  { key: 'scraping', label: 'Scraping' },
  { key: 'collecting', label: 'Collecting' },
  { key: 'deduping', label: 'Deduping' },
  { key: 'verifying', label: 'Verifying' },
  { key: 'hooking', label: 'Hook' },
  { key: 'review', label: 'Review' },
  { key: 'pushing', label: 'Pushing' },
  { key: 'done', label: 'Done' },
] as const;

/** Statuses that will not change without either the scraper or a human. */
const SETTLED = ['review', 'done', 'failed', 'superseded'];

/**
 * Is this run still going to do something on its own?
 *
 * `review` is in SETTLED and also, usually, moving: a run holding for five
 * minutes will push itself without anyone touching it, so it has to keep
 * polling and keep the live dot lit. The same is true of a run waiting on the
 * one ahead of it in the send queue — its deadline is already past and it is
 * still going to go. Only a SKIPPED run — no deadline — is genuinely parked.
 */
export const isMoving = (r: { status: string; autoPushAt: string | null }) =>
  !SETTLED.includes(r.status) || (r.status === 'review' && !!r.autoPushAt);

/* ──────────────────────────────────────────────────────────────────────────
 * One run
 * ────────────────────────────────────────────────────────────────────────── */

export type TrackedRun = NonNullable<ReturnType<typeof useTrackedRun>['run']>;

/**
 * Follow one run, and hold the two actions it offers.
 *
 * Both views render the same panel — a run at review is pushable and holdable
 * whether you found it by starting it or by opening it from the ledger — so the
 * polling, the cache invalidation it triggers and both actions live here rather
 * than being written twice.
 */
export function useTrackedRun(runId: string | null) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const runQuery = useQuery({
    ...trpc.outreach.listRun.queryOptions({ runId: runId ?? '' }),
    enabled: !!runId,
    // Stop polling once the run is finished or genuinely parked. A run counting
    // down to its own push is neither: it changes state on a timer, with nobody
    // touching the page, so it keeps polling until it lands.
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 4000;
      return isMoving(data) ? 4000 : false;
    },
  });
  const run = runId ? runQuery.data : undefined;

  // The run list and the coverage map are both derived from the same ledger, so
  // they refresh together whenever the followed run changes state.
  useEffect(() => {
    if (!run) return;
    qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.outreach.listCoverage.queryKey() });
  }, [run?.status, run?.stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmRun = useMutation({
    ...trpc.outreach.confirmListRun.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.outreach.listRun.queryKey({ runId: runId ?? '' }) });
      toast('Pushing to Smartlead.');
    },
    onError: (e) => toastError(e),
  });

  const skipRun = useMutation({
    ...trpc.outreach.skipListRun.mutationOptions(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: trpc.outreach.listRun.queryKey({ runId: runId ?? '' }) });
      qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
      toast(
        r.skipped
          ? 'Skipped. The queue moves on without it.'
          : r.autoPushAt
            ? 'Back in the queue — pushing in five minutes.'
            : 'Back in the queue.',
      );
    },
    onError: (e) => toastError(e),
  });

  const retryRun = useMutation({
    ...trpc.outreach.retryListRun.mutationOptions(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: trpc.outreach.listRun.queryKey({ runId: runId ?? '' }) });
      qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
      toast(
        r.reusedScrape
          ? 'Picking up from the scrape already paid for.'
          : 'Restarted from the top — nothing had been billed.',
      );
    },
    onError: (e) => toastError(e),
  });

  /**
   * Push now, ahead of the deadline.
   *
   * No confirmation. The run is going to push itself in a few minutes anyway —
   * asking "are you sure" about bringing that forward would be theatre, and the
   * dialog that used to sit here was the gate this replaced.
   */
  const push = () => {
    if (run) confirmRun.mutate({ runId: run.id });
  };

  /** Step out of the send queue, or step back into it. */
  const skip = async (next: boolean) => {
    if (!run) return;
    if (!next && run.readyCount > 0) {
      const ok = await confirm({
        title: `Put ${run.readyCount} contacts back in the send queue?`,
        description:
          'They upload to Smartlead five minutes from now — sooner or later depending on what else is queued ahead of them — fewest reviews first, and start receiving the sequence on its schedule. Skip again before then to stop it.',
        confirmLabel: 'Back in the queue',
      });
      if (!ok) return;
    }
    skipRun.mutate({ runId: run.id, skipped: next });
  };

  /**
   * Pick a failed run back up.
   *
   * No confirmation, on purpose: the whole point of this button is that it is
   * the CHEAP move — it re-reads a dataset that has already been paid for.
   * The one that deserves a dialog is Retire, which throws that away.
   */
  const retry = () => {
    if (run) retryRun.mutate({ runId: run.id });
  };

  return {
    run,
    /**
     * Still finding out. Distinct from `run === undefined` after the fact, which
     * is how a run screen opened on a dead URL has to read — one wants a
     * skeleton, the other wants "there is no run at this address", and a page
     * that cannot tell them apart shows the wrong one of the two every time.
     */
    isPending: !!runId && runQuery.isPending,
    push,
    skip,
    retry,
    pushing: confirmRun.isPending,
    skipping: skipRun.isPending,
    retrying: retryRun.isPending,
  };
}

/**
 * What this run cost, or what it is expected to. An empty string while neither
 * number exists yet — a run that hasn't reached the provider has no figure to
 * report, and "$0.00" would be a claim rather than a blank.
 */
export function runCost(run: Pick<TrackedRun, 'costActualUsd' | 'costEstimateUsd'>): string {
  if (run.costActualUsd !== null) return `$${run.costActualUsd.toFixed(2)} billed`;
  if (run.costEstimateUsd !== null) return `$${run.costEstimateUsd.toFixed(2)} estimated`;
  return '';
}

export function RunPanel({
  run,
  onPush,
  onSkip,
  onRetry,
  pushing,
  skipping,
  retrying,
  showIdentity = true,
  businessesOpen = false,
}: {
  run: TrackedRun;
  onPush: () => void;
  onSkip: (skip: boolean) => void;
  onRetry: () => void;
  pushing: boolean;
  skipping: boolean;
  retrying: boolean;
  /**
   * Whether the panel names the run.
   *
   * True inside the New run view, where the panel arrives unannounced under a
   * form. False on the run screen, whose own page heading is the run's name —
   * repeating it as an h2 directly underneath the h1 says nothing twice. The
   * cost moves up there with it; everything else in this header is about the
   * run's progress rather than its identity and stays put either way.
   */
  showIdentity?: boolean;
  /**
   * Open the roster on arrival.
   *
   * The run screen passes this because there the roster is not a second
   * question behind a disclosure — it is what the screen is for. In the New run
   * view it stays shut unless the run is at `review`, where looking at who is
   * about to be emailed is the decision the five-minute hold is holding for.
   */
  businessesOpen?: boolean;
}) {
  const reduced = useReducedMotion();

  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
      <header className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
        {showIdentity && (
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-panel-title text-ink-100">
              {run.vertical} <span className="text-ink-40">in</span> {run.region}
            </h2>
            <span className="tnum text-ui-xs text-ink-40">{runCost(run)}</span>
          </div>
        )}
        <p className="text-ui-xs mt-1 text-ink-40">
          cap {run.maxRecords} · {run.provider}
          {run.personalise && ' · homepage crawl on'}
        </p>
        <StageRail stage={run.stage} failed={run.status === 'failed'} reduced={reduced} />
        {run.error && <p className="text-ui-xs mt-3 text-danger">{run.error}</p>}
      </header>

      <CountsGrid counts={run.counts} />

      {/* A capped run looks identical to a complete one everywhere else
          — same statuses, same review screen, same green cell on the
          coverage map. Said here because nothing else says it. */}
      {run.capped && run.status !== 'running' && run.status !== 'starting' && (
        <div className="border-t border-[color:var(--color-border-hairline)] px-5 py-4">
          <p className="text-ui-sm text-warn">
            Stopped at the cap — {run.counts.found.toLocaleString()} of however many {run.region}{' '}
            actually holds.
          </p>
          <p className="text-ui-xs mt-1 text-ink-60">
            Push these — they cost the same either way. But there is no cheap way to get the
            rest: the scraper tiles the whole region, so anything you run over this area again
            re-scrapes and re-bills the businesses this run already collected. Dedupe stops the
            second email, not the second charge. Next time set the cap above the region&rsquo;s
            real size.
          </p>
        </div>
      )}

      {run.status === 'review' && (
        <div className="border-t border-[color:var(--color-border-hairline)] px-5 py-4">
          <Hold
            readyCount={run.readyCount}
            autoPushAt={run.autoPushAt}
            holdMs={run.holdMs}
            blockedBy={run.blockedBy}
            skipped={run.skipped}
            reduced={reduced}
            onPush={onPush}
            onSkip={onSkip}
            pushing={pushing}
            skipping={skipping}
          />
        </div>
      )}

      {run.status === 'done' && (
        <div className="border-t border-[color:var(--color-border-hairline)] px-5 py-4">
          <p className="text-ui-sm text-ink-100">
            {run.counts.pushed} contacts pushed to the campaign.
          </p>
          <p className="text-ui-xs mt-1 text-ink-60">
            They start receiving the sequence on its schedule, fewest reviews first.
          </p>
        </div>
      )}

      {/* ── A failure, and what it costs to recover from ──────────────────
          The distinction that matters here is not "why did it fail" — the
          error above says that — but whether the scrape was already paid
          for. If it was, everything downstream re-reads the provider's
          dataset for nothing, so retrying is free and starting the region
          again would buy the same businesses twice. A failed run used to
          offer neither answer nor a way back, and the only move available
          was the expensive one. */}
      {run.status === 'failed' && (
        <div className="border-t border-[color:var(--color-border-hairline)] px-5 py-4">
          <p className="text-ui-sm text-ink-100">
            {run.reusesScrape
              ? 'The scrape landed and is still on the provider.'
              : 'This run stopped before the scrape started, so nothing was billed.'}
          </p>
          <p className="text-ui-xs mt-1 text-ink-60">
            {run.reusesScrape
              ? 'Picking it up again re-reads that dataset, which is free — only verification runs a second time, and that is fractions of a cent. Scraping this region again would pay full price for businesses already bought.'
              : 'Retrying takes the ordinary path from the top, including the check for a scrape that may have been started and never recorded.'}
          </p>
          <Button className="mt-3" size="sm" disabled={retrying} onClick={onRetry}>
            {run.reusesScrape ? 'Retry from the scrape' : 'Retry'}
          </Button>
        </div>
      )}

      {/* ── Who is in it ──────────────────────────────────────────────────
          Last, because everything above is about the run and this is about the
          people in it — and open on arrival only at `review`, where looking at
          them IS the decision the hold is holding for. It replaced a flat list
          of the first 200 contacts with six fields on each; see
          run-businesses.tsx. */}
      <RunBusinesses runId={run.id} defaultOpen={businessesOpen || run.status === 'review'} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * The hold
 * ────────────────────────────────────────────────────────────────────────── */

function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The five minutes between a finished run and a sent campaign.
 *
 * The countdown is the whole design. A button that says "Push to campaign" asks
 * a question; a clock that says "pushing in 4:32" states a fact and leaves one
 * button worth pressing — which matches what actually happens, since these
 * contacts are already scraped, verified and paid for by the time this appears.
 *
 * So the emphasis inverts from what a gate would do: the deadline is the loud
 * element, Hold is an ordinary button, and Push now is the quiet one because it
 * only buys back a few minutes.
 */
function Hold({
  readyCount,
  autoPushAt,
  holdMs,
  blockedBy,
  skipped,
  reduced,
  onPush,
  onSkip,
  pushing,
  skipping,
}: {
  readyCount: number;
  autoPushAt: string | null;
  holdMs: number;
  blockedBy: { label: string; status: string } | null;
  skipped: boolean;
  reduced: boolean;
  onPush: () => void;
  onSkip: (skip: boolean) => void;
  pushing: boolean;
  skipping: boolean;
}) {
  const deadline = autoPushAt ? new Date(autoPushAt).getTime() : null;
  const [remaining, setRemaining] = useState(() =>
    deadline === null ? 0 : deadline - Date.now(),
  );

  // Ticks against the wall clock rather than counting its own intervals, so a
  // backgrounded tab that throttles timers still shows the true time left when
  // it comes back rather than a number frozen where it was left.
  useEffect(() => {
    if (deadline === null) return;
    setRemaining(deadline - Date.now());
    const id = setInterval(() => setRemaining(deadline - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const contacts = `${readyCount.toLocaleString()} contact${readyCount === 1 ? '' : 's'} ready`;

  /**
   * Ready, and still not sending, because something ahead of it isn't.
   *
   * The one genuinely confusing state a strict queue produces, and the reason
   * it gets its own branch rather than a footnote: without this the panel would
   * render "Held" — which is true of the clock and false about the cause, and
   * would send the operator looking for a release button that wouldn't help.
   */
  if (blockedBy && !skipped) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow">Waiting its turn</span>
            <h3 className="text-ui-md text-ink-100">{contacts}</h3>
          </div>
          <p className="text-ui-xs mt-1 text-ink-60">
            <span className="text-ink-100">{blockedBy.label}</span> is ahead in the send queue and
            hasn&rsquo;t sent yet ({blockedBy.status}). This run goes the moment it does. To send
            this one first, move it up the queue &mdash; or skip the run ahead.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={skipping} onClick={() => onSkip(true)}>
          Skip
        </Button>
      </div>
    );
  }

  if (deadline === null) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <div className="flex items-baseline gap-2">
            <span className="eyebrow text-warn">Skipped</span>
            <h3 className="text-ui-md text-ink-100">{contacts}</h3>
          </div>
          <p className="text-ui-xs mt-1 text-ink-60">
            Verified and deduped, fewest reviews first — the order they&rsquo;ll be contacted in.
            Parked out of the send queue, so it holds nothing up and nothing sends until you put it
            back.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pushing}
            onClick={onPush}
            className="press text-ui-xs h-8 px-2 text-ink-40 transition-colors duration-[var(--duration-quick)] hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
          >
            Push now
          </button>
          <Button size="sm" disabled={skipping} onClick={() => onSkip(false)}>
            Back in the queue
          </Button>
        </div>
      </div>
    );
  }

  const fraction = Math.max(0, Math.min(1, remaining / holdMs));
  const due = remaining <= 0;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-[16rem] flex-1">
          <h3 className="text-ui-md text-ink-100">{contacts}</h3>
          <p className="text-ui-xs mt-1 text-ink-60">
            Verified and deduped, fewest reviews first — the order they&rsquo;ll be contacted in.
            Read a few now; skipping stops the send.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pushing || due}
            onClick={onPush}
            className="press text-ui-xs h-8 px-2 text-ink-40 transition-colors duration-[var(--duration-quick)] hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
          >
            Push now
          </button>
          <Button
            size="sm"
            variant="outline"
            disabled={skipping || due}
            onClick={() => onSkip(true)}
          >
            Skip
          </Button>
        </div>
      </div>

      {/* One line, draining. The number says how long; the line says how far
          through, which is the part you read without focusing on it. */}
      <div className="mt-3 flex items-center gap-3">
        <span className={cn('tnum text-ui-sm shrink-0', due ? 'text-ink-40' : 'text-ink-100')}>
          {due ? 'Pushing now…' : `Pushing in ${mmss(remaining)}`}
        </span>
        <div className="h-[2px] flex-1 overflow-hidden rounded-full bg-inset">
          <div
            className={cn(
              'h-full rounded-full bg-accent',
              !reduced && 'transition-[width] duration-1000 ease-linear',
            )}
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Stage rail
 * ────────────────────────────────────────────────────────────────────────── */

function StageRail({
  stage,
  failed,
  reduced,
}: {
  stage: string;
  failed: boolean;
  reduced: boolean;
}) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <ol className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2">
      {STAGES.map((s, i) => {
        const done = activeIndex > i;
        const active = activeIndex === i;
        return (
          <li key={s.key} className="flex items-center gap-1">
            <span
              className={cn(
                'text-ui-xs rounded-[var(--radius-pill)] px-2 py-0.5 transition-colors duration-[var(--duration-standard)]',
                failed && active
                  ? 'bg-danger text-white'
                  : active
                    ? 'bg-ink-100 text-paper'
                    : done
                      ? 'text-ink-60'
                      : 'text-ink-20',
              )}
              style={
                active && !failed && !reduced
                  ? { animation: 'reveal var(--duration-standard) var(--ease-click) both' }
                  : undefined
              }
            >
              {s.label}
            </span>
            {i < STAGES.length - 1 && (
              <span aria-hidden className={cn('h-px w-3', done ? 'bg-ink-20' : 'bg-ink-10')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export interface RunCounts {
  found: number;
  noEmail: number;
  duplicate: number;
  suppressed: number;
  unverified: number;
  unknown: number;
  hooked: number;
  enriched: number;
  pushed: number;
}

/** The five ways a scraped business fails to become a contact. */
const DROPPED: { key: keyof RunCounts; label: string; hint?: string }[] = [
  { key: 'noEmail', label: 'No email', hint: 'we never guess at info@' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'suppressed', label: 'Suppressed' },
  { key: 'unverified', label: 'Undeliverable' },
  { key: 'unknown', label: 'No verdict', hint: 'verifier gave no answer' },
];

/**
 * What the run found, and what it lost on the way.
 *
 * This was seven equal numbers in a row, which is the one shape the data
 * definitely isn't: `found` is the total, five of the others are subtractions
 * from it, and `hooked` describes what survived. Drawn flat, the operator had to
 * know the pipeline to read the grid. Drawn as a funnel — a headline, a group of
 * deductions under one label with a bar showing how much of the run they take,
 * and what came out — the same numbers say what happened on their own.
 */
function CountsGrid({ counts }: { counts: RunCounts }) {
  const found = counts.found ?? 0;
  const droppedTotal = DROPPED.reduce((sum, d) => sum + (counts[d.key] ?? 0), 0);
  const droppedFraction = found > 0 ? Math.min(1, droppedTotal / found) : 0;

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-5 px-5 py-4">
      <Count label="Found" value={found} />

      <div className="min-w-[16rem] flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="eyebrow">Dropped</span>
          <span className="tnum text-ui-xs text-ink-40">
            {droppedTotal.toLocaleString()}
            {found > 0 && ` · ${Math.round(droppedFraction * 100)}%`}
          </span>
        </div>

        {/* How much of the run the deductions take. One bar, one measure. */}
        <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-inset">
          <div
            className="h-full rounded-full bg-ink-40 transition-[width] duration-[var(--duration-standard)] ease-[var(--ease-click)]"
            style={{ width: `${droppedFraction * 100}%` }}
          />
        </div>

        <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          {DROPPED.map((d) => (
            <MiniCount
              key={String(d.key)}
              label={d.label}
              value={counts[d.key] ?? 0}
              hint={d.hint}
            />
          ))}
        </dl>
      </div>

      <Count label="With opener" value={counts.hooked ?? 0} />
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  const n = useTickingInt(value);
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className="tnum text-kpi mt-1 text-ink-100">{n.toLocaleString()}</div>
    </div>
  );
}

function MiniCount({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const n = useTickingInt(value);
  return (
    <div className="min-w-0">
      <dt className="text-ui-xs truncate text-ink-40" title={hint ?? label}>
        {label}
      </dt>
      <dd className="tnum text-ui-md mt-0.5 text-ink-100">{n.toLocaleString()}</dd>
    </div>
  );
}
