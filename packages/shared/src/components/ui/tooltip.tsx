import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lightweight, dependency-free tooltip that appears **immediately** on hover
 * (no browser `title` delay). Rendered into a body-level portal with
 * `position: fixed`, so it is never clipped by an ancestor's `overflow: hidden`
 * (e.g. the collapsed sidebar rail).
 *
 * Pass an empty `label` to render the trigger alone (handy for gating inline,
 * e.g. only-when-collapsed).
 */
export function Tooltip({
  label,
  side = 'right',
  children,
}: {
  label?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  if (!label) return <>{children}</>;

  const show = () => {
    const el = triggerRef.current?.firstElementChild ?? triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    switch (side) {
      case 'right': setPos({ top: r.top + r.height / 2, left: r.right + gap }); break;
      case 'left': setPos({ top: r.top + r.height / 2, left: r.left - gap }); break;
      case 'top': setPos({ top: r.top - gap, left: r.left + r.width / 2 }); break;
      case 'bottom': setPos({ top: r.bottom + gap, left: r.left + r.width / 2 }); break;
    }
  };
  const hide = () => setPos(null);

  // Translate so the tooltip aligns to the trigger edge regardless of its size.
  const transform =
    side === 'right' ? 'translate(0, -50%)'
    : side === 'left' ? 'translate(-100%, -50%)'
    : side === 'top' ? 'translate(-50%, -100%)'
    : 'translate(-50%, 0)';

  return (
    <span
      ref={triggerRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="contents"
    >
      {children}
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ position: 'fixed', top: pos.top, left: pos.left, transform }}
            className="pointer-events-none z-[60] whitespace-nowrap rounded-[var(--radius-sm)] bg-ink-100 px-2 py-1 text-ui-xs text-white shadow-lg"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
