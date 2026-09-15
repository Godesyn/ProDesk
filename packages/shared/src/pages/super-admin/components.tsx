import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Card } from '../../components/ui/card';
import { Input } from '../../components/ui/input';

/**
 * Small pill toggle used by the agency-management actions and payment-plan
 * editor (mirrors Flutter `_buildToggleAction` switch chips). Built locally
 * since there is no shared Switch primitive.
 */
export function PillToggle({
  label,
  checked,
  onChange,
  activeClass = 'text-accent',
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  activeClass?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'press inline-flex items-center gap-2 rounded-full border border-[color:var(--color-border-default)] bg-card px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50',
        checked ? activeClass : 'text-ink-60',
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative h-4 w-7 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-inset',
        )}
      >
        {/* Knob anchored at the left (left-0.5) and slid right when on. */}
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}

/** Bare on/off switch (no label) for inside cards. */
export function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'press relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-inset',
      )}
      aria-pressed={checked}
    >
      <span className={cn('absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
    </button>
  );
}

/** Stat summary card (Total / Verified / Pending). */
export function StatCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'success' | 'warn' }) {
  const toneClass = tone === 'success' ? 'text-success' : tone === 'warn' ? 'text-warn' : 'text-ink-100';
  return (
    <Card className="flex-1 p-5">
      <p className="text-sm text-ink-60">{label}</p>
      <p className={cn('mt-1 text-h3 font-semibold', toneClass)}>{value}</p>
    </Card>
  );
}

export function SearchBar({ value, onChange, placeholder = 'Search…' }: { value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative mb-4 max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
      <Input className="pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Bordered section card with an icon header (Flutter commission/payment cards). */
export function SectionCard({ icon, title, description, action, children }: { icon: ReactNode; title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-4 md:p-6">
      {/* flex-wrap so a multi-button action drops below the title on a phone
          (it was overflowing the viewport on narrow screens). */}
      <div className="flex flex-wrap items-start gap-3 md:gap-4">
        <div className="rounded-[var(--radius-sm)] bg-inset p-3 text-accent">{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink-100">{title}</h2>
          {description && <p className="text-sm text-ink-60">{description}</p>}
        </div>
        {action && <div className="w-full md:w-auto">{action}</div>}
      </div>
      <div className="mt-6">{children}</div>
    </Card>
  );
}
