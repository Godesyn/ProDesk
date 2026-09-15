import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ExternalLink,
  Flag,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  MoreHorizontal,
  Percent,
  Receipt,
  Store,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC, apiUrl } from '../../lib/trpc';
import { toastError } from '../../lib/errors';
import { cn, formatCurrency, formatDate, formatNumber } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { SearchBar } from './components';
import { IS_PRODUCTION } from '../../lib/app-env';

/** Cents → AUD, matching the payments client's `formatCents`. */
function money(cents: number | null | undefined): string {
  return formatCurrency((cents ?? 0) / 100);
}

type AdminTab =
  | 'dashboard'
  | 'customers'
  | 'review'
  | 'transactions'
  | 'support'
  | 'growth'
  | 'finance'
  | 'health'
  | 'flags'
  | 'affiliates'
  | 'plan-tiers';

const TABS: { id: AdminTab; label: string; icon: typeof Activity }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'customers', label: 'Vendors', icon: Store },
  { id: 'review', label: 'Account review', icon: Inbox },
  { id: 'transactions', label: 'Transactions', icon: Activity },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'growth', label: 'Growth', icon: TrendingUp },
  { id: 'finance', label: 'Finance', icon: Wallet },
  { id: 'health', label: 'Platform health', icon: Receipt },
  { id: 'flags', label: 'Feature flags', icon: Flag },
  { id: 'affiliates', label: 'Affiliates', icon: Users },
  { id: 'plan-tiers', label: 'Plan tier rates', icon: Percent },
];

