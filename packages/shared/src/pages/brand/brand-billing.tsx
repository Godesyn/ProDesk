import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRoute, Link } from 'wouter';
import { ArrowLeft, Receipt, TrendingUp, CalendarClock, CalendarRange, Repeat, CheckCircle2, Clock, XCircle, Wallet, FileText, Loader2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { toastError } from '../../lib/errors';
import { printInvoice } from '../../lib/print';
import { useActiveContext } from '../../hooks/use-active-context';
import { cn, formatCurrency, formatDate, initialsOf } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';

type Summary = NonNullable<ReturnType<typeof useBrandSummary>['data']>;
type Record = Summary['past'][number];

function useBrandSummary(brandId: string | undefined, agencyId?: string) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.billing.brandSummary.queryOptions({ brandId: brandId!, ...(agencyId ? { agencyId } : {}) }),
    enabled: !!brandId,
  });
}

/* ── Stat card ───────────────────────────────────────────────────────────── */

function MoneyStat({ icon: Icon, label, value, tone = 'default', delay = 0 }: { icon: LucideIcon; label: string; value: number; tone?: 'default' | 'accent' | 'success'; delay?: number }) {
  const valueClass = tone === 'success' ? 'text-success' : tone === 'accent' ? 'text-accent' : 'text-ink-100';
  return (
    <Card
      className="flex-1 animate-in fade-in slide-in-from-bottom-2 fill-mode-both p-3 transition-shadow hover:shadow-md md:p-5"
      style={{ animationDelay: `${delay}ms`, animationDuration: '320ms' }}
    >
      <div className="mb-1 flex items-center gap-1.5 text-ink-60 md:mb-2 md:gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <p className="text-xs md:text-sm">{label}</p>
      </div>
      <p className={cn('text-xl font-semibold tabular-nums md:text-h3', valueClass)}>{formatCurrency(value)}</p>
    </Card>
  );
}

/* ── Status pill ─────────────────────────────────────────────────────────── */

const STATUS: globalThis.Record<Record['status'], { label: string; variant: 'success' | 'warn' | 'muted' | 'danger'; icon: LucideIcon }> = {
  paid: { label: 'Paid', variant: 'success', icon: CheckCircle2 },
  upcoming: { label: 'Upcoming', variant: 'muted', icon: Clock },
  pending: { label: 'Pending', variant: 'warn', icon: Clock },
  failed: { label: 'Failed', variant: 'danger', icon: XCircle },
};

