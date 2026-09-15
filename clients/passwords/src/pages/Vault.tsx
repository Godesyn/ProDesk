import { useMemo, useState } from 'react';
import { BRANDS, ITEMS, type Health, type ItemType } from '../data/mock';
import { ItemLedger } from '../components/ItemLedger';
import { PageHead } from '../components/primitives';

/**
 * VAULT — every key, every brand, one dense ledger.
 *
 * Layout: filter rail (220) · ledger (fluid). Filters are multi-select and,
 * in the real build, reflected in the URL so a filtered view is a shareable link.
 */

const TYPES: { id: ItemType; label: string }[] = [
  { id: 'login', label: 'Logins' },
  { id: 'key', label: 'API keys' },
  { id: 'card', label: 'Cards' },
  { id: 'licence', label: 'Licences' },
  { id: 'note', label: 'Notes' },
  { id: 'recovery', label: 'Recovery codes' },
  { id: 'delegation', label: 'Delegated access' },
];

const HEALTHS: { id: Health; label: string }[] = [
  { id: 'strong', label: 'Strong' },
  { id: 'weak', label: 'Weak' },
  { id: 'stale', label: 'Stale' },
  { id: 'breached', label: 'Breached' },
];

function FilterGroup<T extends string>({
  label,
  options,
  active,
  onToggle,
  counts,
}: {
  label: string;
  options: { id: T; label: string }[];
  active: T[];
  onToggle: (id: T) => void;
  counts?: Record<string, number>;
}) {
  return (
    <div className="border-b border-[var(--hair)] pb-4">
      <div className="spec mb-2">{label}</div>
      <div className="flex flex-col gap-0.5">
        {options.map((o) => {
          const on = active.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onToggle(o.id)}
              className="press flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] transition"
              style={{
                background: on ? 'var(--ink)' : 'transparent',
                color: on ? 'var(--stage)' : 'var(--ink-2)',
              }}
            >
              <span className="truncate">{o.label}</span>
              {counts?.[o.id] !== undefined && (
                <span className="num text-[11px] opacity-60">{counts[o.id]}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Vault() {
  const [brands, setBrands] = useState<string[]>([]);
  const [types, setTypes] = useState<ItemType[]>([]);
  const [healths, setHealths] = useState<Health[]>([]);

  const toggle =
    <T,>(set: React.Dispatch<React.SetStateAction<T[]>>) =>
    (id: T) =>
      set((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const items = useMemo(
    () =>
      ITEMS.filter(
        (i) =>
          (brands.length === 0 || brands.includes(i.brandId)) &&
          (types.length === 0 || types.includes(i.type)) &&
          (healths.length === 0 || healths.includes(i.health)),
      ),
    [brands, types, healths],
  );

  const brandCounts = Object.fromEntries(
    BRANDS.map((b) => [b.id, ITEMS.filter((i) => i.brandId === b.id).length]),
  );
  const typeCounts = Object.fromEntries(
    TYPES.map((t) => [t.id, ITEMS.filter((i) => i.type === t.id).length]),
  );

  const filtered = brands.length + types.length + healths.length > 0;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="EVERY KEY YOU CAN REACH"
        title="Vault"
        lede={
          <>
            One list across every brand. Copy without revealing — the clipboard
            clears itself in 45 seconds and the copy is written to the register.
            Hold the aperture only when you genuinely need to read it.
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* ── Filter rail ─────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <FilterGroup
            label="BRAND"
            options={BRANDS.map((b) => ({ id: b.id, label: b.name }))}
            active={brands}
            onToggle={toggle(setBrands)}
            counts={brandCounts}
          />
          <FilterGroup
            label="TYPE"
            options={TYPES}
            active={types}
            onToggle={toggle(setTypes)}
            counts={typeCounts}
          />
          <FilterGroup
            label="HEALTH"
            options={HEALTHS}
            active={healths}
            onToggle={toggle(setHealths)}
          />
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setBrands([]);
                setTypes([]);
                setHealths([]);
              }}
              className="press self-start text-xs font-semibold"
              style={{ color: 'var(--pigment)' }}
            >
              Clear filters
            </button>
          )}
        </aside>

        {/* ── Ledger ──────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between">
            <span className="num text-sm text-[var(--ink-2)]">
              {items.length} {items.length === 1 ? 'key' : 'keys'}
              {filtered && ` of ${ITEMS.length}`}
            </span>
            <span className="spec">SORTED BY LAST OPENED</span>
          </div>
          <ItemLedger items={items} />
        </div>
      </div>
    </div>
  );
}
