import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { toast } from "sonner";

const fmt = (n: number) => "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 0 });

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "#22c55e" : value >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 12 }}>
        <span style={{ color: "var(--ink-60)" }}>{label}</span>
        <span style={{ fontWeight: 700, color }}>{value}</span>
      </div>
      <div style={{ height: 6, background: "var(--bg-inset)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 3, transition: "width 600ms ease-out" }} />
      </div>
    </div>
  );
}

function GradeCircle({ grade, score }: { grade: string; score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ width: 80, height: 80, borderRadius: "50%", border: `4px solid ${color}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{grade}</div>
      <div style={{ fontSize: 10, color: "var(--ink-60)", fontFamily: "var(--font-mono)" }}>{score}/100</div>
    </div>
  );
}

export default function AIInsights() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: proposalsData } = useQuery({
    ...trpc.payments.proposals.list.queryOptions({ brandId: brandId!, limit: 50 }),
    enabled: !!brandId,
  });
  const proposals = (proposalsData?.rows ?? []) as any[];

  const [activeTab, setActiveTab] = useState<"score" | "winloss" | "upsell" | "benchmark">("score");

  // Benchmark tab
  const [benchCategory, setBenchCategory] = useState("");
  const [benchItems, setBenchItems] = useState<Array<{ name: string; priceCents: number }>>([
    { name: "", priceCents: 0 },
  ]);
  const [benchResult, setBenchResult] = useState<any>(null);
  const benchMutation = useMutation(trpc.payments.ai.benchmarkPricing.mutationOptions());

  // Score tab
  const [scoreProposalId, setScoreProposalId] = useState<string>("");
  const [scoreResult, setScoreResult] = useState<any>(null);
  const scoreMutation = useMutation(trpc.payments.ai.scoreProposal.mutationOptions());

  // Win/loss tab
  const [wlProposalId, setWlProposalId] = useState<string>("");
  const [wlOutcome, setWlOutcome] = useState<"won" | "lost" | "expired">("lost");
  const [wlReason, setWlReason] = useState("");
  const [wlResult, setWlResult] = useState<any>(null);
  const wlMutation = useMutation(trpc.payments.ai.winLossAnalysis.mutationOptions());

  // Upsell tab
  const [upsellProposalId, setUpsellProposalId] = useState<string>("");
  const [upsellResult, setUpsellResult] = useState<any>(null);
  const upsellMutation = useMutation(trpc.payments.ai.upsellRecommendations.mutationOptions());

  const handleScore = async () => {
    if (!scoreProposalId) { toast.error("Select a proposal first"); return; }
    try {
      const result = await scoreMutation.mutateAsync({ proposalId: scoreProposalId });
      setScoreResult(result);
    } catch { toast.error("Scoring failed"); }
  };

  const handleWinLoss = async () => {
    if (!wlProposalId) { toast.error("Select a proposal first"); return; }
    try {
      const result = await wlMutation.mutateAsync({
        proposalId: wlProposalId,
        outcome: wlOutcome,
        declineReason: wlReason || undefined,
      });
      setWlResult(result);
    } catch { toast.error("Analysis failed"); }
  };

  const handleUpsell = async () => {
    if (!upsellProposalId) { toast.error("Select a proposal first"); return; }
    const proposal = proposals.find(p => p.id === upsellProposalId);
    const lineItems = proposal?.structure?.lineItems ?? [];
    const totalCents = lineItems.reduce((s: number, l: any) =>
      l.type !== "break" ? s + (l.unitPriceCents ?? 0) * (l.quantity ?? 1) : s, 0);
    try {
      const result = await upsellMutation.mutateAsync({
        brandId: brandId!,
        selectedProductIds: [],
        totalCents,
      });
      setUpsellResult(result);
    } catch { toast.error("Upsell analysis failed"); }
  };

  const handleBenchmark = async () => {
    const validItems = benchItems.filter(i => i.name.trim() && i.priceCents > 0);
    if (!validItems.length) { toast.error("Add at least one item with a name and price"); return; }
    try {
      const result = await benchMutation.mutateAsync({ brandId: brandId!, category: benchCategory || "General services", items: validItems });
      setBenchResult(result);
    } catch { toast.error("Benchmarking failed"); }
  };

  const TABS = [
    { id: "score" as const, label: "Proposal Score", icon: "★" },
    { id: "winloss" as const, label: "Win/Loss Analysis", icon: "◑" },
    { id: "upsell" as const, label: "Upsell Recommendations", icon: "↑" },
    { id: "benchmark" as const, label: "Price Benchmarking", icon: "⚖" },
  ];

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">AI · POWERED BY PRODESK INTELLIGENCE</span>
          <h1>AI <em>Insights.</em></h1>
          <span className="sub">Score proposals before you send, understand why deals are won or lost, and discover upsell opportunities.</span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="filter-bar" style={{ marginBottom: 24 }}>
        {TABS.map(tab => (
          <button key={tab.id} className={"chip" + (activeTab === tab.id ? " on" : "")} onClick={() => setActiveTab(tab.id)}>
            <span style={{ marginRight: 6 }}>{tab.icon}</span>{tab.label}
          </button>
        ))}
      </div>

      {/* ── Score Tab ── */}
      {activeTab === "score" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="pnl" style={{ padding: 20 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 12 }}>SCORE A PROPOSAL</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Select proposal</label>
              <select
                value={scoreProposalId}
                onChange={e => { setScoreProposalId(e.target.value); setScoreResult(null); }}
                style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--paper)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit" }}
              >
                <option value="">— Choose a proposal —</option>
                {proposals.map(p => (
                  <option key={p.id} value={p.id}>{p.title} · {p.status}</option>
                ))}
              </select>
            </div>
            <button className="btn primary" onClick={handleScore} disabled={scoreMutation.isPending || !scoreProposalId} style={{ width: "100%", justifyContent: "center" }}>
              {scoreMutation.isPending ? "Analysing…" : "★ Score this proposal"}
            </button>
            <div style={{ marginTop: 16, fontSize: 12, color: "var(--ink-60)", lineHeight: 1.6 }}>
              EziQuotes AI evaluates your proposal on completeness, price anchoring, clarity, and conversion likelihood — then gives you a letter grade and specific improvements.
            </div>
          </div>

          <div className="pnl" style={{ padding: 20 }}>
            {scoreResult ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
                  <GradeCircle grade={scoreResult.grade} score={scoreResult.overallScore} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Overall score</div>
                    <div style={{ fontSize: 12, color: "var(--ink-60)", lineHeight: 1.5 }}>{scoreResult.verdict}</div>
                  </div>
                </div>
                <ScoreBar label="Completeness" value={scoreResult.scores?.completeness ?? 0} />
                <ScoreBar label="Price anchoring" value={scoreResult.scores?.priceAnchoring ?? 0} />
                <ScoreBar label="Clarity" value={scoreResult.scores?.clarity ?? 0} />
                <ScoreBar label="Conversion likelihood" value={scoreResult.scores?.conversionLikelihood ?? 0} />
                {scoreResult.strengths?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "#22c55e", marginBottom: 8 }}>STRENGTHS</div>
                    {scoreResult.strengths.map((s: string, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--ink-80)", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #22c55e" }}>{s}</div>
                    ))}
                  </div>
                )}
                {scoreResult.improvements?.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "#f59e0b", marginBottom: 8 }}>IMPROVEMENTS</div>
                    {scoreResult.improvements.map((s: string, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--ink-80)", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #f59e0b" }}>{s}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 240, color: "var(--ink-40)" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>★</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>SELECT A PROPOSAL TO SCORE</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Win/Loss Tab ── */}
      {activeTab === "winloss" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="pnl" style={{ padding: 20 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 12 }}>ANALYSE AN OUTCOME</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Select proposal</label>
              <select value={wlProposalId} onChange={e => { setWlProposalId(e.target.value); setWlResult(null); }} style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--paper)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit" }}>
                <option value="">— Choose a proposal —</option>
                {proposals.map(p => <option key={p.id} value={p.id}>{p.title} · {p.status}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Outcome</label>
              <div style={{ display: "flex", gap: 8 }}>
                {(["won", "lost", "expired"] as const).map(o => (
                  <button key={o} onClick={() => setWlOutcome(o)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: `2px solid ${wlOutcome === o ? (o === "won" ? "#22c55e" : o === "lost" ? "#ef4444" : "#f59e0b") : "var(--border-1)"}`, background: wlOutcome === o ? (o === "won" ? "#22c55e18" : o === "lost" ? "#ef444418" : "#f59e0b18") : "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: wlOutcome === o ? 700 : 400, color: "var(--ink)", textTransform: "capitalize" }}>
                    {o === "won" ? "✓ Won" : o === "lost" ? "✗ Lost" : "⏱ Expired"}
                  </button>
                ))}
              </div>
            </div>
            {wlOutcome === "lost" && (
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Decline reason (optional)</label>
                <textarea value={wlReason} onChange={e => setWlReason(e.target.value)} placeholder="e.g. Price too high, went with a competitor, project delayed" style={{ width: "100%", height: 64, padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--paper)", color: "var(--ink)", fontSize: 12, fontFamily: "inherit", resize: "none" }} />
              </div>
            )}
            <button className="btn primary" onClick={handleWinLoss} disabled={wlMutation.isPending || !wlProposalId} style={{ width: "100%", justifyContent: "center" }}>
              {wlMutation.isPending ? "Analysing…" : "◑ Analyse outcome"}
            </button>
          </div>

          <div className="pnl" style={{ padding: 20 }}>
            {wlResult ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: wlResult.sentiment === "positive" ? "#22c55e18" : wlResult.sentiment === "negative" ? "#ef444418" : "#f59e0b18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                    {wlResult.sentiment === "positive" ? "✓" : wlResult.sentiment === "negative" ? "✗" : "~"}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Outcome analysis</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      {(wlResult.tags ?? []).map((t: string, i: number) => (
                        <span key={i} style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", background: "var(--bg-inset)", padding: "2px 6px", borderRadius: 4 }}>{t.toUpperCase()}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "var(--ink-60)", marginBottom: 6 }}>KEY FACTOR</div>
                  <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{wlResult.keyFactor}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "var(--ink-60)", marginBottom: 6 }}>RECOMMENDATION</div>
                  <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{wlResult.recommendation}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "var(--ink-60)", marginBottom: 6 }}>PATTERN TO WATCH</div>
                  <div style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.5 }}>{wlResult.pattern}</div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 240, color: "var(--ink-40)" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>◑</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>SELECT A PROPOSAL TO ANALYSE</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Benchmark Tab ── */}
      {activeTab === "benchmark" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="pnl" style={{ padding: 20 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 12 }}>COMPARE YOUR PRICES</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Service category</label>
              <input value={benchCategory} onChange={e => setBenchCategory(e.target.value)} placeholder="e.g. Web design, Accounting, Plumbing" style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--paper)", color: "var(--ink)", fontSize: 13 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Your items</label>
              {benchItems.map((item, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 28px", gap: 6, marginBottom: 6 }}>
                  <input value={item.name} onChange={e => { const n = [...benchItems]; n[i] = { ...n[i], name: e.target.value }; setBenchItems(n); }} placeholder="Item name" style={{ padding: "6px 10px", border: "1px solid var(--border-1)", borderRadius: 7, background: "var(--paper)", color: "var(--ink)", fontSize: 12 }} />
                  <input type="number" value={item.priceCents ? (item.priceCents / 100).toFixed(0) : ""} onChange={e => { const n = [...benchItems]; n[i] = { ...n[i], priceCents: Math.round(parseFloat(e.target.value || "0") * 100) }; setBenchItems(n); }} placeholder="$" style={{ padding: "6px 10px", border: "1px solid var(--border-1)", borderRadius: 7, background: "var(--paper)", color: "var(--ink)", fontSize: 12 }} />
                  <button onClick={() => setBenchItems(benchItems.filter((_, j) => j !== i))} style={{ border: "1px solid var(--border-1)", borderRadius: 7, background: "none", cursor: "pointer", color: "var(--ink-60)", fontSize: 14 }}>×</button>
                </div>
              ))}
              <button className="btn ghost" style={{ fontSize: 11, padding: "4px 10px", marginTop: 4 }} onClick={() => setBenchItems([...benchItems, { name: "", priceCents: 0 }])}>+ Add item</button>
            </div>
            <button className="btn primary" onClick={handleBenchmark} disabled={benchMutation.isPending} style={{ width: "100%", justifyContent: "center" }}>
              {benchMutation.isPending ? "Benchmarking…" : "⚖ Benchmark my prices"}
            </button>
          </div>

          <div className="pnl" style={{ padding: 20 }}>
            {benchResult ? (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 6 }}>OVERALL POSITION</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", textTransform: "capitalize" }}>{benchResult.overallPosition?.replace("_", " ")}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-60)", marginTop: 4, lineHeight: 1.5 }}>{benchResult.summary}</div>
                </div>
                {(benchResult.items ?? []).map((item: any, i: number) => (
                  <div key={i} style={{ padding: "10px 12px", background: "var(--bg-inset)", borderRadius: 8, border: "1px solid var(--border-1)", marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.name}</div>
                      <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", padding: "1px 7px", borderRadius: 4, background: item.position === "below_market" ? "#ECFDF5" : item.position === "above_market" ? "#FEF2F2" : "#EFF6FF", color: item.position === "below_market" ? "#059669" : item.position === "above_market" ? "#DC2626" : "#2563EB" }}>{item.position?.replace("_", " ")}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-60)" }}>{item.insight}</div>
                    {item.suggestedRange && <div style={{ fontSize: 11, color: "var(--ink-40)", marginTop: 4, fontFamily: "var(--font-mono)" }}>Market range: {item.suggestedRange}</div>}
                  </div>
                ))}
                {benchResult.recommendations?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 8 }}>RECOMMENDATIONS</div>
                    {benchResult.recommendations.map((r: string, i: number) => (
                      <div key={i} style={{ fontSize: 12, color: "var(--ink)", lineHeight: 1.5, marginBottom: 6, paddingLeft: 12, borderLeft: "2px solid var(--border-1)" }}>{r}</div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 240, color: "var(--ink-40)" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⚖</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>ENTER YOUR ITEMS TO BENCHMARK</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Upsell Tab ── */}
      {activeTab === "upsell" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div className="pnl" style={{ padding: 20 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 12 }}>FIND UPSELL OPPORTUNITIES</div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "var(--ink-60)", display: "block", marginBottom: 6 }}>Select proposal</label>
              <select value={upsellProposalId} onChange={e => { setUpsellProposalId(e.target.value); setUpsellResult(null); }} style={{ width: "100%", padding: "8px 10px", border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--paper)", color: "var(--ink)", fontSize: 13, fontFamily: "inherit" }}>
                <option value="">— Choose a proposal —</option>
                {proposals.map(p => <option key={p.id} value={p.id}>{p.title} · {p.status}</option>)}
              </select>
            </div>
            <button className="btn primary" onClick={handleUpsell} disabled={upsellMutation.isPending || !upsellProposalId} style={{ width: "100%", justifyContent: "center" }}>
              {upsellMutation.isPending ? "Finding opportunities…" : "↑ Find upsell opportunities"}
            </button>
            <div style={{ marginTop: 16, fontSize: 12, color: "var(--ink-60)", lineHeight: 1.6 }}>
              EziQuotes AI looks at what's in the proposal and suggests complementary products and add-ons that are commonly accepted together, helping you increase deal value.
            </div>
          </div>

          <div className="pnl" style={{ padding: 20 }}>
            {upsellResult ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Upsell potential: <span style={{ color: upsellResult.upsellPotential === "high" ? "#22c55e" : upsellResult.upsellPotential === "medium" ? "#f59e0b" : "var(--ink-60)", textTransform: "capitalize" }}>{upsellResult.upsellPotential}</span></div>
                    <div style={{ fontSize: 12, color: "var(--ink-60)", marginTop: 2 }}>Estimated additional value: {fmt(upsellResult.totalUpsellEstimate ?? 0)}</div>
                  </div>
                </div>
                {(upsellResult.recommendations ?? []).length === 0 ? (
                  <div style={{ textAlign: "center", padding: 24, color: "var(--ink-40)", fontSize: 12 }}>No upsell opportunities identified for this proposal.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(upsellResult.recommendations ?? []).map((rec: any, i: number) => (
                      <div key={i} style={{ padding: "12px 14px", background: "var(--bg-inset)", borderRadius: 8, border: "1px solid var(--border-1)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{rec.name}</div>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700, color: "var(--ink)" }}>{fmt(rec.estimatedValue)}</div>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--ink-60)" }}>{rec.reason}</div>
                        <div style={{ marginTop: 6 }}>
                          <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", background: "var(--paper)", padding: "2px 6px", borderRadius: 4, border: "1px solid var(--border-1)" }}>{rec.type?.toUpperCase()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 240, color: "var(--ink-40)" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>↑</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>SELECT A PROPOSAL TO ANALYSE</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
