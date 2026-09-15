/* Analytics — all-time totals (from clickCount) + windowed event analytics
 * (time-series, unique visitors, device / browser / OS / referrer / country /
 * QR-vs-click source) from link_events, captured by the redirector. Event data
 * accrues from when capture went live, so early windows are sparse; the all-time
 * KPIs come from the denormalized click counter. Bot/prefetch hits are stored
 * but excluded unless the "+ Bots" toggle is on. */
import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Icon, SkeletonTable, EmptyState, Seg } from '../components';
import { num, shortDisplay } from '../lib';
import type { PageProps } from '../types';
import type { RouterOutputs } from '@server/trpc/router';

type AnalyticsData = RouterOutputs['shortLinks']['analytics'];

const WorldMap = lazy(() => import('@shared/components/analytics/world-map'));

type Win = '7' | '30' | '90';
type Row = { key: string; n: number };

const SOURCE_LABELS: Record<string, string> = {
  link: 'Link click',
  qr: 'QR scan',
};

/** Daily click bars across the window (clicks height; unique in the tooltip). */
function SeriesChart({
  data,
  height = 140,
}: {
  data: { day: string; clicks: number; unique: number }[];
  height?: number;
}) {
  const max = Math.max(...data.map((d) => d.clicks), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }}>
      {data.map((d) => (
        <div
          key={d.day}
          title={`${d.day}: ${d.clicks} clicks · ${d.unique} unique`}
          style={{ flex: 1, display: 'flex', alignItems: 'flex-end', height: '100%' }}
        >
          <div
            style={{
              width: '100%',
              background: d.clicks > 0 ? 'var(--adeyy)' : 'var(--bg-inset)',
              borderRadius: '2px 2px 0 0',
              height: Math.max((d.clicks / max) * 100, 2) + '%',
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Breakdown({
  title,
  rows,
  meta,
}: {
  title: string;
  rows: Row[];
  meta?: string;
}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="dcard">
      <div className="dh">
        <h2>{title}</h2>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <div className="db">
        {rows.length === 0 ? (
          <p className="mutetext">No data in this window yet.</p>
        ) : (
          rows.map((r) => (
            <div className="hbar alt" key={r.key}>
              <span className="hl" title={r.key}>
                {r.key}
              </span>
              <span className="ht">
                <i style={{ width: Math.round((r.n / max) * 100) + '%' }} />
              </span>
              <span className="hv">{num(r.n)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function Analytics({ brandId, go }: PageProps) {
  const trpc = useTRPC();
  const [win, setWin] = useState<Win>('30');
  const [includeBots, setIncludeBots] = useState(false);
  const { data, isLoading } = useQuery(
    trpc.shortLinks.analytics.queryOptions({
      brandId,
      days: Number(win),
      includeBots,
    }),
  );

  if (isLoading) {
    return (
      <div>
        <div className="apage-head">
          <h1>Analytics</h1>
        </div>
        <SkeletonTable rows={6} />
      </div>
    );
  }

  if (!data || data.totalLinks === 0) {
    return (
      <div>
        <div className="apage-head">
          <h1>Analytics</h1>
        </div>
        <EmptyState
          title="Nothing to measure yet."
          body="Create a link and switch it on — clicks will show up here."
        />
      </div>
    );
  }

  const maxClicks = Math.max(...data.topLinks.map((l) => l.clickCount), 1);
  const sourceRows: Row[] = data.bySource.map((s) => ({
    key: SOURCE_LABELS[s.key] ?? s.key,
    n: s.n,
  }));

  return (
    <div>
      <div className="apage-head">
        <h1>Analytics</h1>
        <span className="spacer" />
        <Seg
          value={includeBots ? '1' : '0'}
          options={[
            { value: '0', label: 'Humans' },
            { value: '1', label: '+ Bots' },
          ]}
          onChange={(v) => setIncludeBots(v === '1')}
        />
        <Seg
          value={win}
          options={[
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ]}
          onChange={setWin}
        />
        <button
          type="button"
          className="abtn abtn-quiet"
          disabled={data.windowClicks === 0}
          onClick={() => exportCsv(data, Number(win))}
        >
          <Icon name="external" size={14} /> Export
        </button>
      </div>

      <div className="kpis">
        <div className="kpi accent">
          <div className="lbl">Total clicks</div>
          <div className="num">{num(data.totalClicks)}</div>
          <div className="sub">All time</div>
        </div>
        <div className="kpi">
          <div className="lbl">Unique · {data.days}d</div>
          <div className="num">{num(data.uniqueVisitors)}</div>
          <div className="sub">Distinct visitors</div>
        </div>
        <div className="kpi">
          <div className="lbl">Clicks · {data.days}d</div>
          <div className="num">{num(data.windowClicks)}</div>
          <div className="sub">
            {data.botCount > 0 && !includeBots
              ? `+${num(data.botCount)} bots filtered`
              : 'In this window'}
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Active links</div>
          <div className="num">{num(data.activeLinks)}</div>
          <div className="sub">{num(data.totalLinks)} total</div>
        </div>
        <div className="kpi">
          <div className="lbl">Avg / link</div>
          <div className="num">
            {num(Math.round(data.totalClicks / Math.max(data.totalLinks, 1)))}
          </div>
          <div className="sub">Lifetime</div>
        </div>
      </div>

      {/* Time series */}
      <div className="chartbox" style={{ marginBottom: 22 }}>
        <div className="ch">
          <span className="t">Clicks per day</span>
          <span className="legend">
            <span>
              <i style={{ background: 'var(--adeyy)' }} />
              Clicks
            </span>
          </span>
        </div>
        <SeriesChart data={data.series} />
      </div>

      {/* World map — clicks by country */}
      <div className="chartbox" style={{ marginBottom: 22 }}>
        <div className="ch">
          <span className="t">Where clicks come from</span>
          <span className="meta">By country · {data.days}d</span>
        </div>
        {data.byCountry.length === 0 ? (
          <p className="mutetext">No location data in this window yet.</p>
        ) : (
          <Suspense
            fallback={<div style={{ height: 300, background: 'var(--bg-inset)', borderRadius: 8 }} />}
          >
            <WorldMap
              data={data.byCountry.map((c) => ({ country: c.key, count: c.n }))}
              accentColor="#f5a623"
            />
          </Suspense>
        )}
      </div>

      {/* Top links and countries — balanced columns. */}
      <div className="kpis three" style={{ alignItems: 'start', marginBottom: 22 }}>
        {/* Top links */}
        <div className="dcard">
          <div className="dh">
            <h2>Top links</h2>
            <span className="meta">By clicks · all time</span>
          </div>
          <div className="db">
            {data.topLinks.length === 0 ? (
              <p className="mutetext">No clicks recorded yet.</p>
            ) : (
              data.topLinks.map((l) => (
                <div
                  className="hbar"
                  key={l.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => go('detail', { linkId: l.id })}
                >
                  <span className="hl slug" title={l.nickname || l.slug}>
                    {shortDisplay(l.slug)}
                  </span>
                  <span className="ht">
                    <i style={{ width: Math.round((l.clickCount / maxClicks) * 100) + '%' }} />
                  </span>
                  <span className="hv">{num(l.clickCount)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Countries — windowed click counts by country. */}
        <Breakdown title="Countries" rows={data.byCountry} meta={`Top · ${data.days}d`} />
      </div>

      {/* Audience — device / browser / OS. */}
      <div className="kpis three" style={{ alignItems: 'start', marginBottom: 22 }}>
        <Breakdown title="Device" rows={data.byDevice} />
        <Breakdown title="Browser" rows={data.byBrowser} />
        <Breakdown title="Operating system" rows={data.byOs} />
      </div>

      {/* Referrers + source (QR vs link). */}
      <div className="kpis three" style={{ alignItems: 'start' }}>
        <Breakdown title="Top referrers" rows={data.byReferrer} />
        <Breakdown title="Scan vs. click" rows={sourceRows} meta="QR vs. link" />
      </div>
    </div>
  );
}

/** Build + download a CSV of the current window (series + key breakdowns). */
function exportCsv(data: AnalyticsData, days: number) {
  const lines: string[] = [];
  const section = (title: string, header: string, rows: string[]) =>
    lines.push(title, header, ...rows, '');
  section(
    `Daily clicks (last ${days} days)`,
    'date,clicks,unique_visitors',
    data.series.map((s) => `${s.day},${s.clicks},${s.unique}`),
  );
  section(
    'Top links (all time)',
    'slug,nickname,clicks',
    data.topLinks.map(
      (l) => `${csv(l.slug)},${csv(l.nickname ?? '')},${l.clickCount}`,
    ),
  );
  section(
    'Countries',
    'country,clicks',
    data.byCountry.map((c) => `${csv(c.key)},${c.n}`),
  );
  section(
    'Devices',
    'device,clicks',
    data.byDevice.map((d) => `${csv(d.key)},${d.n}`),
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `links-analytics-${days}d.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
