import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { EmptyState, Spec } from '../components/primitives';
import { inboxTime } from '../lib/format';
import { threadAtPath, readSearch } from '../app/routes';

/**
 * Search across every conversation.
 *
 * The query lives in the URL, so a search is a link you can send someone (or come
 * back to). Results are grouped by thread and each hit shows the matching line
 * with the query lit in pigment — finding the message is the job, and a result
 * that makes you open three threads to work out which one it was has not done it.
 *
 * Selecting a hit opens the thread scrolled to that message and flashes its spine
 * segment: the "found it" confirmation almost nobody builds.
 */
export function SearchPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState(() => readSearch().get('q') ?? '');
  const [debounced, setDebounced] = useState(query);
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 180ms: fast enough to feel live, slow enough that a fluent typist sends one
  // request per word rather than one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      const next = query ? `/search?q=${encodeURIComponent(query)}` : '/search';
      window.history.replaceState(null, '', next);
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const results = useInfiniteQuery(
    trpc.chat.searchMessages.infiniteQueryOptions(
      { query: debounced, limit: 20 },
      {
        enabled: debounced.trim().length >= 2,
        getNextPageParam: (last) => last.nextCursor ?? undefined,
      },
    ),
  );

  const hits = useMemo(
    () => results.data?.pages.flatMap((p) => p.items) ?? [],
    [results.data],
  );

  useEffect(() => setCursor(0), [debounced]);

  const open = (hit: (typeof hits)[number]) => {
    navigate(threadAtPath(hit.threadId, hit.id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: 'var(--room)' }}>
      <header
        className="flex h-14 shrink-0 items-center gap-3 px-4"
        style={{ borderBottom: '1px solid var(--wire)' }}
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          aria-label="Back"
          className="press -ml-1 grid h-9 w-9 place-items-center rounded-full"
          style={{ color: 'var(--voice-2)' }}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') navigate('/');
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, hits.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (e.key === 'Enter' && hits[cursor]) {
              e.preventDefault();
              open(hits[cursor]);
            }
          }}
          placeholder="Search every conversation"
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          style={{ color: 'var(--voice)' }}
        />
        {debounced.trim().length >= 2 && (
          <Spec>{results.isFetching ? 'Searching…' : `${hits.length} hit${hits.length === 1 ? '' : 's'}`}</Spec>
        )}
      </header>

      <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
        {debounced.trim().length < 2 ? (
          <EmptyState line="Everything anyone ever told you, in one field." />
        ) : hits.length === 0 && !results.isFetching ? (
          <EmptyState line="Nothing matches that." />
        ) : (
          <ul className="mx-auto w-full max-w-2xl px-4 py-4">
            {hits.map((hit, i) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => open(hit)}
                  onMouseEnter={() => setCursor(i)}
                  className="cx-listrow w-full rounded-[var(--radius-sm)] px-3 py-3 text-left"
                  data-active={i === cursor}
                  style={{ borderBottom: '1px solid var(--wire)' }}
                >
                  <span className="flex items-baseline gap-2">
                    <span
                      className="min-w-0 flex-1 truncate text-[13px] font-semibold"
                      style={{ color: 'var(--voice)' }}
                    >
                      {hit.threadName ?? hit.senderName ?? 'Conversation'}
                    </span>
                    <Spec>{inboxTime(hit.timestamp)}</Spec>
                  </span>
                  <span className="mt-1 block text-[13.5px]" style={{ color: 'var(--voice-2)' }}>
                    <Highlight text={hit.content ?? ''} query={debounced} />
                  </span>
                </button>
              </li>
            ))}

            {results.hasNextPage && (
              <li>
                <button
                  type="button"
                  onClick={() => void results.fetchNextPage()}
                  className="press w-full py-4"
                >
                  <Spec>{results.isFetchingNextPage ? 'Loading…' : 'More results'}</Spec>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* The four bindings that matter, discoverable without a modal. */}
      <footer
        className="hidden shrink-0 items-center gap-4 px-4 py-2 md:flex"
        style={{ borderTop: '1px solid var(--wire)' }}
      >
        <Spec>↑↓ move</Spec>
        <Spec>↵ open</Spec>
        <Spec>esc close</Spec>
        <Spec>⌘K search</Spec>
      </footer>
    </div>
  );
}

/** Light the query inside the matching line. Case-insensitive, literal. */
function Highlight({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (idx < 0 || !query.trim()) {
    return <>{text.length > 160 ? `${text.slice(0, 160)}…` : text}</>;
  }
  // Keep a little context on each side rather than always starting at the top of
  // a long message — the match is what you are looking for, not the opening line.
  const start = Math.max(0, idx - 40);
  const head = start > 0 ? '…' : '';
  const before = text.slice(start, idx);
  const match = text.slice(idx, idx + query.trim().length);
  const after = text.slice(idx + query.trim().length, idx + query.trim().length + 90);
  return (
    <>
      {head}
      {before}
      <mark style={{ background: 'transparent', color: 'var(--live)', fontWeight: 600 }}>
        {match}
      </mark>
      {after}
      {text.length > idx + query.length + 90 ? '…' : ''}
    </>
  );
}
