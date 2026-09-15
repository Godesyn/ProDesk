import { describe, expect, it } from 'vitest';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  applyMessageEvents,
  MAX_LIVE_MESSAGES,
  type CachedMessage,
  type MessageEvent,
} from './cache';

/**
 * The transcript cache, exercised the way realtime actually drives it.
 *
 * Every case below is a bug that has a visible symptom and no stack trace: a
 * message drawn twice, a message the user was reading going blank, "load older"
 * silently doing nothing, or the transcript quietly falling behind.
 */

type Page = { items: CachedMessage[]; nextCursor: unknown };
type Infinite = { pages: Page[]; pageParams: unknown[] };

/** The two methods of QueryClient this module uses, and nothing else. */
function fakeClient(initial: Infinite | undefined) {
  let data = initial;
  const qc = {
    setQueryData<T>(_key: QueryKey, updater: unknown) {
      data = (updater as (old: Infinite | undefined) => Infinite | undefined)(data) ?? undefined;
      return data as T;
    },
  } as unknown as QueryClient;
  return { qc, read: () => data };
}

const KEY: QueryKey = [['chat', 'messages'], { input: { threadId: 't' }, type: 'infinite' }];

let seq = 0;
function msg(id: string, over: Partial<CachedMessage> = {}): CachedMessage {
  seq += 1;
  return {
    id,
    threadId: 't',
    senderId: 'them',
    senderName: 'Them',
    senderAvatar: null,
    content: `body ${id}`,
    type: 'text',
    fileUrl: null,
    fileName: null,
    fileSize: null,
    thumbnailUrl: null,
    replyToId: null,
    isForwarded: false,
    editedAt: null,
    deletedAt: null,
    timestamp: new Date(1_700_000_000_000 + seq * 1_000).toISOString(),
    ...over,
  };
}

/** `n` pages of `per` messages each, newest-first exactly as the query returns. */
function cache(pages: CachedMessage[][]): Infinite {
  return {
    pages: pages.map((items, i) => ({ items, nextCursor: `cursor-${i}` })),
    pageParams: pages.map((_, i) => (i === 0 ? undefined : `cursor-${i - 1}`)),
  };
}

const insert = (m: CachedMessage): MessageEvent => ({ kind: 'insert', message: m });

