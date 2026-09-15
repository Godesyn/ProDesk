/* Verdiict — address autocomplete for the reward shipping form. The Google API
 * key lives on the BACKEND: this queries the `places` tRPC router (autocomplete +
 * details) so the key never reaches the browser, and fills the structured address
 * fields from the parsed place details. Degrades to nothing (the manual fields
 * stay usable) when the server has no key configured. */
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { MapPin, Loader2 } from 'lucide-react';

export type ParsedAddress = {
  houseNumber: string;
  line1: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
};

function newSessionToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

/** Address search box that autofills the structured claim-form fields on pick. */
export function PlacesAddressField({ onPick }: { onPick: (p: ParsedAddress) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const skipNext = useRef(false);
  const sessionToken = useRef(newSessionToken());
  const boxRef = useRef<HTMLDivElement | null>(null);

  const enabledQ = useQuery(trpc.places.enabled.queryOptions());
  const enabled = enabledQ.data?.enabled ?? false;

  useEffect(() => {
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    const id = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);

  const acQ = useQuery({
    ...trpc.places.autocomplete.queryOptions({
      input: debounced,
      sessionToken: sessionToken.current,
    }),
    enabled: enabled && debounced.length >= 3,
  });
  const predictions = acQ.data?.predictions ?? [];
  const showMenu = enabled && open && predictions.length > 0;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function pick(placeId: string, description: string) {
    skipNext.current = true;
    setText(description);
    setOpen(false);
    setResolving(true);
    try {
      const details = await qc.fetchQuery(
        trpc.places.details.queryOptions({ placeId, sessionToken: sessionToken.current }),
      );
      onPick(details.parsed);
    } catch {
      /* leave fields for manual entry */
    } finally {
      setResolving(false);
      sessionToken.current = newSessionToken();
    }
  }

  // No key configured → don't render the search box; the manual fields cover it.
  if (enabledQ.isSuccess && !enabled) return null;

  return (
    <div className="vfield" ref={boxRef} style={{ position: 'relative' }}>
      <label className="vlabel">Find your address</label>
      <div style={{ position: 'relative' }}>
        <MapPin
          size={15}
          style={{
            position: 'absolute',
            left: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--v-muted)',
            pointerEvents: 'none',
          }}
        />
        <input
          className="vinput"
          style={{ paddingLeft: 34 }}
          value={text}
          autoComplete="off"
          placeholder="Start typing an address…"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => predictions.length && setOpen(true)}
        />
        {resolving ? (
          <Loader2
            size={15}
            className="animate-spin"
            style={{
              position: 'absolute',
              right: 11,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--v-muted)',
            }}
          />
        ) : null}
      </div>
      {showMenu ? (
        <ul
          style={{
            position: 'absolute',
            zIndex: 20,
            top: '100%',
            left: 0,
            right: 0,
            margin: '4px 0 0',
            padding: 4,
            listStyle: 'none',
            background: 'var(--v-card)',
            border: '1px solid var(--v-line)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
          {predictions.map((p) => (
            <li key={p.placeId}>
              <button
                type="button"
                className="vrow"
                style={{
                  gap: 8,
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: '9px 8px',
                  borderRadius: 6,
                  fontSize: 13.5,
                  color: 'var(--v-ink)',
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void pick(p.placeId, p.description);
                }}
              >
                <MapPin size={14} style={{ color: 'var(--v-muted)', flexShrink: 0 }} />
                <span
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {p.description}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Common phone country/dial codes for the reward shipping form. */
export const DIAL_CODES: Array<{ code: string; label: string }> = [
  { code: '+61', label: '🇦🇺 +61' },
  { code: '+64', label: '🇳🇿 +64' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+353', label: '🇮🇪 +353' },
  { code: '+91', label: '🇮🇳 +91' },
  { code: '+65', label: '🇸🇬 +65' },
  { code: '+27', label: '🇿🇦 +27' },
  { code: '+49', label: '🇩🇪 +49' },
  { code: '+33', label: '🇫🇷 +33' },
];
