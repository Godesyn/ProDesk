/**
 * The one place a chat URL is spelled.
 *
 * Chat puts more state in the URL than the rest of the suite does, on purpose:
 * the active thread, the inbox filter, the search query AND the open media
 * viewer all live here. The viewer especially — `?v=<messageId>` means the
 * browser Back button closes the lightbox instead of leaving the conversation,
 * which is the single most-reported bug class in every web messenger.
 *
 * Keeping the spellings in one module means the router, the command palette, the
 * realtime "open this thread" handler and the notification click-through can
 * never drift from each other.
 */

export const ROUTE = {
  inbox: '/',
  thread: '/t/:threadId',
  archived: '/archived',
  requests: '/requests',
  search: '/search',
  settings: '/settings',
  profile: '/profile',
  support: '/support',
  supportDetail: '/support/:id',
} as const;

export type InboxFilter = 'all' | 'unread' | 'archived';

export function inboxPath(filter?: InboxFilter): string {
  if (filter === 'archived') return '/archived';
  return !filter || filter === 'all' ? '/' : `/?f=${filter}`;
}

export function archivedPath(): string {
  return '/archived';
}

/**
 * A conversation opened FROM the archive. Deliberately nested under `/archived`
 * rather than reusing `/t/:id`: the rail highlights by path prefix, so opening an
 * archived thread at the inbox's URL would jump the selected tab back to Inbox
 * and replace the list you were working through.
 */
export function archivedThreadPath(threadId: string): string {
  return `/archived/t/${threadId}`;
}

export function threadPath(threadId: string): string {
  return `/t/${threadId}`;
}

/** A thread opened scrolled to one message (a search hit, a quoted reply). */
export function threadAtPath(threadId: string, messageId: string): string {
  return `/t/${threadId}?m=${encodeURIComponent(messageId)}`;
}

export function searchPath(query?: string): string {
  return query ? `/search?q=${encodeURIComponent(query)}` : '/search';
}

/** The media viewer, appended to whatever route is already showing. */
export function mediaSearch(messageId: string, index = 0): string {
  return `v=${encodeURIComponent(messageId)}${index ? `&i=${index}` : ''}`;
}

/**
 * Read the app's URL search params. `useLocation` from wouter deliberately drops
 * the query string, so every reader goes through here rather than each screen
 * inventing its own `window.location.search` parse.
 */
export function readSearch(): URLSearchParams {
  return new URLSearchParams(
    typeof window === 'undefined' ? '' : window.location.search,
  );
}
