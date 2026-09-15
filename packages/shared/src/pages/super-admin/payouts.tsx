import { Fragment, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { toastError } from '../../lib/errors';
import { formatDate, formatCurrency, initialsOf } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Tooltip } from '../../components/ui/tooltip';
import { ReadinessTooltip } from '../../components/ui/readiness-tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Badge } from '../../components/ui/badge';
import { PartyCell } from '../../components/party-cell';
import { PayoutBreakdownTable, type Breakdown } from '../earnings/payout-tile';
import { isStoppedStatus } from '../earnings/payout-status';

const LIMIT = 15;

export function AdminPayoutsPage() {
  const trpc = useTRPC();
  const confirm = useConfirm();
  const [offset, setOffset] = useState(0);
  // Which rows are expanded to reveal their commission breakdown (same table as
  // the earnings payout tiles). Multiple rows may be open at once.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const list = useQuery(trpc.superAdmin.payouts.queryOptions({ limit: LIMIT, offset }));
  const rows = list.data?.items ?? [];

  // Manually kick the payout cron (the weekly Fri 23:59 run) so due payouts are
  // dispatched now. Enqueues a job for the payout worker; refresh the list after.
  const retry = useMutation({
    ...trpc.superAdmin.retryPayouts.mutationOptions(),
    onSuccess: () => {
      toast.success('Payout run queued — due payouts will dispatch shortly.');
      void list.refetch();
    },
    onError: (e) => toastError(e),
  });
  const runRetry = async () => {
    if (
      !(await confirm({
        title: 'Review failed ones?',
        description:
          'Runs the payout cron now: every due payout (pending, on or past its payout date) is dispatched, failed payouts are revived and retried, and wire payouts stranded at the Wise send step (funds already in our Wise balance) are re-sent. Already-dispatched payouts are skipped.',
        confirmLabel: 'Run payout cron',
      }))
    )
      return;
    retry.mutate();
  };

  return (
    <div>
      <PageHeader
        title="Payouts"
        description="All payouts across the platform."
        action={
          <Button variant="outline" onClick={runRetry} disabled={retry.isPending}>
            <RefreshCw className={`h-4 w-4${retry.isPending ? ' animate-spin' : ''}`} />
            Review failed ones
          </Button>
        }
      />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Beneficiary</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Payout Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const userName = p.beneficiary
                    ? [p.beneficiary.firstName, p.beneficiary.lastName].filter(Boolean).join(' ') || p.beneficiary.email || 'Unknown'
                    : null;
                  const email = p.beneficiary?.email;
                  const breakdown = (p.breakdown ?? []) as Breakdown[];
                  const hasBreakdown = breakdown.length > 0;
                  const stopped = isStoppedStatus({ status: p.status, hasBreakdowns: p.payoutReadiness?.hasBreakdowns ?? hasBreakdown });
                  const statusLabel = stopped ? 'Stopped' : p.status;
                  const statusVariant = p.status === 'paid' ? 'success' : stopped ? 'muted' : 'outline';
                  const isOpen = expanded.has(p.id);
                  return (
                    <Fragment key={p.id}>
                    <TableRow
                      className={hasBreakdown ? 'cursor-pointer' : undefined}
                      onClick={hasBreakdown ? () => toggle(p.id) : undefined}
                    >
                      <TableCell className="text-ink-40">
                        {hasBreakdown && (isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
                      </TableCell>
                      <TableCell>
                        {p.beneficiary ? (
                          // A USER beneficiary — avatar + name, email on hover.
                          <Tooltip label={email} side="bottom">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                {p.beneficiary.profileUrl && <AvatarImage src={p.beneficiary.profileUrl} />}
                                <AvatarFallback>{initialsOf(userName!)}</AvatarFallback>
                              </Avatar>
                              <span className="font-medium text-ink-100">{userName}</span>
                            </div>
                          </Tooltip>
                        ) : p.beneficiaryAgency ? (
                          // An AGENCY beneficiary (the agency itself is paid) — show the agency, not "Unknown".
                          <PartyCell party={p.beneficiaryAgency} />
                        ) : (
                          <span className="text-ink-40">Unknown</span>
                        )}
                      </TableCell>
                      <TableCell className="text-ink-60">
                        <PartyCell party={p.sourceAgency} />
                      </TableCell>
                      <TableCell className="text-ink-60">
                        <PartyCell party={p.sourceBrand} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(p.amount, p.currency)}
                      </TableCell>
                      <TableCell>
                        {p.payoutReadiness ? (
                          <ReadinessTooltip readiness={p.payoutReadiness}>
                            <Badge variant={statusVariant} className="cursor-help capitalize">
                              {statusLabel}
                            </Badge>
                          </ReadinessTooltip>
                        ) : (
                          <Badge variant={statusVariant} className="capitalize">
                            {statusLabel}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-ink-60 capitalize">
                        {p.method || '—'}
                      </TableCell>
                      <TableCell className="text-ink-60">
                        {p.toPayAt ? formatDate(p.toPayAt) : '—'}
                      </TableCell>
                    </TableRow>
                    {isOpen && hasBreakdown && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-inset/30 p-4">
                          <div className="mb-2 text-xs font-semibold text-ink-60">Breakdown</div>
                          <PayoutBreakdownTable breakdown={breakdown} currency={p.currency} />
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-6 text-ink-60">
                      No payouts found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {list.data && list.data.total > 0 && (
              <div className="px-4 pb-3 pt-3">
                <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
