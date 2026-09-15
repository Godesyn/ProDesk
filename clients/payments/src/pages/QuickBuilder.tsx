import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";

// No hardcoded fallback sets — if DB has none, show empty state directing user to Pricing

type Model = "one_off" | "subscription" | "payment_plan";
type Opt = { id: string; name: string; description: string; unitPriceCents: number; on: boolean; required: boolean; };

const fmtAUD = (cents: number) => "$" + (cents / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 });

/** Template-backed pseudo quick sets get a prefixed id so we never send them as quickSetId. */
const TEMPLATE_SET_PREFIX = "tpl:";

export default function QuickBuilder() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const brandId = useBrandId();

  // ── Step state ─────────────────────────────────────────────────────────
  const [step, setStep] = useState<"client" | "set" | "edit" | "sent">("client");

  // ── Client picker state ────────────────────────────────────────────────
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedClientName, setSelectedClientName] = useState("");
  const [showNewClient, setShowNewClient] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [newBiz, setNewBiz] = useState("");

  // ── Set picker state ───────────────────────────────────────────────────
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);

  // ── Edit state ─────────────────────────────────────────────────────────
  const [opts, setOpts] = useState<Opt[]>([]);
  const [model, setModel] = useState<Model>("one_off");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  // ── Success state ──────────────────────────────────────────────────────
  const [sentSlug, setSentSlug] = useState("");
  const [sentTotal, setSentTotal] = useState(0);

  // ── Queries ────────────────────────────────────────────────────────────
  const { data: clientsData } = useQuery({
    ...trpc.payments.clients.list.queryOptions({ brandId: brandId!, search: clientSearch || undefined, limit: 20 }),
    enabled: !!brandId,
  });
  const { data: quickSetsData } = useQuery({
    ...trpc.payments.pricing.listQuickSets.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: templatesData } = useQuery({
    ...trpc.payments.templates.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────
  const createClientMutation = useMutation(trpc.payments.clients.create.mutationOptions());
  const createQuickMutation = useMutation(trpc.payments.proposals.createQuick.mutationOptions());

  // ── Derived data ───────────────────────────────────────────────────────
  const clients = clientsData?.rows ?? [];

  const sets = useMemo(() => {
    if (!quickSetsData) return [];
    return quickSetsData.map(s => ({
      id: s.id as string,
      name: s.name,
      defaultPaymentModel: (s.defaultPaymentModel ?? "one_off") as Model,
      options: ((s.options as any[]) ?? []).map((o: any) => ({
        id: o.id ?? String(Math.random()),
        name: o.name ?? o.nm ?? "",
        description: o.description ?? o.sub ?? "",
        unitPriceCents: o.unitPriceCents ?? (o.price ? o.price * 100 : 0),
        on: o.on ?? true,
        required: o.required ?? false,
      })),
    }));
  }, [quickSetsData]);

  const templateSets = useMemo(() => {
    return (templatesData ?? []).map(t => ({
      id: `${TEMPLATE_SET_PREFIX}${t.id}`,
      name: t.name + " (template)",
      defaultPaymentModel: "one_off" as Model,
      options: ((t.structure as any)?.lineItems ?? []).map((li: any) => ({
        id: li.id ?? String(Math.random()),
        name: li.name ?? "",
        description: li.description ?? "",
        unitPriceCents: li.unitPriceCents ?? 0,
        on: true,
        required: false,
      })),
    })).filter(t => t.options.length > 0);
  }, [templatesData]);

  const allSets = [...sets, ...templateSets];
  const total = opts.filter(o => o.on).reduce((s, o) => s + o.unitPriceCents, 0);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleSelectClient = (id: string, name: string) => {
    setSelectedClientId(id);
    setSelectedClientName(name);
    setStep("set");
  };

  const handleCreateClient = async () => {
    if (!newName.trim()) { toast.error("Enter a name"); return; }
    if (!brandId) { toast.error("No active brand"); return; }
    try {
      const client = await createClientMutation.mutateAsync({
        brandId,
        name: newName.trim(),
        businessName: newBiz.trim() || undefined,
        mobile: newMobile.trim() || undefined,
      });
      if (client) {
        setSelectedClientId(client.id);
        setSelectedClientName(client.businessName ?? client.name);
        setShowNewClient(false);
        setStep("set");
      }
    } catch (e: any) {
      toast.error(sanitizeError(e, "Failed to create payer"));
    }
  };

  const handleSelectSet = (setId: string) => {
    const s = allSets.find(x => x.id === setId);
    if (!s) return;
    setSelectedSetId(setId);
    setOpts(s.options.map((o: Opt) => ({ ...o })));
    setModel(s.defaultPaymentModel);
    setStep("edit");
  };

  const toggle = (id: string) => {
    setOpts(prev => prev.map(o => o.id === id && !o.required ? { ...o, on: !o.on } : o));
  };

  const handleSend = async () => {
    if (!selectedClientId) { toast.error("No payer selected"); return; }
    if (!brandId) { toast.error("No active brand"); return; }
    const activeOpts = opts.filter(o => o.on);
    if (activeOpts.length === 0) { toast.error("Select at least one line item"); return; }
    setSending(true);
    try {
      const lineItems = activeOpts.map((o, i) => ({
        id: o.id,
        type: "custom" as const,
        name: o.name,
        description: o.description,
        quantity: 1,
        unitPriceCents: o.unitPriceCents,
        taxBehaviour: "inclusive" as const,
        sortOrder: i,
      }));
      const result = await createQuickMutation.mutateAsync({
        brandId,
        clientId: selectedClientId,
        lineItems,
        paymentModel: model,
        sendViaSms: true,
        ...(selectedSetId && !selectedSetId.startsWith(TEMPLATE_SET_PREFIX) ? { quickSetId: selectedSetId } : {}),
      });
      if (result.success) {
        setSentSlug(result.slug);
        setSentTotal(total);
        setStep("sent");
      }
    } catch (e: any) {
      toast.error(sanitizeError(e, "Failed to send"));
    } finally {
      setSending(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  if (step === "sent") {
    const proposalUrl = `${window.location.origin}/p/${sentSlug}`;
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-page)", padding: 24 }}>
        <div style={{ width: "100%", maxWidth: 400, background: "var(--card)", borderRadius: 20, overflow: "hidden", boxShadow: "0 8px 48px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column", alignItems: "center", padding: 32, textAlign: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--volt)", display: "grid", placeItems: "center" }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-11" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-40)" }}>SENT · DELIVERED</div>
          <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 32, letterSpacing: "-0.02em", margin: 0 }}>Off to <em>{selectedClientName}.</em></h2>
          <p style={{ fontSize: 14, color: "var(--ink-60)", margin: 0 }}>
            Proposal created and marked as sent. Share the link below with your payer so they can review and pay.
          </p>
          <div style={{ background: "var(--bg-inset)", border: "1px solid var(--border-1)", borderRadius: 10, padding: 14, width: "100%", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
            {[
              { k: "Payer", v: selectedClientName },
              { k: "Total", v: fmtAUD(sentTotal) },
              { k: "Model", v: model === "subscription" ? "Subscription · monthly" : model === "payment_plan" ? "Payment plan" : "One-off" },
            ].map((r, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--ink-60)" }}>{r.k}</span>
                <b style={{ fontWeight: 600 }}>{r.v}</b>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, width: "100%" }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={() => {
              setStep("client"); setSelectedClientId(null); setSelectedClientName(""); setOpts([]); setNote("");
            }}>
              Send another
            </button>
            <button className="btn ghost" style={{ flex: 1 }} onClick={() => navigate("/proposals")}>
              View proposals
            </button>
          </div>
          <button className="btn ghost" style={{ width: "100%", fontSize: 12 }} onClick={() => {
            navigator.clipboard.writeText(proposalUrl);
            toast.success("Link copied");
          }}>
            Copy proposal link
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "var(--bg-page)", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "var(--card)", borderRadius: 20, overflow: "hidden", boxShadow: "0 8px 48px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column" }}>

        {/* Top bar */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button className="icon-only" onClick={() => {
            if (step === "set") setStep("client");
            else if (step === "edit") setStep("set");
            else navigate("/app");
          }}>
            {step === "client" ? "✕" : "←"}
          </button>
          <span style={{ fontWeight: 700, fontSize: 15 }}>Quick <em style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>builder</em></span>
          <div style={{ display: "flex", gap: 6 }}>
            {(["client", "set", "edit"] as const).map((s, i) => (
              <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: step === s ? "var(--ink)" : "var(--ink-20)", transition: "background 200ms" }} />
            ))}
          </div>
        </div>

        {/* ── STEP 1: Client picker ── */}
        {step === "client" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)" }}>
              WHO IS THIS FOR?
            </div>

            {!showNewClient ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-40)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/></svg>
                  <input
                    value={clientSearch}
                    onChange={e => setClientSearch(e.target.value)}
                    placeholder="Search clients by name or mobile…"
                    style={{ flex: 1, border: 0, background: "transparent", fontSize: 14, outline: "none", color: "var(--ink)" }}
                    autoFocus
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
                  {clients.length > 0 ? (clients as any[]).map((c: any) => (
                    <div key={c.id} onClick={() => handleSelectClient(c.id, c.businessName ?? c.name)}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)", cursor: "pointer", transition: "background 160ms" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-inset)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--paper)"}
                    >
                      <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--ink)", color: "var(--paper)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {(c.businessName ?? c.name ?? "?").slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.businessName ?? c.name}</div>
                        {c.businessName && c.name !== c.businessName && (
                          <div style={{ fontSize: 11, color: "var(--ink-60)" }}>{c.name}</div>
                        )}
                        {c.mobile && <div style={{ fontSize: 11, color: "var(--ink-60)", fontFamily: "var(--font-mono)" }}>{c.mobile}</div>}
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-40)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  )) : (
                    <div style={{ padding: "20px 0", textAlign: "center", color: "var(--ink-60)", fontSize: 13 }}>
                      {clientSearch ? "No payers match that search." : "No payers yet."}
                    </div>
                  )}
                </div>

                <button className="btn ghost" style={{ width: "100%" }} onClick={() => setShowNewClient(true)}>
                  + New payer
                </button>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--ink-60)" }}>NEW CLIENT</div>
                <input className="fld-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Contact name *" autoFocus />
                <input className="fld-input" value={newBiz} onChange={e => setNewBiz(e.target.value)} placeholder="Business name (optional)" />
                <input className="fld-input" value={newMobile} onChange={e => setNewMobile(e.target.value)} placeholder="Mobile (optional)" type="tel" />
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn ghost" style={{ flex: 1 }} onClick={() => setShowNewClient(false)}>Cancel</button>
                  <button className="btn primary" style={{ flex: 2 }} disabled={createClientMutation.isPending} onClick={handleCreateClient}>
                    {createClientMutation.isPending ? "Creating…" : "Create & continue →"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Quick set picker ── */}
        {step === "set" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 2 }}>
                FOR {selectedClientName.toUpperCase()}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)" }}>
                PICK A QUICK SET
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflowY: "auto" }}>
              {allSets.length > 0 ? allSets.map(s => (
                <div key={s.id} onClick={() => handleSelectSet(s.id)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--paper)", borderRadius: 10, border: "1px solid var(--border-1)", cursor: "pointer", transition: "background 160ms" }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "var(--bg-inset)"}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "var(--paper)"}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-60)", marginTop: 2 }}>
                      {s.options.filter((o: Opt) => o.on).length} items · {fmtAUD(s.options.filter((o: Opt) => o.on).reduce((sum: number, o: Opt) => sum + o.unitPriceCents, 0))}
                      {s.defaultPaymentModel === "subscription" ? "/mo" : ""}
                    </div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-40)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              )) : (
                <div style={{ padding: "24px 0", textAlign: "center", color: "var(--ink-60)", fontSize: 13 }}>
                  No quick sets yet.{" "}
                  <span style={{ color: "var(--ink)", textDecoration: "underline", cursor: "pointer" }} onClick={() => navigate("/pricing")}>
                    Create one in Pricing →
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 3: Edit & send ── */}
        {step === "edit" && (
          <>
            <div style={{ padding: "14px 16px", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Client + set summary */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--ink)", color: "var(--paper)", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                  {selectedClientName.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{selectedClientName}</span>
                  <span style={{ color: "var(--ink-60)", fontSize: 12, marginLeft: 6 }}>
                    · {allSets.find(s => s.id === selectedSetId)?.name ?? "Custom"}
                  </span>
                </div>
                <button className="icon-only" style={{ fontSize: 11 }} onClick={() => setStep("client")}>✎</button>
              </div>

              {/* Line items */}
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 8 }}>LINE ITEMS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {opts.map(o => (
                    <div key={o.id} onClick={() => toggle(o.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--paper)", borderRadius: 8, border: `1px solid ${o.on ? "var(--ink)" : "var(--border-1)"}`, opacity: o.required ? 1 : (o.on ? 1 : 0.55), cursor: o.required ? "default" : "pointer", transition: "all 160ms ease" }}
                    >
                      <span style={{ width: 28, height: 16, background: o.on ? "var(--ink)" : "var(--ink-20)", borderRadius: 999, position: "relative", flexShrink: 0 }}>
                        <span style={{ position: "absolute", top: 2, ...(o.on ? { right: 2 } : { left: 2 }), width: 12, height: 12, borderRadius: "50%", background: o.on ? "var(--volt)" : "var(--paper)", transition: "all 160ms ease" }} />
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
                          {o.name}
                          {o.required && <span style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.12em", color: "var(--ink-60)", background: "var(--bg-inset)", padding: "1px 4px", borderRadius: 3, fontWeight: 600 }}>REQ</span>}
                        </div>
                        {o.description && <div style={{ fontSize: 11, color: "var(--ink-60)" }}>{o.description}</div>}
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12 }}>{fmtAUD(o.unitPriceCents)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payment model */}
              <div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 8 }}>PAYMENT MODEL</div>
                <div style={{ display: "flex", background: "var(--paper)", borderRadius: 8, padding: 3, border: "1px solid var(--border-1)" }}>
                  {(["one_off", "subscription", "payment_plan"] as Model[]).map(m => (
                    <button key={m} onClick={() => setModel(m)} style={{ flex: 1, padding: "7px 0", borderRadius: 6, border: 0, background: model === m ? "var(--ink)" : "transparent", color: model === m ? "var(--volt)" : "var(--ink-60)", fontWeight: model === m ? 700 : 500, fontSize: 11, cursor: "pointer", transition: "all 160ms ease" }}>
                      {m === "one_off" ? "One-off" : m === "subscription" ? "Monthly" : "Plan"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Optional note */}
              <div className="fld">
                <label>Optional note to payer</label>
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Same setup as last time, let me know if you have questions." />
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-1)", background: "var(--card)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--ink-60)" }}>
                  {model === "subscription" ? "MONTHLY TOTAL" : model === "payment_plan" ? "TOTAL OVER PLAN" : "ONE-OFF TOTAL"}
                </span>
                <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em" }}>
                  {fmtAUD(total)}<span style={{ fontSize: 13, color: "var(--ink-60)", fontWeight: 600 }}>{model === "subscription" ? "/mo" : ""}</span>
                </span>
              </div>
              <button onClick={handleSend} disabled={sending} style={{ width: "100%", padding: "13px 16px", background: "var(--ink)", color: "var(--volt)", border: 0, borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: sending ? "not-allowed" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", opacity: sending ? 0.7 : 1, transition: "opacity 160ms" }}>
                <span>{sending ? "Sending…" : `Send to ${selectedClientName}`}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{fmtAUD(total)}{model === "subscription" ? "/mo" : ""} →</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
