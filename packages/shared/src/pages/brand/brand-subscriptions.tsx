import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import {
  Repeat,
  CalendarClock,
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Hourglass,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { cn, formatCurrency, formatDate, initialsOf } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '../../components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';
import {
  FeatureSubscriptionsSection,
  ExploreFeatureSubscriptions,
} from '../../components/feature-subscriptions/feature-subscriptions-section';

/** A scheduled cancellation that hasn't taken effect yet (still reversible). */
function isCancellationScheduled(sub: { cancelledAt?: string | Date | null }): boolean {
  return !!sub.cancelledAt && new Date(sub.cancelledAt).getTime() > Date.now();
}

/**
 * Brand subscriptions — ports brand_subscriptions_screen.dart +
 * agency_subscriptions_screen.dart + cancel_purchase_dialog.dart. Lists the
 * brand's recurring projects (weekly billing cycle) with a cancel flow that
 * surfaces the cost impact and any minimum-term lock, matching the Flutter
 * CancelSubscriptionDialog.
 *
 * Reused in three places: the brand's own `/subscriptions`, the agency's view of
 * a connected client (client-detail "Subscriptions" tab + `/subscriptions/:id`),
 * and shares the same `billing.brandSubscriptions` server procedure.
 */

function useSubs(brandId: string | undefined, agencyId?: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.billing.brandSubscriptions.queryOptions({
      brandId: brandId!,
      ...(agencyId ? { agencyId } : {}),
    }),
    enabled: !!brandId,
  });
}

type SubData = NonNullable<ReturnType<typeof useSubs>['data']>;
type Sub = SubData['subscriptions'][number];

/* ── Reusable view ─────────────────────────────────────────────────────────── */

