import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouterOutputs } from '@server/trpc/router';
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useTRPC } from '../../../lib/trpc';
import { getErrorMessage } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Input } from '../../../components/ui/input';
import {
  CLASSIFICATION_LABEL,
  ClassificationMark,
  ConversationThread,
  fmtDate,
  useKeepInView,
  useListKeys,
} from './shared';

/**
 * WHO IS IN THIS RUN — the roster inside a send-queue row.
 *
 * The send queue answers "which region hears from us next". This answers the
 * question directly underneath it, which the screen could not previously answer
 * at all: *who are those people*. Until now a run showed 200 of its contacts,
 * six fields wide, and only while it sat at `review`. After it sent, the only
 * way to see a business we had emailed was to leave for the Prospects screen and
 * search for it by name — one business at a time, out of four hundred.
 *
 * ── THE ORDER IS THE POINT ─────────────────────────────────────────────────
 * The queue numbers runs 1, 2, 3 in the order they will send. Open one and the
 * businesses inside are numbered the same way, in the order *they* will be
 * emailed — fewest reviews first, which is the sort `push()` actually uses. So
 * the numbering means the same thing at both resolutions, and run 1 / business 1
 * is literally the next stranger who will hear from us. That is also why the
 * pager is offset-based rather than a "Load more" cursor like the Prospects
 * list: while sweeping a region, "142 of 380" is the number you want, and a
 * cursor cannot tell you it. A run's roster is fixed once the run is done, so
 * paging by offset is safe here in a way it is not next door.
 *
 * ── COLLAPSED BY DEFAULT ───────────────────────────────────────────────────
 * You open a run to see its status; the roster is a second question, and a
 * 400-row list unfurling under the stage rail every time you click a queue row
 * would bury the decision the panel exists for. Open it and it becomes the
 * screen — with its own search, its own cuts, and arrows that move to the next
 * run in the queue so a sweep across several regions never goes back up to the
 * list.
 *
 * Nothing here is a decision. Deleting, suppressing and re-classifying all live
 * on surfaces built for them; this is the reading surface, and it stays one.
 */

/** Enough that a page is a real chunk of a region, few enough to scan. */
const PAGE = 25;

/** The envelope and the row, taken from the procedure so they cannot drift. */
type RunPage = NonNullable<RouterOutputs['outreach']['runBusinesses']>;
type Business = RunPage['items'][number];

type Cut = 'all' | 'will_send' | 'rejected' | 'replied' | 'yes';

/**
 * The cuts, named for what happens to the business rather than for the column.
 *
 * Which set you get depends on where the run is in its life, because the two
 * halves ask different questions. Before a push the only thing worth cutting on
 * is whether an address survived verification — the difference between who we
 * paid for and who we can actually email, and a number that stops existing the
 * moment the run is done. After a push, verification is history and what matters
 * is who answered.
 */
const CUTS: Record<
  RunPage['source'],
  { key: Cut; label: string; tally: keyof RunPage['tallies'] }[]
> = {
  candidates: [
    { key: 'all', label: 'All', tally: 'all' },
    { key: 'will_send', label: 'Will send', tally: 'willSend' },
    // Not "rejected" — nobody here rejected them. Verification did, and what the
    // operator needs off the chip is the consequence: these were paid for and
    // cannot be emailed.
    { key: 'rejected', label: "Can't send", tally: 'rejected' },
  ],
  prospects: [
    { key: 'all', label: 'All', tally: 'all' },
    { key: 'replied', label: 'Replied', tally: 'replied' },
    { key: 'yes', label: 'Said yes', tally: 'yes' },
  ],
};

