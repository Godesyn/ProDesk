/* Prodesk Suite — Google Places address autocomplete (with graceful fallback).
   The Google API key lives on the BACKEND: this component queries the
   `places` tRPC router (autocomplete + details) so the key is never shipped to
   the browser. When the server has no key configured, the field degrades to a
   plain text input. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon } from './icons';

export interface PlacePick {
  address: string;
  placeId?: string;
  lat?: number;
  lng?: number;
}

// One session token per input instance ties a run of keystrokes + the final
// details lookup into a single billable Google session.
function newSessionToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

/** A labelled address input that upgrades to Google Places autocomplete when the server is configured. */
export function PlacesAddressInput({
  label,
  value,
  onPick,
  placeholder,
}: {
  label: string;
  value: string;
  onPick: (p: PlacePick) => void;
  placeholder?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const [text, setText] = useState(value);
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  // Suppress the next autocomplete fetch right after a user picks a suggestion
  // (so re-setting the input text doesn't immediately reopen the dropdown).
  const skipNext = useRef(false);
  const sessionToken = useRef(newSessionToken());
  const boxRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  // On-screen rect of the input box, used to position the portalled dropdown.
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);

  const enabledQ = useQuery(trpc.places.enabled.queryOptions());
  const enabled = enabledQ.data?.enabled ?? false;

  // Debounce the typed text before hitting the backend.
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

  // Keep the portalled dropdown aligned with the input as the page scrolls/resizes.
  useLayoutEffect(() => {
    if (!showMenu) return;
    const measure = () => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    measure();
    // `true` => capture phase, so scrolls inside the modal body are caught too.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [showMenu]);

  async function pick(placeId: string, description: string) {
    skipNext.current = true;
    setText(description);
    setOpen(false);
    try {
      const details = await qc.fetchQuery(
        trpc.places.details.queryOptions({
          placeId,
          sessionToken: sessionToken.current,
        }),
      );
      onPick({
        address: details.address || description,
        placeId: details.placeId,
        lat: details.lat,
        lng: details.lng,
      });
    } catch {
      onPick({ address: description, placeId });
    }
    // Start a fresh billing session for the next lookup.
    sessionToken.current = newSessionToken();
  }

  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="eyebrow"
        style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
      >
        {label}
      </span>
      <div ref={boxRef} style={{ position: 'relative' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--white)',
            border: '1px solid var(--rule-2)',
            borderRadius: 'var(--r-2)',
            padding: '0 11px',
          }}
        >
          <Icon
            name="building"
            size={15}
            style={{ color: 'var(--ink-3)', flexShrink: 0 }}
          />
          <input
            type="text"
            value={text}
            placeholder={placeholder ?? 'Start typing an address'}
            autoComplete="off"
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (predictions.length) setOpen(true);
            }}
            onBlur={(e) => {
              // Commit free text on blur (covers the no-key fallback and manual entry).
              // The dropdown's own mousedown handler fires before blur, so picks still work.
              onPick({ address: e.target.value });
            }}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font)',
              fontSize: 14,
              color: 'var(--ink)',
              padding: '9px 0',
              minWidth: 0,
            }}
          />
        </div>

        {showMenu &&
          rect &&
          createPortal(
            <ul
              ref={menuRef}
              style={{
                position: 'fixed',
                top: rect.top,
                left: rect.left,
                width: rect.width,
                zIndex: 1000,
                margin: 0,
                padding: 4,
                listStyle: 'none',
                background: 'var(--white)',
                border: '1px solid var(--rule-2)',
                borderRadius: 'var(--r-2)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                maxHeight: 260,
                overflowY: 'auto',
              }}
            >
              {predictions.map((p) => (
                <li key={p.placeId}>
                  <button
                    type="button"
                    // onMouseDown (not onClick) so the pick fires before the input's blur.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      void pick(p.placeId, p.description);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: '9px 8px',
                      borderRadius: 'var(--r-1)',
                      fontFamily: 'var(--font)',
                      fontSize: 13.5,
                      color: 'var(--ink)',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background =
                        'var(--bg-2, #f4f4f5)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'transparent')
                    }
                  >
                    <Icon
                      name="building"
                      size={14}
                      style={{ color: 'var(--ink-3)', flexShrink: 0 }}
                    />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )}
      </div>
    </label>
  );
}