export function BrandSubscriptionsView({
  brandId,
  agencyId,
}: {
  brandId: string;
  agencyId?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const input = { brandId, ...(agencyId ? { agencyId } : {}) };
  const q = useSubs(brandId, agencyId);
  const [confirm, setConfirm] = useState<Sub | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({
      queryKey: trpc.billing.brandSubscriptions.queryKey(input),
    });
    qc.invalidateQueries({
      queryKey: trpc.billing.brandSummary.queryKey({ brandId }),
    });
  };

  const cancel = useMutation({
    ...trpc.projects.cancelSubscription.mutationOptions(),
    onSuccess: () => {
      toast.success('Subscription scheduled for cancellation');
      setConfirm(null);
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  const resume = useMutation({
    ...trpc.projects.resumeSubscription.mutationOptions(),
    onSuccess: () => {
      toast.success('Subscription resumed');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  const onResume = async (sub: Sub) => {
    const name = sub.serviceName ?? sub.title ?? 'this service';
    const ok = await askConfirm({
      title: 'Resume this subscription?',
      description: `${name} will stay active and weekly billing will continue as normal. The scheduled cancellation will be cancelled.`,
      confirmLabel: 'Resume subscription',
      cancelLabel: 'Keep cancelling',
    });
    if (ok) resume.mutate({ id: sub.id });
  };

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const data = q.data;
  const subs = data?.subscriptions ?? [];
  if (subs.length === 0) {
    return (
      <EmptyState
        icon={Repeat}
        title="No active subscriptions"
        description="Recurring services billed on a weekly cycle will appear here."
      />
    );
  }

  // The remaining weekly spend once the selected subscription is cancelled.
  const newWeeklyTotal = confirm
    ? Math.max(0, (data?.totalWeekly ?? 0) - confirm.weeklyAmount)
    : 0;

  return (
    <div className="space-y-5">
      {/* Summary banner */}
      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <div>
          <div className="flex items-center gap-2 text-ink-60">
            <Repeat className="h-4 w-4 text-accent" />
            <span className="text-sm">Active subscriptions</span>
          </div>
          <p className="mt-1 text-h3 font-semibold tabular-nums text-ink-100">
            {data?.activeCount ?? 0}
          </p>
        </div>
        <div className="h-10 w-px bg-[color:var(--color-border-hairline)]" />
        <div>
          <div className="flex items-center gap-2 text-ink-60">
            <CalendarClock className="h-4 w-4" />
            <span className="text-sm">Weekly total</span>
          </div>
          <p className="mt-1 text-h3 font-semibold tabular-nums text-accent">
            {formatCurrency(data?.totalWeekly ?? 0)}
            <span className="text-sm font-normal text-ink-40"> /wk</span>
          </p>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {subs.map((s, i) => (
          <SubscriptionCard
            key={s.id}
            sub={s}
            index={i}
            onCancel={() => setConfirm(s)}
            onResume={() => onResume(s)}
            resuming={resume.isPending}
          />
        ))}
      </div>

      <CancelDialog
        sub={confirm}
        newWeeklyTotal={newWeeklyTotal}
        pending={cancel.isPending}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && cancel.mutate({ id: confirm.id })}
      />
    </div>
  );
}

/* ── Subscription card ───────────────────────────────────────────────────────── */

function SubscriptionCard({
  sub,
  index,
  onCancel,
  onResume,
  resuming,
}: {
  sub: Sub;
  index: number;
  onCancel: () => void;
  onResume: () => void;
  resuming: boolean;
}) {
  // A scheduled cancellation (future `cancelledAt`) is still active + billing and
  // can be resumed; only a cancellation whose date has passed is truly ended.
  const scheduled = isCancellationScheduled(sub);
  const ended = !!sub.cancelledAt && !scheduled;
  const cancelled = !!sub.cancelledAt;
  const name = sub.serviceName ?? sub.title ?? 'Subscription';
  return (
    <Card
      className={cn(
        'flex animate-in fade-in slide-in-from-bottom-2 fill-mode-both flex-col gap-3 p-4 transition-shadow hover:shadow-md',
        ended && 'opacity-70',
      )}
      style={{
        animationDelay: `${Math.min(index, 10) * 40}ms`,
        animationDuration: '300ms',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-full',
            ended ? 'bg-inset text-ink-40' : 'bg-accent/12 text-accent',
          )}
        >
          <Repeat className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-100">{name}</p>
          {sub.agencyName && (
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-40">
              <Avatar className="h-4 w-4">
                <AvatarImage src={sub.agencyLogoUrl ?? undefined} />
                <AvatarFallback className="text-[8px]">
                  {initialsOf(sub.agencyName)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{sub.agencyName}</span>
            </div>
          )}
        </div>
        {ended ? (
          <Badge variant="danger">
            <Ban className="mr-1 h-3 w-3" /> Cancelled
          </Badge>
        ) : scheduled ? (
          <Badge variant="warn">
            <CalendarClock className="mr-1 h-3 w-3" /> Cancelling
          </Badge>
        ) : (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" /> Active
          </Badge>
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xl font-semibold tabular-nums text-ink-100">
            {formatCurrency(sub.weeklyAmount)}
            <span className="text-sm font-normal text-ink-40"> /wk</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-40">
            {ended ? (
              <>Cancelled {formatDate(sub.cancelledAt)}</>
            ) : scheduled ? (
              <>Cancels {formatDate(sub.cancelledAt)}</>
            ) : sub.nextCycleAt ? (
              <>
                <CalendarClock className="h-3 w-3" /> Next cycle{' '}
                {formatDate(sub.nextCycleAt)}
              </>
            ) : (
              <>
                {sub.deliverableFrequency
                  ? `Billed ${sub.deliverableFrequency}`
                  : 'Recurring'}
              </>
            )}
          </p>
        </div>
        {scheduled ? (
          <Button
            size="sm"
            variant="accent"
            disabled={resuming}
            onClick={onResume}
          >
            Resume
          </Button>
        ) : (
          !cancelled &&
          sub.cancellable && (
            <Button size="sm" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )
        )}
      </div>

      {!cancelled && !sub.cancellable ? (
        <div className="flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-ink-100/5 px-2.5 py-1.5 text-xs text-ink-60">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {sub.paymentPlan
              ? "This can't be cancelled because it's a payment plan — the agreed installments run until the balance is paid in full."
              : "This subscription type can't be cancelled."}
          </span>
        </div>
      ) : !cancelled && sub.minimumCancellationDate ? (
        <div className="flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-warn/10 px-2.5 py-1.5 text-xs text-warn">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Minimum term until {formatDate(sub.minimumCancellationDate)}.
          </span>
        </div>
      ) : null}
    </Card>
  );
}

/* ── Cancel dialog (ports CancelSubscriptionDialog) ──────────────────────────── */

function CancelDialog({
  sub,
  newWeeklyTotal,
  pending,
  onClose,
  onConfirm,
}: {
  sub: Sub | null;
  newWeeklyTotal: number;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!sub} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-danger" /> Cancel
            subscription?
          </DialogTitle>
        </DialogHeader>
        {sub && (
          <div className="space-y-4">
            <p className="text-sm text-ink-60">
              Are you sure you want to cancel the subscription for{' '}
              <span className="font-medium text-ink-100">
                {sub.serviceName ?? sub.title ?? 'this service'}
              </span>
              ?
            </p>

            {/* Cost impact */}
            <div className="space-y-1.5 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] p-3 text-sm">
              <Row
                label="This subscription"
                value={`${formatCurrency(sub.weeklyAmount)} /wk`}
              />
              <Row
                label="New weekly total"
                value={`${formatCurrency(newWeeklyTotal)} /wk`}
                strong
              />
            </div>

            {/* Minimum-term vs no-refund acknowledgement (mirrors Flutter dialog text). */}
            {sub.minimumCancellationDate ? (
              <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-warn/10 p-3 text-sm text-warn">
                <Hourglass className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  This subscription has a minimum term. Billing will continue
                  until{' '}
                  <span className="font-medium">
                    {formatDate(sub.minimumCancellationDate)}
                  </span>
                  , after which the weekly fee will no longer be charged.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-inset p-3 text-sm text-ink-60">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ink-40" />
                <span>
                  Cancellation isn't immediate: billing continues through the
                  current paid cycle and stops after it — you won't be charged
                  for the next cycle. No further work will be completed and no
                  refunds will be issued for payments already made.
                </span>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Keep subscription
          </Button>
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {pending ? 'Cancelling…' : 'Cancel subscription'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-60">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          strong ? 'font-semibold text-ink-100' : 'text-ink-100',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ── Brand self-service page (/subscriptions) ────────────────────────────────── */

export function BrandSubscriptionsPage() {
  const { brandId } = useActiveContext();
  return (
    <div>
      <PageHeader
        title="Subscriptions"
        description="Your recurring services, billed on a weekly cycle."
      />
      {brandId ? (
        <div className="space-y-6">
          <FeatureSubscriptionsSection brandId={brandId} />
          <BrandSubscriptionsView brandId={brandId} />
          <ExploreFeatureSubscriptions brandId={brandId} />
        </div>
      ) : (
        <EmptyState
          icon={Repeat}
          title="No brand selected"
          description="Create a brand profile to manage subscriptions."
        />
      )}
    </div>
  );
}

/* ── Agency view of a connected client's subscriptions (/subscriptions/:brandId) ─ */

export function AgencyBrandSubscriptionsPage() {
  const [, params] = useRoute('/subscriptions/:brandId');
  const { agencyId } = useActiveContext();
  const brandId = params?.brandId;
  if (!brandId) return null;
  return (
    <div>
      <Link
        href="/clients"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-60 hover:text-ink-100"
      >
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>
      <PageHeader
        title="Subscriptions"
        description="Recurring services you fulfil for this client."
      />
      <BrandSubscriptionsView
        brandId={brandId}
        agencyId={agencyId ?? undefined}
      />
    </div>
  );
}
