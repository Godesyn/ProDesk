import { Fragment, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ArrowLeft, Plus, Search, X } from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { Avatar, EmptyState, Marker, Spec } from '../primitives';
import { ThreadRow, type ThreadRowItem } from './ThreadRow';
import { PersonFinder } from './PersonFinder';
import { useChatMe } from '../../app/ChatProvider';
import { useThreadPrefs } from '../../app/thread-prefs';
import { archivedThreadPath, threadPath } from '../../app/routes';

/**
 * The thread list.
 *
 * It used to split by OBLIGATION — Owed / Waiting / Settled, derived from who
 * spoke last rather than from read state. The idea was good and the labels lied:
 * a message you had read and not answered still sat under "Owed", people read
 * that word as "unread", found read conversations under it, and stopped trusting
 * the section. So the split is now the one the words promise, and the server
 * derives it the same way (routers/chat/consumer.ts#InboxSection):
 *
 *   UNREAD   there is something in here you have not read
 *   READ     there isn't
 *
 * Pinned still floats above both, and muted conversations are always Read — mute
 * means "stop putting this in front of me", and a section header that keeps doing
 * so is the same broken promise wearing a different label.
 *
 * The header's search field filters THIS list, and when nothing matches it turns
 * into the new-conversation control. "I can't find Sarah" and "Sarah isn't here
 * yet" are the same moment, and making the user notice they typed into the wrong
 * box, dismiss it, and find a ＋ button is a detour the app can just not take.
 */

const SECTION_ORDER = ['unread', 'read'] as const;
const SECTION_LABEL: Record<(typeof SECTION_ORDER)[number], string> = {
  unread: 'Unread',
  read: 'Read',
};

type Props = {
  activeId: string | null;
  onNew: () => void;
  /** 'archived' renders the same list over the archive. */
  view?: 'inbox' | 'archived';
};

