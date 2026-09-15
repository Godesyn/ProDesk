import { useSignaturesContext } from '@/app/context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/trpc';
import { format } from 'date-fns';
import {
  BarChart3,
  Bot,
  Download,
  Globe2,
  MousePointerClick,
  Sparkles,
  Users,
  UserCheck,
} from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { RouterOutputs } from '@server/trpc/router';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const WorldMap = lazy(() => import('@shared/components/analytics/world-map'));

type Overview = RouterOutputs['signatures']['analytics']['overview'];
type Breakdown = Overview['byDevice'];
type EventType = Overview['byType'][number]['eventType'];

/** Signatures brand accent (lime) + a coherent chart palette. */
const ACCENT = 'var(--color-primary)'; // lime-500 — readable on white, on-brand with the lime
const ACCENT_SOFT = 'var(--color-primary)';
const INK = '#0E0E0C';

const EVENT_LABELS: Record<string, string> = {
  banner_click: 'Banner',
  cta_click: 'CTA',
  verdiict_review_click: 'Get a Review',
  verdiict_reviews_click: 'See Reviews',
  social_click: 'Social',
  email_click: 'Email',
  phone_click: 'Phone',
  website_click: 'Website',
};

const EVENT_COLORS: Record<string, string> = {
  banner_click: 'var(--color-primary)',
  cta_click: '#0E0E0C',
  verdiict_review_click: '#eab308',
  verdiict_reviews_click: '#f59e0b',
  social_click: '#3b82f6',
  email_click: '#8b5cf6',
  phone_click: '#14b8a6',
  website_click: '#ec4899',
};

const DAY_OPTIONS = [
  { value: '7', label: '7d' },
  { value: '30', label: '30d' },
  { value: '90', label: '90d' },
];

const num = (n: number) => n.toLocaleString();

