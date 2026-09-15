import { useMemo, useState } from 'react';
import { CalendarRange, CalendarDays, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { Card, CardContent } from '../../components/ui/card';
import { EmptyState } from '../../components/layout/empty-state';
import { EarningsTrendChart } from './earnings-trend-chart';
import { PayoutTile, type PayoutRow } from './payout-tile';
import type { Beneficiary } from './user-filter-dialog';

const DAY = 24 * 60 * 60 * 1000;

/** Stat card — ports `_StatCard` (Weekly / Monthly / All Time). */
function StatCard({ icon: Icon, title, amount, color }: { icon: LucideIcon; title: string; amount: number; color: string }) {
  return (
    <Card className="flex-1">
      <CardContent className="flex flex-col items-start gap-2 p-3 md:flex-row md:items-center md:gap-4 md:p-5">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] md:h-11 md:w-11" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)`, color }}>
          <Icon className="h-4 w-4 md:h-5 md:w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-ink-60 md:text-sm">{title}</div>
          <div className="text-lg font-semibold tabular-nums text-ink-100 md:text-2xl">{formatCurrency(amount)}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function dateOnly(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatGroupDate(ms: number) {
  const now = new Date();
  const today = dateOnly(now);
  const yesterday = today - DAY;
  if (ms === today) return 'Today';
  if (ms === yesterday) return 'Yesterday';
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium' }).format(new Date(ms));
}

/** Collapsible per-day group — ports `_DailyPayoutsGroup`. */
function DailyGroup({ dateMs, payouts, viewerId, viewerAgencyId, beneficiaryById }: { dateMs: number; payouts: PayoutRow[]; viewerId?: string; viewerAgencyId?: string; beneficiaryById: Record<string, Beneficiary> }) {
  const [open, setOpen] = useState(true);
  const total = payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between py-2">
        <span className="text-sm font-semibold text-ink-100">{formatGroupDate(dateMs)}</span>
        <span className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums text-ink-100">{formatCurrency(total)}</span>
          {open ? <ChevronUp className="h-4 w-4 text-ink-40" /> : <ChevronDown className="h-4 w-4 text-ink-40" />}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 pt-2">
          {payouts.map((p) => (
            <PayoutTile key={p.id} payout={p} viewerId={viewerId} viewerAgencyId={viewerAgencyId} beneficiary={beneficiaryById[p.beneficiaryAgencyId ?? p.beneficiaryId ?? '']} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Earnings tab body — ports `_EarningsContent`: 3 time-windowed stat cards,
 * the Earnings Trend chart, and the day-grouped payout history. Responsive:
 * desktop puts stats and chart side-by-side (1:2), otherwise stacked.
 */
export function EarningsContent({ payouts, isFuture, viewerId, viewerAgencyId, beneficiaryById }: { payouts: PayoutRow[]; isFuture: boolean; viewerId?: string; viewerAgencyId?: string; beneficiaryById: Record<string, Beneficiary> }) {
  const { weekly, monthly, allTime } = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY;
    const weekAfter = now + 7 * DAY;
    const monthAgo = now - 30 * DAY;
    const monthAfter = now + 30 * DAY;
    let w = 0;
    let m = 0;
    let all = 0;
    for (const p of payouts) {
      const t = new Date(p.toPayAt ?? p.createdAt ?? now).getTime();
      const amt = Number(p.amount) || 0;
      all += amt;
      if (!isFuture) {
        if (t > weekAgo) w += amt;
        if (t > monthAgo) m += amt;
      } else {
        if (t > now && t < weekAfter) w += amt;
        if (t > now && t < monthAfter) m += amt;
      }
    }
    return { weekly: w, monthly: m, allTime: all };
  }, [payouts, isFuture]);

  const groups = useMemo(() => {
    const map = new Map<number, PayoutRow[]>();
    for (const p of payouts) {
      const key = dateOnly(new Date(p.toPayAt ?? p.createdAt ?? Date.now()));
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    const keys = [...map.keys()].sort((a, b) => (isFuture ? a - b : b - a));
    return keys.map((k) => {
      const rows = map.get(k)!.sort((a, b) => {
        const ta = new Date(a.toPayAt ?? a.createdAt ?? 0).getTime();
        const tb = new Date(b.toPayAt ?? b.createdAt ?? 0).getTime();
        return isFuture ? ta - tb : tb - ta;
      });
      return { key: k, rows };
    });
  }, [payouts, isFuture]);

  return (
    <div className="flex flex-col gap-5 pt-5 md:gap-8 md:pt-6">
      <div className="flex flex-col gap-4 md:gap-6 lg:flex-row">
        <div className="grid grid-cols-3 gap-3 md:gap-4 lg:flex lg:w-1/3 lg:flex-col">
          <StatCard icon={CalendarRange} title="Weekly" amount={weekly} color="var(--color-ink-100)" />
          <StatCard icon={CalendarDays} title="Monthly" amount={monthly} color="#00D2FF" />
          <StatCard icon={Wallet} title="All Time" amount={allTime} color="#34E89E" />
        </div>
        <Card className="lg:w-2/3">
          <CardContent className="p-4 md:p-6">
            <div className="mb-4 text-lg font-semibold text-ink-100">Earnings Trend</div>
            <div className="h-[220px] w-full md:h-[260px]">
              <EarningsTrendChart payouts={payouts} isFuture={isFuture} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="mb-4 text-lg font-bold text-ink-100 md:text-xl">{isFuture ? 'Future Earnings' : 'Payout History'}</h2>
        {payouts.length === 0 ? (
          <EmptyState icon={Wallet} title={isFuture ? 'No future earnings found' : 'No payouts yet'} description={isFuture ? 'Predicted earnings from recurring work will appear here.' : 'Earnings from completed work will appear here.'} />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <DailyGroup key={g.key} dateMs={g.key} payouts={g.rows} viewerId={viewerId} viewerAgencyId={viewerAgencyId} beneficiaryById={beneficiaryById} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