export function PaymentsAdminPage() {
  const trpc = useTRPC();
  const [tab, setTab] = useState<AdminTab>('dashboard');
  const { data: stats } = useQuery(trpc.payments.admin.stats.queryOptions());
  const pending = stats?.pendingReviews ?? 0;

  return (
    <div>
      <PageHeader title="Payments admin" description="Platform back office — every vendor, transaction and plan." />

      <div className="mb-4 -mx-1 overflow-x-auto px-1">
        <div className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors',
                  active ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                {t.id === 'review' && pending > 0 && (
                  <span className="ml-1 rounded-full bg-danger px-1.5 text-[0.625rem] font-semibold text-white">{pending}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'customers' && <CustomersTab />}
      {tab === 'review' && <ReviewTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'support' && <SupportTab />}
      {tab === 'growth' && <GrowthTab />}
      {tab === 'finance' && <FinanceTab />}
      {tab === 'health' && <HealthTab />}
      {tab === 'flags' && <FlagsTab />}
      {tab === 'affiliates' && <AffiliatesTab />}
      {tab === 'plan-tiers' && <PlanTiersTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function KpiGrid({ children }: { children: ReactNode }) {
  return <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">{children}</div>;
}

function KpiCard({ label, value, meta, accent }: { label: string; value: ReactNode; meta?: string; accent?: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-eyebrow text-ink-60">{label}</p>
      <p className={cn('mt-1 text-h3 font-semibold', accent ? 'text-accent' : 'text-ink-100')}>{value}</p>
      {meta && <p className="mt-1 text-xs text-ink-40">{meta}</p>}
    </Card>
  );
}

function SectionCard({ title, meta, children, className }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-0', className)}>
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--color-border-hairline)] px-4 py-3">
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
        {meta && <span className="text-eyebrow text-ink-40">{meta}</span>}
      </div>
      {children}
    </Card>
  );
}

/** Review-state → badge variant. */
function reviewVariant(state?: string | null) {
  if (state === 'approved' || state === 'approved_with_conditions') return 'success' as const;
  if (state === 'declined' || state === 'rejected' || state === 'suspended') return 'danger' as const;
  return 'warn' as const;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function DashboardTab() {
  const trpc = useTRPC();
  const { data: stats } = useQuery(trpc.payments.admin.stats.queryOptions());
  const { data: finance } = useQuery(trpc.payments.admin.financeOverview.queryOptions());
  const { data: activity } = useQuery(trpc.payments.admin.recentActivity.queryOptions({ limit: 10 }));
  const { data: gmvData } = useQuery(trpc.payments.admin.dailyGmv.queryOptions({ days: 30 }));

  const bars = gmvData ?? [];
  const hasGmv = bars.length > 0 && !bars.every((d) => d.total === 0);
  const maxVal = Math.max(...bars.map((d) => d.total), 1);

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard label="GMV · all time" value={money(finance?.totalGmv ?? 0)} meta="Total processed" accent />
        <KpiCard label="App fee revenue" value={money(Math.round((finance?.totalGmv ?? 0) * 0.017))} meta="1%–5% · tier-based" />
        <KpiCard label="Active customers" value={formatNumber(stats?.activeStripe ?? 0)} meta="Stripe connected" />
        <KpiCard label="Review queue" value={formatNumber(stats?.pendingReviews ?? 0)} meta="Pending review" />
      </KpiGrid>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <SectionCard title="GMV by day · 30d" meta={`${formatNumber(stats?.totalAccounts ?? 0)} customers`}>
          <div className="p-4">
            {!hasGmv ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-ink-40">No payment data yet</div>
            ) : (
              <div className="flex h-[200px] items-end gap-1">
                {bars.map((d, i) => {
                  const h = Math.max(2, (d.total / maxVal) * 180);
                  const last = i === bars.length - 1;
                  return (
                    <div
                      key={i}
                      className={cn('flex-1 rounded-t-sm', last ? 'bg-accent' : 'bg-inset')}
                      style={{ height: `${h}px` }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Alerts" meta="System alerts">
          <div className="flex items-center justify-center p-6 text-sm text-ink-40">No active alerts</div>
        </SectionCard>
      </div>

      <SectionCard title="Recent platform activity">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(activity ?? []).map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs text-ink-60">{r.time || '—'}</TableCell>
                <TableCell className="font-medium text-ink-100">{r.account || '—'}</TableCell>
                <TableCell className="text-ink-60">{r.action || '—'}</TableCell>
                <TableCell className="text-right font-medium">{r.amount || ''}</TableCell>
              </TableRow>
            ))}
            {(!activity || activity.length === 0) && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-ink-60">
                  No activity yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customers (Vendors)
// ---------------------------------------------------------------------------

const CUSTOMER_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Approved', value: 'approved' },
  { label: 'Pending', value: 'pending' },
  { label: 'Rejected', value: 'rejected' },
];

function CustomersTab() {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading } = useQuery(
    trpc.payments.admin.listAccounts.queryOptions({
      search: search || undefined,
      status: statusFilter || undefined,
      limit: 100,
      offset: 0,
    }),
  );
  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-1">
          {CUSTOMER_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={cn(
                'rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors',
                statusFilter === f.value ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="w-full sm:w-72">
          <div className="mb-0">
            <SearchBar value={search} onChange={setSearch} placeholder="Business name or email" />
          </div>
        </div>
      </div>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Signed up</TableHead>
              <TableHead>Connect</TableHead>
              <TableHead>Review state</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading &&
              rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-ink-100">{c.businessName ?? '—'}</TableCell>
                  <TableCell className="text-ink-60">{c.email ?? '—'}</TableCell>
                  <TableCell className="text-ink-60">{c.createdAt ? formatDate(c.createdAt) : '—'}</TableCell>
                  <TableCell>
                    <Badge variant={c.stripeConnectAccountId ? 'success' : 'muted'}>
                      {c.stripeConnectAccountId ? 'Connected' : 'Not connected'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={reviewVariant(c.reviewState)}>{c.reviewState ?? 'pending'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => toast.info(`${c.businessName ?? 'Account'} · ${c.reviewState ?? 'pending'}`)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-ink-60">
                  No customers yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account review
// ---------------------------------------------------------------------------

function ReviewTab() {
  const trpc = useTRPC();
  const { data, refetch } = useQuery(trpc.payments.admin.listPendingReviews.queryOptions({ limit: 50, offset: 0 }));
  const rows = data?.rows ?? [];
  const approve = useMutation(
    trpc.payments.admin.approveAccount.mutationOptions({
      onSuccess: () => {
        refetch();
        toast.success('Account approved');
      },
      onError: (e) => toastError(e),
    }),
  );
  const decline = useMutation(
    trpc.payments.admin.declineAccount.mutationOptions({
      onSuccess: () => {
        refetch();
        toast.success('Account declined');
      },
      onError: (e) => toastError(e),
    }),
  );
  const [reviewing, setReviewing] = useState<string | null>(null);
  const reviewRow = rows.find((r) => r.id === reviewing);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-60">KYC, ABN verification, Stripe Connect onboarding.</p>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>ABN</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-ink-100">{r.businessName}</TableCell>
                <TableCell className="font-mono text-xs text-ink-60">{r.abn ?? '—'}</TableCell>
                <TableCell className="text-ink-60">{formatDate(r.createdAt)}</TableCell>
                <TableCell>
                  <Badge variant="warn">Pending review</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => setReviewing(r.id)}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-ink-60">
                  No accounts pending review
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={reviewing != null} onOpenChange={(o) => !o && setReviewing(null)}>
        {reviewRow && (
          <DialogContent>
            <DialogHeader>
              <p className="text-eyebrow text-ink-40">Account review</p>
              <DialogTitle>{reviewRow.businessName}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-ink-60">
              ABN: {reviewRow.abn ?? '—'} · Submitted {formatDate(reviewRow.createdAt)}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReviewing(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (reviewing) decline.mutate({ id: reviewing, reason: 'Declined by admin' });
                  setReviewing(null);
                }}
              >
                Decline
              </Button>
              <Button
                variant="accent"
                onClick={() => {
                  if (reviewing) approve.mutate({ id: reviewing });
                  setReviewing(null);
                }}
              >
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function TransactionsTab() {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery(
    trpc.payments.admin.listTransactions.queryOptions({ search: search || undefined, limit: 100, offset: 0 }),
  );
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-eyebrow text-ink-40">{formatNumber(total)} total · all customers</span>
        <div className="w-full sm:w-72">
          <SearchBar value={search} onChange={setSearch} placeholder="Business name or charge ID" />
        </div>
      </div>

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Fee</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading &&
              rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-[0.6875rem]">{t.stripeChargeId ?? t.id}</TableCell>
                  <TableCell className="text-ink-60">{t.businessName ?? '—'}</TableCell>
                  <TableCell className="text-right font-semibold text-ink-100">
                    {t.amountCents != null ? money(t.amountCents) : '—'}
                  </TableCell>
                  <TableCell className="text-right text-ink-60">
                    {t.applicationFeeCents != null ? money(t.applicationFeeCents) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.status === 'succeeded' ? 'success' : t.status === 'failed' ? 'danger' : 'warn'}>
                      {t.status ?? 'pending'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-60">
                    {t.paidAt ? formatDate(t.paidAt) : t.createdAt ? formatDate(t.createdAt) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-ink-60">
                  No transactions yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support (static mock — mirrors the source)
// ---------------------------------------------------------------------------

const SUPPORT_TICKETS = [
  { id: 'T-0042', customer: 'iKeep', subject: 'Stripe payout not received', priority: 'P1', age: '2h' },
  { id: 'T-0041', customer: 'Bayside Plumbing', subject: 'ABN verification stuck', priority: 'P2', age: '8h' },
  { id: 'T-0039', customer: 'Park Lane Coaching', subject: 'Cannot connect Stripe account', priority: 'P2', age: '1d' },
];

function SupportTab() {
  return (
    <SectionCard title="Open tickets" meta="3 open · 1 urgent">
      <ul className="divide-y divide-[color:var(--color-border-hairline)]">
        {SUPPORT_TICKETS.map((t) => (
          <li key={t.id} className="flex items-center gap-4 px-4 py-3">
            <span className="w-16 shrink-0 font-mono text-xs text-ink-40">{t.id}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-ink-100">{t.subject}</div>
              <div className="text-xs text-ink-60">{t.customer}</div>
            </div>
            <Badge variant={t.priority === 'P1' ? 'danger' : 'warn'}>{t.priority}</Badge>
            <span className="font-mono text-xs text-ink-40">{t.age}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

function GrowthTab() {
  const trpc = useTRPC();
  const { data: growth } = useQuery(trpc.payments.admin.growthAnalytics.queryOptions());
  return (
    <KpiGrid>
      <KpiCard label="New accounts" value={formatNumber(growth?.newAccountsThisMonth ?? 0)} meta="30 days" accent />
      <KpiCard label="Proposals sent" value={formatNumber(growth?.proposalsSentThisMonth ?? 0)} meta="This month" />
      <KpiCard label="Acceptance rate" value={`${(growth?.conversionRate ?? 0).toFixed(1)}%`} meta="Industry avg 42%" />
      <KpiCard label="Churn rate" value={`${(growth?.churnRate ?? 0).toFixed(1)}%`} meta="Monthly" />
    </KpiGrid>
  );
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

const FEE_STRUCTURE: [string, string, string][] = [
  ['Platform fee', '1%–5% (tier-based)', 'Rate locked at proposal creation via plan tier — applied via Stripe Connect application_fee_amount'],
  ['Stripe processing', '1.75% + 30¢ (AU cards)', 'Charged by Stripe to the connected account'],
  ['Dispute fee', '$15 per dispute', 'Reversed if merchant wins'],
];

function FinanceTab() {
  const trpc = useTRPC();
  const { data: finance } = useQuery(trpc.payments.admin.financeOverview.queryOptions());
  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard label="Gross volume" value={money(finance?.totalGmv ?? 0)} meta="All time" accent />
        <KpiCard label="Platform fees (collected)" value={money(Math.round((finance?.totalGmv ?? 0) * 0.02))} meta="Tier-based rate" />
        <KpiCard label="Total payments" value={formatNumber(finance?.totalPayments ?? 0)} meta="Transactions" />
        <KpiCard label="Avg order value" value={money(finance?.avgOrderValue ?? 0)} meta="Per transaction" />
      </KpiGrid>

      <SectionCard title="Fee structure">
        <ul className="divide-y divide-[color:var(--color-border-hairline)]">
          {FEE_STRUCTURE.map(([k, v, s]) => (
            <li key={k} className="grid grid-cols-1 gap-1 px-4 py-3 md:grid-cols-[1fr_1fr_2fr] md:gap-4">
              <span className="font-medium text-ink-100">{k}</span>
              <span className="font-mono text-xs text-ink-80">{v}</span>
              <span className="text-xs text-ink-60">{s}</span>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform health
// ---------------------------------------------------------------------------

function HealthTab() {
  const trpc = useTRPC();
  const { data: health } = useQuery(trpc.payments.admin.platformHealth.queryOptions());
  const queues = health?.queues;
  const queueRows = queues ? [queues.smsQueue, queues.emailQueue, queues.chaseQueue, queues.webhookQueue] : [];

  const serviceMetrics: [string, string][] = [
    ['SMS delivery rate', health?.smsDeliveryRate != null ? `${health.smsDeliveryRate}%` : '—'],
    ['Email delivery rate', health?.emailDeliveryRate != null ? `${health.emailDeliveryRate}%` : '—'],
    ['Queue depth', health?.queueDepth != null ? String(health.queueDepth) : '—'],
  ];

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard label="API latency" value={`${health?.apiLatencyMs ?? '—'}ms`} meta="p99" accent />
        <KpiCard label="Error rate" value={`${health?.errorRate ?? 0}%`} meta="Last 24h" />
        <KpiCard label="Uptime" value={`${health?.uptime ?? 0}%`} meta="30 days" />
        <KpiCard label="DB connections" value={formatNumber(health?.dbConnections ?? 0)} meta="Active" />
      </KpiGrid>

      <SectionCard title="Service metrics">
        <ul className="divide-y divide-[color:var(--color-border-hairline)]">
          {serviceMetrics.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between px-4 py-3">
              <span className="font-medium text-ink-100">{k}</span>
              <span className="font-mono text-sm text-ink-80">{v}</span>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="BullMQ queues"
        meta={
          <span className={queues?.configured ? 'text-success' : 'text-warn'}>
            {queues?.configured ? 'REDIS CONNECTED' : 'REDIS NOT CONFIGURED'}
          </span>
        }
      >
        {!queues?.configured && (
          <div className="border-b border-[color:var(--color-border-hairline)] bg-warn/10 px-4 py-3 text-xs text-warn">
            ⚠ {queues?.redisStatus}
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead className="text-right">Waiting</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queueRows.map((q) => (
              <TableRow key={q.name}>
                <TableCell className="font-mono text-xs">{q.name}</TableCell>
                <TableCell className="text-right text-ink-60">{q.waiting}</TableCell>
                <TableCell className="text-right text-ink-60">{q.active}</TableCell>
                <TableCell className={cn('text-right', q.failed > 0 ? 'text-danger' : 'text-ink-60')}>{q.failed}</TableCell>
                <TableCell className="text-right text-ink-60">{q.completed.toLocaleString()}</TableCell>
              </TableRow>
            ))}
            {queueRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-ink-60">
                  No queue data
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </SectionCard>

      {queues?.configured && (
        <SectionCard title="Queue monitoring">
          <div className="p-4">
            <p className="mb-3 text-sm text-ink-60">
              Bullboard provides a real-time UI for inspecting, retrying, and draining BullMQ queues.
            </p>
            <Button asChild variant="outline">
              <a href={`${apiUrl}/admin/queues`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open Bullboard
              </a>
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

const FALLBACK_FLAGS = [
  { key: 'quick_builder_v2', description: 'New Quick Builder UI with sets', enabled: true },
  { key: 'ai_proposal_draft', description: 'AI-powered proposal drafting', enabled: true },
  { key: 'becs_direct_debit', description: 'BECS direct debit payment method', enabled: false },
  { key: 'team_invites', description: 'Multi-user team accounts', enabled: false },
  { key: 'proposal_analytics', description: 'Per-proposal view analytics', enabled: true },
  { key: 'stripe_radar_rules', description: 'Custom Stripe Radar fraud rules', enabled: false },
];

function FlagsTab() {
  const trpc = useTRPC();
  const { data: flags, refetch } = useQuery(trpc.payments.admin.listFeatureFlags.queryOptions());
  const updateFlag = useMutation(trpc.payments.admin.updateFeatureFlag.mutationOptions());

  const handleToggle = async (key: string, enabled: boolean) => {
    try {
      await updateFlag.mutateAsync({ key, enabled: !enabled });
      refetch();
      toast.success(`Flag ${!enabled ? 'enabled' : 'disabled'}`);
    } catch {
      toast.error('Failed');
    }
  };

  const displayFlags = (flags ?? []).length > 0 ? flags! : FALLBACK_FLAGS;
  const activeCount = displayFlags.filter((f) => f.enabled).length;

  return (
    <div className="flex flex-col gap-4">
      <span className="text-eyebrow text-ink-40">{activeCount} active</span>
      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Flag</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayFlags.map((f) => (
              <TableRow key={f.key}>
                <TableCell className="font-mono text-xs">{f.key}</TableCell>
                <TableCell className="text-ink-60">{f.description}</TableCell>
                <TableCell>
                  <Badge variant={f.enabled ? 'success' : 'muted'}>{f.enabled ? 'enabled' : 'disabled'}</Badge>
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => handleToggle(f.key ?? '', f.enabled)}>
                    {f.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Affiliates
// ---------------------------------------------------------------------------

const AFFILIATE_PARAMS: [string, string, string][] = [
  ['Affiliate rate', '0.5%', 'of referral lifetime volume'],
  ['Term', 'For life', 'while referral remains active'],
  ['Minimum payout', '$10', 'rolls forward if under'],
  ['Payout cadence', 'Monthly · 1st', 'matches customer billing'],
  ['Self-referral block', 'On', 'same ABN or same card'],
  ['Cookie window', '90 days', 'last-click attribution'],
];

function AffiliatesTab() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: affiliateList = [], isLoading } = useQuery(trpc.payments.affiliates.adminList.queryOptions());
  const setStatus = useMutation(
    trpc.payments.affiliates.adminSetStatus.mutationOptions({
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: trpc.payments.affiliates.adminList.queryKey() });
        toast.success('Status updated');
      },
      onError: (e) => toastError(e),
    }),
  );

  const totalEarned = affiliateList.reduce((s, a) => s + a.totalEarnedCents, 0);
  const totalReferrals = affiliateList.reduce((s, a) => s + a.totalReferrals, 0);
  const activeAffiliates = affiliateList.filter((a) => a.status === 'active').length;

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid>
        <KpiCard label="Active affiliates" value={formatNumber(activeAffiliates)} meta="Enrolled & active" accent />
        <KpiCard label="Total referrals" value={formatNumber(totalReferrals)} meta="All affiliates" />
        <KpiCard label="Total paid out" value={money(totalEarned)} meta="Lifetime earnings" />
        <KpiCard label="Viral coefficient" value="0.42" meta="k-factor · trending up" />
      </KpiGrid>

      <SectionCard title="All affiliates" meta="Ranked by lifetime earnings">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Business</TableHead>
              <TableHead>Referral code</TableHead>
              <TableHead className="text-right">Active refs</TableHead>
              <TableHead className="text-right">Total refs</TableHead>
              <TableHead className="text-right">Lifetime earned</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading &&
              affiliateList.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <div className="font-medium text-ink-100">{a.businessName ?? '—'}</div>
                    <div className="font-mono text-[0.625rem] text-ink-40">{a.email}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-60">{a.referralCode}</TableCell>
                  <TableCell className="text-right text-ink-60">{a.activeReferrals}</TableCell>
                  <TableCell className="text-right text-ink-60">{a.totalReferrals}</TableCell>
                  <TableCell className="text-right font-semibold text-ink-100">{money(a.totalEarnedCents)}</TableCell>
                  <TableCell>
                    <Badge variant={a.status === 'active' ? 'success' : 'danger'}>{a.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() =>
                        setStatus.mutate({ affiliateId: a.id, status: a.status === 'active' ? 'suspended' : 'active' })
                      }
                    >
                      {a.status === 'active' ? 'Suspend' : 'Activate'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            {!isLoading && affiliateList.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-ink-60">
                  No affiliates enrolled yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <SectionCard title="Program parameters" meta="Change with care — applies prospectively">
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
            {AFFILIATE_PARAMS.map(([k, v, sub]) => (
              <div key={k} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-inset p-3">
                <div className="text-eyebrow text-ink-40">{k}</div>
                <div className="mt-1 text-base font-semibold text-ink-100">{v}</div>
                <div className="mt-1 text-xs text-ink-60">{sub}</div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="RCTI batch · May 2026">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-eyebrow text-ink-60">Total to pay out</span>
              <span className="text-h3 font-semibold text-ink-100">{money(totalEarned)}</span>
            </div>
            <p className="text-xs leading-relaxed text-ink-60">
              {activeAffiliates} affiliates, GST-inclusive amounts. RCTI documents auto-generate on payout. Each is emailed to the
              affiliate.
            </p>
            {!IS_PRODUCTION && (
              <Button
                variant="accent"
                onClick={() => toast.info('Payout run coming soon — will process via Stripe Connect')}
              >
                Run payouts on 1 June
              </Button>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan tier rates
// ---------------------------------------------------------------------------

type TierKey = 'send' | 'close' | 'recover';

interface TierRow {
  key: TierKey;
  label: string;
  pct: string;
  tagline: string | null;
  blurb: string | null;
  status: string;
}

function TierCard({ tier, onSaved }: { tier: TierRow; onSaved: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [pct, setPct] = useState(tier.pct);
  const [status, setStatus] = useState<'active' | 'coming_soon'>(tier.status === 'coming_soon' ? 'coming_soon' : 'active');
  const [tagline, setTagline] = useState(tier.tagline ?? '');
  const [blurb, setBlurb] = useState(tier.blurb ?? '');
  const [showWarning, setShowWarning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: auditRows } = useQuery({
    ...trpc.payments.pricing.getPlanTierRateAudit.queryOptions({ tierKey: tier.key }),
    enabled: showHistory,
  });

  const update = useMutation({
    ...trpc.payments.pricing.updatePlanTier.mutationOptions(),
    onSuccess: () => {
      toast.success(`${tier.label} tier updated`);
      qc.invalidateQueries({ queryKey: trpc.payments.pricing.getPlanTiers.queryKey() });
      onSaved();
      setEditing(false);
    },
    onError: (err) => toastError(err),
  });

  const validatePct = (val: string): string | null => {
    const n = parseFloat(val);
    if (isNaN(n) || n <= 0) return 'Rate must be greater than 0';
    if (n > 100) return 'Rate must be 100 or less';
    if (!/^\d+(\.\d{1,2})?$/.test(val.trim())) return 'Max 2 decimal places';
    return null;
  };

  const doSave = () => {
    const err = validatePct(pct);
    if (err) {
      toast.error(err);
      return;
    }
    update.mutate({ key: tier.key, pct: parseFloat(pct), status, tagline, blurb });
  };

  const handleSave = () => {
    const err = validatePct(pct);
    if (err) {
      toast.error(err);
      return;
    }
    const newPct = parseFloat(pct);
    const oldPct = parseFloat(tier.pct);
    if (Math.abs(newPct - oldPct) > 0.001) {
      setShowWarning(true);
    } else {
      doSave();
    }
  };

  const pctError = editing ? validatePct(pct) : null;
  const fmtDisplay = (p: string) => {
    const n = parseFloat(p);
    return isNaN(n) ? p : `${parseFloat(n.toFixed(2))}%`;
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="accent">{tier.label}</Badge>
          <span className={cn('text-eyebrow', tier.status === 'coming_soon' ? 'text-ink-40' : 'text-success')}>
            {tier.status === 'coming_soon' ? 'Coming soon' : 'Active'}
          </span>
        </div>
        {editing ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="accent" disabled={update.isPending} onClick={handleSave}>
              {update.isPending ? 'Saving…' : 'Save & publish'}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className={cn('w-24 text-2xl font-bold', pctError && 'border-danger')}
            />
            <span className="text-xl font-bold text-ink-60">%</span>
            <span className="ml-1 text-sm text-ink-60">per payment</span>
          </div>
        ) : (
          <>
            <span className="text-4xl font-extrabold text-ink-100">{fmtDisplay(tier.pct)}</span>
            <span className="text-base text-ink-60">per payment</span>
          </>
        )}
      </div>

      {pctError && editing && <span className="-mt-2 text-xs text-danger">{pctError}</span>}

      {showWarning && (
        <div className="rounded-[var(--radius-sm)] border border-warn/35 bg-warn/10 p-3 text-sm leading-relaxed text-ink-80">
          <strong className="mb-1 block text-ink-100">Changing this rate affects all new proposals created after save.</strong>
          Existing proposals keep their locked <code>applied_fee_percentage</code> because the rate was baked in at creation time.
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowWarning(false)}>
              Go back
            </Button>
            <Button size="sm" variant="accent" disabled={update.isPending} onClick={doSave}>
              {update.isPending ? 'Saving…' : 'Confirm change'}
            </Button>
          </div>
        </div>
      )}

      {editing && (
        <div className="flex gap-2">
          {(['active', 'coming_soon'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn(
                'rounded-[var(--radius-sm)] border px-3 py-1 text-xs font-medium uppercase tracking-[0.06em] transition-colors',
                status === s
                  ? 'border-accent bg-accent text-white'
                  : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset',
              )}
            >
              {s === 'coming_soon' ? 'Coming soon' : 'Active'}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label className="text-eyebrow text-ink-40">Tagline</Label>
        {editing ? (
          <Input type="text" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="e.g. Send, collect, done." />
        ) : (
          <p className="text-sm text-ink-100">{tier.tagline || '—'}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-eyebrow text-ink-40">Description blurb</Label>
        {editing ? (
          <textarea
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            rows={3}
            placeholder="e.g. Everything you need to build beautiful proposals…"
            className="flex w-full resize-y rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          />
        ) : (
          <p className="text-sm leading-relaxed text-ink-100">{tier.blurb || '—'}</p>
        )}
      </div>

      <button
        onClick={() => setShowHistory((v) => !v)}
        className="self-start text-xs text-ink-60 underline hover:text-ink-100"
      >
        {showHistory ? 'Hide rate history' : 'View rate history'}
      </button>

      {showHistory && (
        <div className="border-t border-[color:var(--color-border-hairline)] pt-3">
          {!auditRows ? (
            <p className="text-sm text-ink-60">Loading…</p>
          ) : auditRows.length === 0 ? (
            <p className="text-sm text-ink-60">No rate changes recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-ink-60">{formatDate(row.createdAt)}</TableCell>
                    <TableCell>{parseFloat(String(row.oldPct)).toFixed(2)}%</TableCell>
                    <TableCell className="font-medium">{parseFloat(String(row.newPct)).toFixed(2)}%</TableCell>
                    <TableCell className="text-ink-60">{row.changedByName ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Card>
  );
}

function PlanTiersTab() {
  const trpc = useTRPC();
  const { data: tiers, isLoading, refetch } = useQuery(trpc.payments.pricing.getPlanTiers.queryOptions());

  if (isLoading) {
    return <div className="py-8 text-sm text-ink-60">Loading plan tiers…</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-2xl text-sm text-ink-60">
        Changes take effect immediately across the marketing page, proposal builder, FAQ, and Stripe charges. The fee is locked onto each
        proposal at creation time, so existing proposals are not affected.
      </p>

      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {(tiers ?? []).map((tier) => (
          <TierCard key={tier.key} tier={tier as TierRow} onSaved={() => refetch()} />
        ))}
      </div>

      <div className="rounded-[var(--radius-md)] bg-inset px-5 py-4 text-sm leading-relaxed text-ink-60">
        <strong className="text-ink-100">Where these rates appear:</strong> Marketing page hero · How-it-works section · Sequences section ·
        Pricing cards · FAQ questions · Proposal builder math footer · Stripe application_fee_amount on new proposals. The server-side cache
        refreshes within 60 seconds for existing server instances.
      </div>
    </div>
  );
}
