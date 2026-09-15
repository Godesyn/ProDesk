import { useCallback, useRef } from 'react';

/**
 * Lets the user pan a horizontally-scrolling container by grabbing any blank
 * space and dragging — the React parity of the Flutter Kanban board's
 * `ScrollConfiguration(dragDevices: { mouse, ... })` (kanban_board.dart), so you
 * never have to reach for the scrollbar.
 *
 * Pointer-downs that land on a draggable card (or any interactive control) are
 * left alone so dnd-kit's card drag and click-to-open keep working; only grabs
 * on empty board space initiate a pan. A small movement threshold keeps plain
 * clicks from being swallowed.
 *
 * Returns a *callback ref*, not a RefObject, on purpose: the Kanban scroll
 * container is only mounted once the board query resolves (it's absent during
 * the loading/empty states). A `useEffect`-based hook runs once on mount, finds
 * `ref.current` still null, and never re-attaches — so a cold-loaded board
 * (e.g. the first visit to the brand board, before its query is cached) would
 * silently lose drag-to-pan. A callback ref instead (re)binds the listeners the
 * moment the node actually mounts and cleans them up when it unmounts.
 */
const DEFAULT_IGNORE = '[data-kanban-card],button,a,input,textarea,select,[role="button"]';

/**
 * `options.ignore` is the selector of elements whose pointer-down must NOT start
 * a pan. It defaults to the Kanban set (cards are dnd-draggable there, so a grab
 * on a card belongs to dnd-kit). Surfaces whose cards are merely *clickable* (the
 * marketplace / catalog rails) pass a looser selector so the cards themselves are
 * grabbable, and the click the browser synthesises at the end of such a drag is
 * swallowed so a pan never also opens the card it began on.
 */
export function useDragScroll<T extends HTMLElement>(options?: { ignore?: string }) {
  const ignore = options?.ignore ?? DEFAULT_IGNORE;
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    // Detach from the previous node (also fires on unmount, when el === null).
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;

    let panning = false;
    let pointerId = -1;
    let startX = 0;
    let startScroll = 0;
    let moved = false;

    const onPointerDown = (e: PointerEvent) => {
      // Only primary mouse/pen/touch grabs, and only on blank space — leave
      // cards (dnd-kit drag) and controls to their own handlers.
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(ignore)) return;
      if (el.scrollWidth <= el.clientWidth) return; // nothing to pan

      panning = true;
      moved = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startScroll = el.scrollLeft;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!panning) return;
      const dx = e.clientX - startX;
      if (!moved) {
        if (Math.abs(dx) < 4) return; // tolerate jitter on a click
        moved = true;
        el.setPointerCapture(pointerId);
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
      }
      el.scrollLeft = startScroll - dx;
    };

    const stop = () => {
      if (!panning) return;
      panning = false;
      if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
      el.style.cursor = '';
      el.style.userSelect = '';
      if (moved) {
        // A real pan just ended; swallow the click the browser will synthesise
        // so dragging the rail from a card doesn't also open that card. Capture
        // phase + once so we only eat this one click; a stray timeout clears it
        // if (e.g. on touch) no click follows.
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        el.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', swallow, true), 0);
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);

    cleanupRef.current = () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
    };
  }, []);
}
