import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { formatCurrency, formatDate, initialsOf } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Tooltip } from '../../components/ui/tooltip';
import { ReadinessTooltip } from '../../components/ui/readiness-tooltip';
import { isStoppedStatus, statusMeta } from './payout-status';
import type { Beneficiary } from './user-filter-dialog';

/** Statuses where the disbursement is still pending — show the readiness tooltip. */
const UNPAID_STATUSES = new Set(['upcoming', 'pending']);

export interface Breakdown {
  id: string;
  brandId?: string | null;
  sourceServiceName?: string | null;
  commissionType?: string | null;
  week?: number | null;
  amount: string | number;
  gst?: string | number | null;
  metadata?: Record<string, unknown> | null;
  project?: { taskTitle?: string | null; title?: string | null; serviceName?: string | null } | null;
}

export interface PayoutRow {
  id: string;
  amount: string | number;
  currency: string;
  status: string;
  /** Set when the beneficiary is a USER; null when the beneficiary is an agency. */
  beneficiaryId: string | null;
  /** Set when the AGENCY itself receives this payout (its own bank account). */
  beneficiaryAgencyId?: string | null;
  sourceBrandName?: string | null;
  // Role-aware party chips (payouts.withPayoutParties). The buyer brand + the source
  // agency, so an agency viewer sees the brand and the super-admin sees both.
  sourceBrand?: { id: string; name: string; logoUrl?: string | null } | null;
  sourceAgency?: { id: string; name: string; logoUrl?: string | null } | null;
  beneficiaryAgency?: { id: string; name: string; logoUrl?: string | null } | null;
  /** Resolved user beneficiary (payouts.forProject) — payee chip without a separate lookup. */
  beneficiaryUser?: { id: string; firstName?: string | null; lastName?: string | null; email: string; profileUrl?: string | null } | null;
  createdAt?: string | Date | null;
  toPayAt?: string | Date | null;
  breakdown?: Breakdown[];
  // Disbursement-readiness checkpoints (see payouts.enrichReadiness).
  bankAccountLinked?: boolean;
  payoutDateReached?: boolean;
  projectCompleted?: boolean;
  hasBreakdowns?: boolean;
  // Wise two-leg funding sub-state — drives the money-flow badge text.
  wiseFunding?: { status?: string | null } | null;
}

const bdName = (b: Breakdown) => {
  if (b.project) return b.project.taskTitle ?? b.project.title ?? b.project.serviceName ?? '—';
  return (b.metadata?.taskTitle as string | undefined) ?? (b.metadata?.brandName as string | undefined) ?? '—';
};
const bdService = (b: Breakdown) =>
  (b.metadata?.serviceName as string | undefined) ?? b.sourceServiceName ?? '—';
// AU tax-invoice split (parity with the invoice totals): the breakdown amount is
// GST-inclusive, so Take is 90% of it and GST is the remaining 10%.
const take = (b: Breakdown) => Number(b.amount || 0) * 0.9;
const gstOf = (b: Breakdown) => Number(b.amount || 0) * 0.1;

/** Human label for a breakdown's commissionType (the "Payment reason" column). */
const REASON_LABEL: Record<string, string> = {
  prodeskCommission: 'Platform',
  affiliateCommission: 'Affiliate',
  agencySalesCommission: 'Sales agency',
  agencyOwnerCommission: 'Agency',
  salesPersonCommission: 'Sales',
  productionManagerCommission: 'Production manager',
  briefingManagerCommission: 'Briefing manager',
  internalApprovalCommission: 'Approval manager',
  contractorCommission: 'Contractor',
};
const reasonLabel = (commissionType?: string | null) =>
  (commissionType && REASON_LABEL[commissionType]) || commissionType || '—';

/**
 * Commission breakdown table — Brand / Service / Payment reason / Week / Take /
 * GST. Shared by the earnings payout tile (expanded) and the super-admin payouts
 * table (expanded row) so both read identically.
 */
