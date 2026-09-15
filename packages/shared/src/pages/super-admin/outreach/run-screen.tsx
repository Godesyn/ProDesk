import { useMemo } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { RouterOutputs } from '@server/trpc/router';
import { useTRPC } from '../../../lib/trpc';
import { cn } from '../../../lib/utils';
import { OutreachShell } from './shell';
import { queueOrder } from './queue-order';
import { RunPanel, runCost, useTrackedRun } from './run-panel';

/**
 * ONE RUN — /super-admin/outreach/lists/:runId
 *
 * A run used to open as a panel wedged in above the send queue on the List
 * Builder screen. That was the wrong shape for it twice over. The panel is the
 * only place a run's contacts can be read, and a roster of four hundred
 * businesses sharing a screen with the coverage map and the queue gets a strip
 * of viewport to do it in. And opening a run pushed the queue you opened it
 * from down the page, so the act of looking at something moved the thing you
 * were looking at.
 *
 * So a run is a screen with a URL. That buys three things the panel could not
 * have: the roster gets the whole page, the run is linkable — the address of a
 * region we bought is now something you can paste to someone — and the browser's
 * own back button returns you to the queue, which is what everybody pressed
 * anyway.
 *
 * The queue is still where a run is *acted on* in relation to the others —
 * reordering, skipping, retiring, purging. Those are comparisons between runs
 * and they belong to the list. This screen is one run on its own terms: what it
 * cost, where it got to, whether to push it, and who is in it.
 */

export const RUN_ROUTE = '/super-admin/outreach/lists/:runId';
const QUEUE_HREF = '/super-admin/outreach/lists';

type QueueRun = RouterOutputs['outreach']['listRuns'][number];

export function OutreachRunPage() {
  const [, params] = useRoute(RUN_ROUTE);
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const runId = params?.runId ?? null;

  const tracked = useTrackedRun(runId);
  const run = tracked.run;

  /**
   * The ledger, only so this screen knows where it sits.
   *
   * Shared cache with the queue screen, so arriving from there costs no request
   * — and arriving from a pasted link fetches a list that was going to be needed
   * the moment the operator pressed back anyway.
   */
  const runs = useQuery(trpc.outreach.listRuns.queryOptions());
  const sweep = useMemo<QueueRun[]>(() => queueOrder(runs.data ?? []), [runs.data]);
  const at = runId ? sweep.findIndex((r) => r.id === runId) : -1;
  const prev = at > 0 ? sweep[at - 1] : null;
  const next = at !== -1 && at < sweep.length - 1 ? sweep[at + 1] : null;
  const label = (r: QueueRun) => `${r.vertical} · ${r.region}`;
  const goto = (r: QueueRun) => navigate(`${QUEUE_HREF}/${r.id}`);

  const title = run ? `${run.vertical} in ${run.region}` : 'Run';

  return (
    <OutreachShell
      title={title}
      description={
        run
          ? [
              runCost(run),
              `cap ${run.maxRecords.toLocaleString()}`,
              at !== -1 ? `${at + 1} of ${sweep.length} in the send queue` : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      action={
        <div className="flex items-center gap-1">
          {/* Back to the queue, said as a place rather than as a direction —
              "Back" alone is the browser's job and it does it better. */}
          <Link
            href={QUEUE_HREF}
            className="press text-ui-xs mr-1 flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 text-ink-40 transition-colors duration-[var(--duration-quick)] hover:bg-inset hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          >
            <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
            Send queue
          </Link>
          <Step
            label={prev ? `Earlier in the queue: ${label(prev)}` : 'Nothing earlier in the queue'}
            disabled={!prev}
            onClick={() => prev && goto(prev)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Step>
          <Step
            label={next ? `Later in the queue: ${label(next)}` : 'Nothing later in the queue'}
            disabled={!next}
            onClick={() => next && goto(next)}
          >
            <ChevronRight className="h-4 w-4" />
          </Step>
        </div>
      }
    >
      {tracked.isPending ? (
        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-5">
          <div className="pd-shimmer h-[13px] w-1/4 rounded-full" />
          <div className="pd-shimmer mt-4 h-[64px] w-full rounded-[var(--radius-sm)]" />
          <div className="pd-shimmer mt-4 h-[160px] w-full rounded-[var(--radius-sm)]" />
        </div>
      ) : !run ? (
        /* A retired run keeps its row; a purged one does not. Either way the
           only useful move from a dead URL is back to the list. */
        <div className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] px-6 py-16 text-center">
          <p className="text-ui-sm text-ink-60">There is no run at this address.</p>
          <Link
            href={QUEUE_HREF}
            className="text-ui-xs mt-2 inline-block text-ink-40 underline underline-offset-2 hover:text-ink-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          >
            Back to the send queue
          </Link>
        </div>
      ) : (
        <RunPanel
          run={run}
          onPush={tracked.push}
          onSkip={tracked.skip}
          onRetry={tracked.retry}
          pushing={tracked.pushing}
          skipping={tracked.skipping}
          retrying={tracked.retrying}
          // The page heading already names the run; an h2 repeating it directly
          // underneath would say nothing twice.
          showIdentity={false}
          // On its own screen the roster is not a second question behind a
          // disclosure — it is what the screen is for.
          businessesOpen
        />
      )}
    </OutreachShell>
  );
}

function Step({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'press flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-ink-40',
        'transition-colors duration-[var(--duration-quick)] hover:bg-inset hover:text-ink-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
        'disabled:opacity-30 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}
