import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/layout/empty-state';

const STATUS_VARIANT: Record<string, 'muted' | 'accent' | 'success' | 'warn' | 'danger'> = {
  pending: 'muted',
  pendingPayment: 'warn',
  processing: 'accent',
  paid: 'success',
  completed: 'success',
  failed: 'danger',
  cancelled: 'danger',
};

/** The per-item recurring weekly fee frozen on its amount snapshot. */
function itemWeekly(amount: unknown): number {
  const a = (amount ?? {}) as { recurring?: { weeklyAfter?: number }; oneOff?: { weeklyAfter?: number } };
  return Number(a.recurring?.weeklyAfter ?? a.oneOff?.weeklyAfter ?? 0);
}

/** Order / purchase history list (ports history_screen.dart). */
export function OrderHistory({ brandId }: { brandId: string | null }) {
  const trpc = useTRPC();
  const list = useQuery({ ...trpc.purchases.list.queryOptions({ brandId: brandId!, limit: 50, offset: 0 }), enabled: !!brandId });

  if (!brandId) return <EmptyState icon={Receipt} title="No brand selected" description="Switch to a brand to view orders." />;
  if (list.isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;

  // Only surface fully completed orders here; pending-payment / processing /
  // failed / cancelled purchases are excluded so history shows finalized orders.
  const orders = (list.data?.items ?? []).filter((o) => o.status === 'completed');
  if (!orders.length) return <EmptyState icon={Receipt} title="No orders yet" description="Your completed purchases will appear here." />;

  return (
    <div className="space-y-3">
      {orders.map((o) => (
        <Card key={o.id}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant={o.type === 'marketplace' ? 'accent' : 'outline'}>{o.type === 'marketplace' ? 'MARKETPLACE' : 'PROPOSAL'}</Badge>
                <span className="text-xs text-ink-40">{formatDate(o.createdAt)}</span>
              </div>
              <Badge variant={STATUS_VARIANT[o.status] ?? 'muted'}>{o.status}</Badge>
            </div>
            <div className="mt-3 space-y-1">
              {o.items.map((it) => {
                // For a recurring item, lineTotal is the one-time setup/upfront
                // charged today; the weekly is billed separately each cycle. Show
                // both ("$100 setup + $10/wk") so the line matches what's actually
                // charged, not a bundled first-cycle figure.
                const setup = Number(it.lineTotal) || 0;
                const weekly = it.isRecurring ? itemWeekly(it.amount) : 0;
                return (
                  <div key={it.id} className="flex justify-between gap-3 text-sm">
                    <span className="text-ink-80">
                      {it.serviceName ?? it.description ?? 'Item'}
                      {it.quantity > 1 && <span className="text-ink-40"> × {it.quantity}</span>}
                      {it.isRecurring && <Badge variant="muted" className="ml-2">recurring</Badge>}
                    </span>
                    <span className="shrink-0 tabular-nums text-ink-60">
                      {it.isRecurring ? (
                        <>
                          {setup > 0 && <>{formatCurrency(setup)} setup + </>}
                          {formatCurrency(weekly)}/wk
                        </>
                      ) : (
                        formatCurrency(setup)
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-between border-t border-[color:var(--color-border-hairline)] pt-2 text-sm font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{formatCurrency(o.totalAmount)}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
