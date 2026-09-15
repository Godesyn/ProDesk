/**
 * Desktop notifications — opt-in, device-scoped, and deliberately thin.
 *
 * The Notification API is the one part of a messenger that can annoy someone in
 * an app they are not looking at, so three rules are baked in here rather than
 * left to each call site:
 *
 *  1. NEVER prompt on load. `Notification.requestPermission()` fires only from
 *     the Settings toggle — a permission prompt on first paint is how a browser
 *     ends up with a permanently denied origin.
 *  2. Off unless explicitly turned on. Granted permission is not consent; the
 *     stored preference is a second gate the user controls.
 *  3. Only when the page is hidden. Notifying someone about a conversation that
 *     is on screen in front of them is pure noise.
 *
 * The preference is per-device (localStorage), like the light/dark ground — it
 * describes this browser, not the account.
 */

const KEY = 'prodesk.chat.desktop-notifications';

function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Whether the user has switched desktop notifications on IN THIS BROWSER. */
export function desktopEnabled(): boolean {
  if (!supported() || Notification.permission !== 'granted') return false;
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Permission state, for the Settings copy. */
export function desktopPermission(): NotificationPermission | 'unsupported' {
  return supported() ? Notification.permission : 'unsupported';
}

/**
 * Turn the preference on or off. Turning it ON asks the browser for permission
 * if it has not been decided yet; returns whether notifications are now live, so
 * the toggle can refuse to flip when the browser said no.
 */
export async function setDesktopEnabled(next: boolean): Promise<boolean> {
  if (!supported()) return false;
  if (!next) {
    try {
      localStorage.setItem(KEY, '0');
    } catch {
      /* private mode — the preference just doesn't persist */
    }
    return false;
  }
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * Fire one notification, if every gate above passes. `tag` collapses repeats:
 * three requests arriving in a row replace one another rather than stacking
 * three toasts on the desktop.
 */
export function notifyDesktop(
  title: string,
  options: { body?: string; tag?: string; onClick?: () => void },
): void {
  if (!desktopEnabled()) return;
  // Rule 3: the tab is in front of them, so they can already see it.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    const n = new Notification(title, {
      body: options.body,
      tag: options.tag,
      icon: '/favicon.png',
    });
    n.onclick = () => {
      window.focus();
      options.onClick?.();
      n.close();
    };
  } catch {
    // Some browsers throw when constructing a Notification outside a service
    // worker (notably Android Chrome). Nothing to recover — stay silent.
  }
}
