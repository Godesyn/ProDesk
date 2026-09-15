/**
 * Watchdog for the Radix "body stays locked" failure.
 *
 * A modal Radix layer (Dialog, Sheet, AlertDialog, DropdownMenu, Popover with
 * `modal`) sets `pointer-events: none` on <body> while open and restores it on a
 * DEFERRED tick. If the layer's React tree unmounts before that tick runs — the
 * menu item navigated, switched screens, signed out — the restore never happens
 * and the entire page goes dead to clicks. Text stays selectable, which is the
 * tell-tale sign.
 *
 * Every known instance has a correct per-site fix (`modal` / `modal={false}`,
 * enforced by scripts/check-radix-nested-overlays.mjs). This is the net under
 * that: getting it wrong should degrade to a repaint, never to an app the user
 * has to reload. It only ever CLEARS a lock that no live layer is asking for, so
 * it cannot interfere with a legitimately open dialog.
 *
 * Mount once, high in each app shell.
 */
import { useEffect } from 'react';
import { IS_DEV_SERVER } from '../lib/env';

/**
 * Selectors for a Radix layer that legitimately wants the body locked. Radix
 * stamps `data-state="open"` on live content and keeps the node mounted while
 * closing, so an exiting layer is correctly NOT counted.
 */
const LIVE_LAYER = [
  '[data-radix-popper-content-wrapper]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[data-radix-menu-content][data-state="open"]',
  '[data-radix-select-content]',
  '[data-state="open"][data-slot$="-content"]',
].join(',');

function bodyIsLockedWithNoLayer(): boolean {
  if (document.body.style.pointerEvents !== 'none') return false;
  return document.querySelector(LIVE_LAYER) === null;
}

/**
 * Clears the lock only once it has OUTLIVED any layer. Radix's own restore is
 * deferred, so checking immediately would race it and clear a lock that was
 * about to be handled correctly — the two-frame wait lets Radix win whenever it
 * is going to.
 */
function scheduleCheck(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!bodyIsLockedWithNoLayer()) return;
      document.body.style.removeProperty('pointer-events');
      if (IS_DEV_SERVER) {
        console.warn(
          '[radix-body-lock-guard] cleared a stuck `pointer-events: none` on <body>. ' +
            'A modal Radix layer unmounted before its cleanup ran — find it and pass ' +
            'an explicit `modal` / `modal={false}`, rather than relying on this.',
        );
      }
    });
  });
}

export function RadixBodyLockGuard() {
  useEffect(() => {
    // React to the style attribute Radix writes, and to layers being removed.
    const observer = new MutationObserver(scheduleCheck);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
      childList: true,
      subtree: false,
    });
    // A lock can also outlive a route change that removed the layer's portal.
    window.addEventListener('focus', scheduleCheck);
    scheduleCheck();
    return () => {
      observer.disconnect();
      window.removeEventListener('focus', scheduleCheck);
    };
  }, []);

  return null;
}
