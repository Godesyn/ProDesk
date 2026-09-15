import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Lightweight popover — a trigger plus an anchored panel that hosts arbitrary
 * content (unlike DropdownMenu, which is built for menu items and fights text
 * inputs). Closes on outside-click and Escape. No external dependency; the panel
 * is anchored to the trigger via a relatively-positioned wrapper, so use it for
 * top-bar controls where `align="end"` keeps it inside the viewport.
 */
export function Popover({
  trigger,
  children,
  align = 'end',
  className,
  style,
}: {
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div
          className={cn(
            'absolute z-50 mt-2 min-w-[16rem] rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] p-3 shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
            className,
          )}
          style={{
            backgroundColor: 'rgba(255, 255, 255, 0.65)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            ...style,
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