export function InboxPane({ activeId, onNew, view = 'inbox' }: Props) {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const { meName, meAvatar } = useChatMe();
  const prefs = useThreadPrefs();
  const archived = view === 'archived';

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('prodesk.chat.sections') ?? '{}');
    } catch {
      return {};
    }
  });

  const list = useInfiniteQuery(
    trpc.chat.inbox.infiniteQueryOptions(
      { limit: 30, filter: archived ? 'archived' : 'all' },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
  const requests = useQuery({
    ...trpc.chat.requestCount.queryOptions(),
    enabled: !archived,
  });

  const pinned = (list.data?.pages[0]?.pinned ?? []) as ThreadRowItem[];
  const items = useMemo(
    () => (list.data?.pages.flatMap((p) => p.items) ?? []) as ThreadRowItem[],
    [list.data],
  );

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;
  /**
   * Filtering is over the LOADED pages, not a server round trip. The list is
   * keyset-paginated by recency, so "the conversations you have scrolled" is
   * almost always "the conversations you meant"; anything older is one "Older
   * conversations" click away, and a per-keystroke query for a list this small
   * would be a worse trade than the occasional extra page.
   */
  const matches = useMemo(() => {
    if (!searching) return [];
    return [...pinned, ...items].filter((t) => t.displayName.toLowerCase().includes(needle));
  }, [searching, needle, pinned, items]);

  /**
   * Bucketed from the row's OWN numbers, not from the server's `section` string.
   *
   * The two agree — routers/chat/consumer.ts derives it exactly this way, and
   * app/thread-prefs.ts restates it for optimistic patches. Reading the string
   * was still the wrong call: `map[it.section]?.push(...)` silently dropped any
   * row whose bucket name it did not recognise, so a single unexpected value
   * emptied the entire list rather than misplacing one row. A list that says
   * "nothing here" when there is something is the worst failure this pane has.
   */
  const bySection = useMemo(() => {
    const map: Record<'unread' | 'read', ThreadRowItem[]> = { unread: [], read: [] };
    for (const it of items) {
      map[it.unreadCount > 0 && !it.isMuted ? 'unread' : 'read'].push(it);
    }
    return map;
  }, [items]);

  const unreadCount = bySection.unread.length;
  const empty = !list.isLoading && items.length === 0 && pinned.length === 0;

  const toggleSection = (key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('prodesk.chat.sections', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /** Opening from the archive stays under `/archived` — see routes.ts. */
  const openPath = (id: string) => (archived ? archivedThreadPath(id) : threadPath(id));

  const rowProps = (item: ThreadRowItem) => ({
    item,
    active: item.id === activeId,
    onOpen: () => navigate(openPath(item.id)),
    onTogglePin: () => prefs.togglePin(item),
    onMute: (until: Date | null) => prefs.mute(item.id, until),
    onArchive: (next: boolean) => prefs.archive(item.id, next),
    onMarkUnread: () => prefs.markUnread(item.id),
    onMarkRead: () => prefs.markRead(item.id),
  });

  return (
    <aside
      className="flex min-h-0 w-full shrink-0 flex-col md:w-[340px] md:border-r"
      style={{ borderColor: 'var(--wire)', background: 'var(--room)' }}
    >
      {/* Header. Who you are, one field, one action. The field replaced a static
          "3 owed" line: the count moved to the navigation rail, where it is
          visible from every screen instead of only this one. */}
      <header
        className="flex h-14 shrink-0 items-center gap-2.5 px-4"
        style={{ borderBottom: '1px solid var(--wire)' }}
      >
        {archived ? (
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="Back to inbox"
            className="press -ml-1 grid h-8 w-8 place-items-center rounded-full"
            style={{ color: 'var(--voice-2)' }}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <Avatar name={meName} url={meAvatar} size={26} />
        )}

        <span
          className="flex min-w-0 flex-1 items-center gap-2 rounded-full px-2.5"
          style={{ background: 'var(--room-2)', height: 32 }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--voice-3)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
              // One match and you meant it — Enter opens rather than making you
              // move to the mouse for a list of length one.
              if (e.key === 'Enter' && matches.length === 1) navigate(openPath(matches[0].id));
            }}
            placeholder={archived ? 'Search the archive' : 'Search conversations'}
            aria-label={archived ? 'Search archived conversations' : 'Search conversations'}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--voice)' }}
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="press shrink-0"
            >
              <X className="h-3.5 w-3.5" style={{ color: 'var(--voice-3)' }} />
            </button>
          )}
        </span>

        {!archived && (
          <button
            type="button"
            onClick={onNew}
            title="New conversation (⌘⇧N)"
            aria-label="New conversation"
            className="press grid h-8 w-8 shrink-0 place-items-center rounded-full text-white"
            style={{ background: 'var(--live)' }}
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
      </header>

      {!archived && !searching && (requests.data?.count ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => navigate('/requests')}
          className="cx-listrow flex items-center gap-2 px-4 py-2.5 text-left"
          style={{ borderBottom: '1px solid var(--wire)' }}
        >
          {/* A hollow ring, not a filled pip: a request is not an obligation. */}
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ border: '1.5px solid var(--live)' }}
          />
          <Spec>
            {requests.data?.count} message request{requests.data?.count === 1 ? '' : 's'}
          </Spec>
        </button>
      )}

      <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
        {searching ? (
          <>
            {matches.map((item) => (
              <ThreadRow key={item.id} {...rowProps(item)} />
            ))}

            {/* Nothing matched. Rather than a dead end, this is the moment the
                new-conversation control belongs on screen — the same one the ＋
                opens, inline, seeded with what was typed if it was an address. */}
            {matches.length === 0 && !archived && (
              <div className="px-4 pb-6 pt-5">
                <Spec>No conversation with “{query.trim()}”</Spec>
                <p className="quill mt-2 text-[17px]">Start one with their email address.</p>
                <div className="mt-4">
                  <PersonFinder
                    // Seeded only once the query looks like an address — "sar"
                    // is a name they are hunting for, not something to look up.
                    initialEmail={query.includes('@') ? query.trim() : ''}
                    autoFocus={false}
                    compact
                    onStarted={() => setQuery('')}
                  />
                </div>
              </div>
            )}
            {matches.length === 0 && archived && (
              <EmptyState line="Nothing archived matches that." />
            )}
          </>
        ) : list.isLoading ? (
          <p className="py-12 text-center">
            <Spec>Loading…</Spec>
          </p>
        ) : empty ? (
          <EmptyState
            line={
              archived
                ? 'Nothing archived. Filed conversations go quiet and wait here.'
                : 'Start with an email address.'
            }
          />
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <Marker label="Pinned" />
                {pinned.map((item) => (
                  <ThreadRow key={item.id} {...rowProps(item)} />
                ))}
              </>
            )}

            {/* The archive is a FLAT list. Archiving silences a thread, so every
                row in it is "read" and the split would be one header over one
                bucket — and a header the user had collapsed in the inbox would
                then hide the entire archive behind a control they'd have to
                guess at. */}
            {archived &&
              items.map((item) => <ThreadRow key={item.id} {...rowProps(item)} />)}

            {!archived &&
              SECTION_ORDER.map((key) => {
              const rows = bySection[key];
              if (rows.length === 0 && key !== 'unread') return null;
              const isCollapsed = collapsed[key];
              return (
                <Fragment key={key}>
                  <button
                    type="button"
                    onClick={() => toggleSection(key)}
                    className="w-full text-left"
                    aria-expanded={!isCollapsed}
                  >
                    <Marker
                      label={
                        key === 'unread' && unreadCount > 0
                          ? `${SECTION_LABEL[key]} · ${unreadCount}`
                          : SECTION_LABEL[key]
                      }
                      tone={key === 'unread' ? 'live' : 'ink'}
                    />
                  </button>
                  {/* The one reward state this product gives. It appears only when
                      there is genuinely nothing waiting, which is the whole point
                      of having a section that can be empty. */}
                  {key === 'unread' && rows.length === 0 && !isCollapsed && (
                    <p className="quill px-4 pb-4 pt-1 text-[17px]">You’re all caught up.</p>
                  )}
                  {!isCollapsed &&
                    rows.map((item) => <ThreadRow key={item.id} {...rowProps(item)} />)}
                </Fragment>
              );
            })}

            {list.hasNextPage && (
              <button
                type="button"
                onClick={() => void list.fetchNextPage()}
                disabled={list.isFetchingNextPage}
                className="press w-full py-4"
              >
                <Spec>{list.isFetchingNextPage ? 'Loading…' : 'Older conversations'}</Spec>
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
