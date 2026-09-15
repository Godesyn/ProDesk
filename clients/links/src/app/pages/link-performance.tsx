/* Per-row click analytics — the "Performance" card on a link's and a campaign's
 * detail screen.
 *
 * Campaigns are `short_links` rows (kind='campaign'), so both screens read the
 * same `shortLinks.linkAnalytics` procedure and want the identical card: windowed
 * clicks/uniques/all-time, a daily series, and the device / country / scan-vs-click
 * breakdowns. It lives here rather than in LinkDetail so the two can't drift —
 * same reasoning as campaign-windows.tsx.
 *
 * The card owns its own 7/30/90-day window state: it's a view preference with no
 * meaning outside this card, and keeping it here means a screen can drop the card
 * in with nothing but an id.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { Seg } from '../components';
import { num } from '../lib';

export function PerformanceCard({
  linkId,
  /** Wording for the empty state — a campaign "serves" rather than "redirects". */
  emptyHint = 'No clicks in this window yet.',
}: {
  linkId: string;
  emptyHint?: string;
}) {
  const trpc = useTRPC();
  const [statWin, setStatWin] = useState<'7' | '30' | '90'>('30');
  const { data: stats } = useQuery(
    trpc.shortLinks.linkAnalytics.queryOptions({
      linkId,
      days: Number(statWin),
    }),
  );

  return (
    <div className="dcard">
      <div className="dh">
        <h2>Performance</h2>
        <span className="spacer" />
        <Seg
          value={statWin}
          options={[
            { value: '7', label: '7d' },
            { value: '30', label: '30d' },
            { value: '90', label: '90d' },
          ]}
          onChange={setStatWin}
        />
      </div>
      <div className="db">
        {!stats || stats.windowClicks === 0 ? (
          <p className="mutetext">{emptyHint}</p>
        ) : (
          <>
            <div className="kpis" style={{ marginBottom: 18 }}>
              <div className="kpi">
                <div className="lbl">Clicks · {stats.days}d</div>
                <div className="num">{num(stats.windowClicks)}</div>
              </div>
              <div className="kpi">
                <div className="lbl">Unique · {stats.days}d</div>
                <div className="num">{num(stats.uniqueVisitors)}</div>
              </div>
              <div className="kpi">
                <div className="lbl">All-time</div>
                <div className="num">{num(stats.totalClicks)}</div>
              </div>
            </div>
            <MiniSeries data={stats.series} />
            <div
              className="kpis three"
              style={{ alignItems: 'start', marginTop: 18 }}
            >
              <MiniBreakdown title="Device" rows={stats.byDevice} />
              <MiniBreakdown title="Country" rows={stats.byCountry} />
              <MiniBreakdown
                title="Scan vs. click"
                rows={stats.bySource.map((s) => ({
                  key: s.key === 'qr' ? 'QR scan' : 'Link click',
                  n: s.n,
                }))}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Daily click bars for a single link. */
function MiniSeries({
  data,
}: {
  data: { day: string; clicks: number; unique: number }[];
}) {
  const max = Math.max(...data.map((d) => d.clicks), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 120 }}>
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

/** Ranked horizontal bars for a single-link breakdown. */
function MiniBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; n: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.n), 1);
  return (
    <div className="dcard">
      <div className="dh">
        <h2>{title}</h2>
      </div>
      <div className="db">
        {rows.length === 0 ? (
          <p className="mutetext">No data yet.</p>
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
