import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { NavIcon } from "@/components/AppShell";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";

const fmtAUD = (n: number) => "$" + (n / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });
const fmtDate = (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString("en-AU") : "—";

const NOTE_TYPES = [
  { value: "note", label: "Note", icon: "📝" },
  { value: "call", label: "Call", icon: "📞" },
  { value: "email", label: "Email", icon: "✉️" },
  { value: "meeting", label: "Meeting", icon: "🤝" },
];

const GRADE_COLORS: Record<string, string> = {
  A: "#22c55e", B: "#84cc16", C: "#eab308", D: "#f97316", F: "#ef4444",
};

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const brandId = useBrandId();
  const clientId = id; // uuid string

  // Edit state
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editMobile, setEditMobile] = useState("");
  const [editBusiness, setEditBusiness] = useState("");
  const [editAbn, setEditAbn] = useState("");

  // Notes state
  const [noteContent, setNoteContent] = useState("");
  const [noteType, setNoteType] = useState<"note" | "call" | "email" | "meeting">("note");
  const [activeTab, setActiveTab] = useState<"proposals" | "timeline" | "referrals" | "reminders">("proposals");
  const [reminderType, setReminderType] = useState<"renewal" | "anniversary" | "check_in">("renewal");
  const [reminderDueAt, setReminderDueAt] = useState("");
  const [reminderNotes, setReminderNotes] = useState("");
  const [showAddReminder, setShowAddReminder] = useState(false);

  // Referral state
  const [refClientId, setRefClientId] = useState("");
  const [refNotes, setRefNotes] = useState("");
  const [showAddRef, setShowAddRef] = useState(false);

  const qc = useQueryClient();
  const { data, isLoading } = useQuery(trpc.payments.clients.getWithProposals.queryOptions({ id: clientId }));
  const { data: health } = useQuery({
    ...trpc.payments.analytics.clientHealthScore.queryOptions({ clientId }),
    enabled: !!clientId,
  });
  const { data: notesData } = useQuery({
    ...trpc.payments.analytics.listClientNotes.queryOptions({ clientId }),
    enabled: !!clientId,
  });
  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    ...trpc.payments.analyticsExtra.mergedTimeline.queryOptions({ clientId }),
    enabled: !!clientId,
  });
  const { data: referralsData } = useQuery({
    ...trpc.payments.analytics.listClientReferrals.queryOptions({ clientId }),
    enabled: !!clientId,
  });
  const { data: remindersData, refetch: refetchReminders } = useQuery({
    ...trpc.payments.surveys.listReminders.queryOptions({ brandId: brandId!, clientId }),
    enabled: !!clientId && !!brandId,
  });
  const { data: allClients } = useQuery({
    ...trpc.payments.clients.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });

  const sendPortalLink = useMutation({
    ...trpc.payments.clients.sendPortalLink.mutationOptions(),
    onSuccess: () => toast.success("Portal link sent to client's email"),
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const generateSupportSession = useMutation({
    ...trpc.payments.clients.generateSupportSession.mutationOptions(),
    onSuccess: (data) => {
      const portalUrl = `${window.location.origin}/client-portal/verify?token=${data.sessionToken}`;
      window.open(portalUrl, "_blank");
      toast.success("Portal opened in a new tab");
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const updateClient = useMutation(trpc.payments.clients.update.mutationOptions({
    onSuccess: () => {
      toast.success("Payer updated");
      qc.invalidateQueries({ queryKey: trpc.payments.clients.getWithProposals.queryKey({ id: clientId }) });
      setEditOpen(false);
    },
    onError: () => toast.error("Failed to update payer"),
  }));
  const addNote = useMutation({
    ...trpc.payments.analytics.addClientNote.mutationOptions(),
    onSuccess: () => {
      toast.success("Entry added");
      setNoteContent("");
      qc.invalidateQueries({ queryKey: trpc.payments.analytics.listClientNotes.queryKey({ clientId }) });
      qc.invalidateQueries({ queryKey: trpc.payments.analyticsExtra.mergedTimeline.queryKey({ clientId }) });
    },
    onError: () => toast.error("Failed to add entry"),
  });

  const deleteNote = useMutation({
    ...trpc.payments.analytics.deleteClientNote.mutationOptions(),
    onSuccess: () => {
      toast.success("Entry deleted");
      qc.invalidateQueries({ queryKey: trpc.payments.analytics.listClientNotes.queryKey({ clientId }) });
      qc.invalidateQueries({ queryKey: trpc.payments.analyticsExtra.mergedTimeline.queryKey({ clientId }) });
    },
    onError: () => toast.error("Failed to delete note"),
  });

  const applyCredit = useMutation({
    ...trpc.payments.analyticsExtra.applyReferralCredit.mutationOptions(),
    onSuccess: () => {
      toast.success("Credit applied");
      qc.invalidateQueries({ queryKey: trpc.payments.analytics.listClientReferrals.queryKey({ clientId }) });
    },
    onError: () => toast.error("Failed to apply credit"),
  });

  const createReminder = useMutation({
    ...trpc.payments.surveys.createReminder.mutationOptions(),
    onSuccess: () => {
      toast.success("Reminder created");
      setShowAddReminder(false);
      setReminderDueAt("");
      setReminderNotes("");
      refetchReminders();
    },
    onError: (e) => toast.error(sanitizeError(e, "Failed to create reminder")),
  });
  const dismissReminder = useMutation({
    ...trpc.payments.surveys.dismissReminder.mutationOptions(),
    onSuccess: () => { toast.success("Reminder dismissed"); refetchReminders(); },
    onError: () => toast.error("Failed to dismiss"),
  });
  const addReferral = useMutation({
    ...trpc.payments.analytics.addReferral.mutationOptions(),
    onSuccess: () => {
      toast.success("Referral recorded");
      setRefClientId("");
      setRefNotes("");
      setShowAddRef(false);
      qc.invalidateQueries({ queryKey: trpc.payments.analytics.listClientReferrals.queryKey({ clientId }) });
    },
    onError: (e) => toast.error(sanitizeError(e, "Failed to add referral")),
  });

  const openEdit = () => {
    if (!data?.client) return;
    setEditName(data.client.name || "");
    setEditEmail(data.client.email || "");
    setEditMobile(data.client.mobile || "");
    setEditBusiness(data.client.businessName || "");
    setEditAbn(data.client.abn || "");
    setEditOpen(true);
  };

  if (isLoading) {
    return (
      <div className="page">
        <div style={{ color: "var(--ink-60)", fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>LOADING…</div>
      </div>
    );
  }

  if (!data?.client) {
    return (
      <div className="page">
        <div style={{ color: "var(--ink-60)" }}>Payer not found.</div>
        <button className="btn" onClick={() => navigate("/clients")}>Back to Payers</button>
      </div>
    );
  }

  const { client, proposals } = data;
  const initials = client.name
    ? client.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
    : "??";

  const totalValueCents = proposals.reduce((sum: number, p: any) => sum + (Number(p.totalCents) || 0), 0);
  const paidProposals = proposals.filter((p: any) => ["paid", "active", "completed"].includes(p.status));

  return (
    <div className="page">
      {/* Breadcrumb */}
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-60)" }}>
        <span style={{ cursor: "pointer" }} onClick={() => navigate("/clients")}>Payers</span>
        {" / "}
        <span style={{ color: "var(--ink)" }}>{client.name?.toUpperCase()}</span>
      </div>

      {/* Header */}
      <div className="page-hd" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div className="avt" style={{ width: 56, height: 56, fontSize: 18 }}>{initials}</div>
          <div>
            <h1 style={{ fontSize: 28 }}>{client.name}</h1>
            <div style={{ color: "var(--ink-60)", fontSize: 13, marginTop: 4 }}>
              {client.businessName} {client.abn && `· ABN ${client.abn}`}
            </div>
          </div>
          {/* Health grade badge */}
          {health && (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              background: GRADE_COLORS[health.grade] + "18",
              border: `1.5px solid ${GRADE_COLORS[health.grade]}`,
              borderRadius: 10, padding: "6px 14px", marginLeft: 8,
            }}>
              <div style={{ fontSize: 22, fontWeight: 900, color: GRADE_COLORS[health.grade], lineHeight: 1 }}>{health.grade}</div>
              <div style={{ fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: GRADE_COLORS[health.grade], textTransform: "uppercase" }}>{health.label}</div>
            </div>
          )}
        </div>
        <div className="acts">
          <button className="btn ghost" onClick={openEdit}><NavIcon name="edit" />Edit</button>
          <button className="btn ghost" disabled={sendPortalLink.isPending} onClick={() => sendPortalLink.mutate({ clientId, origin: window.location.origin })}>
            <NavIcon name="link" />{sendPortalLink.isPending ? "Sending…" : "Send portal link"}
          </button>
          <button className="btn ghost" disabled={generateSupportSession.isPending} onClick={() => generateSupportSession.mutate({ clientId })}>
            <NavIcon name="eye" />{generateSupportSession.isPending ? "Opening…" : "Open portal"}
          </button>
          <button className="btn primary" onClick={() => navigate("/proposals/new")}><NavIcon name="plus" />New proposal</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi">
          <span className="lbl">LIFETIME VALUE</span>
          <span className="num">{fmtAUD(totalValueCents)}</span>
          <span className="meta">{paidProposals.length} paid</span>
        </div>
        <div className="kpi">
          <span className="lbl">PROPOSALS</span>
          <span className="num">{proposals.length}</span>
          <span className="meta">Total</span>
        </div>
        <div className="kpi">
          <span className="lbl">HEALTH SCORE</span>
          <span className="num" style={{ color: health ? GRADE_COLORS[health.grade] : undefined }}>
            {health ? health.overallScore : "—"}
          </span>
          <span className="meta">{health?.label ?? "Calculating…"}</span>
        </div>
        <div className="kpi">
          <span className="lbl">REFERRALS MADE</span>
          <span className="num">{referralsData?.referrals?.length ?? 0}</span>
          <span className="meta">Payers referred</span>
        </div>
      </div>

      {/* Health Score Breakdown */}
      {health && (
        <div className="pnl" style={{ marginBottom: 0 }}>
          <div className="pnl-hd"><h3>Payer Health</h3><span className="meta">SCORE BREAKDOWN</span></div>
          <div className="pnl-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              {[
                { label: "Payment History", score: health.components.paymentHistory, tip: "Acceptance rate" },
                { label: "Dispute Rate", score: health.components.disputeRate, tip: "Low disputes = high score" },
                { label: "Recency", score: health.components.recency, tip: "Days since last proposal" },
                { label: "Engagement", score: health.components.engagement, tip: "Proposal view rate" },
                { label: "Volume", score: health.components.volume, tip: "Total revenue" },
              ].map(c => (
                <div key={c.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-60)" }}>{c.label}</div>
                  <div style={{ height: 6, borderRadius: 3, background: "var(--border-2)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${c.score}%`, background: c.score >= 70 ? "#22c55e" : c.score >= 45 ? "#eab308" : "#ef4444", borderRadius: 3, transition: "width 0.6s ease" }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{c.score}<span style={{ fontSize: 10, fontWeight: 400, color: "var(--ink-60)" }}>/100</span></div>
                  <div style={{ fontSize: 10, color: "var(--ink-60)" }}>{c.tip}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main content grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14 }}>
        {/* Left: tabs */}
        <div>
          <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid var(--border-2)" }}>
            {[
              { key: "proposals", label: `Proposals (${proposals.length})` },
              { key: "timeline", label: `Timeline (${notesData?.length ?? 0})` },
              { key: "referrals", label: `Referrals (${referralsData?.referrals?.length ?? 0})` },
              { key: "reminders", label: `Reminders (${remindersData?.filter((r: any) => r.status === "pending").length ?? 0})` },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key as any)}
                style={{
                  padding: "8px 16px", border: "none", background: "none", cursor: "pointer",
                  fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: activeTab === t.key ? "var(--ink)" : "var(--ink-60)",
                  borderBottom: activeTab === t.key ? "2px solid var(--ink)" : "2px solid transparent",
                  marginBottom: -1, transition: "color 0.15s",
                }}
              >{t.label}</button>
            ))}
          </div>

          {/* Proposals tab */}
          {activeTab === "proposals" && (
            <div className="pnl" style={{ padding: 0 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Proposal</th>
                    <th style={{ textAlign: "right" }}>Total</th>
                    <th>Status</th>
                    <th>Sent</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p: any) => (
                    <tr key={p.id} onClick={() => navigate(`/proposals/${p.id}`)}>
                      <td style={{ fontWeight: 500 }}>{p.title || "Untitled"}</td>
                      <td className="num"><b style={{ fontWeight: 700 }}>{fmtAUD(Number(p.totalCents) || 0)}</b></td>
                      <td><span className={`st ${p.status}`}><span className="d" />{p.status}</span></td>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{fmtDate(p.sentAt)}</td>
                    </tr>
                  ))}
                  {proposals.length === 0 && (
                    <tr><td colSpan={4} style={{ textAlign: "center", padding: "32px 0", color: "var(--ink-60)" }}>No proposals yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Timeline tab */}
          {activeTab === "timeline" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Add note */}
              <div className="pnl">
                <div className="pnl-hd"><h3>Add entry</h3></div>
                <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    {NOTE_TYPES.map(t => (
                      <button
                        key={t.value}
                        onClick={() => setNoteType(t.value as any)}
                        style={{
                          padding: "5px 12px", borderRadius: 6, border: "1px solid",
                          borderColor: noteType === t.value ? "var(--ink)" : "var(--border-2)",
                          background: noteType === t.value ? "var(--ink)" : "transparent",
                          color: noteType === t.value ? "var(--bg)" : "var(--ink)",
                          fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                        }}
                      >{t.icon} {t.label}</button>
                    ))}
                  </div>
                  <textarea
                    value={noteContent}
                    onChange={e => setNoteContent(e.target.value)}
                    placeholder="Add a note, log a call, record a meeting…"
                    style={{ width: "100%", minHeight: 80, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", borderRadius: 6, border: "1px solid var(--border-2)", background: "var(--paper)", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button
                      className="btn primary"
                      onClick={() => addNote.mutate({ clientId, type: noteType, content: noteContent })}
                      disabled={!noteContent.trim() || addNote.isPending}
                    >{addNote.isPending ? "Saving…" : "Add entry"}</button>
                  </div>
                </div>
              </div>

              {/* Merged timeline */}
              {timelineLoading && <div style={{ color: "var(--ink-60)", fontSize: 12 }}>Loading timeline…</div>}
              {timelineData && timelineData.length === 0 && (
                <div style={{ color: "var(--ink-60)", fontSize: 13, textAlign: "center", padding: "24px 0" }}>No activity yet. Add a note, log a call, or send a proposal.</div>
              )}
              {timelineData?.map((event: any) => {
                const iconMap: Record<string, string> = { call: "\u{1F4DE}", email: "✉️", meeting: "\u{1F91D}", note: "\u{1F4DD}", proposal_created: "\u{1F4C4}", proposal_sent: "\u{1F4E4}", proposal_viewed: "\u{1F440}", proposal_accepted: "✅", payment: "\u{1F4B0}" };
                const icon = iconMap[event.icon] ?? iconMap[event.type] ?? "\u{1F4CC}";
                return (
                  <div key={event.id} className="pnl" style={{ padding: 0 }}>
                    <div style={{ padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>{icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-60)" }}>{event.label}</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-60)" }}>·</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--ink-60)" }}>{fmtDate(event.occurredAt)}</span>
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{event.summary}</div>
                      </div>
                      {event.deletable && (
                        <button
                          onClick={() => deleteNote.mutate({ noteId: event.noteId })}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-60)", padding: 4, flexShrink: 0 }}
                          title="Delete"
                        >
                          <NavIcon name="trash" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Referrals tab */}
          {activeTab === "referrals" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Referred by */}
              {referralsData?.referredBy && (
                <div className="pnl">
                  <div className="pnl-hd"><h3>Referred by</h3></div>
                  <div className="pnl-body">
                    <div style={{ fontSize: 13 }}>
                      Payer #{referralsData.referredBy.referrerClientId} referred this payer.
                      {referralsData.referredBy.notes && <div style={{ color: "var(--ink-60)", marginTop: 4 }}>{referralsData.referredBy.notes}</div>}
                    </div>
                  </div>
                </div>
              )}

              {/* Referrals made */}
              <div className="pnl">
                <div className="pnl-hd">
                  <h3>Payers referred by {client.name?.split(" ")[0]}</h3>
                  <button className="btn ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setShowAddRef(!showAddRef)}>
                    <NavIcon name="plus" /> Add referral
                  </button>
                </div>
                {showAddRef && (
                  <div className="pnl-body" style={{ borderBottom: "1px solid var(--border-2)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div className="fld">
                        <label>Referred payer</label>
                        <select
                          value={refClientId}
                          onChange={e => setRefClientId(e.target.value)}
                          style={{ width: "100%", padding: "8px 10px", background: "var(--paper)", border: "1px solid var(--border-1)", borderRadius: 6, color: "var(--ink)" }}
                        >
                          <option value="">Select a payer…</option>
                          {(allClients as any)?.filter((c: any) => c.id !== clientId).map((c: any) => (
                            <option key={c.id} value={c.id}>{c.name}{c.businessName ? ` · ${c.businessName}` : ""}</option>
                          ))}
                        </select>
                      </div>
                      <div className="fld">
                        <label>Notes (optional)</label>
                        <input value={refNotes} onChange={e => setRefNotes(e.target.value)} placeholder="How did this referral happen?" />
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn ghost" onClick={() => setShowAddRef(false)}>Cancel</button>
                        <button
                          className="btn primary"
                          onClick={() => addReferral.mutate({ referrerClientId: clientId, referredClientId: refClientId, notes: refNotes || undefined })}
                          disabled={!refClientId || addReferral.isPending}
                        >{addReferral.isPending ? "Saving…" : "Record referral"}</button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="pnl-body" style={{ padding: 0 }}>
                  {referralsData?.referrals?.length === 0 && (
                    <div style={{ padding: "24px 16px", color: "var(--ink-60)", fontSize: 13, textAlign: "center" }}>No referrals recorded yet.</div>
                  )}
                  {referralsData?.referrals?.map((r: any) => (
                    <div key={r.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>Payer #{r.referredClientId}</div>
                        {r.notes && <div style={{ fontSize: 11, color: "var(--ink-60)", marginTop: 2 }}>{r.notes}</div>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {r.creditApplied ? (
                          <span style={{ fontSize: 11, color: "#22c55e", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>CREDIT APPLIED</span>
                        ) : (
                          <button
                            className="btn ghost"
                            style={{ fontSize: 11, padding: "3px 10px" }}
                            onClick={() => applyCredit.mutate({ referralId: r.id })}
                            disabled={applyCredit.isPending}
                          >Apply credit</button>
                        )}
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)" }}>{fmtDate(r.createdAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* Reminders tab */}
          {activeTab === "reminders" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="pnl">
                <div className="pnl-hd" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <h3>Renewal &amp; Follow-up Reminders</h3>
                  <button className="btn ghost" style={{ fontSize: 11, padding: "4px 12px" }} onClick={() => setShowAddReminder(!showAddReminder)}>+ Add reminder</button>
                </div>
                {showAddReminder && (
                  <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-2)", background: "var(--bg-inset)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                      <div className="fld">
                        <label>Type</label>
                        <select value={reminderType} onChange={(e) => setReminderType(e.target.value as any)} style={{ width: "100%", padding: "7px 10px", border: "1px solid var(--border-1)", borderRadius: 7, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 13 }}>
                          <option value="renewal">Renewal</option>
                          <option value="anniversary">Anniversary</option>
                          <option value="check_in">Check-in</option>
                        </select>
                      </div>
                      <div className="fld">
                        <label>Due date</label>
                        <input type="date" value={reminderDueAt} onChange={(e) => setReminderDueAt(e.target.value)} style={{ width: "100%", padding: "7px 10px", border: "1px solid var(--border-1)", borderRadius: 7, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 13 }} />
                      </div>
                    </div>
                    <div className="fld" style={{ marginBottom: 10 }}>
                      <label>Notes (optional)</label>
                      <input value={reminderNotes} onChange={(e) => setReminderNotes(e.target.value)} placeholder="e.g. Annual contract renewal" style={{ width: "100%", padding: "7px 10px", border: "1px solid var(--border-1)", borderRadius: 7, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 13 }} />
                    </div>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button className="btn ghost" onClick={() => setShowAddReminder(false)}>Cancel</button>
                      <button
                        className="btn primary"
                        disabled={!reminderDueAt || createReminder.isPending}
                        onClick={() => createReminder.mutate({ clientId, type: reminderType, dueAt: new Date(reminderDueAt).getTime(), notes: reminderNotes || undefined })}
                      >{createReminder.isPending ? "Saving…" : "Create reminder"}</button>
                    </div>
                  </div>
                )}
                <div className="pnl-body" style={{ padding: 0 }}>
                  {(!remindersData || remindersData.length === 0) && (
                    <div style={{ padding: "24px 16px", color: "var(--ink-60)", fontSize: 13, textAlign: "center" }}>No reminders yet. Add one to track renewals and follow-ups.</div>
                  )}
                  {remindersData?.map((r: any) => (
                    <div key={r.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 4, background: r.status === "pending" ? "#EFF6FF" : "var(--bg-inset)", color: r.status === "pending" ? "#2563EB" : "var(--ink-40)" }}>{r.type.replace("_", " ")}</span>
                          <span style={{ fontSize: 12, color: "var(--ink)" }}>Due {fmtDate(r.dueAt)}</span>
                        </div>
                        {r.notes && <div style={{ fontSize: 11, color: "var(--ink-60)", marginTop: 4 }}>{r.notes}</div>}
                      </div>
                      {r.status === "pending" && (
                        <button
                          className="btn ghost"
                          style={{ fontSize: 11, padding: "3px 10px" }}
                          onClick={() => dismissReminder.mutate({ reminderId: r.id })}
                          disabled={dismissReminder.isPending}
                        >Dismiss</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="pnl">
            <div className="pnl-hd"><h3>Contact details</h3></div>
            <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { label: "Email", value: client.email },
                { label: "Mobile", value: client.mobile },
                { label: "Business", value: client.businessName },
                { label: "ABN", value: client.abn },
                { label: "Address", value: client.address },
              ].filter(f => f.value).map((f, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)" }}>{f.label}</div>
                  <div style={{ fontSize: 13 }}>{f.value}</div>
                </div>
              ))}
              {!client.email && !client.mobile && !client.businessName && (
                <div style={{ color: "var(--ink-60)", fontSize: 12 }}>No contact details yet.</div>
              )}
            </div>
          </div>

          {health && (
            <div className="pnl">
              <div className="pnl-hd"><h3>Quick stats</h3></div>
              <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { label: "Acceptance rate", value: `${health.stats.acceptanceRate}%` },
                  { label: "Paid proposals", value: health.stats.paidProposals },
                  { label: "Disputed", value: health.stats.disputedProposals },
                  { label: "Days since last", value: health.stats.daysSinceLast !== null ? `${health.stats.daysSinceLast}d` : "—" },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-60)" }}>{s.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      {editOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 200 }}>
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, maxWidth: 480, width: "90%", border: "1px solid var(--border-1)" }}>
            <h3 style={{ margin: "0 0 20px" }}>Edit payer</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
              <div className="fld"><label>Name *</label><input value={editName} onChange={e => setEditName(e.target.value)} /></div>
              <div className="fld"><label>Business name</label><input value={editBusiness} onChange={e => setEditBusiness(e.target.value)} /></div>
              <div className="fld"><label>Email</label><input type="email" value={editEmail} onChange={e => setEditEmail(e.target.value)} /></div>
              <div className="fld"><label>Mobile</label><input value={editMobile} onChange={e => setEditMobile(e.target.value)} /></div>
              <div className="fld"><label>ABN</label><input value={editAbn} onChange={e => setEditAbn(e.target.value)} /></div>
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setEditOpen(false)}>Cancel</button>
              <button
                className="btn primary"
                onClick={() => updateClient.mutate({ id: clientId, name: editName, email: editEmail, mobile: editMobile, businessName: editBusiness, abn: editAbn })}
                disabled={updateClient.isPending || !editName.trim()}
              >
                {updateClient.isPending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
