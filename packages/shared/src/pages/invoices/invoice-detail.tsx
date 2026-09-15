import { useRoute, useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { formatCurrency, formatDate } from '../../lib/utils';
import { printInvoice } from '../../lib/print';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge, type BadgeProps } from '../../components/ui/badge';
import { ReadinessTooltip } from '../../components/ui/readiness-tooltip';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

const STATUS: Record<string, BadgeProps['variant']> = {
  paid: 'success',
  received: 'success',
  unpaid: 'warn',
  processing: 'accent',
  dispatched: 'accent',
};

function Party({ title, party }: { title: string; party: Record<string, unknown> | null | undefined }) {
  const name = (party?.name ?? party?.companyName ?? party?.displayName) as string | undefined;
  const email = party?.email as string | undefined;
  const address = party?.address as string | undefined;
  const abn = party?.abn as string | undefined;
  const phone = party?.phone as string | undefined;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-40">{title}</div>
      <div className="text-sm font-medium text-ink-100">{name ?? '—'}</div>
      {email && <div className="text-sm text-ink-60">{email}</div>}
      {address && <div className="text-sm text-ink-60">{address}</div>}
      {abn && <div className="text-sm text-ink-60">ABN {abn}</div>}
      {phone && <div className="text-sm text-ink-60">{phone}</div>}
    </div>
  );
}

/** Invoice detail — line items, from/to parties, totals, PDF export. */
export function InvoiceDetailPage() {
  const [, params] = useRoute('/invoices/:id');
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const { user } = useActiveContext();
  // Super-admins arrive from the platform-wide list (/super-admin/invoices), so
  // send them back there; everyone else returns to their own /invoices list.
  const backTo = user?.isSuperAdmin ? '/super-admin/invoices' : '/invoices';
  const id = params?.id;
  const q = useQuery({ ...trpc.invoices.byId.queryOptions({ id: id! }), enabled: !!id });

  const pdf = useMutation({
    ...trpc.invoices.pdf.mutationOptions(),
    onSuccess: (res) => {
      if (res.url) {
        window.open(res.url, '_blank');
      } else {
        // No external renderer configured — render a clean printable invoice and
        // let the browser save it as PDF.
        const d = res.document;
        printInvoice({
          number: d.number,
          status: d.status ?? undefined,
          issuedAt: d.issuedAt as string | Date | undefined,
          billingBasis: d.billingBasis,
          from: d.from as never,
          to: d.to as never,
          total: d.total,
          subtotal: d.subtotal,
          gst: d.gst,
          amountDue: d.amountDue,
          items: d.items,
        });
      }
    },
    onError: (e) => toastError(e),
  });

  if (q.isLoading) {
    return (
      <div>
        <PageHeader title="Invoice" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!q.data) {
    return (
      <div>
        <PageHeader title="Invoice not found" />
        <Button variant="outline" onClick={() => navigate(backTo)}><ArrowLeft className="h-4 w-4" /> Back to invoices</Button>
      </div>
    );
  }

  const inv = q.data;
  const number = inv.displayNumber;
  const amountDue = Number(inv.total) || 0;
  // Only show the Package column when at least one line item belongs to a package.
  const hasPackage = inv.items.some((it) => !!it.packageName);
  const colCount = hasPackage ? 4 : 3;

  return (
    <div className="max-w-3xl">
      <PageHeader
        title={number}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigate(backTo)}><ArrowLeft className="h-4 w-4" /> Back</Button>
            <Button variant="accent" disabled={pdf.isPending} onClick={() => pdf.mutate({ id: inv.id })}>
              <Download className="h-4 w-4" /> {pdf.isPending ? 'Exporting…' : 'Export PDF'}
            </Button>
          </div>
        }
      />

      <Card className="print:shadow-none">
        <CardHeader className="flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>{number}</CardTitle>
            <p className="mt-1 text-sm text-ink-60">Issued {formatDate(inv.createdAt)}</p>
          </div>
          {/* When the invoice is connected to a payout, hovering the status badge
              reveals the payout-readiness checkpoints — shown for every status
              (paid and unpaid alike), not just unpaid. */}
          {inv.payoutReadiness ? (
            <ReadinessTooltip readiness={inv.payoutReadiness}>
              <Badge variant={STATUS[inv.status] ?? 'muted'} className="cursor-help">{inv.status}</Badge>
            </ReadinessTooltip>
          ) : (
            <Badge variant={STATUS[inv.status] ?? 'muted'}>{inv.status}</Badge>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <Party title="From" party={inv.fromParty as Record<string, unknown> | null} />
            <Party title="To" party={inv.toParty as Record<string, unknown> | null} />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                {hasPackage && <TableHead>Package</TableHead>}
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inv.items.length === 0 ? (
                <TableRow><TableCell colSpan={colCount} className="text-center text-ink-60">No line items.</TableCell></TableRow>
              ) : (
                inv.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="text-ink-100">
                      {it.name}
                      {it.selectedOptions && Object.keys(it.selectedOptions).length > 0 && (
                        <div className="text-xs text-ink-60">{Object.entries(it.selectedOptions).map(([k, v]) => `${k}: ${v}`).join(', ')}</div>
                      )}
                      {Array.isArray(it.selectedAddons) && it.selectedAddons.length > 0 && (
                        <div className="text-xs text-ink-60">+ {(it.selectedAddons as { name?: string }[]).map((a) => a?.name ?? '').filter(Boolean).join(', ')}</div>
                      )}
                    </TableCell>
                    {hasPackage && <TableCell className="text-ink-60">{it.packageName ?? '—'}</TableCell>}
                    <TableCell className="text-right tabular-nums">{it.qty}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatCurrency(it.totalPrice)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* AU tax-invoice totals: GST-inclusive total split into 90% subtotal + 10% GST. */}
          <div className="ml-auto w-full max-w-xs space-y-1.5 border-t border-[color:var(--color-border-hairline)] pt-4">
            <div className="flex items-center justify-between text-sm text-ink-60">
              <span>Subtotal</span><span className="tabular-nums">{formatCurrency(amountDue * 0.9)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-ink-60">
              <span>GST (10%)</span><span className="tabular-nums">{formatCurrency(amountDue * 0.1)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-[color:var(--color-border-hairline)] pt-2 text-ink-100">
              <span className="font-semibold">Amount due</span>
              <span className="text-xl font-bold tabular-nums">{formatCurrency(amountDue)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
