import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Filter, FilterX, Zap } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { PageHeader } from '../components/layout/page-header';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { useConfirm } from '../components/ui/confirm-dialog';
import { toastError } from '../lib/errors';
import { cn } from '../lib/utils';
import { EarningsContent } from './earnings/earnings-content';
import { UserFilterDialog, type Beneficiary } from './earnings/user-filter-dialog';
import { isStoppedStatus } from './earnings/payout-status';
import type { PayoutRow } from './earnings/payout-tile';

// `failed` is a terminal outcome (a disbursement that was attempted and did not
// go through), so it belongs in Past Earnings with its real status — not rewritten
// to `upcoming` and shown as a future prediction. The tile renders it as a red
// "Failed" badge (see payout-status.ts).
const PAST_STATUSES = new Set(['paid', 'received', 'failed']);

export function EarningsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { workspace, agencyId, user } = useActiveContext();
  const isAdmin = !!user?.isSuperAdmin;
  const scope = workspace === 'agency' && agencyId ? { agencyId } : undefined;

  const [tab, setTab] = useState<'past' | 'future'>('future');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Super-admins can view everyone's payouts; everyone else gets role-scoped.
  const ownList = useQuery({ ...trpc.payouts.list.queryOptions({ ...(scope ?? {}), limit: 200, offset: 0 }), enabled: !isAdmin });
  const allList = useQuery({ ...trpc.payouts.allList.queryOptions({ limit: 200, offset: 0 }), enabled: isAdmin });
  const beneficiaries = useQuery({ ...trpc.payouts.beneficiaries.queryOptions(), enabled: isAdmin });
  const beneficiaryAgencies = useQuery({ ...trpc.payouts.beneficiaryAgencies.queryOptions(), enabled: isAdmin });
  const future = useQuery(trpc.payouts.predictFutureEarnings.queryOptions(isAdmin ? { everyone: true } : (scope ?? {})));

  // Super-admin: force every schedulable payout to pay out now rather than
  // waiting for the weekly cron. Pulls future-dated payouts forward server-side
  // and reports what it did.
  const dispatchNow = useMutation({
    ...trpc.payouts.dispatchNow.mutationOptions(),
    onSuccess: (res) => {
      toast.success(
        res.dispatched > 0
          ? `Dispatched ${res.dispatched} of ${res.considered} payout${res.considered === 1 ? '' : 's'}.`
          : `No payouts were ready to disburse (${res.considered} considered).`,
      );
      void qc.invalidateQueries({ queryKey: trpc.payouts.allList.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.payouts.predictFutureEarnings.queryKey() });
    },
    onError: (e) => toastError(e),
  });

  const initiatePayoutNow = async () => {
    if (
      !(await confirm({
        title: 'Initiate all payouts now?',
        description:
          'This pulls every scheduled payout forward and disburses it immediately, overriding the weekly payout schedule. Only payouts whose work is complete will be sent to their provider. This cannot be undone.',
        confirmLabel: 'Initiate now',
      }))
    )
      return;
    dispatchNow.mutate();
  };

  const list = isAdmin ? allList : ownList;
  const pastRaw = (list.data?.items ?? []) as unknown as PayoutRow[];
  const predicted = (future.data ?? []) as unknown as PayoutRow[];

  // Mirror the Flutter combined provider: "past" = paid/received only; "future"
  // = unpaid-past rows (status overwritten to upcoming) merged with predictions.
  const { pastList, futureList } = useMemo(() => {
    // Stopped payouts are terminal like paid/failed, whether stopped by hand
    // (status `stopped`) or because they have no breakdown items and can never
    // dispatch. Keep them in Past with their "Stopped" badge instead of
    // presenting them as predicted future earnings.
    const isPast = (p: PayoutRow) => PAST_STATUSES.has(p.status) || isStoppedStatus(p);
    const past = pastRaw.filter(isPast);
    const unpaidPast = pastRaw
      .filter((p) => !isPast(p))
      .map((p) => ({ ...p, status: 'upcoming' }));
    const fut = [...unpaidPast, ...predicted].sort((a, b) => {
      const ta = new Date(a.toPayAt ?? a.createdAt ?? 0).getTime();
      const tb = new Date(b.toPayAt ?? b.createdAt ?? 0).getTime();
      return ta - tb;
    });
    return { pastList: past, futureList: fut };
  }, [pastRaw, predicted]);

  const beneficiaryById = useMemo(() => {
    const m: Record<string, Beneficiary> = {};
    for (const b of (beneficiaries.data ?? []) as Beneficiary[]) m[b.id] = b;
    // Agency-received payouts: show the agency (name + logo) as the payee.
    for (const a of (beneficiaryAgencies.data ?? []) as { id: string; businessName: string; username?: string | null; logoUrl?: string | null }[]) {
      m[a.id] = { id: a.id, firstName: a.businessName, lastName: '', email: a.username ?? '', profileUrl: a.logoUrl ?? null };
    }
    return m;
  }, [beneficiaries.data, beneficiaryAgencies.data]);

  const applyUserFilter = (rows: PayoutRow[]) => (selectedUserId ? rows.filter((r) => r.beneficiaryId === selectedUserId) : rows);

  const loading = list.isLoading || future.isLoading;

  return (
    <div>
      <PageHeader
        title="Earnings Overview"
        description="Your payouts and disbursement history."
        action={
          isAdmin ? (
            <div className="flex items-center gap-2">
              <Button variant="accent" onClick={initiatePayoutNow} disabled={dispatchNow.isPending}>
                <Zap className="h-4 w-4" />
                {dispatchNow.isPending ? 'Initiating…' : 'Initiate payout now'}
              </Button>
              <Button variant="outline" size="icon" title="Filter by user" onClick={() => setFilterOpen(true)}>
                {selectedUserId ? <FilterX className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex gap-1 border-b border-[color:var(--color-border-hairline)]">
        {(['past', 'future'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'relative px-4 py-2.5 text-sm font-medium transition-colors',
              tab === t ? 'text-ink-100' : 'text-ink-40 hover:text-ink-60',
            )}
          >
            {t === 'past' ? 'Past Earnings' : 'Future Earnings'}
            {tab === t && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-ink-100" />}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4 pt-6">
          <div className="grid grid-cols-3 gap-3 md:gap-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full md:h-24" />)}</div>
          <Skeleton className="h-[260px] w-full" />
        </div>
      ) : tab === 'past' ? (
        <EarningsContent payouts={applyUserFilter(pastList)} isFuture={false} viewerId={user?.id} viewerAgencyId={scope?.agencyId} beneficiaryById={beneficiaryById} />
      ) : (
        <EarningsContent payouts={applyUserFilter(futureList)} isFuture viewerId={user?.id} viewerAgencyId={scope?.agencyId} beneficiaryById={beneficiaryById} />
      )}

      {isAdmin && (
        <UserFilterDialog
          open={filterOpen}
          onOpenChange={setFilterOpen}
          beneficiaries={(beneficiaries.data ?? []) as Beneficiary[]}
          selectedId={selectedUserId}
          onSelect={setSelectedUserId}
        />
      )}
    </div>
  );
}
