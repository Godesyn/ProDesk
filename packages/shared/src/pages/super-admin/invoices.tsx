import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useTRPC } from '../../lib/trpc';
import { formatDate, formatCurrency } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Pagination } from '../../components/ui/pagination';
import { Badge, type BadgeProps } from '../../components/ui/badge';
import { ReadinessTooltip } from '../../components/ui/readiness-tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { PartyCell } from '../../components/party-cell';

const LIMIT = 15;
const STATUS: Record<string, BadgeProps['variant']> = {
  paid: 'success',
  received: 'success',
  unpaid: 'warn',
  processing: 'accent',
  processingByStripe: 'accent',
  processingByPaypal: 'accent',
  processingByWire: 'accent',
  dispatched: 'accent',
};

/**
 * Super-admin Invoices — every invoice on the platform, newest first. Each row
 * shows BOTH parties (from → to) so either side is visible, and the status badge
 * reveals the connected payout's readiness checkpoints on hover when a payout
 * exists (same tooltip as the earnings / invoice views).
 */
export function AdminInvoicesPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const [offset, setOffset] = useState(0);
  const list = useQuery(trpc.superAdmin.invoices.queryOptions({ limit: LIMIT, offset }));
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Invoices" description="All invoices across the platform." />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <TableCell className="text-ink-100">{inv.displayNumber}</TableCell>
                    <TableCell className="text-ink-60">{inv.fromName ?? '—'}</TableCell>
                    <TableCell className="text-ink-60">{inv.toName ?? '—'}</TableCell>
                    <TableCell className="text-ink-60"><PartyCell party={inv.agency} /></TableCell>
                    <TableCell className="text-ink-60"><PartyCell party={inv.brand} /></TableCell>
                    <TableCell>
                      {inv.payoutReadiness ? (
                        <ReadinessTooltip readiness={inv.payoutReadiness}>
                          <Badge variant={STATUS[inv.status ?? ''] ?? 'muted'} className="cursor-help">{inv.status}</Badge>
                        </ReadinessTooltip>
                      ) : (
                        <Badge variant={STATUS[inv.status ?? ''] ?? 'muted'}>{inv.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-60">{formatDate(inv.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatCurrency(inv.total)}</TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-ink-60">No invoices found.</TableCell>
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
