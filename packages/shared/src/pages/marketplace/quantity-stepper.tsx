import { Minus, Plus } from 'lucide-react';

/** Small +/- quantity stepper bounded by a minimum (mirrors marketplace_cart_item.dart). */
export function QuantityStepper({
  value,
  min = 1,
  onChange,
}: {
  value: number;
  min?: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)]">
      <button
        type="button"
        className="grid h-8 w-8 place-items-center text-ink-60 disabled:opacity-40 hover:bg-inset"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label="Decrease quantity"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span className="min-w-8 text-center text-sm tabular-nums">{value}</span>
      <button
        type="button"
        className="grid h-8 w-8 place-items-center text-ink-60 hover:bg-inset"
        onClick={() => onChange(value + 1)}
        aria-label="Increase quantity"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
