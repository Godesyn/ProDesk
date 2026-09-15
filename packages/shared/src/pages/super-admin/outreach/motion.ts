import { useEffect, useRef, useState } from 'react';

/**
 * Motion primitives for the Outreach screens.
 *
 * Two rules the whole feature obeys, and the reason these live in one place:
 *
 *  1. Reduced motion is honoured everywhere. Not "animations get shorter" —
 *     they don't run, and the final value renders immediately.
 *  2. Entrance motion happens ONCE, on first paint. These screens poll, and a
 *     view that re-animates every few seconds is unreadable.
 */

/** Live `prefers-reduced-motion`, updated if the user changes it mid-session. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/**
 * False on the very first paint, true immediately after.
 *
 * Render the "empty" state of an entrance animation while false and the real
 * value once true, and the browser transitions between them. Because the flag
 * only ever flips once, a refetch changes the value without replaying the
 * entrance — capacity meters fill from empty on load, then move by the delta.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return mounted;
}

/**
 * A number that eases to its target instead of snapping.
 *
 * Numbers are the content on these screens, so they move the way the thing they
 * describe moves. Under reduced motion the target is returned directly.
 */
export function useTickingNumber(target: number, durationMs = 480): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const fromRef = useRef(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (reduced) {
      setValue(target);
      return;
    }

    const from = fromRef.current;
    const delta = target - from;
    if (delta === 0) return;

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Same fast-out/slow-in feel as the brand's click curve.
      const eased = 1 - (1 - t) ** 3;
      const next = from + delta * eased;
      setValue(next);
      fromRef.current = next;
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = target;
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs, reduced]);

  return value;
}

/** Round a ticking number for display — avoids `19.9997 / 20` mid-flight. */
export function useTickingInt(target: number, durationMs = 480): number {
  return Math.round(useTickingNumber(target, durationMs));
}
