import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTRPC } from '../../../lib/trpc';
import { getErrorMessage, toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useConfirm } from '../../../components/ui/confirm-dialog';
import { OutreachShell, SectionHeading } from './shell';
import { queueGroups } from './queue-order';
import {
  isMoving,
  RunPanel,
  STAGES,
  useTrackedRun,
  type RunCounts,
} from './run-panel';

/**
 * LIST BUILDER — /super-admin/outreach/lists
 *
 * A run is a pipeline with a hold in the middle: scrape → dedupe → verify →
 * hook → **review** → push. The review stop is five minutes long and ends by
 * itself. It used to end only when someone clicked Push, and that gate was
 * answered yes every time it was answered at all — its real effect was runs
 * sitting scraped, verified, paid for and unsent because the person who started
 * them had moved on. Skip is what the click is for now, and it is the rarer act.
 *
 * Three things drive the shape of this screen, and all three come from the
 * economics rather than from taste:
 *
 *  • **One run is one (vertical × region).** In-run duplicates are free — the
 *    scraper dedupes by place id before billing — but the same term in two runs
 *    pays twice for the same business. So there is no multi-region field here;
 *    the server refuses a repeat outright rather than warning about it.
 *  • **Coverage is the real state.** Greater Sydney is roughly 6–9 months of
 *    runway at the planned volume, so "what's left" is not a report you go and
 *    find — it's the top of the Send queue view, one click from the form.
 *  • **Scraping is parallel; sending is single-file.** Several regions can be
 *    billing at once, and there is no reason to make anyone wait on one to
 *    start the next. But every run lands in the same one campaign, so which
 *    region hears from us first is a decision — and the queue is where it is
 *    made, in an order the operator can change.
 *
 * The screen is two views, not one long scroll, because the two things done here
 * have nothing to do with each other minute to minute. **New run** is the act of
 * running: the form and whatever is in flight, and nothing else. **Send queue**
 * is everything bought and everything about to be sent — the coverage map, then
 * the queue itself in three groups (queued, sending, sent) with reorder and skip
 * on the first of them, and the two destructive actions in the feature: retiring
 * a run so its region can be scraped again, and deleting the prospects a run
 * created. Coverage sits with the queue because it is the same record read at a
 * different resolution: the map is every run at once, the queue is each of them
 * one at a time, in the order they go out.
 *
 * **A run itself is not on this screen.** Clicking one goes to run-screen.tsx.
 * It used to open as a panel wedged in above the queue, which put a roster of
 * four hundred businesses in a strip of viewport and pushed the list you clicked
 * further down the page as a result of clicking it. Everything that stayed here
 * is a comparison BETWEEN runs — what order they send in, which one is blocking,
 * which region is still unbought — and everything that left is about one run on
 * its own terms.
 *
 * See docs/agents/outreach-apify.md.
 */


const VIEWS = [
  { key: 'new', label: 'New run' },
  // Not "Previous runs" any more. The list it opens now holds runs that have
  // not happened yet — the ones waiting their turn to send — and naming it for
  // the half that is finished would hide the half you can still act on.
  { key: 'previous', label: 'Send queue' },
] as const;

type View = (typeof VIEWS)[number]['key'];

/** Where a run lives. One string, so the two screens cannot disagree on it. */
const RUN_HREF = '/super-admin/outreach/lists';

