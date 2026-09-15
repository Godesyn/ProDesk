import { type ReactNode } from 'react';

/**
 * Section header used inside the service form (ports Flutter
 * `ServiceFormSectionHeader` / `buildSectionHeader`). Matches the bold heading
 * used across add_service_dialog.
 */
export function SectionHeader({ title, required, subtitle }: { title: string; required?: boolean; subtitle?: ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold text-ink-100">
        {title}
        {required && <span className="text-danger"> *</span>}
      </h3>
      {subtitle && <p className="mt-1 text-[13px] italic text-ink-40">{subtitle}</p>}
    </div>
  );
}

/** Bold input label with optional required asterisk (ports `buildInputLabel`). */
export function InputLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-sm font-medium text-ink-80">
      {label}
      {required && <span className="text-danger"> *</span>}
    </span>
  );
}

/** A boxed white card wrapper used by the pricing / task / commission sections. */
export function BoxedSection({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-6">
      {children}
    </div>
  );
}

/** Money input with a `$` prefix and optional suffix unit. */
export function MoneyInput({
  value,
  onChange,
  suffix,
  placeholder = '0',
  id,
  signed = false,
}: {
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  placeholder?: string;
  id?: string;
  /** Allow negative values (used for variant/addon price differences). */
  signed?: boolean;
}) {
  return (
    <div className="flex h-10 items-center rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-[color:var(--color-accent-ring)]">
      <span className="mr-1 text-ink-40">$</span>
      <input
        id={id}
        type="number"
        min={signed ? undefined : '0'}
        step="0.01"
        className="h-full flex-1 bg-transparent outline-none placeholder:text-ink-40"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {suffix && <span className="ml-1 text-xs text-ink-40">{suffix}</span>}
    </div>
  );
}
