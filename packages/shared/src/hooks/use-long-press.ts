import { useCallback, useEffect, useRef } from 'react';

/**
 * Press and hold.
 *
 * The gesture every phone user already knows, and — in both chat surfaces — the
 * only way the message actions are reachable at all without a hover. Every one
 * of react / reply / forward / copy / edit / delete lives in a toolbar that
 * appears on hover, and a phone has no hover, so the whole set was desktop-only
 * by accident.
 *
 * Three details are what separate a long-press that feels native from one that
 * fires by accident:
 *
 *  • A MOVEMENT BUDGET. A finger is never still, but a scroll starts as a press.
 *    Ten pixels is the line between the two; past it this is a scroll and the
 *    timer is cancelled, which is what stops the sheet opening every time
 *    someone flicks through history.
 *  • CANCEL ON EVERYTHING. pointerup, pointercancel and the scroll itself.
 *    A timer that survives the finger leaving the glass fires into an empty
 *    screen.
 *  • THE CLICK AFTERWARDS IS NOT A CLICK. The browser sends one anyway when the
 *    finger lifts, and without swallowing it a long-press on a photo opens the
 *    sheet and the lightbox at once. `suppressClick` is read by the row's own
 *    click handler for exactly that frame.
 */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP_PX = 10;

export function useLongPress(onLongPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    /** True for the click that immediately follows a fired long-press. */
    suppressClick: () => {
      if (!fired.current) return false;
      fired.current = false;
      return true;
    },
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        // Mouse gets the context menu instead (below); this is for finger and pen.
        if (e.pointerType === 'mouse') return;
        origin.current = { x: e.clientX, y: e.clientY };
        fired.current = false;
        cancel();
        timer.current = setTimeout(() => {
          timer.current = null;
          fired.current = true;
          // A short buzz where the platform offers one — the confirmation that
          // the hold registered, before anything is drawn.
          navigator.vibrate?.(8);
          onLongPress();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (!timer.current) return;
        const dx = e.clientX - origin.current.x;
        const dy = e.clientY - origin.current.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => {
        // Right-click is the mouse's press-and-hold, and taking over the
        // browser's menu is right for a message — everything in that menu
        // applies to the page, everything in ours applies to what was said.
        //
        // EXCEPT on media and links, where the browser's menu is the better one:
        // "Save image as", "Copy link address", "Open in new tab" are things
        // people genuinely reach for, and replacing them with a Reply button is
        // taking something away rather than adding to it.
        const target = e.target as HTMLElement | null;
        if (target?.closest('img, video, a')) return;
        e.preventDefault();
        onLongPress();
      },
    },
  };
}
