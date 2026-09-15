import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useCurrentUser } from "@shared/auth/auth-context";
import { NavIcon } from "@/components/AppShell";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const fmtAUD = (cents: number) =>
  "$" + (cents / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

const fmtDelta = (current: number, prior: number) => {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 100);
  return { pct, up: pct >= 0 };
};

const MONTH_LABELS: Record<string, string> = {
  "01": "Jan", "02": "Feb", "03": "Mar", "04": "Apr",
  "05": "May", "06": "Jun", "07": "Jul", "08": "Aug",
  "09": "Sep", "10": "Oct", "11": "Nov", "12": "Dec",
};

const QUICK_ACTIONS = [
  { icon: "proposals", name: "New proposal",  sub: "Two-pane builder, click to add", href: "/proposals/new" },
  { icon: "clients",   name: "Add a client",  sub: "Mobile, ABN, email, contact details", href: "/clients" },
  { icon: "templates", name: "New template",  sub: "Reusable shape for a recurring offer", href: "/templates" },
];

const ACTION_ICONS: Record<string, string> = {
  viewed: "proposals",
  card_declined: "sms",
  installment_due: "calendar",
};

const ACTION_TAGS: Record<string, string> = {
  viewed: "VIEWED · NO DECISION",
  card_declined: "CARD DECLINED",
  installment_due: "INSTALLMENT DUE",
};

const ACTION_LABELS: Record<string, string> = {
  viewed: "Send nudge",
  card_declined: "Resend Stripe",
  installment_due: "Review",
};