export default function AnalyticsPage() {
  // One brand at a time — the one chosen in the side-panel context selector.
  // This page used to carry its own brand chips plus an "All brands" aggregate;
  // both are gone, so what you see always matches the switcher.
  const { brandId: selectedBrandId, activeBrand } = useSignaturesContext();

  const [days, setDays] = useState(30);
  const [includeBots, setIncludeBots] = useState(false);

  const { data: overview, isLoading: loading } =
    trpc.signatures.analytics.overview.useQuery(
      { brandId: selectedBrandId!, days, includeBots },
      { enabled: !!selectedBrandId },
    );

  // Still routed through the merge helper: it's what fills in an empty window
  // (zeroed series, empty breakdowns) so every chart below has a shape to render.
  const data = useMemo(
    () => mergeOverviews(overview ? [overview] : [], days, includeBots),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(overview ?? null), days, includeBots],
  );

  const seriesData = data.series.map((s) => ({
    ...s,
    label: format(new Date(s.day), 'd MMM'),
  }));
  const typeChart = data.byType.map((t) => ({
    name: EVENT_LABELS[t.eventType] ?? t.eventType,
    count: t.count,
    type: t.eventType,
  }));
  const memberMax = Math.max(1, ...data.byMember.map((m) => m.clicks));

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* Header + controls */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real clicks, unique visitors and reach across
            {activeBrand ? ` ${activeBrand.businessName}'s` : ' your'} email
            signatures.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={String(days)}
            onValueChange={(v) => v && setDays(Number(v))}
            variant="outline"
            size="sm"
          >
            {DAY_OPTIONS.map((o) => (
              <ToggleGroupItem key={o.value} value={o.value} className="px-3">
                {o.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground select-none">
            <Switch checked={includeBots} onCheckedChange={setIncludeBots} />
            Include bots
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv(data, days)}
            disabled={data.windowClicks === 0}
          >
            <Download className="w-4 h-4 mr-1.5" /> Export
          </Button>
        </div>
      </div>

      {!selectedBrandId ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Pick a brand from the switcher in the side panel to see its analytics.
          </CardContent>
        </Card>
      ) : loading && data.windowClicks === 0 && data.totalClicks === 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatTile
              icon={<MousePointerClick className="w-5 h-5" />}
              label="Total clicks"
              value={data.totalClicks}
              sub="All time"
              accent
            />
            <StatTile
              icon={<Users className="w-5 h-5" />}
              label="Unique visitors"
              value={data.uniqueVisitors}
              sub={`Last ${days}d`}
            />
            <StatTile
              icon={<Sparkles className="w-5 h-5" />}
              label={`Clicks · ${days}d`}
              value={data.windowClicks}
              sub={
                data.botCount > 0
                  ? `+${num(data.botCount)} bot hits filtered`
                  : 'In this window'
              }
            />
            <StatTile
              icon={<BarChart3 className="w-5 h-5" />}
              label="Top interaction"
              valueText={
                data.topEventType
                  ? (EVENT_LABELS[data.topEventType] ?? data.topEventType)
                  : '—'
              }
              sub="Most clicked"
            />
            <StatTile
              icon={<UserCheck className="w-5 h-5" />}
              label="Active members"
              value={data.activeMembers}
              sub={`Last ${days}d`}
            />
          </div>

          {/* Time series */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Clicks over time</CardTitle>
              <CardDescription>
                Total clicks vs. unique visitors, last {days} days
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart
                  data={seriesData}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="sigClicks" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    allowDecimals={false}
                    width={40}
                  />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area
                    type="monotone"
                    dataKey="clicks"
                    name="Clicks"
                    stroke={ACCENT}
                    strokeWidth={2}
                    fill="url(#sigClicks)"
                  />
                  <Line
                    type="monotone"
                    dataKey="unique"
                    name="Unique"
                    stroke={INK}
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Event types + Team */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Clicks by type</CardTitle>
                <CardDescription>Which links people tap</CardDescription>
              </CardHeader>
              <CardContent>
                {typeChart.length === 0 ? (
                  <Empty>No clicks in this window yet.</Empty>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart
                      data={typeChart}
                      margin={{ top: 4, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        interval={0}
                        angle={-15}
                        textAnchor="end"
                        height={50}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        allowDecimals={false}
                        width={36}
                      />
                      <Tooltip
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                        formatter={(v: number) => [num(v), 'Clicks']}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {typeChart.map((entry, i) => (
                          <Cell
                            key={i}
                            fill={EVENT_COLORS[entry.type] ?? '#94a3b8'}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Team leaderboard</CardTitle>
                <CardDescription>Clicks by team member</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byMember.length === 0 ? (
                  <Empty>No member activity yet.</Empty>
                ) : (
                  <div className="space-y-3">
                    {data.byMember.slice(0, 8).map((m) => (
                      <div key={m.memberId || m.memberName}>
                        <div className="flex items-center justify-between text-sm mb-1">
                          <span className="font-medium truncate pr-2">
                            {m.memberName}
                          </span>
                          <span className="text-muted-foreground text-xs whitespace-nowrap">
                            {num(m.clicks)} clicks · {num(m.unique)} unique
                          </span>
                        </div>
                        <BarTrack ratio={m.clicks / memberMax} color={ACCENT} />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Geography */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe2 className="w-4 h-4" /> Where clicks come from
              </CardTitle>
              <CardDescription>By country, last {days} days</CardDescription>
            </CardHeader>
            <CardContent>
              {data.byCountry.length === 0 ? (
                <Empty>No location data yet.</Empty>
              ) : (
                <div className="grid gap-6 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <Suspense
                      fallback={
                        <Skeleton className="w-full aspect-[2/1] rounded-lg" />
                      }
                    >
                      <WorldMap
                        data={data.byCountry.map((c) => ({
                          country: c.key,
                          count: c.n,
                        }))}
                        accentColor="#65a30d"
                      />
                    </Suspense>
                  </div>
                  <RankList rows={data.byCountry} />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Referrers + Campaigns */}
          <div className="grid gap-6 lg:grid-cols-2">
            <BreakdownCard
              title="Top referrers"
              rows={data.byReferrer}
              description="Where the signature was viewed"
            />
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Campaign performance
                </CardTitle>
                <CardDescription>Banner campaign clicks</CardDescription>
              </CardHeader>
              <CardContent>
                {data.byCampaign.length === 0 ? (
                  <Empty>No campaign clicks yet.</Empty>
                ) : (
                  <RankList
                    rows={data.byCampaign.map((c) => ({
                      key: c.name,
                      n: c.clicks,
                    }))}
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Audience: device / browser / os */}
          <div className="grid gap-6 md:grid-cols-3">
            <BreakdownCard title="Device" rows={data.byDevice} />
            <BreakdownCard title="Browser" rows={data.byBrowser} />
            <BreakdownCard title="Operating system" rows={data.byOs} />
          </div>

          {/* Recent activity */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent activity</CardTitle>
              <CardDescription>Last 50 tracked events</CardDescription>
            </CardHeader>
            <CardContent>
              {data.recent.length === 0 ? (
                <Empty>
                  No activity yet. Share your signatures to start tracking
                  clicks.
                </Empty>
              ) : (
                <div className="space-y-1">
                  {data.recent.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between py-1.5 text-sm border-b border-border/30 last:border-0"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor:
                              EVENT_COLORS[e.eventType] ?? '#94a3b8',
                          }}
                        />
                        <span className="font-medium">
                          {EVENT_LABELS[e.eventType] ?? e.eventType}
                        </span>
                        {e.label && (
                          <span className="text-muted-foreground text-xs truncate">
                            · {e.label}
                          </span>
                        )}
                        <span className="text-muted-foreground text-xs whitespace-nowrap">
                          {[e.device, e.country].filter(Boolean).join(' · ')}
                        </span>
                        {e.isBot && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[10px] gap-0.5"
                          >
                            <Bot className="w-2.5 h-2.5" /> bot
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {format(new Date(e.createdAt), 'dd MMM, HH:mm')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ── Presentational helpers ─────────────────────────────────────────────── */

function StatTile({
  icon,
  label,
  value,
  valueText,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value?: number;
  valueText?: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center mb-3 text-foreground"
          style={{
            backgroundColor: accent ? `${ACCENT_SOFT}55` : 'hsl(var(--muted))',
          }}
        >
          {icon}
        </div>
        <div className="text-2xl font-bold truncate">
          {valueText ?? num(value ?? 0)}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
        {sub && (
          <div className="text-[11px] text-muted-foreground/70 mt-0.5">
            {sub}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BarTrack({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(2, Math.min(100, ratio * 100))}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}

function RankList({ rows }: { rows: Breakdown }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="truncate pr-2">{r.key}</span>
            <span className="text-muted-foreground text-xs">{num(r.n)}</span>
          </div>
          <BarTrack ratio={r.n / max} color={ACCENT} />
        </div>
      ))}
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  description,
}: {
  title: string;
  rows: Breakdown;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty>No data yet.</Empty>
        ) : (
          <RankList rows={rows} />
        )}
      </CardContent>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground text-center py-6">{children}</p>
  );
}


/* ── Data helpers ───────────────────────────────────────────────────────── */

/**
 * Normalise the overview into the shape every chart below expects. Kept as a
 * list-merge (it once aggregated several brands at once) because it's also what
 * synthesises an EMPTY window — zeroed series, empty breakdowns — so a brand with
 * no traffic yet still renders the full dashboard instead of blank panels.
 */
function mergeOverviews(
  list: Overview[],
  days: number,
  includeBots: boolean,
): Overview {
  const empty: Overview = {
    days,
    includeBots,
    totalClicks: 0,
    windowClicks: 0,
    uniqueVisitors: 0,
    activeMembers: 0,
    botCount: 0,
    topEventType: null,
    series: [],
    byType: [],
    byMember: [],
    byCampaign: [],
    byDevice: [],
    byBrowser: [],
    byOs: [],
    byCountry: [],
    byReferrer: [],
    recent: [],
  };
  if (list.length === 0) return empty;
  if (list.length === 1) return list[0];

  const mergeBreak = (arrs: Breakdown[]): Breakdown => {
    const m = new Map<string, number>();
    for (const arr of arrs)
      for (const r of arr) m.set(r.key, (m.get(r.key) ?? 0) + r.n);
    return [...m.entries()]
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8);
  };

  // series: same window for all brands → merge by day, preserving order.
  const seriesMap = new Map<string, { clicks: number; unique: number }>();
  for (const o of list)
    for (const s of o.series) {
      const e = seriesMap.get(s.day) ?? { clicks: 0, unique: 0 };
      e.clicks += s.clicks;
      e.unique += s.unique;
      seriesMap.set(s.day, e);
    }
  const series = (list[0]?.series ?? []).map((s) => ({
    day: s.day,
    ...(seriesMap.get(s.day) ?? { clicks: 0, unique: 0 }),
  }));

  const typeMap = new Map<EventType, number>();
  for (const o of list)
    for (const r of o.byType)
      typeMap.set(r.eventType, (typeMap.get(r.eventType) ?? 0) + r.count);
  const byType = [...typeMap.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count);

  return {
    days,
    includeBots,
    totalClicks: sum(list, (o) => o.totalClicks),
    windowClicks: sum(list, (o) => o.windowClicks),
    uniqueVisitors: sum(list, (o) => o.uniqueVisitors),
    activeMembers: sum(list, (o) => o.activeMembers),
    botCount: sum(list, (o) => o.botCount),
    topEventType: byType[0]?.eventType ?? null,
    series,
    byType,
    byMember: list
      .flatMap((o) => o.byMember)
      .sort((a, b) => b.clicks - a.clicks),
    byCampaign: list
      .flatMap((o) => o.byCampaign)
      .sort((a, b) => b.clicks - a.clicks),
    byDevice: mergeBreak(list.map((o) => o.byDevice)),
    byBrowser: mergeBreak(list.map((o) => o.byBrowser)),
    byOs: mergeBreak(list.map((o) => o.byOs)),
    byCountry: mergeBreak(list.map((o) => o.byCountry)),
    byReferrer: mergeBreak(list.map((o) => o.byReferrer)),
    recent: list
      .flatMap((o) => o.recent)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 50),
  };
}

function sum<T>(list: T[], pick: (t: T) => number): number {
  return list.reduce((s, t) => s + pick(t), 0);
}

/** Build + download a CSV of the current window (series + key breakdowns). */
function exportCsv(data: Overview, days: number) {
  const lines: string[] = [];
  const section = (title: string, header: string, rows: string[]) => {
    lines.push(title, header, ...rows, '');
  };
  section(
    `Daily activity (last ${days} days)`,
    'date,clicks,unique_visitors',
    data.series.map((s) => `${s.day},${s.clicks},${s.unique}`),
  );
  section(
    'Clicks by type',
    'type,clicks',
    data.byType.map((t) => `${t.eventType},${t.count}`),
  );
  section(
    'Clicks by member',
    'member,clicks,unique',
    data.byMember.map((m) => `${csv(m.memberName)},${m.clicks},${m.unique}`),
  );
  section(
    'Clicks by country',
    'country,clicks',
    data.byCountry.map((c) => `${csv(c.key)},${c.n}`),
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `signatures-analytics-${days}d.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Quote a CSV field when it contains a comma or quote. */
function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
