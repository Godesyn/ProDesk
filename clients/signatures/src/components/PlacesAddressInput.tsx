/* SIGKITT — Google Places address autocomplete for the brand form.
 *
 * The Google API key lives on the BACKEND: this queries the shared `places`
 * tRPC router (autocomplete + details) via @shared/lib/trpc, so the key never
 * reaches the browser. (Brand data itself goes through the LOCAL signatures
 * client; only Places uses the shared client, which is mounted app-wide.)
 *
 * Fully controlled — the parent owns the address string. Typing updates it
 * live; picking a suggestion fills the formatted address. When the server has
 * no key configured (places.enabled === false) it degrades to a plain input,
 * so the field always stays usable.
 *
 * The dropdown is portalled to <body> with fixed positioning so it isn't
 * clipped by the surrounding Dialog's overflow. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { MapPin, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

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
  placeholder,
}: {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  // Suppress the next autocomplete fetch right after we set the input text
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

  // Keep the portalled dropdown aligned with the input as the dialog scrolls/resizes.
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
      // Guard the resulting value change from retriggering autocomplete.
      skipNext.current = true;
      onChange(details.address || description);
    } catch {
      /* keep the description text for manual editing */
    } finally {
      setResolving(false);
      // Fresh billing session for the next lookup.
      sessionToken.current = newSessionToken();
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <MapPin className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        placeholder={placeholder ?? 'Start typing an address…'}
        autoComplete="off"
        className="pl-8 pr-8"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => predictions.length && setOpen(true)}
      />
      {(resolving || acQ.isFetching) && (
        <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {showMenu &&
        rect &&
        createPortal(
          <ul
            ref={menuRef}
            className="fixed z-[1000] m-0 max-h-60 overflow-y-auto rounded-lg border border-[#E8E5DC] bg-white p-1 shadow-xl"
            // Re-enable pointer events: a modal Radix Dialog sets pointer-events:none
            // on <body>, which this body-portalled menu would otherwise inherit —
            // making clicks fall through to the dialog behind it.
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
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-[#0E0E0C] transition-colors hover:bg-[#F4F1E8]"
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
