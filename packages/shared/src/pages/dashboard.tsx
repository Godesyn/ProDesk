import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  Package, Building2, FolderKanban, Users, Bell, Rocket, Activity, ClipboardCheck, type LucideIcon,
} from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from '../auth/auth-context';
import { useActiveContext } from '../hooks/use-active-context';
import { formatDate } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { cyclePrice, projectPriceSummary } from './projects/cycle-price';

// Mirror of kanban_status_helpers: stage label + pill tone (brand_dashboard_project_card.dart).
const PROJECT_STATUS: Record<string, { label: string; variant: 'muted' | 'accent' | 'success' | 'warn' }> = {
  clientBrief: { label: 'Client Brief', variant: 'muted' },
  upcoming: { label: 'Future Phases', variant: 'muted' },
  brief: { label: 'Brief', variant: 'muted' },
  allocate: { label: 'Allocate', variant: 'warn' },
  production: { label: 'Production', variant: 'accent' },
  internalApproval: { label: 'Internal Approval', variant: 'accent' },
  revision: { label: 'Revision', variant: 'warn' },
  clientApproval: { label: 'Client Approval', variant: 'warn' },
  completed: { label: 'Completed', variant: 'success' },
};
const statusOf = (s: string) => PROJECT_STATUS[s] ?? { label: s, variant: 'muted' as const };
const projectTitle = (p: { title: string | null; taskTitle?: string | null; serviceName?: string | null }) =>
  p.title || p.taskTitle || p.serviceName || 'Untitled project';

export function DashboardPage() {
  const { data: user } = useCurrentUser();
  const { workspace } = useActiveContext();
  const greeting = `Welcome back, ${user?.firstName ?? 'there'}`;

  if (workspace === 'agency') return <AgencyDashboard greeting={greeting} />;
  if (workspace === 'brand') return <BrandDashboard greeting={greeting} />;
  return <ContractorDashboard greeting={greeting} />;
}

function AgencyDashboard({ greeting }: { greeting: string }) {
  const trpc = useTRPC();
  const { agencyId } = useActiveContext();
  const stats = useQuery({ ...trpc.agencies.dashboardStats.queryOptions({ agencyId: agencyId! }), enabled: !!agencyId });

  if (!agencyId) {
    return (
      <div>
        <PageHeader title={greeting} description="Set up your agency to get started." />
        <Card><CardContent className="p-6 text-sm text-ink-60">No agency yet — create one to begin.</CardContent></Card>
      </div>
    );
  }
  const d = stats.data;
  return (
    <div>
      <PageHeader
        title={greeting}
        description="Here's a snapshot of your workspace."
        action={<Button variant="accent" asChild><Link href="/proposals">New proposal</Link></Button>}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <Stat icon={FolderKanban} label="Active projects" value={d?.activeProjects} loading={stats.isLoading} />
        <Stat icon={Bell} label="Pending actions" value={d?.pendingActions} loading={stats.isLoading} />
        <Stat icon={Building2} label="Clients" value={d?.clients} loading={stats.isLoading} />
        <Stat icon={Package} label="Services" value={d?.services} loading={stats.isLoading} />
        <Stat icon={Users} label="Team members" value={d?.teamMembers} loading={stats.isLoading} />
      </div>
    </div>
  );
}

