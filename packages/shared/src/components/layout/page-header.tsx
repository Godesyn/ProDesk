import type { ReactNode } from 'react';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 md:mb-6 md:items-start md:gap-4">
      {/* The page title stays visible on mobile (compact 18px) so every screen
          is self-identifying and the action row has an anchor — without it the
          primary button floats alone over empty space. The decorative subtitle
          is still mobile-hidden.

          On mobile the title keeps a 7rem floor (md:min-w-0 lifts it on desktop):
          a single action stays beside it, but wide / multiple actions wrap to
          their own row below rather than crushing the title to an ellipsis. */}
      <div className="min-w-[7rem] flex-1 md:min-w-0">
        <h1 className="truncate text-lg font-semibold text-ink-100 md:text-section-title">{title}</h1>
        {description && <p className="text-eyebrow mt-1.5 hidden text-ink-60 md:block">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">{action}</div>}
    </div>
  );
}
