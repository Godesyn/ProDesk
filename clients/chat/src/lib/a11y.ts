import { useEffect, useState } from 'react';

// Press-and-hold now lives in the shared hooks, because the workspace chat
// panel needs exactly the same gesture for exactly the same reason (its message
// actions are hover-only too). Re-exported here so this file stays the one
// import for the messenger's quality floor.
export { useLongPress } from '@shared/hooks/use-long-press';

/**
 * The quality floor, in one file.
 *
 * Reduced motion and the live announcer are the two accessibility concerns a
 * messenger gets uniquely wrong, so both live here rather than being sprinkled
 * through components where one will inevitably be forgotten.
 */

/** Does this person want motion kept to a minimum? */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Does this device have a precise pointer? Decides Enter-to-send and autofocus. */
export function usePointerFine(): boolean {
  const [fine, setFine] = useState(() => {
    try {
      return window.matchMedia('(pointer: fine)').matches;
    } catch {
      return true;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(pointer: fine)');
    } catch {
      return;
    }
    const onChange = () => setFine(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return fine;
}

/**
 * The live announcer.
 *
 * Fed ONLY with new incoming messages — never your own, never a page of history.
 * The virtualised transcript must never carry `aria-live` itself: virtualisation
 * mutates the DOM continuously as you scroll, and every recycled row would be
 * announced as if it had just arrived.
 *
 * Throttled to one announcement every two seconds, and silent while the tab is
 * hidden, because a screen reader narrating a conversation you are not looking at
 * is the fastest way to get the whole app muted.
 */
const ANNOUNCE_THROTTLE_MS = 2_000;

let announceNode: HTMLElement | null = null;
let lastAnnouncedAt = 0;

function ensureNode(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (announceNode?.isConnected) return announceNode;
  const node = document.createElement('div');
  node.className = 'cx-sr';
  node.setAttribute('role', 'status');
  node.setAttribute('aria-live', 'polite');
  node.setAttribute('aria-atomic', 'false');
  document.body.appendChild(node);
  announceNode = node;
  return node;
}

export function announceMessage(senderName: string, body: string): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  const now = Date.now();
  if (now - lastAnnouncedAt < ANNOUNCE_THROTTLE_MS) return;
  lastAnnouncedAt = now;
  const node = ensureNode();
  if (!node) return;
  const trimmed = body.length > 120 ? `${body.slice(0, 120)}…` : body;
  node.textContent = `${senderName}: ${trimmed}`;
}

/** Announce something once, outside the throttle (thread opened, request accepted). */
export function announce(text: string): void {
  const node = ensureNode();
  if (node) node.textContent = text;
}