export function RunBusinesses({
  runId,
  defaultOpen = false,
}: {
  runId: string;
  /**
   * Open on arrival. True while a run sits at `review`, because there the roster
   * is not a record — it is the thing the five-minute hold exists for, and
   * hiding it behind a click would make the spot-check something you have to
   * remember to do.
   */
  defaultOpen?: boolean;
}) {
  const trpc = useTRPC();

  const [open, setOpen] = useState(defaultOpen);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cut, setCut] = useState<Cut>('all');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  // A run that reaches review while you are watching it opens itself. Only ever
  // opens: a block you deliberately shut must not spring back on the next poll,
  // and `open` is deliberately NOT reset when the run changes, so stepping
  // through the queue with the arrows stays open the whole way.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  // A new run is a new list. Carrying a page number or an open row across would
  // land you at "page 6 of 2" on the run you just moved to.
  useEffect(() => {
    setOffset(0);
    setExpanded(null);
    setCut('all');
    setSearch('');
  }, [runId]);

  // Narrowing the list invalidates where you were in it.
  useEffect(() => {
    setOffset(0);
    setExpanded(null);
  }, [debounced, cut]);

  const query = useQuery({
    ...trpc.outreach.runBusinesses.queryOptions({
      runId,
      limit: PAGE,
      offset,
      search: debounced || undefined,
      cut,
    }),
    enabled: open,
    // Page flips keep the rows they are replacing on screen. Without this the
    // list blanks to a spinner on every press of `]`, which at 400 rows is the
    // difference between reading and waiting.
    placeholderData: (prev) => prev,
  });

  const data = query.data ?? null;
  const items = data?.items ?? [];
  const matched = data?.matched ?? 0;
  const source = data?.source ?? 'candidates';
  const pageCount = Math.max(1, Math.ceil(matched / PAGE));
  const pageNum = Math.floor(offset / PAGE) + 1;

  const flip = (delta: -1 | 1) => {
    const next = offset + delta * PAGE;
    if (next < 0 || next >= matched) return;
    setOffset(next);
    setExpanded(null);
  };

  /**
   * `j`/`k` walk the rows and turn the page when they reach the end of one, so
   * paging disappears while you are actually reading. `[`/`]` flip on purpose,
   * `/` reaches the search box, `Esc` closes whatever row is open.
   */
  const step = (delta: 1 | -1) => {
    if (items.length === 0) return;
    const at = items.findIndex((r) => r.key === expanded);

    // Nothing open yet: enter the page from the end you are travelling towards.
    if (at === -1) {
      setExpanded(delta === 1 ? items[0].key : items[items.length - 1].key);
      return;
    }

    const next = at + delta;
    // Walking off either end turns the page, so the pager disappears while you
    // are reading. The row to land on lives on a page that isn't loaded yet —
    // so land on none of them and let the next press pick one up, rather than
    // guessing a key and opening the wrong row for a frame.
    if (next < 0) {
      if (offset === 0) return;
      setOffset(offset - PAGE);
      setExpanded(null);
      return;
    }
    if (next >= items.length) {
      if (offset + PAGE >= matched) return;
      setOffset(offset + PAGE);
      setExpanded(null);
      return;
    }
    setExpanded(items[next].key);
  };

  useListKeys({
    disabled: !open,
    onNext: () => step(1),
    onPrev: () => step(-1),
    onPrevPage: () => flip(-1),
    onNextPage: () => flip(1),
    onSearch: () => searchRef.current?.focus(),
    onEscape: () => setExpanded(null),
  });

  const selectedRef = useKeepInView<HTMLLIElement>(expanded);
  const cuts = CUTS[source];
  const narrowed = !!debounced || cut !== 'all';

  return (
    <section className="border-t border-[color:var(--color-border-hairline)]">
      {/* ── The disclosure ─────────────────────────────────────────────────
          Shut, it names what is behind it and nothing else — the roster is not
          fetched until it is asked for, so there is no count to show yet. It
          keeps one once you have looked. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="press text-ui-sm flex items-center gap-2 text-ink-100 transition-colors duration-[var(--duration-quick)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'h-4 w-4 text-ink-40 transition-transform duration-[var(--duration-quick)] motion-reduce:transition-none',
              !open && '-rotate-90',
            )}
          />
          Businesses
          {data && <span className="tnum text-ink-40">{data.total.toLocaleString()}</span>}
        </button>

        {!open && (
          <span className="text-ui-xs text-ink-40">
            everything we hold on each one, in the order they are emailed
          </span>
        )}

      </div>

      {!open ? null : (
        <div className="border-t border-[color:var(--color-border-hairline)] px-5 py-4">
          {/* ── Search and cuts ─────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-20"
              />
              <Input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, email, suburb, category"
                className="h-8 pl-8 text-ui-xs"
              />
            </div>

            <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
              {cuts.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={cut === c.key}
                  onClick={() => setCut(c.key)}
                  className={cn(
                    'press text-ui-xs h-8 px-2.5 transition-colors duration-[var(--duration-quick)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                    cut === c.key ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
                  )}
                >
                  {c.label}
                  {data && (
                    <span
                      className={cn('tnum ml-1.5', cut === c.key ? 'opacity-60' : 'text-ink-20')}
                    >
                      {data.tallies[c.tally].toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {query.isError && (
            <p className="text-ui-sm mt-4 text-danger">{getErrorMessage(query.error)}</p>
          )}

          {/* ── The roster ──────────────────────────────────────────────── */}
          {query.isPending ? (
            <ul className="mt-4 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="border-b border-[color:var(--color-border-hairline)] px-3 py-3 last:border-0"
                >
                  <div className="pd-shimmer h-[13px] w-1/3 rounded-full" />
                  <div className="pd-shimmer mt-2 h-[11px] w-1/2 rounded-full" />
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <Empty narrowed={narrowed} data={data} onClear={() => { setSearch(''); setCut('all'); }} />
          ) : (
            <>
              <ul
                className={cn(
                  'mt-4 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]',
                  query.isFetching && 'opacity-60 transition-opacity motion-reduce:transition-none',
                )}
              >
                {items.map((row, i) => (
                  <BusinessRow
                    key={row.key}
                    row={row}
                    /* The send order, continued across pages — not the index on
                       this page. Position 1 is the next person contacted. */
                    ordinal={offset + i + 1}
                    open={expanded === row.key}
                    onToggle={() => setExpanded(expanded === row.key ? null : row.key)}
                    itemRef={expanded === row.key ? selectedRef : undefined}
                  />
                ))}
              </ul>

              <div className="text-ui-xs mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-ink-40">
                <span>
                  <span className="tnum text-ink-60">
                    {(offset + 1).toLocaleString()}&ndash;
                    {Math.min(offset + PAGE, matched).toLocaleString()}
                  </span>{' '}
                  of <span className="tnum text-ink-60">{matched.toLocaleString()}</span>
                  {narrowed && ` matching, ${(data?.total ?? 0).toLocaleString()} in the run`}
                  {' · '}
                  {source === 'candidates'
                    ? 'fewest reviews first — the order they will be emailed'
                    : 'fewest reviews first — the order they were emailed'}
                </span>

                <div className="flex items-center gap-2">
                  <span className="tnum">
                    Page {pageNum} / {pageCount}
                  </span>
                  <NavArrow label="Previous page" disabled={offset === 0} onClick={() => flip(-1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </NavArrow>
                  <NavArrow
                    label="Next page"
                    disabled={offset + PAGE >= matched}
                    onClick={() => flip(1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </NavArrow>
                </div>
              </div>

              <p className="text-ui-xs mt-2 text-ink-40">
                <kbd className="mono">j</kbd> <kbd className="mono">k</kbd> move,{' '}
                <kbd className="mono">[</kbd> <kbd className="mono">]</kbd> turn the page,{' '}
                <kbd className="mono">/</kbd> searches
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * A business
 * ────────────────────────────────────────────────────────────────────────── */

/** What the verifier said, in the words the consequence has. */
const VERDICT_LABEL: Record<string, string> = {
  valid: 'Deliverable',
  invalid: 'Dead address',
  // Not "unknown". The verifier could not reach an answer, and the rule the
  // push applies is that only `valid` goes out — so for this business the
  // consequence of not knowing is that we paid for them and cannot email them.
  unknown: 'Unverified — not sent',
};

function reviewLine(row: Business): string {
  const n = row.reviewsCount;
  const reviews = n === null ? 'no review count' : `${n} review${n === 1 ? '' : 's'}`;
  return row.rating === null ? reviews : `${reviews} · ${row.rating.toFixed(1)}★`;
}

function BusinessRow({
  row,
  ordinal,
  open,
  onToggle,
  itemRef,
}: {
  row: Business;
  ordinal: number;
  open: boolean;
  onToggle: () => void;
  itemRef?: React.Ref<HTMLLIElement>;
}) {
  const effective = row.manualClassification ?? row.classification;
  /** Verified and turned down: paid for, and not emailable. */
  const blocked = row.verdict && row.verdict !== 'valid' ? row.verdict : null;
  const panelId = `run-business-${row.key}`;

  return (
    <li
      ref={itemRef}
      className={cn(
        'border-b border-[color:var(--color-border-hairline)] last:border-0',
        open && 'bg-inset/40',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn(
          'flex w-full items-start gap-3 px-3 py-2.5 text-left',
          'transition-colors duration-[var(--duration-quick)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent-ring)]',
          !open && 'hover:bg-inset/60',
        )}
      >
        {/* The same ordinal device as the queue itself, one level down: this is
            the business's place in the send order, not its place on the page. */}
        <span
          aria-hidden
          className={cn(
            'tnum mt-0.5 w-8 shrink-0 text-right text-[11px]',
            blocked ? 'text-ink-20 line-through' : 'text-ink-40',
          )}
        >
          {ordinal}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span
              className={cn(
                'text-ui-sm min-w-0 truncate',
                blocked ? 'text-ink-40' : 'text-ink-100',
              )}
            >
              {row.businessName || row.email}
            </span>
            <span className="tnum shrink-0 text-[11px] text-ink-40">{reviewLine(row)}</span>
          </span>

          <span className="mono mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] text-ink-40">
            <span className="min-w-0 truncate">{row.email}</span>
            <span className="flex shrink-0 items-baseline gap-2">
              {blocked && <span className="text-warn">{VERDICT_LABEL[blocked] ?? blocked}</span>}
              {effective && <ClassificationMark value={effective} />}
              {!effective && row.repliedAt && <span className="tnum">replied {fmtDate(row.repliedAt)}</span>}
            </span>
          </span>

          {/* The opener, quoted — the sentence this business actually receives,
              and the one thing on the row worth reading in full. */}
          {row.hook ? (
            <span className="text-ui-xs mt-1 block text-ink-60">&ldquo;{row.hook}&rdquo;</span>
          ) : (
            <span className="text-ui-xs mt-1 block text-ink-20">
              no opener — already at or above typical for the area
            </span>
          )}
        </span>

        <ChevronDown
          aria-hidden
          className={cn(
            'mt-1 h-4 w-4 shrink-0 text-ink-20 transition-transform duration-[var(--duration-quick)] motion-reduce:transition-none',
            !open && '-rotate-90',
          )}
        />
      </button>

      {open && <BusinessDetail id={panelId} row={row} />}
    </li>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Everything we hold
 * ────────────────────────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-ui-xs mt-0.5 break-words text-ink-80">{children}</dd>
    </div>
  );
}

const dash = <span className="text-ink-20">&mdash;</span>;

function BusinessDetail({ id, row }: { id: string; row: Business }) {
  const trpc = useTRPC();

  /**
   * The thread is a LIVE Smartlead read — one call per business — so it is
   * fetched when a row is opened and never before. `hasThread` is false for
   * every business in a run that hasn't sent, which is what keeps a review-stage
   * sweep from making four hundred API calls for conversations that cannot
   * exist yet.
   */
  const thread = useQuery({
    ...trpc.outreach.prospectThread.queryOptions({ email: row.email }),
    enabled: row.hasThread,
  });

  const site = row.website
    ? {
        href: row.website.startsWith('http') ? row.website : `https://${row.website}`,
        label: row.website.replace(/^https?:\/\//, ''),
      }
    : null;
  const confidence = row.classificationConfidence;
  const effective = row.manualClassification ?? row.classification;

  return (
    <div
      id={id}
      className="border-t border-[color:var(--color-border-hairline)] bg-paper px-3 py-4 sm:pl-14"
    >
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Category">{row.category || dash}</Field>
        <Field label="Phone">
          {row.phone ? (
            <a
              href={`tel:${row.phone.replace(/\s+/g, '')}`}
              className="underline-offset-4 hover:text-ink-100 hover:underline"
            >
              {row.phone}
            </a>
          ) : (
            dash
          )}
        </Field>
        <Field label="Website">
          {site ? (
            <a
              href={site.href}
              target="_blank"
              rel="noreferrer noopener"
              className="underline-offset-4 hover:text-ink-100 hover:underline"
            >
              {site.label}
            </a>
          ) : (
            dash
          )}
        </Field>
        <Field label="Address">{row.address || dash}</Field>
        {/* Every field above shows a dash when it is empty, because empty means
            something there — no website is why a business gets the generic
            opener, no phone is why email is all we have. These two are
            different: before a push they are not missing, they do not exist
            yet, and a column of dashes on every row of a review sweep says
            nothing at all. */}
        {row.vertical && <Field label="Found as">{row.vertical}</Field>}
        {row.sendingDomain && (
          <Field label="Sending domain">
            <span className="mono">{row.sendingDomain}</span>
          </Field>
        )}
        {/* Verification is a fact about a run that hasn't sent. On a pushed row
            it is already spent — everything there passed — so it isn't repeated. */}
        {row.verdict && (
          <Field label="Verified">
            <span className={row.verdict === 'valid' ? 'text-ink-80' : 'text-warn'}>
              {VERDICT_LABEL[row.verdict] ?? row.verdict}
            </span>
          </Field>
        )}
        {row.hasThread && (
          <>
            <Field label="Last sent">{fmtDate(row.lastSentAt)}</Field>
            <Field label="Replied">{fmtDate(row.repliedAt)}</Field>
          </>
        )}
        {row.fulfilmentStatus && row.fulfilmentStatus !== 'none' && (
          <Field label="Verdiict account">
            {row.fulfilmentStatus}
            {row.fulfilmentEmail && row.fulfilmentEmail !== row.email && (
              <span className="mono text-ink-40"> · {row.fulfilmentEmail}</span>
            )}
          </Field>
        )}
        <Field label="Place id">
          <span className="mono break-all text-ink-40">{row.placeId || dash}</span>
        </Field>
        {row.leadId && (
          <Field label="Smartlead lead">
            <span className="mono text-ink-40">{row.leadId}</span>
          </Field>
        )}
        {row.createdAt && <Field label="On file since">{fmtDate(row.createdAt)}</Field>}
      </dl>

      {row.detail && (
        <p className="text-ui-xs mt-4 text-ink-60">
          <span className="eyebrow mr-2">From their site</span>
          {row.detail}
        </p>
      )}

      {/* How the reply was read, and why. Shown, not editable — the control for
          changing it is on Prospects, where the conversation is the whole page. */}
      {effective && (
        <p className="text-ui-xs mt-3 text-ink-60">
          <span className="eyebrow mr-2">Read as</span>
          {CLASSIFICATION_LABEL[effective]}
          {row.manualClassification && <span className="text-ink-40"> (set by hand)</span>}
          {row.classificationReasoning && ` — ${row.classificationReasoning}`}
          {confidence !== null && (
            <span className="tnum text-ink-40"> · {Math.round(confidence * 100)}% confident</span>
          )}
        </p>
      )}

      {/* ── The emails ─────────────────────────────────────────────────────
          Smartlead owns every sent message, so this is a live read that can
          fail. It failing must not take the record above it off the screen. */}
      {row.hasThread && (
        <div className="mt-5 border-t border-[color:var(--color-border-hairline)] pt-4">
          <div className="eyebrow">Emails</div>
          {thread.isPending ? (
            <div className="pd-shimmer mt-3 h-[72px] w-full rounded-[var(--radius-sm)]" />
          ) : thread.isError ? (
            <p className="text-ui-xs mt-2 text-danger">{getErrorMessage(thread.error)}</p>
          ) : (
            <ConversationThread
              messages={thread.data?.messages ?? []}
              error={thread.data?.threadError}
              /*
               * An empty thread is three different facts, and this block used to
               * assert the friendliest one for all of them.
               *
               * `threadUnavailable` is the server saying it could not look —
               * no API key here, no campaign, no lead of that address in
               * Smartlead. Otherwise `lastSentAt` decides: a business the
               * campaign has already mailed but whose history comes back empty
               * is a thread we failed to read, not an untouched prospect, and
               * telling the operator "nothing has gone out" about someone we
               * emailed on the 4th is the one answer that is certainly wrong.
               */
              empty={
                thread.data?.threadUnavailable ??
                (row.lastSentAt
                  ? `Smartlead reported no messages, though the campaign records a send on ${fmtDate(row.lastSentAt)}.`
                  : 'Nothing has gone out to this address yet — the sequence has not reached them.')
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Nothing to show
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Four different empty lists, four different sentences.
 *
 * "No businesses" would be true of all of them and useful for none: a run that
 * hasn't scraped yet, a run whose list aged out of the cache, a run whose
 * prospects were deleted, and a search that matched nothing are four different
 * situations with four different next moves.
 */
function Empty({
  narrowed,
  data,
  onClear,
}: {
  narrowed: boolean;
  data: RunPage | null;
  onClear: () => void;
}) {
  if (narrowed) {
    return (
      <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-ink-20)] px-5 py-10 text-center">
        <p className="text-ui-sm text-ink-60">Nothing in this run matches.</p>
        <button
          type="button"
          onClick={onClear}
          className="text-ui-xs mt-2 text-ink-40 underline underline-offset-2 hover:text-ink-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
        >
          Show all of them
        </button>
      </div>
    );
  }

  const body = !data
    ? 'This run is gone.'
    : data.expired
      ? 'The reviewed list has aged out of the cache. The scrape itself is still on file, so re-running this region re-reads it for free.'
      : data.runStatus === 'done'
        ? 'These prospects were deleted. The scrape stays on the ledger, so the region still counts as bought.'
        : data.runStatus === 'failed'
          ? 'This run stopped before it had a list.'
          : data.runStatus === 'superseded'
            ? 'This run was retired, and nothing it created is still on file.'
            : 'Still scraping — the list appears once verification has run.';

  return (
    <div className="mt-4 rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-ink-20)] px-5 py-10 text-center">
      <p className="text-ui-sm text-ink-60">{body}</p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Bits
 * ────────────────────────────────────────────────────────────────────────── */

/** The pager's two buttons. */
function NavArrow({
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
      className="press flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-40 transition-colors duration-[var(--duration-quick)] hover:bg-inset hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
