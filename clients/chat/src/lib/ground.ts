/**
 * The ground — Night or Day.
 *
 * Chat is the one dark-FIRST frontend in the suite (see index.css), so it owns
 * its own two-ground switch rather than inheriting the shared light theme. The
 * choice is written as `data-ground` on <html> and read by a single CSS rule
 * (`:root[data-ground='day'] .cx-ui`), which keeps the whole mechanism to one
 * attribute and no React state.
 *
 * `applyStoredGround()` runs BEFORE React mounts (main.tsx), beside
 * `applyStoredAccent()`. A messenger that paints white for one frame and then
 * flips to Night has made its most common moment — a phone in a dark room — its
 * worst one.
 *
 * Deliberately NOT stored on the server. The right ground depends on the device
 * and the hour, not on the account: the same person wants Day on a desk monitor
 * at 10am and Night on a phone at 11pm, and syncing the two fights them.
 */

export type Ground = 'night' | 'day' | 'system';

const KEY = 'prodesk.chat.ground';

/** The stored preference, or `system` when nothing has been chosen yet. */
export function storedGround(): Ground {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'night' || raw === 'day' || raw === 'system') return raw;
  } catch {
    /* private mode / storage disabled */
  }
  return 'system';
}

/** Resolve a preference to the ground actually painted. */
export function resolveGround(pref: Ground): 'night' | 'day' {
  if (pref === 'night' || pref === 'day') return pref;
  // First-run guess only. A device explicitly set to light gets Day; everything
  // else — including "no preference" — gets Night, because that is this app's
  // default and `prefers-color-scheme` is unset far more often than it is dark.
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'day';
  } catch {
    /* matchMedia unavailable */
  }
  return 'night';
}

/** Paint a ground without touching the stored preference. */
export function paintGround(ground: 'night' | 'day'): void {
  document.documentElement.setAttribute('data-ground', ground);
  // Keep the browser chrome (address bar, notch) in step with the room.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', ground === 'day' ? '#f3f1ea' : '#101317');
}

/** Persist a preference and paint it. */
export function setGround(pref: Ground): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    /* ignore */
  }
  paintGround(resolveGround(pref));
}

/** Called once before React mounts. */
export function applyStoredGround(): void {
  paintGround(resolveGround(storedGround()));
}

/**
 * While the preference is `system`, follow the OS as it changes (macOS auto
 * light/dark at sunset is the common case). Returns an unsubscribe.
 */
export function watchSystemGround(): () => void {
  let mq: MediaQueryList;
  try {
    mq = window.matchMedia('(prefers-color-scheme: light)');
  } catch {
    return () => {};
  }
  const onChange = () => {
    if (storedGround() === 'system') paintGround(resolveGround('system'));
  };
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
