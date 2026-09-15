import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import type { RouterOutputs } from '@server/trpc/router';
import { useTRPC } from '../../../lib/trpc';
import { cn } from '../../../lib/utils';
import { useReducedMotion } from './motion';

/**
 * MONITORING — the second view of the Sending Floor.
 *
 * It shares the floor's surface rather than taking a nav tab of its own, because
 * the question it answers ("is it safe to keep sending?") is only ever asked
 * about the mailboxes next door. What it does not share is the same screen: this
 * is weeks of trend, and it was sitting underneath the controls you reach for
 * when something is on fire. `slidingDomains` is exported so the switch between
 * the two can carry the alarm — a tab you have to open to learn a domain is
 * failing is a tab that will be opened too late.
 *
 * Two deliberate constraints on the chart:
 *
 *  • **One measure, one axis.** Volume is charted; reply and bounce RATES are not
 *    plotted beside it. Sent runs in the hundreds and bounced in the single
 *    digits, so sharing an axis would flatten one and a second axis would be a
 *    lie. Rates are numbers in the grid instead.
 *  • **Bounces stack rather than sit alongside.** A bounced email is a sent email,
 *    so the segment is a true part of the same bar in the same unit — not a
 *    second series smuggled onto the same scale.
 *
 * Per-domain data is window aggregates only: Smartlead exposes a daily series
 * for the account as a whole and nothing finer, so there are no per-domain
 * sparklines here. Drawing one would imply a granularity we don't have.
 */

type Floor = RouterOutputs['outreach']['floor'];
type DayStat = RouterOutputs['outreach']['dayWiseStats'][number];

/** A domain losing this many points of deliverability week-on-week is in trouble. */
const TREND_ALARM = 2;

function pct(v: number | null, decimals = 1): string {
  return v === null ? '—' : `${(v * 100).toFixed(decimals)}%`;
}

/**
 * The domains actually sliding.
 *
 * Read here to name them up front, and read by the floor's view switch to mark
 * the tab — a number buried in a grid is something you have to go looking for,
 * and this is the thing that must interrupt.
 */
export function slidingDomains(floor: Floor): Floor['domains'] {
  return floor.domains.filter(
    (d) => d.health?.deliverabilityTrend != null && d.health.deliverabilityTrend <= -TREND_ALARM,
  );
}

