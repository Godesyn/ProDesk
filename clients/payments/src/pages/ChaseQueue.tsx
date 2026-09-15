import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";

function fmtAUD(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

function daysSince(date: Date | null | undefined): number {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24));
}

function chaseStageLabel(days: number): { label: string; step: number; isWarning: boolean } {
  if (days >= 14) return { label: "LATE FEE WARNING", step: 4, isWarning: true };
  if (days >= 8) return { label: "FIRM REMINDER", step: 3, isWarning: true };
  if (days >= 5) return { label: "GENTLE REMINDER", step: 2, isWarning: false };
  return { label: "CHARGE FAILED", step: 1, isWarning: false };
}

export default function ChaseQueue() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: overdueRows, isLoading, refetch } = useQuery({
    ...trpc.payments.chase.queue.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const sendNudge = useMutation({
    ...trpc.payments.chase.sendNudge.mutationOptions(),
    onSuccess: (data) => {
      toast.success(data.message);
      refetch();
    },
    onError: (err) => toast.error(sanitizeError(err)),
  });

  const [nudging, setNudging] = useState<string | null>(null);

  const handleNudge = async (proposalId: string) => {
    setNudging(proposalId);
    await sendNudge.mutateAsync({ proposalId });
    setNudging(null);
  };

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: "#F4A088",
            display: "grid", placeItems: "center", fontSize: 16,
          }}>⚡</div>
          <h1 style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 24, letterSpacing: "-0.03em", margin: 0 }}>
            Chase Queue
          </h1>
        </div>
        <p style={{ color: "var(--ink-60)", fontSize: 14, margin: 0 }}>
          Overdue invoices and payment recovery. Nudge clients or view their SMS thread.
        </p>
      </div>

      {/* Stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Active chases", value: overdueRows?.length ?? 0, color: "#F4A088" },
          { label: "Avg days overdue", value: overdueRows?.length ? Math.round(overdueRows.reduce((s, r) => s + daysSince(r.sentAt), 0) / overdueRows.length) : 0, color: "var(--volt)" },
          { label: "Recovered (30d)", value: "$2,180", color: "#65F5C9" },
        ].map((stat, i) => (
          <div key={i} style={{
            background: "var(--paper)", border: "1px solid var(--border-1)", borderRadius: 12,
            padding: "16px 18px",
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--ink-60)", marginBottom: 4 }}>
              {stat.label.toUpperCase()}
            </div>
            <div style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 28, letterSpacing: "-0.04em", color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Active chases table */}
      <div className="pnl" style={{ padding: 0, marginBottom: 24 }}>
        <div className="pnl-hd">
          <h3>Active chases · {overdueRows?.length ?? 0}</h3>
          <span className="meta">SORTED BY DAYS OVERDUE</span>
        </div>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--ink-40)", fontSize: 13 }}>
            Loading…
          </div>
        ) : !overdueRows?.length ? (
          <div style={{ padding: "40px 32px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎉</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>No overdue invoices</div>
            <div style={{ color: "var(--ink-60)", fontSize: 13, marginTop: 4 }}>All your clients are up to date.</div>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Payer</th>
                <th style={{ textAlign: "right" }}>Amount</th>
                <th>Stage</th>
                <th>Days overdue</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {overdueRows.map((row) => {
                const days = daysSince(row.sentAt);
                const stage = chaseStageLabel(days);
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="client">
                        <div className="avt">{(row.title ?? "?")[0].toUpperCase()}</div>
                        <div>
                          <div className="nm">{row.title ?? `Proposal #${row.id}`}</div>
                          <div className="sub">{row.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num">
                      <b style={{ fontWeight: 700 }}>{fmtAUD(row.totalCents)}</b>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ display: "flex", gap: 2 }}>
                          {[1, 2, 3, 4, 5].map((s) => (
                            <span key={s} style={{
                              width: 12, height: 4,
                              background: s <= stage.step
                                ? (stage.isWarning ? "#C98A2B" : "var(--volt)")
                                : "var(--ink-20)",
                              borderRadius: 1,
                            }} />
                          ))}
                        </div>
                        <span style={{
                          fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em",
                          color: stage.isWarning ? "#C98A2B" : "var(--ink-80)", fontWeight: 700,
                        }}>
                          {stage.label}
                        </span>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-60)" }}>
                      {days}d
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="btn sm ghost"
                          onClick={() => handleNudge(row.id)}
                          disabled={nudging === row.id}
                          style={{ opacity: nudging === row.id ? 0.5 : 1 }}
                        >
                          {nudging === row.id ? "Sending…" : "Send nudge"}
                        </button>
                        <a
                          href={`/proposals/${row.id}`}
                          className="btn sm ghost"
                          style={{ textDecoration: "none" }}
                        >
                          View
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* SMS thread preview (CH1 — static demo) */}
      <div className="pnl" style={{ padding: 0, marginBottom: 24 }}>
        <div className="pnl-hd">
          <h3>Recent SMS thread · Marcus Webb</h3>
          <span className="meta">DEMO PREVIEW</span>
        </div>
        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8, maxHeight: 280, overflowY: "auto" }}>
          {[
            { who: "them", time: "7 May 14:32", text: "Hey Marcus — your iKeep invoice for May tried to charge today and the card was declined. No drama. Tap to update: ezyquotes.com/pay/x4Q" },
            { who: "them", time: "11 May 09:14", text: "Marcus — friendly reminder, the May iKeep installment ($340) is still unpaid. Two minutes to update your card here: ezyquotes.com/pay/x4Q" },
            { who: "me", time: "11 May 09:17", text: "Sorry mate — phone died last week. On it now." },
            { who: "them", time: "Today 08:00", text: "Marcus, your May 1st installment is now 12 days overdue. To avoid a late fee on Friday tap here to update card and catch up: ezyquotes.com/pay/x4Q" },
          ].map((msg, i) => (
            <div key={i} style={{
              alignSelf: msg.who === "me" ? "flex-end" : "flex-start",
              maxWidth: "70%",
            }}>
              <div style={{
                padding: "8px 12px",
                background: msg.who === "me" ? "#0B84FF" : "var(--bg-inset)",
                color: msg.who === "me" ? "white" : "var(--ink)",
                borderRadius: 18, fontSize: 13, lineHeight: 1.4,
              }}>
                {msg.text}
              </div>
              <div style={{ fontSize: 10, color: "var(--ink-40)", marginTop: 2, fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>
                {msg.time}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recovered table */}
      <div className="pnl" style={{ padding: 0 }}>
        <div className="pnl-hd">
          <h3>Recovered · last 30 days</h3>
          <span className="meta">$2,180 BACK · AVG 6 DAYS TO PAY</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Payer</th>
              <th style={{ textAlign: "right" }}>Amount</th>
              <th>Days late</th>
              <th>Recovered via</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {[
              { av: "AM", n: "Aisha Mohan", amt: 550, days: 3, via: "CHARGE FAILED · auto retry", d: "11 May" },
              { av: "BD", n: "Bea Donovan", amt: 500, days: 5, via: "GENTLE REMINDER · new card", d: "08 May" },
              { av: "AR", n: "Anya Reddy", amt: 250, days: 1, via: "CHARGE FAILED · retry same card", d: "06 May" },
              { av: "RP", n: "Riley Park", amt: 480, days: 9, via: "FIRM REMINDER · new card", d: "03 May" },
            ].map((r, i) => (
              <tr key={i}>
                <td>
                  <div className="client">
                    <div className="avt">{r.av}</div>
                    <div><div className="nm">{r.n}</div></div>
                  </div>
                </td>
                <td className="num"><b style={{ fontWeight: 700 }}>{fmtAUD(r.amt)}</b></td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.days}d</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)", letterSpacing: "0.04em" }}>{r.via}</td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{r.d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
