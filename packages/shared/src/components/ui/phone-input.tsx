import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

/** ISO-3166 alpha-2 → emoji flag (regional indicator symbols). */
function flagOf(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

interface Country {
  iso: string;
  name: string;
  dial: string;
}

// A pragmatic set of the markets Prodesk operates in (AU first — the platform is
// Australia-based) plus the major global dial codes. Extend freely.
const COUNTRIES: Country[] = [
  { iso: 'AU', name: 'Australia', dial: '+61' },
  { iso: 'NZ', name: 'New Zealand', dial: '+64' },
  { iso: 'US', name: 'United States', dial: '+1' },
  { iso: 'GB', name: 'United Kingdom', dial: '+44' },
  { iso: 'CA', name: 'Canada', dial: '+1' },
  { iso: 'IE', name: 'Ireland', dial: '+353' },
  { iso: 'IN', name: 'India', dial: '+91' },
  { iso: 'SG', name: 'Singapore', dial: '+65' },
  { iso: 'MY', name: 'Malaysia', dial: '+60' },
  { iso: 'PH', name: 'Philippines', dial: '+63' },
  { iso: 'ID', name: 'Indonesia', dial: '+62' },
  { iso: 'JP', name: 'Japan', dial: '+81' },
  { iso: 'CN', name: 'China', dial: '+86' },
  { iso: 'HK', name: 'Hong Kong', dial: '+852' },
  { iso: 'KR', name: 'South Korea', dial: '+82' },
  { iso: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { iso: 'SA', name: 'Saudi Arabia', dial: '+966' },
  { iso: 'ZA', name: 'South Africa', dial: '+27' },
  { iso: 'DE', name: 'Germany', dial: '+49' },
  { iso: 'FR', name: 'France', dial: '+33' },
  { iso: 'ES', name: 'Spain', dial: '+34' },
  { iso: 'IT', name: 'Italy', dial: '+39' },
  { iso: 'NL', name: 'Netherlands', dial: '+31' },
  { iso: 'BE', name: 'Belgium', dial: '+32' },
  { iso: 'SE', name: 'Sweden', dial: '+46' },
  { iso: 'NO', name: 'Norway', dial: '+47' },
  { iso: 'DK', name: 'Denmark', dial: '+45' },
  { iso: 'FI', name: 'Finland', dial: '+358' },
  { iso: 'CH', name: 'Switzerland', dial: '+41' },
  { iso: 'AT', name: 'Austria', dial: '+43' },
  { iso: 'PT', name: 'Portugal', dial: '+351' },
  { iso: 'PL', name: 'Poland', dial: '+48' },
  { iso: 'BR', name: 'Brazil', dial: '+55' },
  { iso: 'MX', name: 'Mexico', dial: '+52' },
  { iso: 'AR', name: 'Argentina', dial: '+54' },
];

const DEFAULT_ISO = 'AU';

/** Longest-dial-prefix match so "+61…" resolves to AU, "+1…" to US, etc. */
function parsePhone(value: string): { country: Country; national: string } {
  const v = (value ?? '').trim();
  if (v.startsWith('+')) {
    const match = [...COUNTRIES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => v.startsWith(c.dial));
    if (match)
      return { country: match, national: v.slice(match.dial.length).trim() };
  }
  const def = COUNTRIES.find((c) => c.iso === DEFAULT_ISO)!;
  return { country: def, national: v };
}

/**
 * Phone field with a searchable country-code selector. Emits the combined
 * "+<dial> <national>" string (empty string when no number is entered, so an
 * optional phone stays unset). House style: a single bordered row matching
 * Input height, country segment on the left with flag + dial code.
 */
export function PhoneInput({
  value,
  onChange,
  placeholder = '412 345 678',
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}) {
  const parsed = useMemo(() => parsePhone(value), [value]);
  const [country, setCountry] = useState<Country>(parsed.country);
  const [national, setNational] = useState(parsed.national);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Keep internal state in sync when the parent value changes externally (e.g.
  // edit-mode hydration). Compare against the value we'd emit to avoid loops.
  useEffect(() => {
    const emitted = national.trim() ? `${country.dial} ${national.trim()}` : '';
    if ((value ?? '') !== emitted) {
      setCountry(parsed.country);
      setNational(parsed.national);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const emit = (c: Country, n: string) =>
    onChange(n.trim() ? `${c.dial} ${n.trim()}` : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="relative">
      <div className="flex h-10 w-full items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card focus-within:outline-none focus-within:ring-2 focus-within:ring-[color:var(--color-accent-ring)]">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="press flex h-full items-center gap-1.5 rounded-l-[var(--radius-sm)] border-r border-[color:var(--color-border-default)] px-2.5 text-sm text-ink-80 hover:bg-inset"
        >
          <span className="text-base leading-none">{flagOf(country.iso)}</span>
          <span className="font-medium tabular-nums">{country.dial}</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 text-ink-40 transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          value={national}
          placeholder={placeholder}
          onChange={(e) => {
            const n = e.target.value;
            setNational(n);
            emit(country, n);
          }}
          className="h-full flex-1 rounded-r-[var(--radius-sm)] bg-transparent px-3 text-sm outline-none placeholder:text-ink-40"
        />
      </div>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setQuery('');
            }}
          />
          <div className="absolute left-0 top-[calc(100%+4px)] z-50 w-72 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card shadow-2 animate-reveal">
            <div className="relative border-b border-[color:var(--color-border-hairline)] p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search countries…"
                className="h-9 w-full rounded-[var(--radius-sm)] bg-inset/60 pl-9 pr-3 text-sm outline-none placeholder:text-ink-40"
              />
            </div>
            <ul className="max-h-60 overflow-y-auto p-1">
              {filtered.map((c) => (
                <li key={c.iso}>
                  <button
                    type="button"
                    onClick={() => {
                      setCountry(c);
                      emit(c, national);
                      setOpen(false);
                      setQuery('');
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 text-left text-sm transition-colors hover:bg-inset',
                      c.iso === country.iso ? 'text-ink-100' : 'text-ink-80',
                    )}
                  >
                    <span className="text-base leading-none">
                      {flagOf(c.iso)}
                    </span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="font-mono text-xs text-ink-40">
                      {c.dial}
                    </span>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-2.5 py-6 text-center text-sm text-ink-40">
                  No matches
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
