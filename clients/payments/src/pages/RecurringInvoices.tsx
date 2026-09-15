import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useConfirm } from "@shared/components/ui/confirm-dialog";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
const FREQ_LABELS: Record<string, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annually: "Annually",
};

function formatCents(cents: number, currency = "AUD") {
  return `${currency} ${(cents / 100).toFixed(2)}`;
}

function NewInvoiceModal({ onClose }: { onClose: () => void }) {
  const trpc = useTRPC();
  const brandId = useBrandId();
  // Use limit:100 (server max) instead of 200 which was silently capped/rejected
  const { data: clientsData, isLoading: clientsLoading, refetch: refetchClients } = useQuery({
    ...trpc.payments.clients.list.queryOptions({ brandId: brandId!, limit: 100 }),
    enabled: !!brandId,
  });
  const clients = (clientsData as any)?.rows ?? clientsData ?? [];
  const qc = useQueryClient();
  const create = useMutation({
    ...trpc.payments.recurringInvoices.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Recurring invoice created");
      qc.invalidateQueries({ queryKey: trpc.payments.recurringInvoices.list.queryKey() });
      onClose();
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const createClient = useMutation(trpc.payments.clients.create.mutationOptions({
    onSuccess: async (newClient: any) => {
      await refetchClients();
      setForm(f => ({ ...f, clientId: newClient.id }));
      setShowNewPayer(false);
      setNewPayerForm({ name: "", businessName: "", email: "", mobile: "" });
      toast.success("Payer added");
    },
    onError: (e) => toast.error(sanitizeError(e)),
  }));

  const [form, setForm] = useState({
    clientId: "",
    title: "",
    frequency: "monthly" as const,
    startDate: new Date().toISOString().slice(0, 10),
    currency: "AUD",
    notes: "",
  });
  const [lineItems, setLineItems] = useState([{ name: "", qty: 1, unitCents: 0 }]);
  const [showNewPayer, setShowNewPayer] = useState(false);
  const [newPayerForm, setNewPayerForm] = useState({ name: "", businessName: "", email: "", mobile: "" });

  const totalCents = lineItems.reduce((s, li) => s + (li.qty * li.unitCents), 0);

  function submit() {
    if (!form.clientId) return toast.error("Select a payer");
    if (!form.title.trim()) return toast.error("Enter a title");
    if (lineItems.some(li => !li.name.trim())) return toast.error("All line items need a name");
    create.mutate({ ...form, lineItems, totalCents });
  }

  function submitNewPayer() {
    if (!newPayerForm.name.trim()) return toast.error("Name is required");
    createClient.mutate({ brandId: brandId!, ...newPayerForm });
  }

  const inputStyle = { width: "100%", padding: "8px 12px", border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 13, boxSizing: "border-box" as const };
  const labelStyle = { fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "var(--ink-40)", display: "block", marginBottom: 6 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-1)", borderRadius: 14, padding: 28, width: 520, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", marginBottom: 20 }}>New Recurring Invoice</h3>
        <div style={{ display: "grid", gap: 14 }}>

          {/* Payer selector + inline create */}
          <div>
            <label style={labelStyle}>Payer</label>
            {showNewPayer ? (
              <div style={{ border: "1px solid var(--border-1)", borderRadius: 10, padding: 14, background: "var(--bg-inset)", display: "grid", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>New payer</div>
                <input placeholder="Full name *" value={newPayerForm.name} onChange={e => setNewPayerForm(f => ({ ...f, name: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} />
                <input placeholder="Business name (optional)" value={newPayerForm.businessName} onChange={e => setNewPayerForm(f => ({ ...f, businessName: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input placeholder="Email (optional)" value={newPayerForm.email} onChange={e => setNewPayerForm(f => ({ ...f, email: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} />
                  <input placeholder="Mobile (optional)" value={newPayerForm.mobile} onChange={e => setNewPayerForm(f => ({ ...f, mobile: e.target.value }))} style={{ ...inputStyle, fontSize: 12 }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                  <button className="btn ghost" style={{ fontSize: 12 }} onClick={() => { setShowNewPayer(false); setNewPayerForm({ name: "", businessName: "", email: "", mobile: "" }); }}>Cancel</button>
                  <button className="btn primary" style={{ fontSize: 12 }} disabled={createClient.isPending} onClick={submitNewPayer}>{createClient.isPending ? "Adding…" : "Add payer"}</button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={form.clientId}
                  onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
                  style={{ ...inputStyle, flex: 1 }}
                  disabled={clientsLoading}
                >
                  <option value="">{clientsLoading ? "Loading payers…" : (clients as any[]).length === 0 ? "No payers yet — create one →" : "Select payer…"}</option>
                  {(clients as any[]).map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}{c.businessName ? ` — ${c.businessName}` : ""}</option>
                  ))}
                </select>
                <button
                  className="btn ghost"
                  style={{ fontSize: 12, whiteSpace: "nowrap", padding: "8px 12px" }}
                  onClick={() => setShowNewPayer(true)}
                  title="Create a new payer"
                >+ New</button>
              </div>
            )}
          </div>

          <div>
            <label style={labelStyle}>Title</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Monthly retainer" style={inputStyle} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div>
              <label style={labelStyle}>Frequency</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value as any }))} style={inputStyle}>
                {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Start Date</label>
              <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Currency</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} style={inputStyle}>
                {["AUD","USD","GBP","EUR","NZD","CAD","SGD"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label style={labelStyle}>Line Items</label>
            {lineItems.map((li, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 60px 100px 32px", gap: 6, marginBottom: 6 }}>
                <input placeholder="Description" value={li.name} onChange={e => setLineItems(items => items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} style={{ padding: "6px 10px", border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 12 }} />
                <input type="number" min={1} placeholder="Qty" value={li.qty} onChange={e => setLineItems(items => items.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} style={{ padding: "6px 8px", border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 12, textAlign: "center" }} />
                <input type="number" min={0} step={0.01} placeholder="Unit price" value={li.unitCents / 100} onChange={e => setLineItems(items => items.map((x, j) => j === i ? { ...x, unitCents: Math.round(Number(e.target.value) * 100) } : x))} style={{ padding: "6px 8px", border: "1px solid var(--border-1)", borderRadius: 6, background: "var(--bg-inset)", color: "var(--ink)", fontSize: 12 }} />
                <button onClick={() => setLineItems(items => items.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", color: "var(--ink-40)", cursor: "pointer", fontSize: 16 }}>×</button>
              </div>
            ))}
            <button onClick={() => setLineItems(items => [...items, { name: "", qty: 1, unitCents: 0 }])} className="btn ghost" style={{ fontSize: 12, padding: "4px 10px", marginTop: 4 }}>+ Add line item</button>
          </div>
          <div>
            <label style={labelStyle}>Notes (optional)</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>Total: {formatCents(totalCents, form.currency)}</span>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={create.isPending} onClick={submit}>{create.isPending ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RecurringInvoices() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const confirm = useConfirm();
  const { data: invoices = [], isLoading } = useQuery({
    ...trpc.payments.recurringInvoices.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const qc = useQueryClient();
  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: trpc.payments.recurringInvoices.list.queryKey() });
  const toggle = useMutation({
    ...trpc.payments.recurringInvoices.toggle.mutationOptions(),
    onSuccess: () => invalidateList(),
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const del = useMutation({
    ...trpc.payments.recurringInvoices.delete.mutationOptions(),
    onSuccess: () => { toast.success("Deleted"); invalidateList(); },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const [showNew, setShowNew] = useState(false);

  return (
    <div style={{ padding: "32px 40px", maxWidth: 900 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Recurring Invoices</h1>
            <p style={{ fontSize: 13, color: "var(--ink-40)", marginTop: 4 }}>Auto-send invoices to clients on a schedule.</p>
          </div>
          <button className="btn primary" onClick={() => setShowNew(true)}>+ New Recurring Invoice</button>
        </div>

        {isLoading ? (
          <div style={{ color: "var(--ink-40)", fontSize: 14 }}>Loading…</div>
        ) : (invoices as any[]).length === 0 ? (
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-1)", borderRadius: 12, padding: "48px 32px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", marginBottom: 8 }}>No recurring invoices yet</div>
            <div style={{ fontSize: 13, color: "var(--ink-40)", marginBottom: 20 }}>Set up automatic invoices that send on a weekly, monthly, or custom schedule.</div>
            <button className="btn primary" onClick={() => setShowNew(true)}>Create your first recurring invoice</button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {(invoices as any[]).map((inv: any) => (
              <div key={inv.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border-1)", borderRadius: 12, padding: "18px 22px", display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 2 }}>{inv.title}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-40)" }}>
                    {FREQ_LABELS[inv.frequency]} · {formatCents(inv.totalCents, inv.currency)} · Next: {new Date(inv.nextDueAt).toLocaleDateString()}
                    {inv.lastSentAt && ` · Last sent: ${new Date(inv.lastSentAt).toLocaleDateString()}`}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={() => toggle.mutate({ id: inv.id, isActive: !inv.isActive })}
                    style={{ padding: "4px 12px", borderRadius: 20, border: "1px solid var(--border-1)", background: inv.isActive ? "var(--accent)" : "var(--bg-inset)", color: inv.isActive ? "var(--accent-fg)" : "var(--ink-40)", fontSize: 11, fontWeight: 700, cursor: "pointer", transition: "all 0.15s" }}
                  >
                    {inv.isActive ? "Active" : "Paused"}
                  </button>
                  <button
                    onClick={async () => {
                      if (await confirm({ title: "Delete this recurring invoice?", destructive: true })) {
                        del.mutate({ id: inv.id });
                      }
                    }}
                    style={{ border: "none", background: "transparent", color: "var(--ink-40)", cursor: "pointer", fontSize: 18, lineHeight: 1 }}
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      {showNew && <NewInvoiceModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