export function PayoutBreakdownTable({ breakdown, currency }: { breakdown: Breakdown[]; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-inset text-ink-60">
            <th className="px-2 py-1.5 text-left font-semibold">Task title</th>
            <th className="px-2 py-1.5 text-left font-semibold">Service name</th>
            <th className="px-2 py-1.5 text-left font-semibold">Payment reason</th>
            <th className="px-2 py-1.5 text-right font-semibold">Week</th>
            <th className="px-2 py-1.5 text-right font-semibold">Take</th>
            <th className="px-2 py-1.5 text-right font-semibold">GST</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((b) => (
            <tr key={b.id} className="border-t border-[color:var(--color-border-hairline)]">
              <td className="px-2 py-1.5 text-ink-80">{bdName(b)}</td>
              <td className="px-2 py-1.5 text-ink-80">{bdService(b)}</td>
              <td className="px-2 py-1.5 text-ink-80">{reasonLabel(b.commissionType)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-80">{Math.max(b.week ?? 1, 1)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-ink-100">{formatCurrency(take(b), currency)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-ink-60">{formatCurrency(gstOf(b), currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Single payout row — ports `_PayoutTile`. Status icon chip, service names,
 * beneficiary chip (avatar + name, email on hover — shown when viewing others),
 * created date + "Expected to be paid at" badge, amount, status badge, and an
 * expandable breakdown table (Brand / Service / Payment reason / Week / Take / GST).
 */
export function PayoutTile({ payout, viewerId, viewerAgencyId, beneficiary }: { payout: PayoutRow; viewerId?: string; viewerAgencyId?: string; beneficiary?: Beneficiary }) {
  const [expanded, setExpanded] = useState(false);
  const breakdown = payout.breakdown ?? [];
  const hasBreakdown = breakdown.length > 0;
  const stopped = isStoppedStatus(payout);
  const meta = statusMeta(stopped ? 'stopped' : payout.status);
  const Icon = meta.icon;
  // Incoming = the payout is paid to the viewer (their user account) or, for an
  // agency-received payout, to the agency the viewer is currently acting as.
  const incoming =
    (!!payout.beneficiaryId && viewerId === payout.beneficiaryId) ||
    (!!payout.beneficiaryAgencyId && !!viewerAgencyId && viewerAgencyId === payout.beneficiaryAgencyId);
  const serviceNames = breakdown.map(bdService).filter((s) => s && s !== '—').join(', ') || payout.sourceBrandName || '—';
  const beneficiaryName = beneficiary
    ? [beneficiary.firstName, beneficiary.lastName].filter(Boolean).join(' ') || beneficiary.email
    : '';

  return (
    <div
      className={`rounded-[var(--radius-md)] border bg-card transition-colors ${expanded ? 'border-accent/40' : 'border-[color:var(--color-border-default)]'} ${hasBreakdown ? 'cursor-pointer' : ''}`}
      onClick={() => hasBreakdown && setExpanded((e) => !e)}
    >
      <div className="flex items-start gap-3 p-3 md:gap-4 md:p-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-inset md:h-10 md:w-10">
          <Icon className={`h-4 w-4 md:h-5 md:w-5 ${meta.iconClass}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink-100">{serviceNames}</span>
            {payout.sourceBrand && (
              // The buyer brand (logo + name) — context for agency/admin viewers.
              <span className="inline-flex items-center gap-1.5 rounded-full bg-inset py-0.5 pl-0.5 pr-2">
                <Avatar className="h-5 w-5 rounded-[var(--radius-sm)]">
                  {payout.sourceBrand.logoUrl && <AvatarImage src={payout.sourceBrand.logoUrl} />}
                  <AvatarFallback className="rounded-[var(--radius-sm)] text-[9px]">{initialsOf(payout.sourceBrand.name)}</AvatarFallback>
                </Avatar>
                <span className="text-[11px] font-semibold text-ink-80">{payout.sourceBrand.name}</span>
              </span>
            )}
            {!incoming && beneficiary && (
              // Avatar + name with the email on hover — disambiguates payees who share a name.
              <Tooltip label={beneficiary.email} side="bottom">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 py-0.5 pl-0.5 pr-2">
                  <Avatar className="h-5 w-5">
                    {beneficiary.profileUrl && <AvatarImage src={beneficiary.profileUrl} />}
                    <AvatarFallback className="text-[9px]">{initialsOf(beneficiaryName)}</AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] font-semibold text-ink-100">{beneficiaryName}</span>
                </span>
              </Tooltip>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-40">{formatDate(payout.createdAt)}</span>
            <span className="rounded-[4px] bg-inset px-2 py-0.5 text-[11px] font-semibold text-ink-100">
              Expected to be paid at {formatDate(payout.toPayAt)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-bold tabular-nums text-ink-100 md:text-base">{formatCurrency(payout.amount, payout.currency)}</span>
          <div className="flex items-center gap-1">
            {stopped || UNPAID_STATUSES.has(payout.status) ? (
              <ReadinessTooltip readiness={payout}>
                <Badge variant={meta.variant} className="cursor-help">{meta.label(incoming, payout.wiseFunding?.status)}</Badge>
              </ReadinessTooltip>
            ) : (
              <Badge variant={meta.variant}>{meta.label(incoming, payout.wiseFunding?.status)}</Badge>
            )}
            {hasBreakdown && (expanded ? <ChevronUp className="h-3.5 w-3.5 text-ink-40" /> : <ChevronDown className="h-3.5 w-3.5 text-ink-40" />)}
          </div>
        </div>
      </div>

      {expanded && hasBreakdown && (
        <div className="border-t border-[color:var(--color-border-hairline)] p-4">
          <div className="mb-2 text-xs font-semibold text-ink-60">Breakdown</div>
          <PayoutBreakdownTable breakdown={breakdown} currency={payout.currency} />
        </div>
      )}
    </div>
  );
}
