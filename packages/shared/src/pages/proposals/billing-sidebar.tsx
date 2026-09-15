import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import {
  computePayInFull,
  computePaymentPlan,
  computePaymentSchedule,
  type BillingItem,
  type PaymentPlan,
  type PaymentSchedule,
  type SchedulePhase,
  type ScheduleSegment,
  type Subtotals,
} from './billing';
import { BillingMiniCard, BillingRow } from './ui';

interface Props {
  brandName?: string | null;
  itemCount: number;
  validityDays?: number | null;
  subtotals: Subtotals;
  isBrandView: boolean;
  /** Plan persisted on the proposal (seeds the initial selection). null/undefined = pay in full. */
  initialPlan?: PaymentPlan | null;
  /** Selected plan index (-1 = pay in full). */
  onPlanChange?: (plan: PaymentPlan | null) => void;
  /** Line items + phases — when provided, a phase-aware payment schedule is shown. */
  items?: BillingItem[];
  phases?: SchedulePhase[];
  /** Drop brand-excluded items from the schedule (brand-review / public views). */
  excludeBrandExcluded?: boolean;
  /**
   * Whether the viewing agency owns the services it's selling (a self-sent
   * proposal). True → it keeps agency + sales + affiliate (≈87%, only the platform
   * fee is deducted). False → a sales agency reselling another agency's services,
   * which earns only the sales cut. See docs/commissions.md. Defaults to true.
   * Used as the fallback when per-item agency info isn't available.
   */
  sellingOwnServices?: boolean;
  /** Sales (inter-agency) proposal: items can mix own + resold services. */
  salesMode?: boolean;
  /** The building agency — items tagged with another agency are resold (sales cut only). */
  ownAgencyId?: string | null;
}

/**
 * Billing summary sidebar — mirrors `ProposalBillingSidebar`: overview, one-off
 * + recurring breakdown, payment-plan chips with selected breakdown, and
 * (agency view) an agency-earnings summary.
 */
export function BillingSidebar(props: Props) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.proposals.billingSettings.queryOptions());
  const plans = ((settings.data?.defaultPaymentPlans ?? []) as PaymentPlan[]).filter((p) => p.isActive !== false);
  const [selectedPlan, setSelectedPlan] = useState(-1);

  // Seed the selection from the plan stored on the proposal (once plans load),
  // unless the user has already picked one this session.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || !props.initialPlan || plans.length === 0) return;
    const idx = plans.findIndex(
      (p) => (props.initialPlan!.id && p.id === props.initialPlan!.id) || p.name === props.initialPlan!.name,
    );
    if (idx >= 0) setSelectedPlan(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data, props.initialPlan]);

  const oneOff = props.subtotals.oneOffSubtotal;
  const recurUpfront = props.subtotals.recurringUpfrontTotal;
  const recurWeekly = props.subtotals.recurringWeeklyTotal;
  const hasRecurring = recurUpfront > 0 || recurWeekly > 0;
  const hasItems = props.itemCount > 0;

  const selectedPlanObj = selectedPlan === -1 ? null : plans[selectedPlan] ?? null;
  const breakdown =
    selectedPlanObj === null
      ? computePayInFull(oneOff, recurUpfront, recurWeekly)
      : computePaymentPlan(oneOff, recurUpfront, recurWeekly, selectedPlanObj);

  // Phase-aware schedule (only when the caller passes the line items). Recomputes
  // on plan change so the timeline reflects the selected instalment plan.
  const schedule = props.items
    ? computePaymentSchedule(props.items, props.phases ?? [], selectedPlanObj, props.excludeBrandExcluded)
    : null;

  const onSelect = (idx: number) => {
    touched.current = true;
    setSelectedPlan(idx);
    props.onPlanChange?.(idx === -1 ? null : plans[idx]);
  };

  // Agency's share of each service (see docs/commissions.md), shown as a PERCENTAGE
  // only (never a dollar figure):
  //  • its OWN services → it keeps the agency rate + the freed sales + freed
  //    affiliate cuts = 100% − prodesk (≈87%); only the platform fee is deducted.
  //  • another agency's services it's reselling → only the sales cut (≈30%).
  // A sales proposal can mix both, so we surface whichever shares actually apply.
  const agencyCommission = Number(settings.data?.agencyCommission ?? 0);
  const salesAgencyCommission = Number(settings.data?.salesAgencyCommission ?? 0);
  const affiliateCommission = Number(settings.data?.affiliateCommission ?? 0);
  const ownPct = agencyCommission + salesAgencyCommission + affiliateCommission;
  const resoldPct = salesAgencyCommission;

  // Classify the line items into own vs resold. With per-item agency info we split
  // exactly; otherwise we fall back to the proposal-level sellingOwnServices flag.
  const earningItems = (props.items ?? []).filter((i) => i.type !== 'heading');
  const isResold = (i: BillingItem) => !!props.salesMode && !!i.agencyId && i.agencyId !== props.ownAgencyId;
  const hasResold = props.items ? earningItems.some(isResold) : props.sellingOwnServices === false;
  const hasOwn = props.items ? earningItems.some((i) => !isResold(i)) : props.sellingOwnServices !== false;
  const showEarnings = !props.isBrandView && hasItems && (hasOwn || hasResold);

  return (
    <div className="space-y-3">
      <h3 className="text-[15px] font-bold text-ink-100">Billing Summary</h3>

      <BillingMiniCard>
        <BillingRow label="Client" value={props.brandName ?? '—'} />
        <BillingRow label="Items" value={String(props.itemCount)} />
        <BillingRow label="Valid for" value={`${props.validityDays ?? 30} days`} />
      </BillingMiniCard>

      <BillingMiniCard label="One-off items" dimmed={oneOff === 0}>
        <BillingRow label="Subtotal" value={formatCurrency(oneOff)} strong />
      </BillingMiniCard>

      {hasRecurring && (
        <BillingMiniCard label="Recurring">
          {recurUpfront > 0 && <BillingRow label="Setup (once)" value={formatCurrency(recurUpfront)} />}
          {recurWeekly > 0 && <BillingRow label="Weekly" value={formatCurrency(recurWeekly)} />}
        </BillingMiniCard>
      )}

      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-60">Payment Options</div>
        <div className="flex flex-wrap gap-1.5">
          <PlanChip label="Pay in Full" active={selectedPlan === -1} onClick={() => onSelect(-1)} />
          {plans.map((p, i) => (
            <PlanChip key={i} label={p.name ?? `Plan ${i + 1}`} active={selectedPlan === i} onClick={() => onSelect(i)} />
          ))}
        </div>
      </div>

      {hasItems &&
        (schedule ? (
          <PaymentScheduleCard schedule={schedule} planLabel={breakdown.planLabel} />
        ) : (
          <BillingMiniCard label={breakdown.planLabel}>
            <BillingRow label="Upfront" value={formatCurrency(breakdown.upfront)} strong />
            {breakdown.weeklyDuring > 0 && (
              <BillingRow
                label={breakdown.durationWeeks ? `Weekly × ${breakdown.durationWeeks}` : 'Weekly'}
                value={formatCurrency(breakdown.weeklyDuring)}
              />
            )}
            {breakdown.weeklyAfter > 0 && <BillingRow label="Weekly after" value={formatCurrency(breakdown.weeklyAfter)} />}
          </BillingMiniCard>
        ))}

      {showEarnings && (
        <BillingMiniCard label="Agency earnings">
          {/* Percentage shares only — never a dollar amount. */}
          {hasOwn && <BillingRow label="Your share · your services" value={`${ownPct}%`} strong />}
          {hasResold && <BillingRow label="Your share · other agencies'" value={`${resoldPct}%`} strong />}
          <p className="mt-1 text-[11px] leading-snug text-ink-40">
            {hasOwn && hasResold
              ? `You keep ${ownPct}% on your own services and the ${resoldPct}% sales cut on services you're reselling for other agencies.`
              : hasOwn
                ? `Your share of your own services — only the ${Math.max(0, 100 - ownPct)}% platform fee is deducted (no sales or affiliate cut on your own services).`
                : `Sales commission for reselling other agencies' services.`}
          </p>
        </BillingMiniCard>
      )}
    </div>
  );
}

