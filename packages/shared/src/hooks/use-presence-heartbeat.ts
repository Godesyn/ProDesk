import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';

/** How often we stamp presence while the tab is foregrounded. Must sit
 *  comfortably inside the server's PRESENCE_HEARTBEAT_THRESHOLD_MS (90s). */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Maintains a presence heartbeat for the signed-in user: posts
 * `users.heartbeat` every ~30s while the tab is visible (anywhere in the app,
 * not just chat), and once immediately when the tab regains focus. The server
 * uses the freshness of this stamp to suppress chat-digest emails for users
 * who are actively online. Ports Flutter's PresenceService.
 *
 * Best-effort: heartbeat failures are swallowed (the mutation has no UI).
 * Pass `enabled: false` (e.g. before auth resolves) to keep it idle.
 */
export function usePresenceHeartbeat(enabled: boolean) {
  const trpc = useTRPC();
  const { mutate } = useMutation(trpc.users.heartbeat.mutationOptions());
  // Keep a stable reference so the interval effect doesn't restart each render.
  const beat = useRef(mutate);
  beat.current = mutate;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') beat.current();
    };
    tick(); // stamp on mount so a freshly-loaded session counts as online
    const timer = window.setInterval(tick, HEARTBEAT_INTERVAL_MS);
    // Stamp the moment the tab is refocused, without waiting for the next tick.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled]);
}
