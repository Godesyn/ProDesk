import {
  Ban,
  CheckCircle2,
  CalendarDays,
  Rocket,
  Hourglass,
  RefreshCw,
  XCircle,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import type { BadgeProps } from '../../components/ui/badge';

/**
 * Full payout status set mirroring Flutter `PayoutStatus` + `_PayoutStatusCell`.
 * Each entry carries the colored icon (status chip) and a badge label/variant.
 * Per-provider processing states and In/Out directionality are preserved.
 */
export interface PayoutStatusMeta {
  icon: LucideIcon;
  /** Tailwind text-color class for the icon chip. */
  iconClass: string;
  variant: BadgeProps['variant'];
  /**
   * Label. `incoming` = beneficiary is the viewer. `wiseFundingStatus` is the
   * `wiseFunding.status` sub-state, used to show the money-flow leg of an
   * in-flight wire payout.
   */
  label: (incoming: boolean, wiseFundingStatus?: string | null) => string;
}

/**
 * Money-flow label for an in-flight wire/Wise payout, derived from its
 * `wiseFunding.status`: our Stripe balance → Wise → the recipient's bank.
 */
function wiseFlowLabel(wiseFundingStatus?: string | null): string {
  switch (wiseFundingStatus) {
    case 'funding':
      return 'Processing (Stripe → Wise)';
    case 'paying_out':
      return 'Processing (Stripe → Bank)';
    case 'funded':
    case 'transferring':
      return 'Processing (Wise → Bank)';
    default:
      return 'Processing (Wire)';
  }
}

export const PAYOUT_STATUS: Record<string, PayoutStatusMeta> = {
  paid: { icon: CheckCircle2, iconClass: 'text-success', variant: 'success', label: () => 'Paid' },
  received: { icon: CheckCircle2, iconClass: 'text-success', variant: 'success', label: () => 'Paid' },
  upcoming: { icon: CalendarDays, iconClass: 'text-ink-40', variant: 'muted', label: (i) => (i ? 'Unpaid (In)' : 'Unpaid (Out)') },
  pending: { icon: Clock, iconClass: 'text-accent', variant: 'accent', label: (i) => (i ? 'Unpaid (In)' : 'Unpaid (Out)') },
  dispatched: { icon: Rocket, iconClass: 'text-accent', variant: 'accent', label: () => 'Dispatched' },
  processing: { icon: Hourglass, iconClass: 'text-warn', variant: 'warn', label: () => 'Processing' },
  processingByStripe: { icon: RefreshCw, iconClass: 'text-accent', variant: 'accent', label: () => 'Proc (Stripe)' },
  processingByPaypal: { icon: RefreshCw, iconClass: 'text-accent', variant: 'accent', label: () => 'Proc (PayPal)' },
  processingByWire: { icon: RefreshCw, iconClass: 'text-accent', variant: 'accent', label: (_i, wf) => wiseFlowLabel(wf) },
  failed: { icon: XCircle, iconClass: 'text-danger', variant: 'danger', label: () => 'Failed' },
  // Both a real DB status (a payout deliberately taken out of circulation) and
  // the derived display state for a payout that can never dispatch because it
  // has no breakdown items (see isStoppedPayout). They render identically.
  stopped: { icon: Ban, iconClass: 'text-ink-40', variant: 'muted', label: () => 'Stopped' },
};

export function statusMeta(status: string): PayoutStatusMeta {
  return PAYOUT_STATUS[status] ?? PAYOUT_STATUS.upcoming;
}

/** Statuses a never-dispatchable payout can be parked in. */
const STOPPABLE = new Set(['upcoming', 'pending', 'failed']);

/** Terminal for display: stored `stopped`, or derived from having no breakdowns. */
export function isStoppedStatus(p: { status: string; hasBreakdowns?: boolean | null }): boolean {
  return p.status === 'stopped' || isStoppedPayout(p);
}

/**
 * A payout with NO breakdown items can never disburse — dispatch pays the sum
 * of eligible items, so its payable is 0 forever and the cron skips it. Rather
 * than showing it as permanently "Unpaid"/"Failed", every status render site
 * shows it as "Stopped". `hasBreakdowns` comes from the server's readiness
 * enrichment; undefined means unknown → not stopped.
 */
export function isStoppedPayout(p: { status: string; hasBreakdowns?: boolean | null }): boolean {
  return p.hasBreakdowns === false && STOPPABLE.has(p.status);
}
