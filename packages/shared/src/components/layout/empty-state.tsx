import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({ icon: Icon, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-dashed border-[color:var(--color-border-default)] bg-card/60 backdrop-blur-sm p-8 text-center shadow-sm hover:shadow-md transition-all">
      {Icon && (
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/5 text-accent border border-accent/10 shadow-[inset_0_1px_2px_rgba(255,255,255,0.2)]">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-accent/0 via-accent/5 to-accent/20 opacity-60" />
          <Icon className="relative h-6 w-6 stroke-[1.75]" />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="font-semibold text-[15px] leading-tight text-ink-100">{title}</h3>
        {description && <p className="text-xs leading-normal text-ink-50 max-w-sm">{description}</p>}
      </div>
      {action && <div className="mt-1 flex items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