export default function Dashboard() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: user } = useCurrentUser();

  // Real data queries
  const { data: kpis } = useQuery({
    ...trpc.payments.accounts.dashboardFullKpis.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: actionQueue } = useQuery({
    ...trpc.payments.accounts.dashboardActionQueue.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: revenueChart } = useQuery({
    ...trpc.payments.accounts.dashboardRevenueChart.queryOptions({ brandId: brandId!, months: 7 }),
    enabled: !!brandId,
  });
  const { data: activity } = useQuery({
    ...trpc.payments.accounts.dashboardActivity.queryOptions({ brandId: brandId!, limit: 10 }),
    enabled: !!brandId,
  });
  const { data: recentProposals } = useQuery({
    ...trpc.payments.accounts.recentProposals.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: tierInfo } = useQuery({
    ...trpc.payments.billing.getTierInfo.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: waitlistStatus } = useQuery({
    ...trpc.payments.billing.getWaitlistStatus.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const joinWaitlist = useMutation({
    ...trpc.payments.billing.joinRecoverWaitlist.mutationOptions(),
    onSuccess: () => toast.success("You're on the Recover waitlist!"),
    onError: (e) => toast.error(sanitizeError(e)),
  });

  const sendNudge = useMutation({
    ...trpc.payments.chase.sendNudge.mutationOptions(),
    onSuccess: (data) => toast.success(data.message),
    onError: (err) => toast.error(sanitizeError(err)),
  });

  // Greeting
  const now = new Date();
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const eyeDate = `${days[now.getDay()].slice(0,3).toUpperCase()} · ${now.getDate()} ${months[now.getMonth()].toUpperCase()} · LAST 30 DAYS`;

  // First name from user
  const firstName = user?.firstName || "there";

  // KPI deltas
  const revDelta = fmtDelta(kpis?.paidLast30d ?? 0, kpis?.paidPrior30d ?? 0);
  const avgDelta = fmtDelta(kpis?.avgProposalCents ?? 0, kpis?.avgProposalPrior ?? 0);
  const convDelta = (kpis?.conversionRate ?? 0) - (kpis?.conversionPrior ?? 0);
  const ttaDelta = (kpis?.medianAcceptHours ?? 0) - (kpis?.medianAcceptHoursPrior ?? 0);

  // Revenue chart data — fill missing months with 0
  const chartData = (() => {
    if (!revenueChart || revenueChart.length === 0) return [];
    const map = new Map(revenueChart.map(r => [r.month, r.totalCents]));
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = MONTH_LABELS[String(d.getMonth() + 1).padStart(2, "0")] ?? key;
      result.push({ m: label, v: (map.get(key) ?? 0) / 100 });
    }
    return result;
  })();

  const totalRevenue = chartData.reduce((s, r) => s + r.v, 0);

  // Subtitle
  const chaseCount = kpis?.chaseCount ?? 0;
  const declinedCount = kpis?.cardDeclinedCount ?? 0;
  const subtitleParts = [];
  if (chaseCount > 0) subtitleParts.push(`${chaseCount} proposal${chaseCount !== 1 ? "s" : ""} to chase`);
  if (declinedCount > 0) subtitleParts.push(`${declinedCount} card declined`);
  const subtitle = subtitleParts.length > 0 ? subtitleParts.join(". ") + "." : "Everything looks good today.";

  // Activity time formatter
  const fmtTime = (ts: Date | string) => {
    const d = new Date(ts);
    const h = Math.floor((Date.now() - d.getTime()) / 3600000);
    if (h < 1) return "Just now";
    if (h < 24) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (h < 48) return "Yesterday";
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  };

  const ttaHours = kpis?.medianAcceptHours ?? 0;
  const ttaDays = Math.floor(ttaHours / 24);
  const ttaRem = ttaHours % 24;

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">{eyeDate}</span>
          <h1>Good morning, <em>{firstName}.</em></h1>
          <span className="sub">{subtitle}</span>
        </div>
        <div className="acts">
          <button className="btn ghost">
            <NavIcon name="calendar" />This month
          </button>
          <button className="btn primary" onClick={() => navigate("/proposals/new")}>
            <NavIcon name="plus" />New proposal
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpis">
        <div className="kpi volt">
          <span className="lbl">PAID · LAST 30 DAYS</span>
          <span className="num">{fmtAUD(kpis?.paidLast30d ?? 0)}</span>
          <span className="meta">
            {revDelta && (
              <span className={`delta ${revDelta.up ? "up" : ""}`}>
                {revDelta.up ? "+" : ""}{revDelta.pct}%
              </span>
            )}
            vs prior 30d
          </span>
        </div>
        <div className="kpi">
          <span className="lbl">AVERAGE PROPOSAL</span>
          <span className="num">{fmtAUD(kpis?.avgProposalCents ?? 0)}</span>
          <span className="meta">
            {avgDelta && (
              <span className={`delta ${avgDelta.up ? "up" : ""}`}>
                {avgDelta.up ? "+" : ""}{avgDelta.pct}%
              </span>
            )}
            {kpis?.sentLast30d ?? 0} sent this month
          </span>
        </div>
        <div className="kpi">
          <span className="lbl">CONVERSION</span>
          <span className="num">
            {kpis?.conversionRate ?? 0}%<span className="cents"> of sent</span>
          </span>
          <span className="meta">
            {convDelta !== 0 && (
              <span className={`delta ${convDelta > 0 ? "up" : ""}`}>
                {convDelta > 0 ? "+" : ""}{convDelta}pp
              </span>
            )}
            {kpis?.acceptedLast30d ?? 0} of {kpis?.sentLast30d ?? 0} accepted
          </span>
        </div>
        <div className="kpi">
          <span className="lbl">TIME TO ACCEPT</span>
          <span className="num">
            {ttaDays > 0 ? <>{ttaDays}d<span className="cents"> {ttaRem}h</span></> : <>{ttaHours}h</>}
          </span>
          <span className="meta">
            {ttaDelta !== 0 && (
              <span className={`delta ${ttaDelta < 0 ? "up" : ""}`}>
                {ttaDelta > 0 ? "+" : ""}{ttaDelta}h
              </span>
            )}
            median · faster than industry
          </span>
        </div>
      </div>

      {/* Tier value widget — contextual upgrade prompt */}
      {tierInfo && tierInfo.tier !== "recover" && (
        <div className="pnl" style={{ background: tierInfo.tier === "send" ? "var(--card)" : "var(--card)", border: "1px solid var(--border-1)" }}>
          <div className="pnl-hd">
            <h3>Your plan · <span style={{ color: tierInfo.tier === "close" ? "var(--volt)" : "#6B7280" }}>{tierInfo.tier.charAt(0).toUpperCase() + tierInfo.tier.slice(1)}</span></h3>
            <span className="meta" style={{ color: tierInfo.tier === "close" ? "var(--volt)" : "#6B7280" }}>{tierInfo.ratePercent}% PLATFORM FEE</span>
            <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => navigate("/settings/billing")}>
              Manage plan
            </button>
          </div>
          <div className="pnl-body" style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {tierInfo.tier === "send" && (
              <>
                <div style={{ flex: 1, fontSize: 13, color: "var(--ink-60)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--ink)" }}>Upgrade to Close</strong> to unlock payment plans, subscriptions, team members, and analytics — at {tierInfo.allTiers.close.rate}% per transaction.
                </div>
                <button
                  className="btn primary sm"
                  onClick={() => navigate("/settings/billing")}
                >
                  Upgrade to Close →
                </button>
              </>
            )}
            {tierInfo.tier === "close" && (
              <>
                <div style={{ flex: 1, fontSize: 13, color: "var(--ink-60)", lineHeight: 1.6 }}>
                  <strong style={{ color: "var(--ink)" }}>Recover</strong> is coming — automated follow-up sequences and AI-powered missed payment recovery.
                  {waitlistStatus?.onWaitlist ? (
                    <span style={{ color: "#A78BFA", marginLeft: 6 }}>✓ You're on the waitlist.</span>
                  ) : null}
                </div>
                {!waitlistStatus?.onWaitlist && (
                  <button
                    className="btn sm"
                    style={{ background: "#A78BFA", color: "#fff", border: "none", flexShrink: 0 }}
                    onClick={() => joinWaitlist.mutate({ brandId: brandId!, source: "settings" })}
                    disabled={joinWaitlist.isPending || !brandId}
                  >
                    {joinWaitlist.isPending ? "Joining..." : "Join Recover waitlist"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {/* Action queue */}
      {(actionQueue && actionQueue.length > 0) && (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Action queue · {actionQueue.length} today</h3>
            <span className="meta">SORTED · OLDEST FIRST</span>
          </div>
          <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {actionQueue.map((r, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "32px 1fr auto auto",
                gap: 14, alignItems: "center", padding: "12px 14px",
                background: "var(--paper)", borderRadius: 10, border: "1px solid var(--border-1)",
              }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--bg-inset)", display: "grid", placeItems: "center", color: "var(--ink-60)" }}>
                  <NavIcon name={ACTION_ICONS[r.type] ?? "proposals"} />
                </div>
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)" }}>
                    {ACTION_TAGS[r.type] ?? r.type.toUpperCase()}
                  </div>
                  <div style={{ fontWeight: 600, marginTop: 2 }}>
                    {r.clientName} <span style={{ color: "var(--ink-60)", fontWeight: 400 }}>· {r.title}</span>
                  </div>
                  {r.meta && r.type !== "viewed" && (
                    <div style={{ fontSize: 11, color: "var(--ink-60)", marginTop: 2 }}>{r.meta}</div>
                  )}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)", letterSpacing: "0.04em" }}>{r.age}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                    {fmtAUD(r.totalCents)}
                  </span>
                  <button
                    className="btn sm"
                    disabled={r.type === "viewed" && sendNudge.isPending}
                    onClick={() => {
                      if (r.type === "viewed") {
                        sendNudge.mutate({ proposalId: r.proposalId });
                      } else if (r.type === "card_declined") {
                        navigate(`/proposals/${r.proposalId}`);
                      } else {
                        navigate(`/proposals/${r.proposalId}`);
                      }
                    }}
                  >
                    {ACTION_LABELS[r.type] ?? "Review"} <NavIcon name="arrow_r" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty action queue state */}
      {(actionQueue && actionQueue.length === 0) && (
        <div className="pnl">
          <div className="pnl-hd"><h3>Action queue</h3><span className="meta">ALL CLEAR</span></div>
          <div className="pnl-body" style={{ textAlign: "center", padding: "32px 0", color: "var(--ink-60)" }}>
            Nothing needs your attention right now.
          </div>
        </div>
      )}

      {/* Revenue chart + Activity */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Revenue · last 7 months</h3>
            <span className="meta">{fmtAUD(totalRevenue * 100)} TOTAL</span>
          </div>
          <div className="pnl-body">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#D9F542" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#D9F542" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-1)" vertical={false} />
                  <XAxis dataKey="m" tick={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--ink-60)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--ink-60)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v >= 1000 ? (v/1000).toFixed(0) + "k" : v}`} />
                  <Tooltip
                    contentStyle={{ background: "var(--ink)", border: "none", borderRadius: 8, color: "var(--paper)", fontFamily: "var(--font-mono)", fontSize: 11 }}
                    formatter={(v: number) => [fmtAUD(v * 100), "Revenue"]}
                  />
                  <Area type="monotone" dataKey="v" stroke="var(--ink)" strokeWidth={2} fill="url(#revGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink-60)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                No payment data yet
              </div>
            )}
          </div>
        </div>

        <div className="pnl">
          <div className="pnl-hd"><h3>Activity</h3><span className="meta">LIVE</span></div>
          <div className="pnl-body" style={{ paddingTop: 6, paddingBottom: 6 }}>
            {activity && activity.length > 0 ? activity.map((a, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "52px 8px 1fr", gap: 8, padding: "10px 0",
                borderBottom: i === activity.length - 1 ? "0" : "1px solid var(--border-1)",
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-60)", letterSpacing: "0.04em" }}>
                  {fmtTime(a.time)}
                </span>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: a.volt ? "var(--volt)" : "var(--ink-20)",
                  marginTop: 6, flexShrink: 0,
                  boxShadow: a.volt ? "0 0 0 3px rgba(217,245,66,0.35)" : "none",
                }} />
                <div style={{ fontSize: 12, lineHeight: 1.45 }}>
                  <b style={{ fontWeight: 600 }}>{a.who}</b> {a.what}
                  {a.amountCents != null && a.amountCents > 0 && (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)", marginLeft: 4 }}>
                      · {fmtAUD(a.amountCents)}
                    </span>
                  )}
                </div>
              </div>
            )) : (
              <div style={{ padding: "24px 0", textAlign: "center", color: "var(--ink-60)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                Activity will appear here as you send proposals
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {QUICK_ACTIONS.map((q, i) => (
          <div key={i} onClick={() => navigate(q.href)} style={{
            display: "flex", alignItems: "center", gap: 14, padding: 16,
            background: "var(--pd-card)", border: "1px solid var(--border-1)",
            borderRadius: 12, cursor: "pointer", boxShadow: "var(--shadow-1)",
            transition: "background var(--dur-quick)",
          }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-inset)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--pd-card)"; }}
          >
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--bg-inset)", display: "grid", placeItems: "center" }}>
              <NavIcon name={q.icon} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em" }}>{q.name}</div>
              <div style={{ fontSize: 12, color: "var(--ink-60)" }}>{q.sub}</div>
            </div>
            <NavIcon name="arrow_r" />
          </div>
        ))}
      </div>

      {/* Recent proposals */}
      <div className="pnl" style={{ padding: 0 }}>
        <div className="pnl-hd" style={{ padding: "14px 18px" }}>
          <h3>Recent Proposals</h3>
          <button className="btn sm ghost" onClick={() => navigate("/proposals")}>
            View all <NavIcon name="arrow_r" />
          </button>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Proposal</th>
              <th>Payer</th>
              <th style={{ textAlign: "right" }}>Value</th>
              <th>Status</th>
              <th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {(recentProposals?.rows ?? []).slice(0, 5).map((p: any, i: number) => (
              <tr key={i} onClick={() => navigate(`/proposals/${p.id}`)} style={{ cursor: "pointer" }}>
                <td style={{ fontWeight: 500 }}>{p.title ?? "Untitled"}</td>
                <td style={{ color: "var(--ink-60)", fontSize: 13 }}>{p.clientBusinessName ?? p.clientName ?? "—"}</td>
                <td className="num" style={{ fontWeight: 700 }}>{fmtAUD(Number(p.totalCents) || 0)}</td>
                <td><span className={`st ${p.status}`}><span className="d" />{p.status}</span></td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                  {p.sentAt ? new Date(p.sentAt).toLocaleDateString("en-AU") : "—"}
                </td>
              </tr>
            ))}
            {(!recentProposals?.rows || recentProposals.rows.length === 0) && (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", padding: "32px 0", color: "var(--ink-60)" }}>
                  No proposals yet.{" "}
                  <button className="btn sm primary" onClick={() => navigate("/proposals/new")}>
                    Create your first
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
