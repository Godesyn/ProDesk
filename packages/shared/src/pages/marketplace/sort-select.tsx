/** Marketplace sort control — mirrors the `_sortBy` dropdown on the Flutter
 * agency-services screen. Keys match `marketplace.browse`'s `sort` enum. */
export type SortKey = 'custom' | 'priceAsc' | 'priceDesc' | 'name' | 'newest';

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'custom', label: 'Recommended' },
  { value: 'priceAsc', label: 'Price: low to high' },
  { value: 'priceDesc', label: 'Price: high to low' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'newest', label: 'Newest' },
];

export function SortSelect({ value, onChange }: { value: SortKey; onChange: (v: SortKey) => void }) {
  return (
    <select
      aria-label="Sort services"
      className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-2.5 py-2 text-sm text-ink-80"
      value={value}
      onChange={(e) => onChange(e.target.value as SortKey)}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
