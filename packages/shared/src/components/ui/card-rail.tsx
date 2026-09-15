import type { ReactNode } from 'react';
import { useDragScroll } from '../../hooks/use-drag-scroll';
import { cn } from '../../lib/utils';

/**
 * Horizontal rail for the marketplace / catalog item rows (the fixed-height
 * `layout="rail"` cards). Mirrors the Kanban board's grab-anywhere panning
 * (Flutter `ScrollConfiguration(dragDevices: { mouse, touch, stylus, ... })`):
 * touch / trackpad / stylus already scroll the overflow natively, and this adds
 * mouse click-and-drag panning on top, so the rail is scrollable with every
 * pointer device without reaching for a scrollbar.
 *
 * The cards here are clickable (not dnd-draggable), so unlike the Kanban the
 * grab selector lets you start a pan on a card itself — only real interactive
 * controls (the favourite button, links, inputs) keep their own behaviour.
 */
const RAIL_IGNORE = 'button,a,input,textarea,select';

export function CardRail({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useDragScroll<HTMLDivElement>({ ignore: RAIL_IGNORE });
  return (
    <div ref={ref} className={cn('flex cursor-grab gap-3 overflow-x-auto pb-2', className)}>
      {children}
    </div>
  );
}
