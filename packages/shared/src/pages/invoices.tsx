import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Receipt } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { formatCurrency, formatDate } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Card } from '../components/ui/card';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { ReadinessTooltip } from '../components/ui/readiness-tooltip';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { PartyCell } from '../components/party-cell';

const LIMIT = 10;
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

export function InvoicesPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const { brandId, workspace } = useActiveContext();
  const [offset, setOffset] = useState(0);
  // Brand workspaces scope by brandId; agency/contractor see beneficiary-side invoices.
  const input = workspace === 'brand' && brandId ? { brandId, limit: LIMIT, offset } : { limit: LIMIT, offset };
  const list = useQuery(trpc.invoices.list.queryOptions(input));
  const rows = list.data?.items ?? [];
  // Role-aware counterparty column: a brand sees the agency, everyone else (agency /
  // contractor) sees the brand. (Super-admins use the dedicated /super-admin table.)
  const showAgencyCol = workspace === 'brand';
  const partyLabel = showAgencyCol ? 'Agency' : 'Brand';

  return (
    <div>
      <PageHeader title="Invoices" description="Billing documents for your purchases." />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices yet" description="Invoices are generated when you make a purchase." />
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>{partyLabel}</TableHead><TableHead>Status</TableHead><TableHead>Issued</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((inv) => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <TableCell className="text-ink-100">{inv.displayNumber}</TableCell>
                    <TableCell className="text-ink-60"><PartyCell party={showAgencyCol ? inv.agency : inv.brand} /></TableCell>
                    <TableCell>
                      {inv.payoutReadiness ? (
                        <ReadinessTooltip readiness={inv.payoutReadiness}>
                          <Badge variant={STATUS[inv.status] ?? 'muted'} className="cursor-help">{inv.status}</Badge>
                        </ReadinessTooltip>
                      ) : (
                        <Badge variant={STATUS[inv.status] ?? 'muted'}>{inv.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-ink-60">{formatDate(inv.createdAt)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatCurrency(inv.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-3"><Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} /></div>
          </>
        )}
      </Card>
    </div>
  );
}
