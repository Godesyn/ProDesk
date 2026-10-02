/**
 * A frontend running inside the dashboard's app modal (an iframe — see the
 * dashboard's AppModal). The suite is the parent page there, so anything that
 * would load the suite or sign out inside the frame asks the parent to close
 * the modal instead.
 */
import { useEffect } from 'react';
import { PRODESK_ORIGINS, originUrl } from './origins';

export const IS_EMBEDDED =
  typeof window !== 'undefined' && window.parent !== window;

export const SUITE_MESSAGE = 'prodesk:suite';
export interface SuiteMessage {
  type: typeof SUITE_MESSAGE;
  action: 'close' | 'signout';
  /** Dashboard path to route to after closing (e.g. '/app/info-hub'). */
  path?: string;
}

/** Tell the dashboard (the parent page) to close the app modal. */
export function postToSuite(action: SuiteMessage['action'], path?: string) {
  const msg: SuiteMessage = { type: SUITE_MESSAGE, action, path };
  window.parent.postMessage(msg, originUrl(PRODESK_ORIGINS.dashboard));
}

/** Is `origin` (a MessageEvent origin) one of our own frontends? */
export function isProdeskOrigin(origin: string): boolean {
  return Object.values(PRODESK_ORIGINS).some((h) => !!h && originUrl(h) === origin);
}

const OVERLAY = '[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]';

/**
 * Escape inside the frame closes the modal — focus there never reaches the
 * dashboard's own Esc handler. Skipped when the app has an overlay open (seen in
 * the capture phase, before it unmounts) or something else consumed the key.
 */
export function useEmbedEscape() {
  useEffect(() => {
    if (!IS_EMBEDDED) return;
    let overlayOpen = false;
    const capture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') overlayOpen = !!document.querySelector(OVERLAY);
    };
    const bubble = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !overlayOpen && !e.defaultPrevented) postToSuite('close');
    };
    window.addEventListener('keydown', capture, true);
    window.addEventListener('keydown', bubble);
    return () => {
      window.removeEventListener('keydown', capture, true);
      window.removeEventListener('keydown', bubble);
    };
  }, []);
}
