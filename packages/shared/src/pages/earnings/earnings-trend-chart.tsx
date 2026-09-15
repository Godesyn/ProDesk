import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { formatCurrency } from '../../lib/utils';

interface PayoutLike {
  amount: string | number;
  toPayAt?: string | Date | null;
  createdAt?: string | Date | null;
}

/**
 * "Earnings Trend" chart — ports `_SimpleLineChart`: 9 weekly buckets with a
 * gradient area fill and point markers. Buckets are anchored to the most recent
 * payout date (or now) and run backwards (past) / forwards (future).
 */
export function EarningsTrendChart({ payouts, isFuture }: { payouts: PayoutLike[]; isFuture: boolean }) {
  const data = useMemo(() => {
    const week = 7 * 24 * 60 * 60 * 1000;
    const buckets = Array.from({ length: 9 }, (_, i) => ({ i, total: 0 }));
    const now = Date.now();
    for (const p of payouts) {
      const t = new Date(p.toPayAt ?? p.createdAt ?? now).getTime();
      const deltaWeeks = isFuture ? Math.floor((t - now) / week) : Math.floor((now - t) / week);
      // Index 8 = current/nearest week, 0 = oldest/furthest.
      const idx = 8 - Math.min(8, Math.max(0, deltaWeeks));
      buckets[idx].total += Number(p.amount) || 0;
    }
    return buckets.map((b) => ({ week: `W${b.i + 1}`, amount: b.total }));
  }, [payouts, isFuture]);

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ left: -10, top: 8, right: 8 }}>
        <defs>
          <linearGradient id="earningsTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-hairline)" vertical={false} />
        <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--color-ink-40)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--color-ink-40)' }} axisLine={false} tickLine={false} width={48} />
        <Tooltip formatter={(v) => formatCurrency(v as number)} cursor={{ stroke: 'var(--color-border-default)' }} />
        <Area type="monotone" dataKey="amount" stroke="var(--color-accent)" strokeWidth={2} fill="url(#earningsTrend)" dot={{ r: 3, fill: 'var(--color-accent)' }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