export function MonitoringPanel({ floor }: { floor: Floor }) {
  const trpc = useTRPC();
  const reduced = useReducedMotion();
  const [days, setDays] = useState(28);

  const statsQuery = useQuery(trpc.outreach.dayWiseStats.queryOptions({ days }));
  const stats = statsQuery.data ?? [];

  const sliding = slidingDomains(floor);

  return (
    <section className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-[color:var(--color-border-hairline)] px-5 py-4">
        <div>
          <h2 className="text-panel-title text-ink-100">Monitoring</h2>
          <p className="text-ui-xs mt-1 text-ink-60">
            Deliverability per domain, and how much we&rsquo;ve been sending.
          </p>
        </div>
        <div
          role="group"
          aria-label="Time range"
          className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
        >
          {[7, 28, 90].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                'press h-8 px-3 text-ui-xs transition-colors duration-[var(--duration-quick)]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                days === d ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </header>

      {sliding.length > 0 && (
        <div className="flex items-start gap-2 border-b border-[color:var(--color-border-hairline)] bg-inset px-5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <p className="text-ui-sm text-ink-100">
            {sliding.map((d, i) => (
              <span key={d.domain}>
                {i > 0 && ', '}
                <span className="mono">{d.domain}</span> is down{' '}
                <span className="tnum">
                  {Math.abs(d.health!.deliverabilityTrend!).toFixed(1)}
                </span>{' '}
                points
              </span>
            ))}{' '}
            <span className="text-ink-60">
              on last week. Slow that domain down before it gets worse — reputation recovers far
              slower than it drops.
            </span>
          </p>
        </div>
      )}

      <VolumeChart stats={stats} loading={statsQuery.isPending} reduced={reduced} days={days} />

      <DomainGrid floor={floor} />
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Volume
 * ────────────────────────────────────────────────────────────────────────── */

function VolumeChart({
  stats,
  loading,
  reduced,
  days,
}: {
  stats: DayStat[];
  loading: boolean;
  reduced: boolean;
  days: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const max = useMemo(() => Math.max(1, ...stats.map((s) => s.sent)), [stats]);
  const total = useMemo(() => stats.reduce((sum, s) => sum + s.sent, 0), [stats]);
  const bounced = useMemo(() => stats.reduce((sum, s) => sum + s.bounced, 0), [stats]);

  if (loading) {
    return (
      <div className="px-5 py-5">
        <div className="pd-shimmer h-[140px] w-full rounded-[var(--radius-sm)]" />
      </div>
    );
  }

  if (stats.length === 0 || total === 0) {
    return (
      <div className="px-5 py-8">
        <p className="text-ui-sm text-ink-60">Nothing sent in the last {days} days.</p>
        <p className="text-ui-xs mt-1 text-ink-40">
          Volume appears here once a campaign starts sending.
        </p>
      </div>
    );
  }

  const CHART_H = 140;
  const active = hover !== null ? stats[hover] : null;

  return (
    <div className="px-5 py-5">
      <div className="flex items-baseline justify-between gap-4">
        {/* The chart has one series, so the title names it — no legend box. */}
        <div>
          <div className="eyebrow">Emails sent</div>
          <div className="tnum text-kpi mt-1 text-ink-100">{total.toLocaleString()}</div>
        </div>
        <div className="text-right">
          <div className="eyebrow">Bounced</div>
          <div
            className={cn(
              'tnum text-ui-lg mt-1',
              bounced / total > 0.02 ? 'text-danger' : 'text-ink-60',
            )}
          >
            {bounced.toLocaleString()}
            <span className="text-ui-xs text-ink-40"> · {pct(bounced / total)}</span>
          </div>
        </div>
      </div>

      {/* Bars: discrete daily counts, so bars rather than a line. Bounced is a
          stacked segment of the same bar — a bounced email IS a sent email. */}
      <div
        className="relative mt-4"
        style={{ height: CHART_H }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="flex h-full items-end gap-[2px]">
          {stats.map((s, i) => {
            const h = (s.sent / max) * CHART_H;
            const bounceH = s.sent > 0 ? Math.max(s.bounced > 0 ? 2 : 0, (s.bounced / max) * CHART_H) : 0;
            return (
              <div
                key={`${s.date}-${i}`}
                className="group relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                role="img"
                aria-label={`${s.date}: ${s.sent} sent, ${s.replied} replied, ${s.bounced} bounced`}
                style={{ minWidth: 0 }}
              >
                <div
                  className="w-full overflow-hidden rounded-t-[4px]"
                  style={{
                    height: Math.max(s.sent > 0 ? 2 : 0, h),
                    transition: reduced ? undefined : 'height var(--duration-statement) var(--ease-click)',
                  }}
                >
                  {/* Bounced sits at the top of the bar with a 2px surface gap
                      beneath it, so the two segments never blur into one mark. */}
                  {bounceH > 0 && (
                    <div
                      className="w-full rounded-t-[4px] bg-danger"
                      style={{ height: bounceH, marginBottom: 2 }}
                    />
                  )}
                  <div
                    className={cn(
                      'w-full',
                      hover === i ? 'bg-ink-100' : 'bg-ink-80',
                      bounceH === 0 && 'rounded-t-[4px]',
                    )}
                    style={{ height: `calc(100% - ${bounceH ? bounceH + 2 : 0}px)` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {active && (
          <div
            role="status"
            className="pointer-events-none absolute -top-1 right-0 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-paper px-3 py-2 shadow-[var(--shadow-2)]"
          >
            <div className="text-ui-xs text-ink-40">
              {active.dayName} {active.date}
            </div>
            <div className="tnum text-ui-sm mt-0.5 text-ink-100">{active.sent} sent</div>
            <div className="tnum text-ui-xs text-ink-60">
              {active.replied} replied
              {active.bounced > 0 && (
                <span className="text-danger"> · {active.bounced} bounced</span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="text-ui-xs mt-2 flex justify-between text-ink-40">
        <span>{stats[0]?.date}</span>
        <span>{stats[stats.length - 1]?.date}</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Per-domain comparison
 * ────────────────────────────────────────────────────────────────────────── */

function DomainGrid({ floor }: { floor: Floor }) {
  return (
    <div className="overflow-x-auto border-t border-[color:var(--color-border-hairline)]">
      <table className="w-full min-w-[42rem] border-collapse">
        <caption className="sr-only">Deliverability and engagement per sending domain</caption>
        <thead>
          <tr className="border-b border-[color:var(--color-border-hairline)]">
            {['Domain', 'Sent', 'Delivered', 'vs last week', 'Replied', 'Warmup', 'Warmup spam'].map(
              (h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={cn('eyebrow px-5 py-2.5 font-normal', i === 0 ? 'text-left' : 'text-right')}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {floor.domains.map((d) => {
            const h = d.health;
            const trend = h?.deliverabilityTrend ?? null;
            const falling = trend !== null && trend <= -TREND_ALARM;
            const spamHot = d.spamRate !== null && d.spamRate > 0.02;

            return (
              <tr
                key={d.domain}
                className="border-b border-[color:var(--color-border-hairline)] last:border-0"
              >
                <th scope="row" className="px-5 py-3 text-left">
                  <span className="mono text-[13px] text-ink-100">{d.domain}</span>
                  <span className="text-ui-xs ml-2 text-ink-40">
                    {d.activeCount}/{d.mailboxes.length}
                  </span>
                </th>
                <td className="tnum text-ui-sm px-5 py-3 text-right text-ink-100">
                  {h ? h.sent.toLocaleString() : '—'}
                </td>
                <td className="tnum text-ui-sm px-5 py-3 text-right text-ink-100">
                  {pct(h?.deliverability ?? null)}
                </td>
                <td
                  className={cn(
                    'tnum text-ui-sm px-5 py-3 text-right',
                    falling ? 'text-danger' : 'text-ink-40',
                  )}
                >
                  {trend === null
                    ? '—'
                    : Math.abs(trend) < 0.5
                      ? 'steady'
                      : `${trend > 0 ? '+' : '−'}${Math.abs(trend).toFixed(1)} pts`}
                </td>
                <td className="tnum text-ui-sm px-5 py-3 text-right text-ink-60">
                  {pct(h?.replyRate ?? null)}
                </td>
                <td className="tnum text-ui-sm px-5 py-3 text-right text-ink-60">
                  {d.warmupReputation === null ? '—' : Math.round(d.warmupReputation)}
                </td>
                <td
                  className={cn(
                    'tnum text-ui-sm px-5 py-3 text-right',
                    spamHot ? 'text-danger' : 'text-ink-60',
                  )}
                >
                  {pct(d.spamRate)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {floor.healthWindow && (
        <p className="text-ui-xs px-5 py-3 text-ink-40">
          Domain figures cover {floor.healthWindow.start} to {floor.healthWindow.end}, compared with
          the week before. Smartlead reports these per window, not per day, so there is no
          per-domain daily trend to show.
        </p>
      )}
    </div>
  );
}
