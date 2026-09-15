import * as React from 'react';
import { cn } from '../../lib/utils';

/** Lightweight textarea matching the design-system input styling. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-transparent px-3 py-2 text-sm text-ink-100 placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

/** Compact label/value billing row used in the sidebar mini-cards. */
export function BillingRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-ink-60">{label}</span>
      <span className={cn('tabular-nums', strong ? 'font-semibold text-ink-100' : 'text-ink-80')}>{value}</span>
    </div>
  );
}

export function BillingMiniCard({ label, dimmed, children }: { label?: string; dimmed?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-inset/40 p-3', dimmed && 'opacity-50')}>
      {label && <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-40">{label}</div>}
      {children}
    </div>
  );
}