function PaymentRow({ r, index }: { r: Record; index: number }) {
  const trpc = useTRPC();
  const s = STATUS[r.status];
  const Icon = s.icon;
  // Generate the brand's tax invoice for this payment on the fly (no stored row)
  // and open the printable view — ports the Flutter per-row "open invoice" action.
  const gen = useMutation({
    ...trpc.invoices.generateForPurchaseCycle.mutationOptions(),
    onSuccess: (res) =>
      printInvoice({ ...res.document, status: res.document.status ?? undefined, issuedAt: res.document.issuedAt ?? undefined }),
    onError: (e) => toastError(e),
  });
  return (
    <div
      className="flex animate-in fade-in fill-mode-both items-center gap-3 border-b border-[color:var(--color-border-default)] px-4 py-3 last:border-0 transition-colors hover:bg-inset"
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms`, animationDuration: '260ms' }}
    >
      <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', r.recurring ? 'bg-accent/12 text-accent' : 'bg-inset text-ink-60')}>
        {r.recurring ? <Repeat className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-100">{r.description}</p>
        <p className="text-xs text-ink-40">
          {formatDate(r.date)}
          {r.recurring && <span> · Week {r.cycle - 1}</span>}
        </p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-ink-100">{formatCurrency(r.amount)}</p>
        <Badge variant={s.variant} className="mt-0.5">
          <Icon className="mr-1 h-3 w-3" /> {s.label}
        </Badge>
      </div>
      <button
        type="button"
        title="Generate invoice"
        aria-label="Generate invoice"
        disabled={gen.isPending}
        onClick={() => gen.mutate({ purchaseId: r.purchaseId, cycle: r.cycle })}
        className="shrink-0 rounded-[var(--radius-sm)] p-2 text-ink-40 transition-colors hover:bg-inset hover:text-ink-100 disabled:opacity-50"
      >
        {gen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      </button>
    </div>
  );
}

function RecordList({ title, icon: Icon, records, emptyLabel }: { title: string; icon: LucideIcon; records: Record[]; emptyLabel: string }) {
  const total = records.reduce((t, r) => t + r.amount, 0);
  return (
    <Card className="flex flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-[color:var(--color-border-default)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-ink-60" />
          <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
          <Badge variant="muted">{records.length}</Badge>
        </div>
        <span className="text-sm font-medium tabular-nums text-ink-60">{formatCurrency(total)}</span>
      </div>
      {records.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-ink-40">{emptyLabel}</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          {records.map((r, i) => <PaymentRow key={r.id} r={r} index={i} />)}
        </div>
      )}
    </Card>
  );
}

/* ── Reusable dashboard ──────────────────────────────────────────────────── */

export function BrandBillingView({ brandId, agencyId }: { brandId: string; agencyId?: string }) {
  const q = useBrandSummary(brandId, agencyId);
  const [tab, setTab] = useState<'past' | 'upcoming'>('upcoming');

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 md:h-24 md:flex-1" />)}</div>
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>
      </div>
    );
  }

  const data = q.data;
  if (!data) return <EmptyState icon={Receipt} title="No billing data" description="This brand has no purchases yet." />;
  const { stats, past, upcoming } = data;

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4">
        <MoneyStat icon={Wallet} label="Total paid" value={stats.totalPaid} tone="success" delay={0} />
        <MoneyStat icon={CalendarClock} label="Due this month" value={stats.upcomingThisMonth} tone="accent" delay={60} />
        <MoneyStat icon={CalendarRange} label="Due next month" value={stats.upcomingNextMonth} delay={120} />
        <MoneyStat icon={TrendingUp} label="Remaining this year" value={stats.upcomingThisYear} delay={180} />
      </div>

      {stats.activeSubscriptions > 0 && (
        <div className="flex items-center gap-2 text-sm text-ink-60">
          <Repeat className="h-4 w-4 text-accent" />
          {stats.activeSubscriptions} active subscription{stats.activeSubscriptions === 1 ? '' : 's'} on a weekly billing cycle.
        </div>
      )}

      {/* Desktop: two columns. Mobile: segmented tabs. */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-2">
        <RecordList title="Upcoming" icon={CalendarClock} records={upcoming} emptyLabel="No upcoming payments scheduled." />
        <RecordList title="Past payments" icon={CheckCircle2} records={past} emptyLabel="No payments yet." />
      </div>

      <div className="lg:hidden">
        <div className="mb-3 inline-flex rounded-[var(--radius-pill)] border border-[color:var(--color-border-default)] p-0.5">
          {(['upcoming', 'past'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-[var(--radius-pill)] px-4 py-1.5 text-sm capitalize transition-colors',
                tab === t ? 'bg-accent/12 font-medium text-accent' : 'text-ink-60',
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === 'upcoming'
          ? <RecordList title="Upcoming" icon={CalendarClock} records={upcoming} emptyLabel="No upcoming payments scheduled." />
          : <RecordList title="Past payments" icon={CheckCircle2} records={past} emptyLabel="No payments yet." />}
      </div>
    </div>
  );
}

/* ── Brand self-service page (/payments) ──────────────────────────────────── */

export function BrandBillingPage() {
  const { brandId } = useActiveContext();
  return (
    <div>
      <PageHeader title="Payments" description="Your payment history and the upcoming billing schedule." />
      {brandId
        ? <BrandBillingView brandId={brandId} />
        : <EmptyState icon={Receipt} title="No brand selected" description="Create a brand profile to see your billing." />}
    </div>
  );
}

/* ── Agency view of a connected client's billing (/payments/:brandId) ──────── */

export function AgencyBrandBillingPage() {
  const [, params] = useRoute('/payments/:brandId');
  const { agencyId } = useActiveContext();
  const id = params?.brandId;
  const q = useBrandSummary(id, agencyId ?? undefined);
  const brand = q.data?.brand;
  if (!id) return null;
  return (
    <div>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-60 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> Back to clients
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <Avatar className="h-11 w-11">{brand?.logoUrl && <AvatarImage src={brand.logoUrl} />}<AvatarFallback>{initialsOf(brand?.businessName)}</AvatarFallback></Avatar>
        <div>
          <h1 className="text-h3 text-ink-100">{brand?.businessName ?? 'Client'} · Billing</h1>
          <p className="mt-0.5 hidden text-sm text-ink-60 md:block">Payment history and the upcoming schedule for this client.</p>
        </div>
      </div>
      <BrandBillingView brandId={id} agencyId={agencyId ?? undefined} />
    </div>
  );
}

/* ── Super-admin route page (/super-admin/brands/:id/billing) ─────────────── */

export function AdminBrandBillingPage() {
  const [, params] = useRoute('/super-admin/brands/:id/billing');
  const id = params?.id;
  const q = useBrandSummary(id);
  const brand = q.data?.brand;

  if (!id) return null;
  return (
    <div>
      <Link href="/super-admin/brands" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-60 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> Back to brands
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <Avatar className="h-11 w-11">{brand?.logoUrl && <AvatarImage src={brand.logoUrl} />}<AvatarFallback>{initialsOf(brand?.businessName)}</AvatarFallback></Avatar>
        <div>
          <h1 className="text-h3 text-ink-100">{brand?.businessName ?? 'Brand'} · Billing</h1>
          <p className="mt-0.5 hidden text-sm text-ink-60 md:block">Payment history and the upcoming schedule for this brand.</p>
        </div>
      </div>
      <BrandBillingView brandId={id} />
    </div>
  );
}