describe('applyMessageEvents', () => {
  it('prepends a batch to the newest page in one write', () => {
    const { qc, read } = fakeClient(cache([[msg('old')]]));
    const a = msg('a');
    const b = msg('b');
    const { inserted } = applyMessageEvents(qc, KEY, [insert(a), insert(b)]);
    expect(inserted.map((m) => m.id)).toEqual(['a', 'b']);
    // Pages are newest-first, so the LAST of the batch must sit at the head.
    expect(read()!.pages[0].items.map((m) => m.id)).toEqual(['b', 'a', 'old']);
  });

  it('bails when nothing is cached rather than writing a page with no param', () => {
    // INVARIANT 1: a lone page with no matching pageParam is corrupt to
    // react-query — the next fetch throws or silently drops history.
    const { qc, read } = fakeClient(undefined);
    const { inserted } = applyMessageEvents(qc, KEY, [insert(msg('a'))]);
    expect(inserted).toEqual([]);
    expect(read()).toBeUndefined();
  });

  it('dedupes an id already in the cache and reports it as not inserted', () => {
    // The sender receives their own message twice — mutation result and realtime
    // echo — and both carry the same client-generated uuid by design. Reporting
    // it as inserted would ring the new-message bell for your own send.
    const mine = msg('mine', { senderId: 'me' });
    const { qc, read } = fakeClient(cache([[mine]]));
    const { inserted } = applyMessageEvents(qc, KEY, [insert(mine)]);
    expect(inserted).toEqual([]);
    expect(read()!.pages[0].items).toHaveLength(1);
  });

  it('dedupes within a single batch', () => {
    const { qc, read } = fakeClient(cache([[msg('old')]]));
    const dup = msg('dup');
    const { inserted } = applyMessageEvents(qc, KEY, [insert(dup), insert(dup)]);
    expect(inserted).toHaveLength(1);
    expect(read()!.pages[0].items.filter((m) => m.id === 'dup')).toHaveLength(1);
  });

  it('finds a duplicate on ANY page, not just the newest', () => {
    const buried = msg('buried');
    const { qc } = fakeClient(cache([[msg('n1')], [buried]]));
    const { inserted } = applyMessageEvents(qc, KEY, [insert(buried)]);
    expect(inserted).toEqual([]);
  });

  it('applies an insert and a later update in ONE batch, in order', () => {
    // The reason inserts/updates/deletes share a queue: applying all inserts and
    // then all updates would resurrect the pre-edit text.
    const { qc, read } = fakeClient(cache([[msg('old')]]));
    applyMessageEvents(qc, KEY, [
      insert(msg('a', { content: 'typo' })),
      { kind: 'update', patch: { id: 'a', content: 'fixed', editedAt: 'now' } },
    ]);
    const row = read()!.pages[0].items.find((m) => m.id === 'a')!;
    expect(row.content).toBe('fixed');
    expect(row.editedAt).toBe('now');
  });

  it('never blanks content on an update that omits it', () => {
    // Postgres logical decoding drops unchanged TOASTed columns, so an update
    // that touched only edited_at arrives with content: null. An unguarded
    // spread blanks a message the user is mid-sentence in.
    const { qc, read } = fakeClient(cache([[msg('a', { content: 'the real text' })]]));
    applyMessageEvents(qc, KEY, [
      { kind: 'update', patch: { id: 'a', content: null, editedAt: '2026-01-01' } },
    ]);
    const row = read()!.pages[0].items[0];
    expect(row.content).toBe('the real text');
    expect(row.editedAt).toBe('2026-01-01');
  });

  it('DOES null content for a soft delete, which is the one write that means it', () => {
    const { qc, read } = fakeClient(cache([[msg('a', { content: 'oops' })]]));
    applyMessageEvents(qc, KEY, [
      { kind: 'update', patch: { id: 'a', content: null, deletedAt: '2026-01-01' } },
    ]);
    const row = read()!.pages[0].items[0];
    expect(row.content).toBeNull();
    expect(row.deletedAt).toBe('2026-01-01');
  });

  it('ignores an update or delete for an id it does not hold', () => {
    // The realtime bindings are thread-scoped but not window-scoped: a message
    // outside the loaded pages is a legitimate no-op, not an error.
    const before = cache([[msg('a')]]);
    const { qc, read } = fakeClient(before);
    applyMessageEvents(qc, KEY, [
      { kind: 'update', patch: { id: 'nope', content: 'x' } },
      { kind: 'delete', id: 'also-nope' },
    ]);
    expect(read()).toBe(before); // same reference — no render caused
  });

  it('removes a deleted message from whichever page holds it', () => {
    const { qc, read } = fakeClient(cache([[msg('n1')], [msg('gone'), msg('o2')]]));
    applyMessageEvents(qc, KEY, [{ kind: 'delete', id: 'gone' }]);
    expect(read()!.pages[1].items.map((m) => m.id)).toEqual(['o2']);
  });

  it('leaves pageParams untouched for an ordinary append', () => {
    // INVARIANT 3 — an append changes no cursor.
    const before = cache([[msg('a')], [msg('b')]]);
    const { qc, read } = fakeClient(before);
    applyMessageEvents(qc, KEY, [insert(msg('new'))]);
    expect(read()!.pageParams).toEqual(before.pageParams);
  });

  it('does not trim unless asked', () => {
    const pages = [Array.from({ length: MAX_LIVE_MESSAGES + 50 }, (_, i) => msg(`m${i}`))];
    const { qc, read } = fakeClient(cache(pages));
    const { trimmed } = applyMessageEvents(qc, KEY, [insert(msg('new'))]);
    expect(trimmed).toBe(false);
    expect(read()!.pages).toHaveLength(1);
  });

  it('drops the OLDEST pages when trimming, and slices pageParams in lockstep', () => {
    // Dropping trailing pages is what keeps "load older" working: the new last
    // page's own nextCursor is exactly what fetched the page just dropped. A
    // pageParams array left out of sync makes the next fetch read a param
    // belonging to a page that no longer exists.
    const page = (tag: string) => Array.from({ length: 200 }, (_, i) => msg(`${tag}${i}`));
    const { qc, read } = fakeClient(cache([page('a'), page('b'), page('c'), page('d')]));
    const { trimmed } = applyMessageEvents(qc, KEY, [insert(msg('new'))], { trim: true });

    expect(trimmed).toBe(true);
    const after = read()!;
    expect(after.pages.length).toBe(after.pageParams.length);
    expect(after.pages.length).toBeLessThan(4);
    // The NEWEST page survives, with the new message at its head.
    expect(after.pages[0].items[0].id).toBe('new');
    // The surviving last page still carries a cursor to fetch older history.
    expect(after.pages[after.pages.length - 1].nextCursor).toBeTruthy();
  });

  it('never trims below one page, however large that page has grown', () => {
    const huge = [Array.from({ length: MAX_LIVE_MESSAGES * 3 }, (_, i) => msg(`m${i}`))];
    const { qc, read } = fakeClient(cache(huge));
    applyMessageEvents(qc, KEY, [insert(msg('new'))], { trim: true });
    expect(read()!.pages).toHaveLength(1);
    expect(read()!.pageParams).toHaveLength(1);
  });

  it('is a no-op for an empty batch', () => {
    const before = cache([[msg('a')]]);
    const { qc, read } = fakeClient(before);
    const { inserted, trimmed } = applyMessageEvents(qc, KEY, []);
    expect(inserted).toEqual([]);
    expect(trimmed).toBe(false);
    expect(read()).toBe(before);
  });
});