/** Human label for a schedule run, e.g. "Week 3", "Weeks 1–14", "Week 15 onward". */
function weekRangeLabel(seg: ScheduleSegment): string {
  if (seg.toWeek === null) return `Week ${seg.fromWeek} onward`;
  if (seg.toWeek === seg.fromWeek) return `Week ${seg.fromWeek}`;
  return `Weeks ${seg.fromWeek}–${seg.toWeek}`;
}

/**
 * Phase-aware payment timeline: what's due today, then the weekly amount over
 * time as instalments end and delayed phases switch on. Each delayed phase's
 * recurring billing begins one week after it starts (the first week is covered by
 * the setup fee paid today), shown as an annotation on that week's row.
 */
function PaymentScheduleCard({ schedule, planLabel }: { schedule: PaymentSchedule; planLabel: string }) {
  const startsByWeek = new Map<number, string[]>();
  for (const s of schedule.phaseStarts) {
    const list = startsByWeek.get(s.week) ?? [];
    list.push(s.label);
    startsByWeek.set(s.week, list);
  }

  return (
    <BillingMiniCard label={planLabel}>
      {/* Due today */}
      <div className="flex items-center justify-between py-0.5 text-sm">
        <span className="font-semibold text-ink-100">Due today</span>
        <span className="tabular-nums font-semibold text-ink-100">{formatCurrency(schedule.dueToday)}</span>
      </div>
      {schedule.dueTodayParts.length > 1 &&
        schedule.dueTodayParts.map((part, i) => (
          <div key={i} className="flex items-center justify-between py-0.5 pl-3 text-xs text-ink-60">
            <span>{part.label}</span>
            <span className="tabular-nums">{formatCurrency(part.amount)}</span>
          </div>
        ))}

      {/* Weekly timeline */}
      {schedule.hasWeekly && (
        <>
          <div className="my-2 h-px bg-[color:var(--color-border-hairline)]" />
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-40">Then weekly</div>
          <ol className="space-y-1.5">
            {schedule.segments.map((seg, i) => {
              const starts = startsByWeek.get(seg.fromWeek);
              return (
                <li key={i}>
                  {starts && (
                    <div className="flex items-center gap-1 text-[11px] font-medium text-accent">
                      <span aria-hidden>↳</span>
                      <span>{starts.join(' & ')} subscription starts</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-60">{weekRangeLabel(seg)}</span>
                    <span className="tabular-nums text-ink-80">{formatCurrency(seg.weekly)} <span className="text-ink-40">/wk</span></span>
                  </div>
                </li>
              );
            })}
          </ol>
          {schedule.hasDelayedPhase && (
            <p className="mt-2 text-[11px] leading-snug text-ink-40">
              A delayed phase&apos;s weekly billing begins 7 days after it starts — its first week is covered by the setup fee paid today.
            </p>
          )}
        </>
      )}
    </BillingMiniCard>
  );
}

function PlanChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="sm" variant={active ? 'accent' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  );
}
