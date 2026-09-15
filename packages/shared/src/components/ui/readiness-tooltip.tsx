import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, X } from 'lucide-react';
import { formatDate } from '../../lib/utils';

/**
 * The three disbursement-readiness checkpoints, mirroring Flutter
 * `_PayoutStatusCell` (earnings_payout_tile.dart). Surfaced both on payout
 * status badges (earnings) and invoice status badges (the invoice's connected
 * payout), so the payee can see exactly what gates disbursement.
 */
export interface PayoutReadiness {
  bankAccountLinked?: boolean;
  payoutDateReached?: boolean;
  projectCompleted?: boolean;
  toPayAt?: string | Date | null;
  /** False = no breakdown items → can never dispatch (shown as "Stopped"). */
  hasBreakdowns?: boolean;
}

/** A single ✓/✗ checkpoint line. */
function Checkpoint({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap">
      {ok ? <Check className="h-3.5 w-3.5 text-success" /> : <X className="h-3.5 w-3.5 text-danger" />}
      <span>{label}</span>
    </div>
  );
}

interface Anchor {
  right: number;
  top?: number;
  bottom?: number;
}

/**
 * Hover tooltip listing the readiness checkpoints. Wraps its trigger (the status
 * badge) as `children` and renders the panel in a PORTAL on `document.body`, so it
 * is never clipped by an ancestor's `overflow` — most importantly the table
 * wrapper's `overflow-x-auto`, which (per CSS) also clips vertically and was
 * cutting the tooltip off at the table's bottom edge. Positioned with `fixed`
 * coordinates relative to the trigger, flipping above when there isn't room below.
 */
export function ReadinessTooltip({
  readiness,
  children,
}: {
  readiness: PayoutReadiness;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // ~100px covers the 3-line panel + padding; flip above when it would overflow.
    const below = r.bottom + 100 < window.innerHeight;
    setAnchor({
      right: Math.max(8, window.innerWidth - r.right),
      ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
    });
  }
  const hide = () => setAnchor(null);

  return (
    <span
      ref={ref}
      className="relative inline-flex cursor-help"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      {children}
      {anchor &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[60] w-max rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2.5 text-xs text-ink-80 shadow-lg"
            style={{ right: anchor.right, top: anchor.top, bottom: anchor.bottom }}
          >
            {readiness.hasBreakdowns === false && (
              <Checkpoint ok={false} label="No payment items — will never dispatch" />
            )}
            <Checkpoint ok={!!readiness.bankAccountLinked} label="Bank account linked" />
            <Checkpoint ok={!!readiness.payoutDateReached} label={`Payout date reached (${formatDate(readiness.toPayAt)})`} />
            <Checkpoint ok={!!readiness.projectCompleted} label="Respective project completed" />
          </div>,
          document.body,
        )}
    </span>
  );
}
