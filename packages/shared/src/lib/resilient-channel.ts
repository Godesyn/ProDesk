import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Self-healing wrapper around a Supabase realtime channel.
 *
 * Three failure modes make a plain `.subscribe()` silently go dark:
 *
 * 1. **Missed events are lost forever.** postgres_changes has no replay: any
 *    change that happens while the socket is down (laptop sleep, tab throttled,
 *    network blip, realtime restart) is never delivered. Reconnecting only
 *    resumes FUTURE events — the UI stays stale for everything in the gap.
 * 2. **Channels can die permanently.** The socket retries forever, but a channel
 *    whose rejoin is rejected (e.g. the JWT expired during sleep, so the join is
 *    refused before auth-js has refreshed the token) parks in 'errored'/'closed'
 *    and nothing revives it — future events never arrive either. A worse
 *    variant: the server drops the subscription while the client still reports
 *    'joined' (a zombie) — undetectable from client state alone.
 * 3. **Two subscriptions to one topic collide.** Supabase reuses a channel by
 *    topic and `removeChannel` is ASYNC, so a rebuild (or a remount, or React
 *    StrictMode's double-invoked effect) that re-subscribes the same topic while
 *    the previous teardown is still in flight throws — and the caller's view
 *    blanks. See the same hazard, solved by ref-counting, in chat-channel.ts.
 *
 * This wrapper cures all three:
 * - Subscribes with a status callback; any re-`SUBSCRIBED` after a gap fires
 *   `onCatchUp` so the caller refetches whatever realtime dropped in between.
 * - On tab-visible / network-online it health-checks after a short grace period
 *   (letting auth-js's own visibility token refresh and phoenix's automatic
 *   rejoin land first), re-syncs the socket JWT, and hard-resubscribes (remove +
 *   rebuild) anything not cleanly joined. After a LONG hidden stretch it
 *   resubscribes unconditionally, which is the only cure for zombies — and a
 *   slow background sweep catches the tab that is left open for hours and never
 *   hidden, which the visibility path by definition never sees.
 * - Serialises attach behind teardown PER TOPIC (module-level, so it holds
 *   across separate wrappers on the same topic), which is what makes a rebuild
 *   or a fast unmount→remount safe.
 *
 * `build` must create the channel and attach all `.on()` bindings but NOT call
 * `.subscribe()` — the wrapper owns subscription and teardown.
 */

/** Grace before health-checking, so token refresh + auto-rejoin can land first. */
const REJOIN_GRACE_MS = 2_000;
/** Hidden longer than this → resubscribe unconditionally (zombie insurance). */
const LONG_GAP_MS = 5 * 60_000;
/**
 * Background sweep for a tab that stays open and visible. Cheap (it reads a
 * string off the channel and does nothing in the healthy case) and it is the
 * only thing that ever notices a channel that errored out while the user was
 * sitting right in front of it — visibility and online events never fire then.
 */
const HEALTH_SWEEP_MS = 45_000;

/**
 * In-flight `removeChannel` calls, by topic.
 *
 * Module-level on purpose: the collision this prevents is between two DIFFERENT
 * wrapper instances (an unmounting one and a mounting one) on the same topic, so
 * per-instance state could not see it.
 */
const teardowns = new Map<string, Promise<unknown>>();

function releaseTopic(topic: string | undefined, ch: RealtimeChannel): Promise<unknown> {
  const done = Promise.resolve(supabase.removeChannel(ch)).catch(() => null);
  if (!topic) return done;
  const chain = done.finally(() => {
    if (teardowns.get(topic) === chain) teardowns.delete(topic);
  });
  teardowns.set(topic, chain);
  return chain;
}

function topicFree(topic: string | undefined): Promise<unknown> {
  return (topic && teardowns.get(topic)) || Promise.resolve();
}

export interface ResilientChannel {
  /** The live channel (identity changes after a hard resubscribe; null mid-swap). */
  getChannel(): RealtimeChannel | null;
  dispose(): void;
}

export function subscribeResilient(opts: {
  build: () => RealtimeChannel;
  /** Called after every re-join that may have dropped events — refetch here. */
  onCatchUp: () => void;
  /**
   * The channel's topic, exactly as passed to `supabase.channel(...)`. Optional
   * only for backwards compatibility: without it, a rebuild or a fast
   * remount can race its own teardown and throw. Always pass it.
   */
  topic?: string;
}): ResilientChannel {
  let channel: RealtimeChannel | null = null;
  let disposed = false;
  let everJoined = false;
  // True once any non-SUBSCRIBED status arrives: events may have been dropped.
  let gap = false;
  let rebuilding = false;
  let hiddenAt: number | null = null;
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  // Invalidates an in-flight attach whose topic wait resolves after a newer
  // attach (or a dispose) has already superseded it.
  let attachToken = 0;

  const attach = () => {
    const token = ++attachToken;
    void topicFree(opts.topic).then(() => {
      if (disposed || token !== attachToken) return;
      let ch: RealtimeChannel;
      try {
        ch = opts.build();
      } catch {
        // A build that throws (the classic "tried to subscribe multiple times")
        // must not leave the wrapper wedged — the sweep below will retry.
        gap = true;
        return;
      }
      channel = ch;
      ch.subscribe((status) => {
        if (disposed || channel !== ch) return;
        if (status === 'SUBSCRIBED') {
          if (everJoined && gap) opts.onCatchUp();
          everJoined = true;
          gap = false;
        } else {
          // CHANNEL_ERROR / TIMED_OUT / CLOSED — delivery has (or may have) stopped.
          gap = true;
        }
      });
    });
  };

  const rebuild = () => {
    if (disposed || rebuilding) return;
    rebuilding = true;
    gap = true; // the fresh join must catch up
    const old = channel;
    channel = null;
    // removeChannel is async — subscribing a new channel on the same topic while
    // teardown is still in flight throws, so the attach waits on `topicFree`.
    void (old ? releaseTopic(opts.topic, old) : Promise.resolve()).then(() => {
      rebuilding = false;
      if (!disposed) attach();
    });
  };

  const check = (forceRebuild: boolean) => {
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(() => {
      checkTimer = null;
      if (disposed) return;
      void supabase.auth.getSession().then(({ data }) => {
        if (disposed) return;
        // Sync the socket's JWT before (re)joining: getSession() refreshes an
        // expired token, and a rejoin sent with the stale pre-sleep token is
        // rejected by the server — the exact path that strands a channel.
        void supabase.realtime.setAuth(data.session?.access_token ?? null);
        const state = channel?.state;
        if (!forceRebuild && state === 'joining') return; // rejoin already in flight
        if (!forceRebuild && state === 'joined' && !gap) return; // healthy
        rebuild();
      });
    }, REJOIN_GRACE_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    check(hiddenFor > LONG_GAP_MS);
  };
  const onOnline = () => check(false);

  /**
   * The slow sweep. Deliberately does NOT go through `check()`: that one waits a
   * grace period and re-reads the session, which is the right amount of work for
   * a wake-up and far too much to do every 45s forever. Here we only act on a
   * channel that is definitively not working — an attach in flight (`null`) or a
   * healthy/joining state is left completely alone.
   */
  const sweep = setInterval(() => {
    if (disposed || rebuilding || !channel) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const state = channel.state;
    if (state === 'joined' || state === 'joining') return;
    rebuild();
  }, HEALTH_SWEEP_MS);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  attach();

  return {
    getChannel: () => channel,
    dispose: () => {
      disposed = true;
      attachToken++;
      clearInterval(sweep);
      if (checkTimer) clearTimeout(checkTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      // Register the teardown under the topic even on dispose, so a component
      // remounting onto the same topic in the same tick waits for it instead of
      // racing it.
      if (channel) void releaseTopic(opts.topic, channel);
      channel = null;
    },
  };
}
