import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";

const fmtAUD = (cents: number) => "$" + (cents / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

export default function RevenueForecast() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const [months, setMonths] = useState(6);
  const { data, isLoading } = useQuery({
    ...trpc.payments.analytics.revenueForecast.queryOptions({ brandId: brandId!, months }),
    enabled: !!brandId,
  });

  const maxCents = data ? Math.max(...data.months.map(m => Math.max(m.forecastCents, m.actualCents ?? 0)), 1) : 1;

  return (
    <div className="page">
      <div className="page-hd">
        <div>
          <h1>Revenue Forecast</h1>
          <p style={{ color: "var(--ink-60)", fontSize: 13, marginTop: 4 }}>
            Projected revenue based on active subscriptions, pipeline, and historical trends.
          </p>
        </div>
        <div className="acts">
          {[3, 6, 12].map(m => (
            <button
              key={m}
              className={`btn ${months === m ? "primary" : "ghost"}`}
              onClick={() => setMonths(m)}
            >{m}M</button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div style={{ color: "var(--ink-60)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>LOADING…</div>
      )}

      {data && (
        <>
          {/* Summary KPIs */}
          <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
            <div className="kpi">
              <span className="lbl">TOTAL FORECAST</span>
              <span className="num">{fmtAUD(data.summary.totalForecastCents)}</span>
              <span className="meta">Next {months} months</span>
            </div>
            <div className="kpi">
              <span className="lbl">RECURRING / MONTH</span>
              <span className="num">{fmtAUD(data.summary.recurringMonthlyCents)}</span>
              <span className="meta">{data.summary.activeSubscriptionCount} active subs</span>
            </div>
            <div className="kpi">
              <span className="lbl">PIPELINE VALUE</span>
              <span className="num">{fmtAUD(data.summary.pipelineCents)}</span>
              <span className="meta">{data.summary.pipelineProposalCount} proposals</span>
            </div>
            <div className="kpi">
              <span className="lbl">AVG MONTHLY (ACTUAL)</span>
              <span className="num">{fmtAUD(data.summary.avgMonthlyActualCents ?? 0)}</span>
              <span className="meta">Last 6 months</span>
            </div>
          </div>

          {/* Bar chart */}
          <div className="pnl">
            <div className="pnl-hd"><h3>Monthly forecast</h3><span className="meta">ACTUAL vs PROJECTED</span></div>
            <div className="pnl-body">
              {/* Legend */}
              <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
                {[
                  { color: "#D9F542", label: "Actual" },
                  { color: "var(--ink-20)", label: "Forecast" },
                  { color: "#22c55e", label: "Recurring" },
                  { color: "#60a5fa", label: "Pipeline" },
                ].map(l => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: l.color }} />
                    <span style={{ fontSize: 11, color: "var(--ink-60)", fontFamily: "var(--font-mono)" }}>{l.label}</span>
                  </div>
                ))}
              </div>

              {/* Bars */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", height: 200, padding: "0 4px" }}>
                {data.months.map(m => {
                  const hasActual = m.actualCents !== null;
                  const barCents = hasActual ? m.actualCents! : m.forecastCents;
                  const barH = Math.round((barCents / maxCents) * 180);
                  const recurringH = Math.round((m.recurringCents / maxCents) * 180);
                  const pipelineH = Math.round((m.pipelineCents / maxCents) * 180);

                  return (
                    <div key={m.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                      <div style={{ fontSize: 10, color: "var(--ink-60)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                        {fmtAUD(barCents)}
                      </div>
                      <div style={{ width: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: 180, position: "relative" }}>
                        {hasActual ? (
                          // Actual bar (solid lime)
                          <div style={{ width: "100%", height: barH, background: "#D9F542", borderRadius: "4px 4px 0 0", transition: "height 0.5s ease" }} />
                        ) : (
                          // Forecast bar (stacked: recurring + pipeline + other)
                          <div style={{ width: "100%", height: barH, borderRadius: "4px 4px 0 0", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                            <div style={{ height: pipelineH, background: "#60a5fa", transition: "height 0.5s ease" }} />
                            <div style={{ height: recurringH, background: "#22c55e", transition: "height 0.5s ease" }} />
                            <div style={{ flex: 1, background: "var(--border-2)" }} />
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--ink-60)", fontFamily: "var(--font-mono)", textAlign: "center", lineHeight: 1.2 }}>
                        {m.label}
                        {hasActual && <div style={{ color: "#D9F542", fontSize: 8 }}>ACTUAL</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Monthly breakdown table */}
          <div className="pnl" style={{ padding: 0 }}>
            <div className="pnl-hd"><h3>Monthly breakdown</h3></div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: "right" }}>Actual</th>
                  <th style={{ textAlign: "right" }}>Forecast</th>
                  <th style={{ textAlign: "right" }}>Recurring</th>
                  <th style={{ textAlign: "right" }}>Pipeline</th>
                </tr>
              </thead>
              <tbody>
                {data.months.map(m => (
                  <tr key={m.key}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{m.label}</td>
                    <td className="num">
                      {m.actualCents !== null
                        ? <b style={{ color: "#D9F542" }}>{fmtAUD(m.actualCents)}</b>
                        : <span style={{ color: "var(--ink-40)" }}>—</span>}
                    </td>
                    <td className="num"><b>{fmtAUD(m.forecastCents)}</b></td>
                    <td className="num" style={{ color: "#22c55e" }}>{fmtAUD(m.recurringCents)}</td>
                    <td className="num" style={{ color: "#60a5fa" }}>{fmtAUD(m.pipelineCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: "12px 0", color: "var(--ink-60)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
            * Forecast assumes 30% pipeline conversion rate per month. Recurring revenue is based on active subscription proposals.
          </div>
        </>
      )}
    </div>
  );
}
