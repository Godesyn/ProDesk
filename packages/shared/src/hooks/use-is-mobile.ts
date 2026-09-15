import { useEffect, useState } from 'react';

/**
 * Reactive viewport-width check for JS-level layout decisions (e.g. swapping a
 * desktop two-pane layout for a mobile tabbed one). Prefer Tailwind responsive
 * classes for pure styling; reach for this only when the DOM structure itself
 * must differ between mobile and desktop.
 *
 * Defaults to the Tailwind `md` breakpoint (768px) so it lines up with the
 * `md:` / `max-md:` utilities used across the app.
 */
export function useIsMobile(maxWidth = 768): boolean {
  const query = `(max-width: ${maxWidth - 0.02}px)`;
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
