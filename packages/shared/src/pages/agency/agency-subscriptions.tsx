import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { formatDate } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';

/** A scheduled cancellation that hasn't taken effect yet (still reversible). */
function isCancellationScheduled(cancelledAt: string | Date | null | undefined): boolean {
  return !!cancelledAt && new Date(cancelledAt).getTime() > Date.now();
}

/**
 * Agency subscriptions — ports agency_subscriptions_screen.dart + cancel_purchase_dialog.
 * Lists recurring (non oneTime) projects with a cancel-subscription flow.
 */
export function AgencySubscriptionsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const askConfirm = useConfirm();
  const { agencyId } = useActiveContext();
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);

  const key = trpc.projects.list.queryKey();
  const list = useQuery({ ...trpc.projects.list.queryOptions({ agencyId: agencyId!, limit: 100, offset: 0 }), enabled: !!agencyId });
  const cancel = useMutation({
    ...trpc.projects.cancelSubscription.mutationOptions(),
    onSuccess: () => { toast.success('Subscription scheduled for cancellation'); setConfirm(null); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toastError(e),
  });
  const resume = useMutation({
    ...trpc.projects.resumeSubscription.mutationOptions(),
    onSuccess: () => { toast.success('Subscription resumed'); qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toastError(e),
  });

  const onResume = async (p: any) => {
    const name = p.serviceName ?? p.title ?? 'this subscription';
    const ok = await askConfirm({
      title: 'Resume this subscription?',
      description: `"${name}" will stay active and billing will continue as normal. The scheduled cancellation will be cancelled.`,
      confirmLabel: 'Resume subscription',
      cancelLabel: 'Keep cancelling',
    });
    if (ok) resume.mutate({ id: p.id });
  };

  // Include scheduled-cancel rows (future `cancelledAt`) so the agency can resume
  // them; only truly-ended cancellations (past date) drop off the list.
  const subs = (list.data?.items ?? []).filter(
    (p: any) =>
      !!p.deliverableFrequency &&
      (!p.cancelledAt || isCancellationScheduled(p.cancelledAt)) &&
      p.status !== 'completed',
  );

  return (
    <div>
      <PageHeader title="Subscriptions" description="Recurring projects billed on a cycle." />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : subs.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No active subscriptions" description="Recurring projects appear here." />
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Project</TableHead><TableHead>Frequency</TableHead><TableHead>Next cycle</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {subs.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-ink-100">{p.serviceName ?? p.title ?? 'Project'}</TableCell>
                  <TableCell><Badge variant="outline">{p.deliverableFrequency}</Badge></TableCell>
                  <TableCell className="text-ink-60">
                    {isCancellationScheduled(p.cancelledAt) ? (
                      <span className="text-warn">Cancels {formatDate(p.cancelledAt)}</span>
                    ) : (
                      formatDate(p.nextCycleAt)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isCancellationScheduled(p.cancelledAt) ? (
                      <Button size="sm" variant="accent" disabled={resume.isPending} onClick={() => onResume(p)}>Resume</Button>
                    ) : p.cancellable ? (
                      <Button size="sm" variant="ghost" onClick={() => setConfirm({ id: p.id, name: p.serviceName ?? p.title ?? 'this subscription' })}>Cancel</Button>
                    ) : (
                      <span className="text-xs text-ink-40">Not cancellable</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel subscription?</DialogTitle>
            <DialogDescription>{confirm ? `Cancellation isn't immediate: billing continues through the current paid cycle and stops after it — "${confirm.name}" won't be charged for the next cycle. Work already in progress continues until complete.` : ''}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Keep subscription</Button>
            <Button variant="danger" disabled={cancel.isPending} onClick={() => confirm && cancel.mutate({ id: confirm.id })}>{cancel.isPending ? 'Cancelling…' : 'Cancel subscription'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
