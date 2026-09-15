/**
 * Burst absorber for realtime-driven work.
 *
 * Realtime arrives one socket frame at a time, and every naive handler therefore
 * does its work once per frame. That is invisible while a conversation ticks over
 * at one message every few seconds and catastrophic the moment it doesn't: a
 * group where five people are talking, someone pasting a dozen lines, a bot
 * replaying a backlog, or a channel re-joining after a gap and delivering
 * everything at once.
 *
 * Two costs blow up together, which is why one utility covers both:
 *
 *  - NETWORK. `invalidateQueries` on an ACTIVE query refetches immediately, and
 *    an infinite query refetches every loaded page. Thirty arriving messages
 *    became thirty inbox refetches — each one several pages, each page a
 *    multi-join decoration query — while the server was already busy writing the
 *    messages that caused them. That is how a chat burst turns into an API
 *    outage.
 *  - RENDER. Each socket frame is its own task, so React cannot batch across
 *    them: thirty frames is thirty commits of a list that re-sorts, re-groups and
 *    re-measures on each one, while the transcript is simultaneously trying to
 *    follow the conversation down.
 *
 * Both are fixed by the same move — collect, then do it once.
 *
 * Three properties are load-bearing:
 *
 *  1. `maxWait`. A plain trailing debounce NEVER fires while a burst is ongoing,
 *     so a busy group would freeze the badge until the room went quiet. The batch
 *     is forced out once it is `maxWait` old, however much is still arriving.
 *  2. `deferWhileHidden`. A background tab still holds mounted (active) queries,
 *     so invalidations there still hit the network — at full burst rate, for a
 *     screen nobody is looking at. Work is held and flushed on the way back.
 *     Callers that must run regardless (cache writes) leave this off.
 *  3. `key`. Deduping collapses "the same query, thirty times" into one entry, so
 *     the flush is O(distinct) rather than O(events).
 */

const hasDocument = typeof document !== 'undefined';

const isHidden = (): boolean => hasDocument && document.visibilityState === 'hidden';

export interface Coalescer<T> {
  /** Queue an item. Schedules a flush unless one is already pending. */
  push(item: T): void;
  /** Run whatever is queued right now (no-op when empty). */
  flush(): void;
  /** Drop everything queued and detach listeners. Safe to call twice. */
  cancel(): void;
  /** Is anything waiting? Mostly for tests. */
  readonly pending: boolean;
}

export interface CoalesceOptions<T> {
  /** Quiet period after the last item before the batch runs. */
  wait: number;
  /**
   * Hard ceiling on how long an item can sit queued. Without it a sustained
   * burst re-arms the debounce forever and the batch never runs at all.
   */
  maxWait?: number;
  /**
   * Hold the batch while the tab is hidden and flush when it comes back.
   * Correct for refetches (nobody is looking); WRONG for cache writes, which
   * must land whether or not the tab is in front, or the transcript is missing
   * messages the moment you switch back to it.
   */
  deferWhileHidden?: boolean;
  /** Dedupe identity. Later items with the same key replace earlier ones. */
  key?: (item: T) => string;
}

export function createCoalescer<T>(
  run: (items: T[]) => void,
  { wait, maxWait, deferWhileHidden = false, key }: CoalesceOptions<T>,
): Coalescer<T> {
  let list: T[] = [];
  let keyed: Map<string, T> | null = key ? new Map() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let firstQueuedAt = 0;
  let cancelled = false;
  let listening = false;

  const size = () => (keyed ? keyed.size : list.length);

  const take = (): T[] => {
    if (keyed) {
      const items = [...keyed.values()];
      keyed = new Map();
      return items;
    }
    const items = list;
    list = [];
    return items;
  };

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (cancelled || isHidden()) return;
    // Back in front: everything held while hidden is now worth doing, and doing
    // it immediately is what makes the tab correct on the first frame the user
    // sees rather than `wait` ms later.
    if (size() > 0) flush();
  };

  const listen = () => {
    if (listening || !deferWhileHidden || !hasDocument) return;
    listening = true;
    document.addEventListener('visibilitychange', onVisibility);
  };

  const unlisten = () => {
    if (!listening || !hasDocument) return;
    listening = false;
    document.removeEventListener('visibilitychange', onVisibility);
  };

  function flush(): void {
    clearTimer();
    firstQueuedAt = 0;
    if (cancelled) return;
    const items = take();
    if (items.length === 0) return;
    run(items);
  }

  const schedule = () => {
    // Held for the duration — `onVisibility` is what releases it. Nothing is
    // dropped; the queue simply keeps growing (deduped, when a key is given).
    if (deferWhileHidden && isHidden()) {
      clearTimer();
      return;
    }
    const now = Date.now();
    if (!firstQueuedAt) firstQueuedAt = now;
    const cap = maxWait === undefined ? Infinity : firstQueuedAt + maxWait - now;
    const delay = Math.max(0, Math.min(wait, cap));
    clearTimer();
    timer = setTimeout(flush, delay);
  };

  return {
    push(item: T) {
      if (cancelled) return;
      if (keyed) keyed.set(key!(item), item);
      else list.push(item);
      listen();
      schedule();
    },
    flush,
    cancel() {
      cancelled = true;
      clearTimer();
      list = [];
      if (keyed) keyed = new Map();
      unlisten();
    },
    get pending() {
      return size() > 0;
    },
  };
}

/** A react-query filter, structurally — avoids importing the type here. */
export type QueryFilter = { queryKey: readonly unknown[] };

/**
 * The common case: "invalidate these queries, at most once per burst".
 *
 * Deduped by the key's JSON form (arrays are not Set-friendly), so pushing the
 * same procedure filter fifty times in a burst costs exactly one refetch.
 */
export function createInvalidator(
  invalidate: (filter: QueryFilter) => void,
  opts: Omit<CoalesceOptions<QueryFilter>, 'key'>,
): Coalescer<QueryFilter> {
  return createCoalescer<QueryFilter>(
    (filters) => {
      for (const f of filters) invalidate(f);
    },
    { ...opts, key: (f) => JSON.stringify(f.queryKey) },
  );
}
