import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { useTRPC } from '../../../lib/trpc';
import { getErrorMessage, toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useConfirm } from '../../../components/ui/confirm-dialog';
import { OutreachShell, railColumn } from './shell';
import {
  CLASSIFICATION_LABEL,
  ClassificationMark,
  ConversationThread,
  fmtDate,
  useKeepInView,
  useListKeys,
} from './shared';
import { SuppressionPanel } from './suppression-panel';

/**
 * PROSPECTS — /super-admin/outreach/prospects
 *
 * The contact database. Two panes, like a mail client, because that is the shape
 * the work actually has: scan a list, open one, decide, move on. `j`/`k` move,
 * `/` searches, `Esc` backs out — a high-repetition surface where reaching for
 * the mouse between every row is the difference between ten minutes and an hour.
 */

const PAGE = 50;

const CLASSIFICATIONS = ['yes', 'question', 'not_now', 'never', 'other'] as const;

export function OutreachProspectsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [classification, setClassification] = useState<(typeof CLASSIFICATIONS)[number] | undefined>();
  const [vertical, setVertical] = useState<string | undefined>();
  const [repliedOnly, setRepliedOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 200);
    return () => clearTimeout(t);
  }, [search]);

  // The terms actually present in the table, largest first. Read from the
  // prospects rather than the campaign list so the menu can't offer a term that
  // matches nothing.
  const verticals = useQuery(trpc.outreach.prospectVerticals.queryOptions());

  const filters = useMemo(
    () => ({
      limit: PAGE,
      search: debounced || undefined,
      classification,
      vertical,
      repliedOnly: repliedOnly || undefined,
    }),
    [debounced, classification, vertical, repliedOnly],
  );

  const listQuery = useInfiniteQuery(
    trpc.outreach.prospects.infiniteQueryOptions(filters, {
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );

  const rows = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [listQuery.data],
  );

  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const selectedIndex = rows.findIndex((r) => r.email === selectedEmail);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const next = Math.min(rows.length - 1, Math.max(0, (selectedIndex === -1 ? -1 : selectedIndex) + delta));
      setSelectedEmail(rows[next].email);
      // Pull the next page when the cursor reaches the end of what's loaded.
      if (next >= rows.length - 3 && listQuery.hasNextPage && !listQuery.isFetchingNextPage) {
        void listQuery.fetchNextPage();
      }
    },
    [rows, selectedIndex, listQuery],
  );

  useListKeys({
    onNext: () => move(1),
    onPrev: () => move(-1),
    onSearch: () => searchRef.current?.focus(),
    onEscape: () => setSelectedEmail(null),
  });

  /**
   * Invalidating an INFINITE query by queryKey() silently matches nothing —
   * every page carries its own cursor in the key. pathFilter matches the whole
   * procedure regardless of page.
   */
  const invalidateList = () =>
    qc.invalidateQueries(trpc.outreach.prospects.pathFilter());

  const filtered = !!debounced || !!classification || !!vertical || repliedOnly;
  // Attached to whichever row is selected, so `j`/`k` can't walk the cursor off
  // the bottom of the pane.
  const selectedRef = useKeepInView<HTMLLIElement>(selectedEmail);

  return (
    <OutreachShell
      title="Prospects"
      description="Everyone we've contacted, what they said back, and how it was read."
    >
      {/* ── Filters ───────────────────────────────────────────────────────
          Search leads because it is the one control that gets used on every
          visit; the classification segments sit at the other end of the row so
          the two never fight for the same wrap point on a narrow window. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative min-w-[13rem] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-40" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business or email"
            aria-label="Search prospects"
            className="w-full pl-8"
          />
        </div>

        {/* The search term that found them — the string the List Builder ran on
            Maps, which is also the campaign they sit in and the noun in their
            opener. It is the one field that says where a prospect came from, so
            it filters here rather than only being readable one row at a time. */}
        {(verticals.data?.length ?? 0) > 0 && (
          <label className="flex items-center gap-2">
            <span className="eyebrow shrink-0">Search term</span>
            <select
              value={vertical ?? ''}
              onChange={(e) => setVertical(e.target.value || undefined)}
              className="h-8 max-w-[12rem] rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-paper px-2 text-ui-xs text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
            >
              <option value="">Any</option>
              {(verticals.data ?? []).map((v) => (
                <option key={v.vertical} value={v.vertical}>
                  {v.vertical} ({v.count})
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
            <FilterChip active={!classification} onClick={() => setClassification(undefined)}>
              All
            </FilterChip>
            {CLASSIFICATIONS.map((c) => (
              <FilterChip
                key={c}
                active={classification === c}
                onClick={() => setClassification(classification === c ? undefined : c)}
              >
                {CLASSIFICATION_LABEL[c]}
              </FilterChip>
            ))}
          </div>

          <FilterChip
            active={repliedOnly}
            onClick={() => setRepliedOnly((v) => !v)}
            className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
          >
            Replied
          </FilterChip>
        </div>
      </div>

      {/* Who we are not allowed to email, under the filters that decide who we
          are looking at. Collapsed — it answers a question, it isn't the work. */}
      <SuppressionPanel />

      {listQuery.isError && (
        <p className="text-ui-sm mb-4 text-danger">{getErrorMessage(listQuery.error)}</p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* ── List ────────────────────────────────────────────────────────
            Parks under the sticky rail and scrolls on its own from `lg` up, so
            reading a long conversation on the right never takes the list you
            are working through off the screen. */}
        <div
          className={cn(
            'overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card',
            railColumn,
          )}
        >
          {/* Same header shape as the Reply Queue's "Waiting" column — these two
              screens are used interchangeably and shouldn't feel unrelated. */}
          {/* Sticky only where the column owns a scrollbar — below `lg` it would
              stick to the viewport instead and slide under the tab rail. */}
          <div className="flex items-baseline justify-between gap-2 border-b border-[color:var(--color-border-hairline)] bg-card px-4 py-3 lg:sticky lg:top-0 lg:z-10">
            <span className="eyebrow">{filtered ? 'Matching' : 'Prospects'}</span>
            <span className="tnum text-ui-sm text-ink-100">
              {rows.length}
              {listQuery.hasNextPage && <span className="text-ink-40">+</span>}
            </span>
          </div>

          {listQuery.isPending ? (
            <ul>
              {Array.from({ length: 8 }).map((_, i) => (
                <li key={i} className="border-b border-[color:var(--color-border-hairline)] px-4 py-3 last:border-0">
                  <div className="pd-shimmer h-[13px] w-2/3 rounded-full" />
                  <div className="pd-shimmer mt-2 h-[11px] w-1/2 rounded-full" />
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-ui-sm text-ink-60">
                {filtered ? 'Nothing matches these filters.' : 'No prospects yet.'}
              </p>
              <p className="text-ui-xs mt-1 text-ink-40">
                {filtered ? 'Widen the search or pick All.' : 'Run the List Builder to find some.'}
              </p>
            </div>
          ) : (
            <>
              <ul>
                {rows.map((r) => {
                  const active = r.email === selectedEmail;
                  const effective = r.manualClassification ?? r.classification;
                  return (
                    <li key={r.id} ref={active ? selectedRef : undefined}>
                      <button
                        type="button"
                        onClick={() => setSelectedEmail(r.email)}
                        className={cn(
                          'w-full border-b border-[color:var(--color-border-hairline)] px-4 py-3 text-left last:border-0',
                          'transition-colors duration-[var(--duration-quick)]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent-ring)]',
                          active ? 'bg-inset' : 'hover:bg-inset/60',
                        )}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-ui-sm truncate text-ink-100">
                            {r.businessName || r.email}
                          </span>
                          <ClassificationMark value={effective} />
                        </div>
                        <div className="mono mt-1 flex items-baseline justify-between gap-2 text-[11px] text-ink-40">
                          <span className="truncate">{r.email}</span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            {/* Only worth the width when the list is mixed —
                                filtered to one term, every row would repeat it. */}
                            {!vertical && r.vertical && (
                              <span className="max-w-[7rem] truncate text-ink-20">{r.vertical}</span>
                            )}
                            <span className="tnum">{fmtDate(r.repliedAt ?? r.lastSentAt)}</span>
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {listQuery.hasNextPage && (
                <div className="p-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    disabled={listQuery.isFetchingNextPage}
                    onClick={() => listQuery.fetchNextPage()}
                  >
                    {listQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Detail ──────────────────────────────────────────────────────── */}
        <div>
          {selectedEmail ? (
            <ProspectDetail
              email={selectedEmail}
              onChanged={invalidateList}
              onDeleted={() => setSelectedEmail(null)}
            />
          ) : (
            <div className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] px-6 py-16 text-center">
              <p className="text-ui-sm text-ink-60">Pick a prospect to see the conversation.</p>
              <p className="text-ui-xs mt-1 text-ink-40">
                <kbd className="mono">j</kbd> and <kbd className="mono">k</kbd> move,{' '}
                <kbd className="mono">/</kbd> searches.
              </p>
            </div>
          )}
        </div>
      </div>
    </OutreachShell>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'press h-8 px-3 text-ui-xs transition-colors duration-[var(--duration-quick)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
        active ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Detail
 * ────────────────────────────────────────────────────────────────────────── */

function ProspectDetail({
  email,
  onChanged,
  onDeleted,
}: {
  email: string;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const threadKey = trpc.outreach.prospectThread.queryKey({ email });
  const threadQuery = useQuery(trpc.outreach.prospectThread.queryOptions({ email }));
  const data = threadQuery.data;

  /**
   * Delete this one.
   *
   * The server takes them out of their Smartlead campaign before it deletes the
   * row, and refuses the whole thing if it can't — so a failure here means the
   * person is still being emailed and we have deliberately kept the record.
   * That message is worth reading, which is why the error is surfaced rather
   * than swallowed into a generic toast.
   */
  const remove = useMutation({
    ...trpc.outreach.deleteProspect.mutationOptions(),
    onSuccess: () => {
      onDeleted();
      onChanged();
      toast('Prospect deleted, and taken out of the campaign.');
    },
    onError: (e) => toastError(e),
  });

  const onDelete = async () => {
    const ok = await confirm({
      title: `Delete ${data?.prospect.businessName || email}?`,
      description:
        'They are taken out of their Smartlead campaign first, so the rest of the sequence stops, and then the record goes — replies included. Marking them Never instead keeps the record and suppresses the address.',
      confirmLabel: 'Delete prospect',
      destructive: true,
    });
    if (ok) remove.mutate({ email });
  };

  const override = useMutation({
    ...trpc.outreach.overrideClassification.mutationOptions(),
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: threadKey });
      onChanged();
      toast(
        vars.classification === 'never'
          ? 'Marked never — and suppressed.'
          : `Marked ${CLASSIFICATION_LABEL[vars.classification].toLowerCase()}.`,
      );
    },
    onError: (e) => toastError(e),
  });

  if (threadQuery.isPending) {
    return (
      <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-5">
        <div className="pd-shimmer h-[18px] w-1/3 rounded-full" />
        <div className="pd-shimmer mt-3 h-[13px] w-1/2 rounded-full" />
        <div className="pd-shimmer mt-6 h-[120px] w-full rounded-[var(--radius-sm)]" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-ui-sm text-danger">{getErrorMessage(threadQuery.error)}</p>;
  }

  const p = data.prospect;
  const effective = p.manualClassification ?? p.classification;
  const confidence = p.classificationConfidence ? Number(p.classificationConfidence) : null;

  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
      <header className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
        <h2 className="text-panel-title text-ink-100">{p.businessName || p.email}</h2>
        <p className="mono mt-1 text-[12px] text-ink-40">
          {p.email}
          {p.website && (
            <>
              {' · '}
              <a
                href={p.website.startsWith('http') ? p.website : `https://${p.website}`}
                target="_blank"
                rel="noreferrer noopener"
                className="underline-offset-4 hover:text-ink-100 hover:underline"
              >
                {p.website.replace(/^https?:\/\//, '')}
              </a>
            </>
          )}
        </p>
        <dl className="text-ui-xs mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-ink-40">
          {/* Named, not bare: "Dentist" on its own could be anything about this
              business. It is the term we searched Maps for to find them. */}
          {p.vertical && (
            <span>
              Found as <span className="text-ink-60">{p.vertical}</span>
            </span>
          )}
          {p.sendingDomain && <span className="mono">{p.sendingDomain}</span>}
          <span>Last sent {fmtDate(p.lastSentAt)}</span>
          <span>Replied {fmtDate(p.repliedAt)}</span>
          {p.fulfilmentStatus !== 'none' && (
            <span className="text-ink-60">Account {p.fulfilmentStatus}</span>
          )}
          <button
            type="button"
            disabled={remove.isPending}
            onClick={onDelete}
            className="press ml-auto text-ink-40 transition-colors duration-[var(--duration-quick)] hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
          >
            Delete
          </button>
        </dl>
      </header>

      {/* Classification — a decisive control, not a badge. */}
      <section className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="eyebrow">How this was read</div>
            <div className="mt-1 flex items-center gap-2">
              <ClassificationMark value={effective} />
              <span className="text-ui-md text-ink-100">
                {effective ? CLASSIFICATION_LABEL[effective] : 'Not classified'}
              </span>
              {p.manualClassification && (
                <span className="text-ui-xs text-ink-40">(set by hand)</span>
              )}
            </div>
          </div>

          <div className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
            {CLASSIFICATIONS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={effective === c}
                disabled={override.isPending}
                onClick={() => override.mutate({ email: p.email, classification: c })}
                className={cn(
                  'press h-8 px-2.5 text-ui-xs transition-colors duration-[var(--duration-quick)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                  'disabled:pointer-events-none disabled:opacity-50',
                  effective === c ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
                )}
              >
                {CLASSIFICATION_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        {p.classificationReasoning && (
          <p className="text-ui-xs mt-3 text-ink-60">
            {p.classificationReasoning}
            {confidence !== null && (
              <span className="tnum text-ink-40"> · {Math.round(confidence * 100)}% confident</span>
            )}
          </p>
        )}
      </section>

      {/* Thread */}
      <section className="px-5 py-4">
        <div className="eyebrow">Conversation</div>
        {/* Same three facts as the run roster: the server saying it could not
            look, a send on record with no history behind it, or genuinely
            nothing sent yet. See the note in run-businesses.tsx. */}
        <ConversationThread
          messages={data.messages}
          error={data.threadError}
          empty={
            data.threadUnavailable ??
            (p.lastSentAt
              ? `Smartlead reported no messages, though the campaign records a send on ${fmtDate(p.lastSentAt)}.`
              : 'Nothing sent yet — the sequence has not reached them.')
          }
        />
      </section>
    </div>
  );
}