export function OutreachListsPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const config = useQuery(trpc.outreach.listBuilderConfig.queryOptions());
  const runs = useQuery(trpc.outreach.listRuns.queryOptions());
  const coverage = useQuery(trpc.outreach.listCoverage.queryOptions());

  const [view, setView] = useState<View>('new');
  const [vertical, setVertical] = useState('');
  // Both set together, only by picking a search result — there is no other way
  // to name a region now. `placeId` is what the server actually runs on; the
  // label is here to render and to predict the already-scraped refusal.
  const [region, setRegion] = useState('');
  const [placeId, setPlaceId] = useState<string | null>(null);
  // Above the 1,500–4,000 a mainstream vertical runs to across Greater Sydney,
  // because under-capping costs real money and over-capping costs nothing.
  const [maxRecords, setMaxRecords] = useState(5000);
  const [personalise, setPersonalise] = useState(false);

  // One id, and it is the run in flight. There used to be a second — whatever
  // you had opened from the ledger — because a run opened as a panel on this
  // screen needed following too. Runs have their own screen now, so the only run
  // this page follows is the one it started.
  const [liveRunId, setLiveRunId] = useState<string | null>(null);

  // Whichever run is live gets followed automatically, so a page refresh
  // mid-scrape doesn't lose track of a run that is actively billing.
  useEffect(() => {
    if (liveRunId || !runs.data) return;
    const live = runs.data.find(isMoving);
    if (live) setLiveRunId(live.id);
  }, [liveRunId, runs.data]);

  const estimate = useQuery(trpc.outreach.estimateListRun.queryOptions({ maxRecords }));

  const live = useTrackedRun(liveRunId);

  const inFlight = !!live.run && isMoving(live.run);

  const start = useMutation({
    ...trpc.outreach.startListRun.mutationOptions(),
    onSuccess: (r) => {
      setLiveRunId(r.runId);
      setView('new');
      qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
      toast('List run started.');
    },
    onError: (e) => toastError(e),
  });

  const supersede = useMutation({
    ...trpc.outreach.supersedeListRun.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.outreach.listCoverage.queryKey() });
      toast('Run retired. That region can be scraped again.');
    },
    onError: (e) => toastError(e),
  });

  /**
   * Retrying a failed run, from the ledger.
   *
   * The counterpart to Retire and the one to reach for first: a run that failed
   * after its scrape landed re-reads a dataset already paid for, so this costs
   * nothing where retiring-and-rerunning costs the whole scrape again.
   */
  const retryRun = useMutation({
    ...trpc.outreach.retryListRun.mutationOptions(),
    onSuccess: (r) => {
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
   * The run whose prospects are being deleted right now.
   *
   * Held in the page rather than the ledger row because the work outlives the
   * click: the purge runs in the Worker, one Smartlead call per contact, so the
   * row has to keep reporting progress across refetches.
   */
  const [purgingId, setPurgingId] = useState<string | null>(null);

  const purgeQuery = useQuery({
    ...trpc.outreach.listRunPurge.queryOptions({ runId: purgingId ?? '' }),
    enabled: !!purgingId,
    refetchInterval: (q) => (q.state.data?.finishedAt ? false : 2000),
  });

  // Announced once, when it lands. The counts are the point: "deleted" is the
  // number that left, and "stranded" is the number still receiving email — the
  // one thing about this operation that can quietly not work.
  useEffect(() => {
    const state = purgeQuery.data;
    if (!state?.finishedAt) return;
    setPurgingId(null);
    qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
    if (state.stranded > 0) {
      toastError(
        `${state.deleted} prospects deleted. ${state.stranded} could not be taken out of their campaign, so their records were kept — they are still receiving the sequence. ${state.errors[0] ?? ''}`,
      );
    } else {
      toast(`${state.deleted} prospect${state.deleted === 1 ? '' : 's'} deleted.`);
    }
  }, [purgeQuery.data?.finishedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const purgeProspects = useMutation({
    ...trpc.outreach.deleteRunProspects.mutationOptions(),
    onSuccess: (state) => {
      if (state.finishedAt) {
        toast('Nothing to delete — this run has no prospects on file.');
        return;
      }
      setPurgingId(state.runId);
    },
    onError: (e) => toastError(e),
  });

  const moveRun = useMutation({
    ...trpc.outreach.moveListRun.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() }),
    onError: (e) => toastError(e),
  });

  const skipRun = useMutation({
    ...trpc.outreach.skipListRun.mutationOptions(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: trpc.outreach.listRuns.queryKey() });
      toast(r.skipped ? 'Skipped. The queue moves on without it.' : 'Back in the queue.');
    },
    onError: (e) => toastError(e),
  });

  /**
   * Skipping a run that is ready to send is the one that deserves a beat.
   *
   * Skipping a scrape in progress costs nothing — it stops it blocking the
   * queue and the scrape carries on. Skipping a run at `review` cancels a send
   * that was minutes away, which is the kind of thing to be sure about.
   */
  const toggleSkip = async (row: QueueRow) => {
    if (!row.skipped && row.status === 'review') {
      const ok = await confirm({
        title: `Skip ${row.vertical} · ${row.region}?`,
        description:
          'It is ready to send. Skipping parks it out of the queue — nothing sends, nothing behind it is held up, and it keeps its place for when you put it back.',
        confirmLabel: 'Skip',
      });
      if (!ok) return;
    }
    skipRun.mutate({ runId: row.id, skipped: !row.skipped });
  };

  const deleteProspects = async (row: QueueRow) => {
    const ok = await confirm({
      title: `Delete ${row.prospectCount.toLocaleString()} prospects from the ${row.vertical} · ${row.region} run?`,
      description:
        'Each one is taken out of its Smartlead campaign first, so the rest of their sequence stops, and then the record is deleted. Anyone Smartlead refuses to release is kept — a contact we are still emailing has to stay on file. The scrape itself is not undone; the run keeps its place on the coverage map.',
      confirmLabel: 'Delete prospects',
      destructive: true,
    });
    if (ok) purgeProspects.mutate({ runId: row.id });
  };

  const notConfigured =
    config.data &&
    (!config.data.scraperConfigured ||
      !config.data.verifierConfigured ||
      !config.data.campaignConfigured);

  // Mirrors the server's `normaliseKey`. Both halves of the pair are compared
  // the same way the unique index compares them, or this warning would disagree
  // with the refusal it is trying to predict.
  const normKey = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

  const scraped = useMemo(() => {
    const pairs = new Set<string>();
    const places = new Set<string>();
    for (const r of runs.data ?? []) {
      if (r.status === 'superseded') continue;
      // A failed run still holds its region once its scrape was paid for —
      // `reusesScrape` is the server saying the dataset is still there. Only a
      // failure that never reached the provider frees the pair, and letting the
      // other kind through here would show a green Start button for a run the
      // server is going to refuse.
      if (r.status === 'failed' && !r.reusesScrape) continue;
      pairs.add(`${normKey(r.vertical)}|${r.regionKey}`);
      if (r.placeId) places.add(`${normKey(r.vertical)}|${r.placeId}`);
    }
    return { pairs, places };
  }, [runs.data]);

  /** …and the run holding it is a failure whose scrape can be picked up for free. */
  const scrapedButFailed = useMemo(
    () =>
      (runs.data ?? []).some(
        (r) =>
          r.status === 'failed' &&
          r.reusesScrape &&
          normKey(r.vertical) === normKey(vertical) &&
          (r.regionKey === normKey(region) || (!!placeId && r.placeId === placeId)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs.data, vertical, region, placeId],
  );

  const alreadyScraped =
    vertical.trim().length > 1 &&
    (scraped.pairs.has(`${normKey(vertical)}|${normKey(region)}`) ||
      // The case a name can't catch: this area was scraped under a different
      // name, and only Google's id knows the two are the same place.
      (!!placeId && scraped.places.has(`${normKey(vertical)}|${placeId}`)));

  /**
   * The case NO name can catch: this region is inside one we already bought.
   *
   * A council scraped after the metro above it is two different regions with
   * two different ids, so nothing local can see the collision — and it is the
   * expensive one. Apify bills for every business again, then dedupe drops all
   * of them as already known: the run "succeeds", pushes nothing, and the money
   * is gone. Asked of the server because the answer lives in the geography, not
   * in the runs list the client holds.
   */
  const overlap = useQuery({
    ...trpc.outreach.regionOverlap.queryOptions({ vertical: vertical.trim(), placeId: placeId ?? '' }),
    enabled: vertical.trim().length > 1 && !!placeId && !alreadyScraped,
  });
  const coveredBy = overlap.data ?? null;

  /**
   * The run standing in the way of this one, if there is one.
   *
   * Two different collisions arrive here — the same region under a name we have
   * already run, and a region sitting inside a bigger one we already bought —
   * but the operator's next question is identical for both: which run holds it,
   * and what is in it. So they collapse to one id, and the primary button below
   * becomes the way there rather than a dead control beside an explanation.
   */
  const blockingRunId = useMemo(() => {
    if (coveredBy) return coveredBy.runId;
    if (!alreadyScraped) return null;
    const hit = (runs.data ?? []).find(
      (r) =>
        r.status !== 'superseded' &&
        // The same exemption `scraped` makes: a failure that never reached the
        // provider does not hold its region, so it cannot be what is blocking.
        !(r.status === 'failed' && !r.reusesScrape) &&
        normKey(r.vertical) === normKey(vertical) &&
        (r.regionKey === normKey(region) || (!!placeId && r.placeId === placeId)),
    );
    return hit?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coveredBy, alreadyScraped, runs.data, vertical, region, placeId]);

  /**
   * Open a run.
   *
   * A navigation rather than a state change, which is what fixed the scroll
   * problem this used to have: a run opening as a panel on this screen appeared
   * ABOVE the queue you clicked it in, so looking at something moved the thing
   * you were looking at, and pressing a button halfway down the form landed you
   * halfway down the queue with the panel above the fold.
   */
  const openRun = (id: string) => navigate(`${RUN_HREF}/${id}`);

  const retire = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Retire the ${label} run?`,
      description:
        'That region becomes scrapeable again, and scraping it again costs full price for a month of churn — typically 1–2% genuinely new businesses. Only worth it on a stale region.',
      confirmLabel: 'Retire run',
      destructive: true,
    });
    if (ok) supersede.mutate({ runId: id });
  };

  return (
    <OutreachShell
      title="List Builder"
      description="One vertical, one region, one run. Nothing sends until you review it."
    >
      {notConfigured && (
        <div className="mb-5 rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] bg-card px-5 py-4">
          <h2 className="text-ui-md text-ink-100">List building isn&rsquo;t configured</h2>
          <ul className="text-ui-xs mt-2 flex flex-col gap-1 text-ink-60">
            {!config.data?.scraperConfigured && (
              <li>
                No Maps provider — add <code className="mono text-ink-100">APIFY_TOKEN</code>.
              </li>
            )}
            {!config.data?.verifierConfigured && (
              <li>
                No email verifier — add{' '}
                <code className="mono text-ink-100">MILLIONVERIFIER_API_KEY</code>. Verification is
                mandatory: bounces are the fastest way to burn a domain.
              </li>
            )}
            {!config.data?.campaignConfigured && (
              <li>
                No campaign to send with — add{' '}
                <code className="mono text-ink-100">OUTREACH_CAMPAIGN_NAME</code>. Every run lands
                in this environment&rsquo;s one campaign; without a name there is nowhere for the
                contacts to go, and a scrape with nowhere to go is money spent for nothing.
              </li>
            )}
          </ul>
        </div>
      )}

      <ViewSwitch
        view={view}
        onChange={setView}
        runCount={runs.data?.length ?? 0}
        inFlight={inFlight}
      />

      {view === 'new' ? (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
          {/* ── The run form ──────────────────────────────────────────────────
              Scrolls with the page. It is longer than a viewport once the cost
              notes and the two overlap warnings are on it, and a pane with its
              own scrollbar either hides the Start button below the fold or
              traps the wheel on the way past it. */}
          <section className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-5 py-5">
            {/* Not "New run" — that is the tab you are standing on. This names
                the half of it you are filling in. */}
            <h2 className="text-panel-title text-ink-100">What to scrape</h2>

            <label className="mt-4 block">
              <span className="eyebrow">Vertical</span>
              <Input
                className="mt-2"
                value={vertical}
                onChange={(e) => setVertical(e.target.value)}
                placeholder="Dentist"
                list="outreach-verticals"
                autoComplete="off"
              />
              {/* The verticals we have actually run, not a wish list. Getting
                  the spelling to match matters more than it looks: the string is
                  the search and the noun in the opener at once, so "Dentists"
                  and "Dentist" are two ledger rows and two bills for one set of
                  businesses. */}
              <datalist id="outreach-verticals">
                {(config.data?.verticals ?? []).map((v) => (
                  <option key={v.vertical} value={v.vertical} />
                ))}
              </datalist>
              <span className="text-ui-xs mt-1.5 block text-ink-40">
                This is the literal Google search and the noun in the opener &mdash; so keep it
                singular. The same one twice over the same region is refused, because that pays
                twice.
              </span>
            </label>

            <RegionPicker
              attribution={config.data?.regionSearchAttribution ?? ''}
              region={region}
              placeId={placeId}
              onPick={(label, id) => {
                setRegion(label);
                setPlaceId(id);
              }}
            />

            {/* No campaign picker. There is one campaign per environment and
                every run lands in it — see the Sending Email tab, which is
                first in the row for exactly this reason: the sequence is what
                these contacts will receive, and it should exist before they
                are bought. */}
            <label className="mt-4 block">
              <span className="eyebrow">Cap</span>
              <Input
                type="number"
                min={1}
                max={config.data?.resultCeiling ?? 17_000}
                className="tnum mt-2 w-28"
                value={maxRecords}
                onChange={(e) => setMaxRecords(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>

            <label className="mt-4 flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={personalise}
                onChange={(e) => setPersonalise(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--color-accent)]"
              />
              <span>
                <span className="text-ui-sm block text-ink-100">Also crawl homepages</span>
                <span className="text-ui-xs mt-0.5 block text-ink-40">
                  Adds an LLM pass over one concrete detail from the homepage — but only for
                  contacts that qualify, meaning those below typical reviews for their area. A
                  business already at or above typical is getting a generic opener anyway, so it
                  isn&rsquo;t worth a crawl. Off by default: the review-count opener is free, comes
                  with every run, and is the stronger hook for a reviews product.
                </span>
              </span>
            </label>

            <p className="text-ui-xs mt-4 text-ink-60">
              <span className="tnum">about ${estimate.data?.usd?.toFixed(2) ?? '—'}</span>{' '}
              <span className="text-ink-40">
                upper bound — a region with fewer businesses than the cap costs less
              </span>
            </p>
            <p className="text-ui-xs mt-1.5 text-ink-40">
              Set the cap high. It&rsquo;s a spend ceiling, not a target, and you&rsquo;re billed
              per business found — but a run that stops at its cap can&rsquo;t be continued
              without paying again for everything it already scraped.
            </p>

            {/* ── When the region is already ours ─────────────────────────
                Both messages explain and stop there. The link out used to be
                buried in the sentence, sitting beside a full-width primary
                button that could only be greyed out — so the one control the
                operator could actually press was the small underlined one, and
                the big one existed to be refused. The button below becomes the
                way to the run instead, which is where every next move is:
                retry it, retire it, or read who it already bought. */}
            {alreadyScraped && (
              <p className="text-ui-xs mt-3 text-danger">
                {vertical.trim()} in {region} has already been scraped.{' '}
                {scrapedButFailed
                  ? 'That run failed after the scrape landed, so picking it up again is free — buying the region a second time is not.'
                  : 'Retire that run to do the region again.'}
              </p>
            )}

            {coveredBy && (
              <p className="text-ui-xs mt-3 text-danger">
                {region} is inside {coveredBy.region}, already scraped for {vertical.trim()}. Those
                businesses are bought &mdash; this run would pay for them again and push nothing.
              </p>
            )}

            {blockingRunId ? (
              <Button className="mt-4 w-full" onClick={() => openRun(blockingRunId)}>
                See that run
              </Button>
            ) : (
              <Button
                className="mt-4 w-full"
                disabled={
                  start.isPending ||
                  !!notConfigured ||
                  !vertical.trim() ||
                  // Not `region` — the id is what the server runs on, and a typed
                  // name that was never resolved to one is exactly the ambiguity
                  // that gets a council scraped twice under two spellings.
                  !placeId ||
                  // Belt and braces: `blockingRunId` covers both collisions and
                  // normally renders the button above instead, but a collision
                  // whose run has scrolled off the 50-row ledger would leave it
                  // null with the warning still on screen.
                  alreadyScraped ||
                  !!coveredBy
                }
                onClick={() =>
                  placeId &&
                  start.mutate({
                    vertical: vertical.trim(),
                    placeId,
                    maxRecords,
                    sendingDomain: null,
                    personalise,
                  })
                }
              >
                Start run
              </Button>
            )}
            {start.isError && (
              <p className="text-ui-xs mt-2 text-danger">{getErrorMessage(start.error)}</p>
            )}
          </section>

          {/* ── The run in flight ─────────────────────────────────────────── */}
          <section>
            {!live.run ? (
              <div className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] px-6 py-16 text-center">
                <p className="text-ui-sm text-ink-60">No run in progress.</p>
                <p className="text-ui-xs mt-1 text-ink-40">
                  Name a vertical and search for a region to start one.
                </p>
                {(runs.data?.length ?? 0) > 0 && (
                  <button
                    type="button"
                    onClick={() => setView('previous')}
                    className="text-ui-xs mt-3 text-ink-40 underline underline-offset-2 hover:text-ink-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
                  >
                    See the {runs.data?.length} run{runs.data?.length === 1 ? '' : 's'} already done
                  </button>
                )}
              </div>
            ) : (
              <RunPanel
                run={live.run}
                onPush={live.push}
                onSkip={live.skip}
                onRetry={live.retry}
                pushing={live.pushing}
                skipping={live.skipping}
                retrying={live.retrying}
              />
            )}
          </section>
        </div>
      ) : null}

      {view === 'previous' && (
        <>
          {(runs.data?.length ?? 0) === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] px-6 py-16 text-center">
              <p className="text-ui-sm text-ink-60">Nothing has been run yet.</p>
              <button
                type="button"
                onClick={() => setView('new')}
                className="text-ui-xs mt-2 text-ink-40 underline underline-offset-2 hover:text-ink-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
              >
                Start the first run
              </button>
            </div>
          ) : (
            <>
              {/* Summary before detail: the map is every run at once, the ledger
                  is each of them one at a time. */}
              <Coverage data={coverage.data ?? null} />
              <SendQueue
                rows={runs.data ?? []}
                onOpen={openRun}
                onMove={(id, delta) => moveRun.mutate({ runId: id, delta })}
                onSkip={toggleSkip}
                onRetire={retire}
                onRetry={(id) => retryRun.mutate({ runId: id })}
                onDeleteProspects={deleteProspects}
                purge={purgeQuery.data ?? null}
                busy={
                  supersede.isPending ||
                  purgeProspects.isPending ||
                  moveRun.isPending ||
                  skipRun.isPending ||
                  retryRun.isPending
                }
              />
            </>
          )}
        </>
      )}
    </OutreachShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Views
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * New run / Previous runs.
 *
 * Deliberately NOT a sixth entry in the Outreach nav. Those five are surfaces —
 * separate jobs, separate data, worth their own URL. These two are one job seen
 * from two ends, and the switch between them carries state (a form half filled
 * in, a run being watched) that a route change would throw away.
 *
 * The live dot is the reason it can be a switch at all: leaving the working view
 * while a scrape is billing is only safe if the tab you left says it's still
 * going.
 */
function ViewSwitch({
  view,
  onChange,
  runCount,
  inFlight,
}: {
  view: View;
  onChange: (v: View) => void;
  runCount: number;
  inFlight: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="List builder view"
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
            {v.key === 'new' && inFlight && (
              <span
                aria-label="a run is in progress"
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full motion-safe:animate-pulse',
                  active ? 'bg-paper' : 'bg-accent',
                )}
              />
            )}
            {v.key === 'previous' && runCount > 0 && (
              <span className={cn('tnum', active ? 'text-paper/60' : 'text-ink-40')}>
                {runCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Region
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Find a region by searching for it. There is no other way, on purpose.
 *
 * This used to default to a dropdown of 38 hand-verified names with search as
 * an escape hatch, and the split was the wrong shape twice over. It made the
 * narrow path the default — Sydney's 33 councils, when the whole point of the
 * search provider is that anywhere is reachable — and, worse, it made the
 * PLACE ID optional, because a curated name has none.
 *
 * That id is the thing worth protecting. It's what stops one council being
 * scraped twice under two spellings, which is the single mistake in this
 * pipeline that costs real money and cannot be undone afterwards. With the
 * dropdown gone, every run carries one, so the exact-identity uniqueness index
 * always applies instead of applying only to the runs that happened to come in
 * through the escape hatch.
 */
function RegionPicker({
  attribution,
  region,
  placeId,
  onPick,
}: {
  attribution: string;
  region: string;
  placeId: string | null;
  onPick: (label: string, placeId: string) => void;
}) {
  const trpc = useTRPC();
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');

  /**
   * Type-to-search, debounced — NOT per keystroke.
   *
   * The distinction matters more than it usually would. OpenStreetMap is the
   * default backend and the reason this works without an API key at all, and
   * their usage policy asks specifically that they not be used as an
   * autocomplete. So the pause is the request: nothing leaves the browser until
   * typing stops, and the server serialises whatever does to one call a second
   * process-wide (`osmQueue` in region-search.ts). Between them, a fast typist
   * costs one request, not one per letter.
   */
  useEffect(() => {
    const next = term.trim();
    if (next.length < 2) {
      setQuery('');
      return;
    }
    const id = setTimeout(() => setQuery(next), 500);
    return () => clearTimeout(id);
  }, [term]);

  const suggestions = useQuery({
    ...trpc.outreach.regionSuggest.queryOptions({ query }),
    enabled: query.length >= 2,
    staleTime: 5 * 60_000,
    // Hold the last results while the next search is in flight. Without this
    // the list empties on every refined keystroke, which reads as "no matches"
    // for as long as the 1-a-second queue takes to answer.
    placeholderData: (prev) => prev,
  });

  // Gated on `query`, not just on the data. `placeholderData` deliberately
  // outlives the key it came from, which is right mid-search and wrong the
  // moment a result is picked — without this the list a pick came from would
  // stay open underneath it.
  const results = query.length >= 2 ? (suggestions.data ?? []) : [];

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="eyebrow">Region</span>
        {suggestions.isFetching && <span className="text-ui-xs text-ink-40">Searching…</span>}
      </div>

      <Input
        className="mt-2"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Inner West, Wollongong, Hamilton NZ…"
        aria-label="Search for a region"
      />

      {/* The chosen region stays visible while searching again, so it's obvious
          that typing without picking changes nothing. */}
      {!!placeId && (
        <p className="text-ui-xs mt-2 text-ink-60">
          Using <span className="text-ink-100">{region}</span>
        </p>
      )}

      {suggestions.isError && (
        <p className="text-ui-xs mt-2 text-danger">{getErrorMessage(suggestions.error)}</p>
      )}

      {results.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
          {results.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => {
                  onPick(s.label, s.placeId);
                  setTerm('');
                  setQuery('');
                }}
                className="w-full px-3 py-2 text-left transition-colors duration-[var(--duration-quick)] hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
              >
                <span className="text-ui-sm block text-ink-100">{s.label}</span>
                {s.context && <span className="text-ui-xs block text-ink-40">{s.context}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!!query &&
        !suggestions.isFetching &&
        !suggestions.isError &&
        results.length === 0 && (
          <p className="text-ui-xs mt-2 text-ink-40">
            Nothing matching. Councils, cities and states work; suburbs mostly don&rsquo;t, and
            shouldn&rsquo;t — the scraper tiles whatever it&rsquo;s given.
          </p>
        )}

      {results.length > 0 && !!attribution && (
        <p className="text-ui-xs mt-1.5 text-ink-20">{attribution}</p>
      )}

      <span className="text-ui-xs mt-1.5 block text-ink-40">
        A council area, or a whole metro — never a suburb. The scraper geocodes the region and
        tiles it itself, so a whole-metro run has the same coverage as splitting it up, at a
        fraction of the overhead.
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Coverage
 * ────────────────────────────────────────────────────────────────────────── */

interface CoverageCell {
  region: string;
  osmId: string | null;
  /** How it came to be covered — its own run, a bigger one, or not at all. */
  via: 'direct' | 'parent' | null;
  status: string | null;
  runId: string | null;
  coveredBy: string | null;
  found: number;
  pushed: number;
  costUsd: number | null;
  scrapedAt: string | null;
}

interface CoverageGrid {
  vertical: string;
  region: string;
  osmId: string;
  self: {
    status: string;
    runId: string;
    found: number;
    pushed: number;
    costUsd: number | null;
  } | null;
  cells: CoverageCell[];
  done: number;
  total: number;
  note: string | null;
}

interface CoverageData {
  grids: CoverageGrid[];
  loose: { vertical: string; cells: CoverageCell[] }[];
}

/** Above this many cells a grid opens collapsed — 30 councils read, 300 don't. */
const CELLS_BEFORE_COLLAPSE = 24;

/**
 * The fill for one cell.
 *
 * Five states now, where there used to be four, and the new one is the whole
 * point of this rewrite: a council covered because the metro above it was
 * bought. It reads as filled — it IS covered, nothing more needs to be spent on
 * it — but softer than a region with its own run and its own line on the bill,
 * because those two facts lead to different decisions.
 */
function cellTone(c: CoverageCell): string {
  if (c.status === 'failed') return 'bg-danger/10 text-danger';
  if (!c.status) return 'text-ink-20 ring-1 ring-inset ring-[color:var(--color-ink-10)]';
  if (c.status !== 'done') return 'bg-accent/15 text-ink-100';
  return c.via === 'direct'
    ? 'bg-ink-100 text-paper'
    : 'bg-ink-100/12 text-ink-80 ring-1 ring-inset ring-[color:var(--color-ink-20)]';
}

function cellTitle(c: CoverageCell): string {
  if (!c.status) return `${c.region} — not scraped`;
  if (c.via === 'parent') return `${c.region} — covered by the ${c.coveredBy} run`;
  const bill = c.costUsd !== null ? `, $${c.costUsd.toFixed(2)}` : '';
  return `${c.region} — ${c.status}${c.pushed ? `, ${c.pushed} pushed` : ''}${bill}`;
}

/**
 * What&rsquo;s left.
 *
 * Geography is a depleting resource: across ~25 verticals the Sydney basin
 * holds 45–60k listings → 12–18k verified contacts, which at 2,000 new contacts
 * a month runs out in 6–9 months. This grid is the thing that says when to open
 * Melbourne, so it leads the Previous runs view rather than living in a report
 * someone has to think to go and look at.
 *
 * It is computed from the polygons the runs were scraped against, not from
 * matching region names against a list we wrote — which is why one whole-metro
 * run now fills the thirty councils inside it instead of a single square, and
 * why the councils that fall outside that polygon stay honestly empty.
 */
function Coverage({ data }: { data: CoverageData | null }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  if (!data || (data.grids.length === 0 && data.loose.length === 0)) return null;

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section className="mb-8">
      <SectionHeading
        title="Coverage"
        note="Regions inside a region you scraped are covered by it — one metro run buys every council in it."
      />

      {/* Five states, five fills. Nothing on the page used to say which was
          which, so the map could only be read by hovering every cell. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <LegendKey className="bg-ink-100">Scraped</LegendKey>
        <LegendKey className="bg-ink-100/12 ring-1 ring-inset ring-[color:var(--color-ink-20)]">
          Covered by a bigger run
        </LegendKey>
        <LegendKey className="bg-accent/15">In progress</LegendKey>
        <LegendKey className="bg-danger/10">Failed</LegendKey>
        <LegendKey className="ring-1 ring-inset ring-[color:var(--color-ink-10)]">
          Not scraped
        </LegendKey>
      </div>

      <div className="mt-4 flex flex-col gap-5">
        {data.grids.map((g) => {
          const key = `${g.vertical}-${g.osmId}`;
          const open = expanded.has(key) || g.cells.length <= CELLS_BEFORE_COLLAPSE;
          const shown = open ? g.cells : g.cells.slice(0, CELLS_BEFORE_COLLAPSE);
          return (
            <div key={key}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="text-ui-sm text-ink-100">
                  {g.vertical} <span className="text-ink-40">· {g.region}</span>
                </h3>
                <span className="tnum text-ui-xs text-ink-40">
                  {g.done} / {g.total} inside
                </span>
              </div>

              {/* The parent's own run, when there is one. Said here rather than
                  as a cell because the whole grid is its result — a metro run's
                  found count belongs to the metro, not to any one council. */}
              {g.self && (
                <p className="text-ui-xs mt-1 text-ink-40">
                  Scraped as one run &mdash; {g.self.found.toLocaleString()} found
                  {g.self.pushed ? `, ${g.self.pushed.toLocaleString()} pushed` : ''}
                  {g.self.costUsd !== null ? `, $${g.self.costUsd.toFixed(2)}` : ''}
                </p>
              )}
              {g.note && <p className="text-ui-xs mt-1 text-warn">{g.note}</p>}

              <div className="mt-2 flex flex-wrap gap-1">
                {shown.map((c) => (
                  <span
                    key={c.osmId ?? c.region}
                    title={cellTitle(c)}
                    className={cn(
                      'text-ui-xs rounded-[var(--radius-sm)] px-2 py-0.5',
                      cellTone(c),
                    )}
                  >
                    {c.region}
                  </span>
                ))}
                {g.cells.length > CELLS_BEFORE_COLLAPSE && (
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="text-ui-xs rounded-[var(--radius-sm)] px-2 py-0.5 text-ink-40 underline underline-offset-2 hover:text-ink-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
                  >
                    {open ? 'Show fewer' : `+${g.cells.length - CELLS_BEFORE_COLLAPSE} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/**
         * Regions with no denominator to sit in.
         *
         * Somewhere we scraped that no grid above accounts for — either we have
         * not asked OpenStreetMap what is inside it yet, or nothing is. Listing
         * them separately is the honest shape: these are places we HAVE bought,
         * with no claim about how much of anywhere they represent. Without this
         * they would be scraped, billed, and then invisible on the one surface
         * that says what has been covered.
         */}
        {data.loose.map((l) => (
          <div key={`loose-${l.vertical}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-ui-sm text-ink-100">
                {l.vertical} <span className="text-ink-40">· elsewhere</span>
              </h3>
              <span className="tnum text-ui-xs text-ink-40">
                {l.cells.length} region{l.cells.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {l.cells.map((c) => (
                <span
                  key={c.osmId ?? c.region}
                  title={cellTitle(c)}
                  className={cn('text-ui-xs rounded-[var(--radius-sm)] px-2 py-0.5', cellTone(c))}
                >
                  {c.region}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LegendKey({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="text-ui-xs flex items-center gap-1.5 text-ink-40">
      <span
        aria-hidden
        className={cn('h-3 w-5 rounded-[var(--radius-sm)]', className)}
      />
      {children}
    </span>
  );
}


/* ──────────────────────────────────────────────────────────────────────────
 * The send queue
 *
 * This was a ledger — one flat table of runs, newest first, which is the order
 * they were STARTED in. That order stopped being the interesting one when
 * sending became single-file: every run lands in the same campaign now, so the
 * question the screen has to answer is not "what have I run" but "who hears
 * from us next, and in what order".
 *
 * So it is three groups, and the order within them is the send order:
 * **queued** (next at the top, where the controls are), **sending** (the one
 * uploading right now), and **sent**. Runs cross from one to the next and never
 * back, which is why reordering and skipping exist only in the first group —
 * a run that has already sent has no position left to argue about.
 *
 * The queue is strict on purpose: a run that is still scraping holds up the
 * ones behind it, because an order that only applied to whoever happened to
 * finish first would not be an order. Every blocked row says what is holding
 * it, by name. Skip is the release valve, and the reason it can be — parking a
 * run keeps its place, so it comes back exactly where it was.
 * ────────────────────────────────────────────────────────────────────────── */

interface QueueRow {
  id: string;
  vertical: string;
  region: string;
  status: string;
  stage: string;
  counts: RunCounts;
  maxRecords: number;
  capped: boolean;
  /** Failed, and therefore recoverable — see `retryListRun`. */
  retryable: boolean;
  /** …and recoverable for FREE, because the scrape it paid for is still there. */
  reusesScrape: boolean;
  prospectCount: number;
  costActualUsd: number | null;
  costEstimateUsd: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  /** Where it sits: queued, sending, or sent. Three states, no fourth. */
  queueState: string;
  position: number;
  skipped: boolean;
  blockedBy: { id: string; label: string } | null;
}

interface PurgeState {
  runId: string;
  total: number;
  done: number;
  deleted: number;
  stranded: number;
  errors: string[];
  finishedAt: string | null;
}

/** What a run is doing, in the words the operator would use for it. */
function stageLabel(row: QueueRow): string {
  if (row.status === 'failed') return 'failed';
  if (row.status === 'superseded') return 'retired';
  if (row.status === 'done') return 'sent';
  if (row.status === 'pushing') return 'uploading to the campaign';
  if (row.status === 'review') return 'ready to send';
  return STAGES.find((s) => s.key === row.stage)?.label.toLowerCase() ?? row.stage;
}

function money(row: QueueRow): string {
  if (row.costActualUsd !== null) return `$${row.costActualUsd.toFixed(2)}`;
  if (row.costEstimateUsd !== null) return `~$${row.costEstimateUsd.toFixed(2)}`;
  return '—';
}

/**
 * The ordinal on a queued row.
 *
 * Deliberately NOT `queue_position`. That column spans sent runs too, so the
 * front of the queue would read "7" — a true number answering a question nobody
 * asked. What the operator wants to know is how many runs go before this one,
 * so the eligible runs are numbered 1, 2, 3 and a skipped run gets no number at
 * all, because it is not in the running order. It keeps its place in the list,
 * which is where "unskip puts it back where it was" becomes something you can
 * see rather than something you have to be told.
 */
function eligibleOrdinals(queued: QueueRow[]): Map<string, number> {
  const map = new Map<string, number>();
  let n = 0;
  for (const r of queued) if (!r.skipped) map.set(r.id, ++n);
  return map;
}

function QueueGroup({
  label,
  note,
  children,
}: {
  label: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="eyebrow">{label}</span>
        {note && <span className="text-ui-xs text-ink-40">{note}</span>}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

/**
 * The position marker.
 *
 * A number while the run is waiting — it is what the reorder buttons act on, so
 * it sits where the hand goes. A live dot while it is sending. A rule once it
 * has sent, because the number has stopped meaning anything by then and a
 * finished run should read as closed rather than as position zero.
 */
function QueueMarker({
  ordinal,
  state,
  skipped,
}: {
  ordinal: number | null;
  state: string;
  skipped: boolean;
}) {
  if (state === 'sending') {
    return (
      <span
        aria-label="sending now"
        className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center"
      >
        <span className="h-2 w-2 rounded-full bg-accent motion-safe:animate-pulse" />
      </span>
    );
  }
  if (state === 'sent') {
    return (
      <span aria-hidden className="mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center">
        <span className="h-px w-3 bg-[color:var(--color-border-default)]" />
      </span>
    );
  }
  return (
    <span
      aria-label={skipped ? 'skipped' : `position ${ordinal}`}
      className={cn(
        'tnum mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]',
        skipped
          ? 'border-dashed border-[color:var(--color-ink-20)] text-ink-20'
          : 'border-[color:var(--color-border-hairline)] text-ink-60',
      )}
    >
      {skipped ? '–' : ordinal}
    </span>
  );
}

function QueueRowCard({
  row,
  ordinal,
  first,
  last,
  purge,
  busy,
  onOpen,
  onMove,
  onSkip,
  onRetire,
  onRetry,
  onDeleteProspects,
}: {
  row: QueueRow;
  ordinal: number | null;
  first: boolean;
  last: boolean;
  purge: PurgeState | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onSkip: (row: QueueRow) => void;
  onRetire: (id: string, label: string) => void;
  onRetry: (id: string) => void;
  onDeleteProspects: (row: QueueRow) => void;
}) {
  const queued = row.queueState === 'queued';
  const purging = purge && purge.runId === row.id && !purge.finishedAt;

  return (
    <div
      className={cn(
        'flex gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-4 py-3',
        row.skipped && 'opacity-70',
      )}
    >
      <QueueMarker ordinal={ordinal} state={row.queueState} skipped={row.skipped} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => onOpen(row.id)}
            className="text-ui-sm truncate text-left text-ink-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          >
            {row.vertical} <span className="text-ink-60">· {row.region}</span>
          </button>
          <span
            className={cn(
              'text-ui-xs',
              row.status === 'failed' ? 'text-danger' : row.skipped ? 'text-warn' : 'text-ink-40',
            )}
          >
            {row.skipped ? 'skipped' : stageLabel(row)}
          </span>
          {row.capped && (
            <span className="text-[11px] text-warn" title={`Stopped at the ${row.maxRecords} cap`}>
              capped
            </span>
          )}
        </div>

        {/* The one thing a strict queue owes the person reading it: why a run
            that is ready is not going. Named, so the fix is obvious. */}
        {queued && row.blockedBy && !row.skipped && row.status === 'review' && (
          <p className="text-ui-xs mt-1 text-ink-40">
            waiting on <span className="text-ink-60">{row.blockedBy.label}</span>
          </p>
        )}
        {row.error && !row.skipped && (
          <p className="text-ui-xs mt-1 max-w-[36rem] text-ink-40">{row.error}</p>
        )}

        <div className="text-ui-xs mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-ink-40">
          <span className="tnum">{(row.counts.found ?? 0).toLocaleString()} found</span>
          <span className="tnum">{(row.counts.pushed ?? 0).toLocaleString()} pushed</span>
          {row.prospectCount > 0 && (
            <span className="tnum">{row.prospectCount.toLocaleString()} on file</span>
          )}
          <span className={cn('tnum', row.costActualUsd === null && 'text-ink-20')}>
            {money(row)}
          </span>
        </div>
      </div>

      {/* Reordering and skipping exist only while a run is queued — a run that
          has sent has no position left to argue about. */}
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        {purging ? (
          <span className="tnum text-ui-xs text-ink-40">
            clearing {purge.done}/{purge.total}
          </span>
        ) : (
          <>
            {queued && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Send this run earlier"
                  disabled={busy || first}
                  onClick={() => onMove(row.id, -1)}
                  className="press flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-40 transition-colors duration-[var(--duration-quick)] hover:bg-inset hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Send this run later"
                  disabled={busy || last}
                  onClick={() => onMove(row.id, 1)}
                  className="press flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-40 transition-colors duration-[var(--duration-quick)] hover:bg-inset hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSkip(row)}
                  className="text-ui-xs ml-1 h-7 px-1 text-ink-40 transition-colors duration-[var(--duration-quick)] hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
                >
                  {row.skipped ? 'Unskip' : 'Skip'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-3">
              {/* Ahead of Retire and Delete, because it is the cheap move and
                  they are the expensive ones. A run that failed after its
                  scrape landed can be picked up for nothing; retiring it so the
                  region can be run again buys the same businesses twice. */}
              {row.retryable && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onRetry(row.id)}
                  title={
                    row.reusesScrape
                      ? 'Re-reads the scrape already paid for — free'
                      : 'Nothing was billed; this starts from the top'
                  }
                  className="text-ui-xs text-ink-60 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
                >
                  Retry
                </button>
              )}
              {row.prospectCount > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDeleteProspects(row)}
                  className="text-ui-xs text-ink-40 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
                >
                  Delete prospects
                </button>
              )}
              {row.status !== 'superseded' &&
                row.status !== 'running' &&
                row.status !== 'starting' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRetire(row.id, `${row.vertical} · ${row.region}`)}
                    className="text-ui-xs text-ink-40 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
                  >
                    Retire
                  </button>
                )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SendQueue({
  rows,
  onOpen,
  onMove,
  onSkip,
  onRetire,
  onRetry,
  onDeleteProspects,
  purge,
  busy,
}: {
  rows: QueueRow[];
  onOpen: (id: string) => void;
  onMove: (id: string, delta: -1 | 1) => void;
  onSkip: (row: QueueRow) => void;
  onRetire: (id: string, label: string) => void;
  onRetry: (id: string) => void;
  onDeleteProspects: (row: QueueRow) => void;
  purge: PurgeState | null;
  busy: boolean;
}) {
  const { queued, sending, sent } = queueGroups(rows);

  if (rows.length === 0) return null;

  const ordinals = eligibleOrdinals(queued);
  const actual = rows.reduce((sum, r) => sum + (r.costActualUsd ?? 0), 0);
  const unbilled = rows.filter((r) => r.costActualUsd === null && r.status !== 'superseded');
  const waiting = queued.filter((r) => !r.skipped).length;

  const card = (row: QueueRow, i: number, group: QueueRow[]) => (
    <QueueRowCard
      key={row.id}
      row={row}
      ordinal={ordinals.get(row.id) ?? null}
      first={i === 0}
      last={i === group.length - 1}
      purge={purge}
      busy={busy}
      onOpen={onOpen}
      onMove={onMove}
      onSkip={onSkip}
      onRetire={onRetire}
      onRetry={onRetry}
      onDeleteProspects={onDeleteProspects}
    />
  );

  return (
    <section>
      <SectionHeading
        title="Send queue"
        note={
          <>
            {waiting} waiting · <span className="tnum text-ink-100">${actual.toFixed(2)}</span>{' '}
            billed so far
          </>
        }
      />

      <div className="mt-3">
        {queued.length > 0 && (
          <QueueGroup label="Queued" note="in the order they will send — top goes first">
            {queued.map(card)}
          </QueueGroup>
        )}

        {sending.length > 0 && (
          <QueueGroup label="Sending" note="uploading to the campaign now">
            {sending.map(card)}
          </QueueGroup>
        )}

        {sent.length > 0 && (
          <QueueGroup label="Sent" note="most recent first">
            {sent.map(card)}
          </QueueGroup>
        )}
      </div>

      {unbilled.length > 0 && (
        <p className="text-ui-xs mt-3 text-ink-40">
          {unbilled.length} run{unbilled.length === 1 ? '' : 's'} not yet reported by the provider,
          so the total above is what has actually been billed — not what the runs will cost.
        </p>
      )}
    </section>
  );
}
