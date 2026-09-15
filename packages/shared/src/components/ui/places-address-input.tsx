/* Shared Google Places address autocomplete.
 *
 * The Google API key lives on the BACKEND — this queries the shared `places`
 * tRPC router (autocomplete + details), so the key never reaches the browser.
 * When the server has no key configured (places.enabled === false) it degrades
 * to a plain text input, so the field always stays usable.
 *
 * Controlled: the parent owns the address string. Typing calls onChange with
 * the raw text; picking a suggestion resolves the formatted address + place
 * metadata and calls BOTH onChange (with the formatted address) and onPick.
 *
 * The dropdown is portalled to <body> with fixed positioning so it isn't
 * clipped by a surrounding card/dialog's overflow, and re-enables pointer
 * events (a modal Radix Dialog sets pointer-events:none on <body>). */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Loader2 } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';

export interface PlacePick {
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}

function newSessionToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

export function PlacesAddressInput({
  value,
  onChange,
  onPick,
  placeholder,
  autoFocus,
}: {
  value: string;
  /** Fires on every keystroke with the raw text (place metadata no longer valid). */
  onChange: (address: string) => void;
  /** Fires when a suggestion is resolved, with the formatted address + coordinates. */
  onPick?: (pick: PlacePick) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Suppress the next autocomplete fetch right after we set the text
  // programmatically (picking a suggestion), so the menu doesn't reopen.
  const skipNext = useRef(false);
  const sessionToken = useRef(newSessionToken());
  const boxRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const enabledQ = useQuery(trpc.places.enabled.queryOptions());
  const enabled = enabledQ.data?.enabled ?? false;

  // Debounce the typed text before hitting the backend.
  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const id = setTimeout(() => setDebounced(value.trim()), 250);
    return () => clearTimeout(id);
  }, [value]);

  const acQ = useQuery({
    ...trpc.places.autocomplete.queryOptions({
      input: debounced,
      sessionToken: sessionToken.current,
    }),
    enabled: enabled && debounced.length >= 3,
  });
  const predictions = acQ.data?.predictions ?? [];
  const showMenu = enabled && open && predictions.length > 0;

  // Close the dropdown on outside click (the menu is portalled, so check it too).
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Keep the portalled dropdown aligned with the input as things scroll/resize.
  useLayoutEffect(() => {
    if (!showMenu) return;
    const measure = () => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [showMenu]);

  async function pick(placeId: string, description: string) {
    skipNext.current = true;
    onChange(description);
    setOpen(false);
    setResolving(true);
    try {
      const details = await qc.fetchQuery(
        trpc.places.details.queryOptions({ placeId, sessionToken: sessionToken.current }),
      );
      const address = details.address || description;
      skipNext.current = true;
      onChange(address);
      onPick?.({ address, placeId: details.placeId, lat: details.lat, lng: details.lng });
    } catch {
      // Keep the description text for manual editing; still report the pick.
      onPick?.({ address: description, placeId });
    } finally {
      setResolving(false);
      // Fresh billing session for the next lookup.
      sessionToken.current = newSessionToken();
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <MapPin className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-ink-40" />
      <input
        value={value}
        placeholder={placeholder ?? 'Start typing an address…'}
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        className="w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card py-1.5 pl-8 pr-8 text-sm text-ink-100 outline-none focus:border-[color:var(--color-accent)]"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => predictions.length && setOpen(true)}
      />
      {(resolving || acQ.isFetching) && (
        <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-ink-40" />
      )}

      {showMenu &&
        rect &&
        createPortal(
          <ul
            ref={menuRef}
            className="fixed z-[1000] m-0 max-h-60 overflow-y-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-1 shadow-lg"
            style={{ top: rect.top, left: rect.left, width: rect.width, pointerEvents: 'auto' }}
          >
            {predictions.map((p) => (
              <li key={p.placeId}>
                <button
                  type="button"
                  // onMouseDown (not onClick) so the pick fires before the input blurs.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void pick(p.placeId, p.description);
                  }}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-2 text-left text-[13px] text-ink-100 transition-colors hover:bg-inset"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-40" />
                  <span className="truncate">{p.description}</span>
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