function BrandDashboard({ greeting }: { greeting: string }) {
  const trpc = useTRPC();
  const { brandId } = useActiveContext();
  const stats = useQuery({ ...trpc.brands.dashboardStats.queryOptions({ brandId: brandId! }), enabled: !!brandId });
  // Recent projects, newest-touched first; the rail filters out completed ones.
  const projects = useQuery({
    ...trpc.projects.list.queryOptions({ brandId: brandId!, limit: 8, offset: 0 }),
    enabled: !!brandId,
  });

  // No-brand empty state with a Create Brand entry (brand_dashboard_no_brand_state.dart).
  if (!brandId) {
    return (
      <div>
        <PageHeader title={greeting} description="Set up your brand to get started." />
        <EmptyState
          icon={Building2}
          title="No Brand Selected"
          description="Create a brand profile to unlock your dashboard, agencies and projects."
          action={<Button variant="accent" asChild><Link href="/create-brand">Create Brand</Link></Button>}
        />
      </div>
    );
  }

  const d = stats.data;
  const all = projects.data?.items ?? [];
  const active = all.filter((p) => p.status !== 'completed').slice(0, 4);
  const recent = all.slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <PageHeader
          title={greeting}
          description="Here's a snapshot of your brand."
          action={<Button variant="accent" asChild><Link href="/marketplace">Purchase a service</Link></Button>}
        />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <Stat icon={Rocket} label="Active projects" value={d?.activeProjects} loading={stats.isLoading} href="/brand-projects" />
          <Stat icon={Bell} label="Pending actions" value={d?.pendingActions} loading={stats.isLoading} href="/tasks" highlight={(d?.pendingActions ?? 0) > 0} />
          <Stat icon={Building2} label="Connected agencies" value={d?.connectedAgencies} loading={stats.isLoading} href="/agencies" />
          <Stat icon={Users} label="Team members" value={d?.teamMembers} loading={stats.isLoading} href="/staff" />
        </div>
      </div>

      {/* Active Projects rail (brand_dashboard_active_projects_section.dart). */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h4 text-ink-100">Active Projects</h2>
          <Button variant="ghost" size="sm" asChild><Link href="/brand-projects">View All</Link></Button>
        </div>
        {projects.isLoading ? (
          <div className="flex gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-[280px] shrink-0" />)}</div>
        ) : active.length === 0 ? (
          <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-ink-60"><Rocket className="h-5 w-5 text-ink-40" /> No active projects yet.</CardContent></Card>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-1">
            {active.map((p) => {
              const s = statusOf(p.status);
              return (
                <Link key={p.id} href={`/project/${p.id}`}>
                  <Card className="flex w-[280px] shrink-0 flex-col gap-3 p-4 transition-shadow hover:shadow-2">
                    <Badge variant={s.variant} className="w-fit">{s.label}</Badge>
                    <div className="line-clamp-2 font-medium text-ink-100">{projectTitle(p)}</div>
                    <div className="mt-auto text-xs text-ink-40">Created {formatDate(p.createdAt)}</div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent Activity (brand_dashboard_recent_activity_section.dart). */}
      <section>
        <h2 className="mb-3 text-h4 text-ink-100">Recent Activity</h2>
        {projects.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : recent.length === 0 ? (
          <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-ink-60"><Activity className="h-5 w-5 text-ink-40" /> No recent activity.</CardContent></Card>
        ) : (
          <Card className="p-0">
            <div className="divide-y divide-[color:var(--color-border-default)]">
              {recent.map((p) => (
                <Link key={p.id} href={`/project/${p.id}`}>
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-inset/40">
                    <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-accent/10 text-accent"><Activity className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink-100">{projectTitle(p)}</div>
                      <div className="text-xs text-ink-40">Status: {statusOf(p.status).label}</div>
                    </div>
                    <span className="text-xs text-ink-40">{formatDate(p.createdAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

// Mirror of contractor_dashboard_screen.dart: a welcome header, a "Contracts
// Completed" metric trio (All Time / This Month / This Week) and an Active
// Projects rail. Where Flutter's _calculateMetrics returned zeros (an unfinished
// stub), we compute the real completed-contract counts from the assigned-project
// list — completion is dated by the project's updatedAt when status=completed.
function ContractorDashboard({ greeting }: { greeting: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.contractor.myProjects.queryOptions());
  const projects = q.data ?? [];

  const metrics = useMemo(() => {
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const MONTH = 30 * 24 * 60 * 60 * 1000;
    let allTime = 0, thisMonth = 0, thisWeek = 0;
    for (const p of projects) {
      if (p.status !== 'completed') continue;
      allTime++;
      const t = p.updatedAt ? new Date(p.updatedAt).getTime() : null;
      if (t != null) {
        if (now - t <= MONTH) thisMonth++;
        if (now - t <= WEEK) thisWeek++;
      }
    }
    return { allTime, thisMonth, thisWeek };
  }, [projects]);

  const active = projects.filter((p) => p.status !== 'completed').slice(0, 5);

  return (
    <div className="flex flex-col gap-10">
      <div>
        <PageHeader title={greeting} description="Here's what's happening with your contracts." />
        <div className="mb-3 flex items-center gap-2 text-ui-md font-semibold text-ink-100"><ClipboardCheck className="h-5 w-5 text-accent" /> Contracts Completed</div>
        {q.isLoading ? (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full sm:h-24" />)}</div>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <MetricCard label="All Time" value={metrics.allTime} />
            <MetricCard label="This Month" value={metrics.thisMonth} />
            <MetricCard label="This Week" value={metrics.thisWeek} />
          </div>
        )}
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-h4 text-ink-100">Active Projects</h2>
          <Button variant="ghost" size="sm" asChild><Link href="/my-projects">View All</Link></Button>
        </div>
        {q.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : active.length === 0 ? (
          <Card><CardContent className="flex items-center gap-3 p-6 text-sm text-ink-60"><FolderKanban className="h-5 w-5 text-ink-40" /> No active contracts at the moment.</CardContent></Card>
        ) : (
          <Card className="p-0">
            <div className="divide-y divide-[color:var(--color-border-default)]">
              {active.map((p) => {
                const s = statusOf(p.status);
                return (
                  <Link key={p.id} href={`/my-projects?openProject=${p.id}`}>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-inset/40">
                      <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-accent/10 text-accent"><Activity className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-ink-100">{projectTitle(p)}</div>
                        <Badge variant={s.variant} className="mt-1">{s.label}</Badge>
                      </div>
                      {cyclePrice(p) > 0 && <span className="text-sm font-semibold text-success">{projectPriceSummary(p)}</span>}
                    </div>
                  </Link>
                );
              })}
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-5">
        <div className="truncate text-ui-xs text-ink-40 sm:text-ui-sm">{label}</div>
        <div className="mt-1 text-2xl font-extrabold tabular-nums leading-none tracking-tight text-ink-100 sm:text-kpi">{value}</div>
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, label, value, loading, href, highlight }: { icon: LucideIcon; label: string; value?: number; loading?: boolean; href?: string; highlight?: boolean }) {
  const card = (
    <Card className={`${highlight ? 'border-accent/40 bg-accent/[0.04]' : ''} ${href ? 'transition-shadow hover:shadow-2' : ''}`}>
      <CardContent className="flex items-center gap-3 p-3 sm:gap-4 sm:p-5">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-accent/10 text-accent sm:h-11 sm:w-11">
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-ui-xs text-ink-60 sm:text-ui-sm">{label}</div>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : <div className="text-2xl font-extrabold tabular-nums leading-none tracking-tight text-ink-100 sm:text-kpi">{value ?? 0}</div>}
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}
