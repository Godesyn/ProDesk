import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Label } from '../../components/ui/label';

/** A labelled field wrapper used across the agency forms. */
export function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor?: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-ink-40">{hint}</span> : null}
    </div>
  );
}

/** A native select styled to match the design system. */
export function Select({ value, onChange, children, id, disabled, className }: { value: string; onChange: (v: string) => void; children: ReactNode; id?: string; disabled?: boolean; className?: string }) {
  return (
    <select
      id={id}
      disabled={disabled}
      className={cn('h-10 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm disabled:opacity-50', className)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}

/** A toggleable pill (used for disciplines / sort / permission chips). */
export function Chip({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-pill)] border px-3 py-1 text-xs transition-colors',
        active ? 'border-transparent bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** A small on/off switch row. */
export function ToggleRow({ label, description, checked, onChange, disabled }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn('flex items-center justify-between gap-4 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-3 py-2.5', disabled && 'opacity-50')}>
      <span className="flex flex-col">
        <span className="text-sm font-medium text-ink-100">{label}</span>
        {description && <span className="text-xs text-ink-40">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-ink-20')}
      >
        <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </label>
  );
}

/** Section divider with a heading inside a dialog/form. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-[color:var(--color-border-default)] pt-4 first:border-t-0 first:pt-0">
      <div>
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
        {description && <p className="text-xs text-ink-40">{description}</p>}
      </div>
      {children}
    </section>
  );
}
