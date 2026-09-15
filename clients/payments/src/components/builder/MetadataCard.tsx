/**
 * MetadataCard — compact proposal header + payment configuration.
 *
 * Density target: ≤500px for full subscription config (setup fee on + all toggles visible).
 * Design reference: Stripe Dashboard subscription creation, Notion property editor, Linear issue modal.
 *
 * Layout rules:
 *   - Payer + Title: full-width rows
 *   - Payment model selector: full-width
 *   - Config row: all model-specific fields in ONE horizontal row (wraps on narrow screens)
 *   - Setup fee (subscription): inline in the config row when enabled — Label + Amount beside toggle
 *   - Auto-renew (subscription): single compact row with tooltip
 *   - Payer permissions: three columns on one row, each with title + toggle + tooltip icon
 *   - Dual option: upfront config row + plan config row
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
import type { PaymentConfig } from "./types";

interface Client {
  id: string;
  name: string;
  businessName?: string;
  email?: string;
  mobile?: string;
}

interface MetadataCardProps {
  title: string;
  onTitleChange: (v: string) => void;
  clientId: string | null;
  clients: Client[];
  onClientChange: (id: string | null) => void;
  paymentConfig: PaymentConfig;
  onPaymentConfigChange: (patch: Partial<PaymentConfig>) => void;
  /** @deprecated kept for API compat */
  onAddClient: () => void;
}

const CADENCE_OPTIONS = [
  { value: "weekly",      label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly",     label: "Monthly" },
  { value: "quarterly",   label: "Quarterly" },
  { value: "annually",    label: "Annually" },
];

const TERM_OPTIONS = [
  { value: "3m",         label: "3 mo" },
  { value: "6m",         label: "6 mo" },
  { value: "12m",        label: "12 mo" },
  { value: "18m",        label: "18 mo" },
  { value: "24m",        label: "24 mo" },
  { value: "36m",        label: "36 mo" },
  { value: "open-ended", label: "Open-ended" },
];

// ── Inline client combobox ─────────────────────────────────────────────────────
function ClientCombobox({
  clientId, clients, onClientChange,
}: {
  clientId: string | null;
  clients: Client[];
  onClientChange: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBiz, setNewBiz] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newMobile, setNewMobile] = useState("");
  const [creating, setCreating] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trpc = useTRPC();
  const brandId = useBrandId();
  const qc = useQueryClient();
  const createClient = useMutation(trpc.payments.clients.create.mutationOptions());

  const selected = clients.find(c => c.id === clientId);

  const filtered = query.trim()
    ? clients.filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.businessName ?? "").toLowerCase().includes(query.toLowerCase()) ||
        (c.email ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : clients;

  useEffect(() => {
    if (!open && !showNewForm) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowNewForm(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, showNewForm]);

  const handleSelect = (id: string) => {
    onClientChange(id);
    setOpen(false);
    setQuery("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClientChange(null);
    setQuery("");
  };

  const handleCreateClient = useCallback(async () => {
    if (!newName.trim()) { toast.error("Client name is required"); return; }
    if (!brandId) { toast.error("No active brand"); return; }
    setCreating(true);
    try {
      const result = await createClient.mutateAsync({
        brandId,
        name: newName.trim(),
        businessName: newBiz.trim() || undefined,
        email: newEmail.trim() || undefined,
        mobile: newMobile.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: trpc.payments.clients.list.queryKey() });
      onClientChange((result as any).id);
      setShowNewForm(false);
      setOpen(false);
      setNewName(""); setNewBiz(""); setNewEmail(""); setNewMobile("");
      toast.success(`Payer "${newName.trim()}" created`);
    } catch (e: any) {
      toast.error(sanitizeError(e, "Failed to create payer"));
    } finally {
      setCreating(false);
    }
  }, [newName, newBiz, newEmail, newMobile, createClient, brandId, qc, trpc, onClientChange]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div
        className="input"
        style={{
          display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
          minHeight: 34, padding: "5px 10px",
          background: open ? "var(--card)" : undefined,
          borderColor: open ? "var(--ink)" : undefined,
          boxShadow: open ? "var(--ring-volt)" : undefined,
        }}
        onClick={() => { setOpen(o => !o); setTimeout(() => inputRef.current?.focus(), 50); }}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {selected ? (
          <>
            <span style={{ flex: 1, fontSize: 13, color: "var(--ink)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selected.name}{selected.businessName ? ` · ${selected.businessName}` : ""}
            </span>
            <button
              type="button"
              onClick={handleClear}
              style={{ background: "none", border: "none", padding: 0, color: "var(--ink-40)", cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0 }}
              title="Clear payer"
              aria-label="Clear payer"
            >
              <svg width={12} height={12} viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </>
        ) : (
          <span style={{ flex: 1, fontSize: 13, color: "var(--ink-40)" }}>Select payer…</span>
        )}
        <svg width={10} height={10} viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, color: "var(--ink-40)", transform: open ? "rotate(180deg)" : undefined, transition: "transform 150ms" }}>
          <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>

      {open && !showNewForm && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "var(--paper)", border: "1px solid var(--border-2)",
            borderRadius: 8, boxShadow: "var(--shadow-3)",
            zIndex: 50, overflow: "hidden",
          }}
          role="listbox"
        >
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-1)" }}>
            <input
              ref={inputRef}
              className="input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search payers…"
              style={{ fontSize: 12, padding: "5px 8px" }}
              onKeyDown={e => {
                if (e.key === "Escape") { setOpen(false); setQuery(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0].id);
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--ink-60)", textAlign: "center" }}>
                No payers match "{query}"
              </div>
            ) : (
              filtered.map(c => (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={c.id === clientId}
                  onClick={() => handleSelect(c.id)}
                  style={{
                    padding: "9px 14px", cursor: "pointer", fontSize: 13,
                    display: "flex", flexDirection: "column", gap: 2,
                    background: c.id === clientId ? "rgba(217,245,66,0.15)" : undefined,
                    borderLeft: c.id === clientId ? "2px solid var(--volt)" : "2px solid transparent",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-inset)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = c.id === clientId ? "rgba(217,245,66,0.15)" : ""; }}
                >
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>{c.name}</span>
                  {(c.businessName || c.email) && (
                    <span style={{ fontSize: 11, color: "var(--ink-60)" }}>
                      {[c.businessName, c.email].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
          <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border-1)" }}>
            <button
              type="button"
              className="add-new-row"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => { setShowNewForm(true); setQuery(""); }}
            >
              <svg width={12} height={12} viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              New payer
            </button>
          </div>
        </div>
      )}

      {showNewForm && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "var(--paper)", border: "1px solid var(--border-2)",
            borderRadius: 8, boxShadow: "var(--shadow-3)",
            zIndex: 50, padding: "14px 14px 12px",
            display: "flex", flexDirection: "column", gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", fontWeight: 500 }}>New payer</span>
            <button type="button" onClick={() => { setShowNewForm(false); setOpen(true); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-40)", padding: 0, display: "flex", alignItems: "center" }}>
              <svg width={12} height={12} viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Name <span className="required">*</span></label>
              <input autoFocus className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Jane Smith" />
            </div>
            <div className="field">
              <label>Business</label>
              <input className="input" value={newBiz} onChange={e => setNewBiz(e.target.value)} placeholder="Acme Co." />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="jane@acme.com" />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Phone</label>
              <input className="input" type="tel" value={newMobile} onChange={e => setNewMobile(e.target.value)} placeholder="+61 400 000 000" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => { setShowNewForm(false); setOpen(true); }}>Cancel</button>
            <button type="button" className="btn primary" onClick={handleCreateClient} disabled={creating || !newName.trim()}>
              {creating ? "Creating…" : "Create payer"}
            </button>
          </div>
        </div>
      )}

      {selected && !open && !showNewForm && (
        <div style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--ink-60)" }}>
          {selected.businessName && <span style={{ color: "var(--ink)", fontWeight: 500 }}>{selected.businessName}</span>}
          {selected.email && <span>{selected.email}</span>}
          {selected.mobile && <span>{selected.mobile}</span>}
        </div>
      )}
    </div>
  );
}

// ── Compact toggle with tooltip ────────────────────────────────────────────────
function CompactToggle({
  label, tooltip, on, onChange,
}: {
  label: string;
  tooltip?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  const [showTip, setShowTip] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        style={{
          width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer",
          background: on ? "var(--volt)" : "var(--border-2)",
          position: "relative", flexShrink: 0, transition: "background 150ms",
        }}
      >
        <span style={{
          position: "absolute", top: 1, left: on ? 15 : 1, width: 16, height: 16,
          borderRadius: "50%", background: on ? "var(--ink)" : "var(--paper)",
          transition: "left 150ms",
        }} />
      </button>
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {tooltip && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onMouseEnter={() => setShowTip(true)}
            onMouseLeave={() => setShowTip(false)}
            onFocus={() => setShowTip(true)}
            onBlur={() => setShowTip(false)}
            style={{ background: "none", border: "none", padding: 0, cursor: "help", color: "var(--ink-40)", display: "flex", alignItems: "center" }}
            aria-label={tooltip}
          >
            <svg width={12} height={12} viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 7v5M8 5.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          {showTip && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
              background: "var(--ink)", color: "var(--paper)", fontSize: 11, lineHeight: 1.4,
              padding: "6px 10px", borderRadius: 6, whiteSpace: "normal", width: 220,
              zIndex: 100, pointerEvents: "none", boxShadow: "var(--shadow-3)",
            }}>
              {tooltip}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Compact field (label + input in a tight column) ────────────────────────────
function CField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--ink-60)", fontWeight: 500, whiteSpace: "nowrap" }}>{label}</span>
      {children}
    </div>
  );
}

// ── Compact select ─────────────────────────────────────────────────────────────
function CSelect({ value, onChange, options, style }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  style?: React.CSSProperties;
}) {
  return (
    <div className="select" style={{ minWidth: 0 }}>
      <select
        className="input"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ paddingRight: 24, appearance: "none", fontSize: 12, padding: "5px 24px 5px 8px", ...style }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Compact number input ───────────────────────────────────────────────────────
function CNumber({ value, onChange, min, max, step, placeholder, prefix, style }: {
  value: number | string;
  onChange: (v: string) => void;
  min?: number; max?: number; step?: number;
  placeholder?: string;
  prefix?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      {prefix && <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 12, color: "var(--ink-60)", pointerEvents: "none" }}>{prefix}</span>}
      <input
        className="input"
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        min={min} max={max} step={step}
        placeholder={placeholder}
        style={{ fontSize: 12, padding: prefix ? "5px 8px 5px 20px" : "5px 8px", ...style }}
      />
    </div>
  );
}

// ── Thin vertical rule between field groups in the pm-row ────────────────────
function PmDivider() {
  return <div aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: "var(--border-1)", margin: "0 2px", flexShrink: 0 }} />;
}

// ── MetadataCard ───────────────────────────────────────────────────────────────
export function MetadataCard({
  title, onTitleChange, clientId, clients, onClientChange,
  paymentConfig, onPaymentConfigChange,
}: MetadataCardProps) {
  const model = paymentConfig.paymentModel;
  const isSubscription = model === "subscription";
  const isPaymentPlan  = model === "payment-plan";
  const isDualOption   = model === "dual_option";
  const depositPct     = paymentConfig.ppDepositPct ?? 0;

  const MODEL_OPTIONS = [
    { value: "one-off",      label: "One-off payment" },
    { value: "subscription", label: "Subscription" },
    { value: "payment-plan", label: "Payment plan" },
    { value: "dual_option",  label: "Pay upfront or in installments" },
  ];

  const INTERVAL_OPTIONS = [
    { value: "weekly",       label: "Weekly" },
    { value: "fortnightly",  label: "Fortnightly" },
    { value: "monthly",      label: "Monthly" },
  ];

  return (
    <div className="card quiet">
      <div className="card-head">
        <div>
          <h2>Proposal details</h2>
          <div className="sub">Header fields and payment configuration</div>
        </div>
      </div>
      <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Row 1: Title + Payer on same line */}
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 8, alignItems: "start" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Proposal title <span className="required">*</span></label>
            <input
              className="input"
              value={title}
              onChange={e => onTitleChange(e.target.value)}
              placeholder="e.g. Brand Identity Package"
              style={{ fontSize: 13, padding: "5px 10px" }}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Payer <span className="required">*</span></label>
            <ClientCombobox clientId={clientId} clients={clients} onClientChange={onClientChange} />
          </div>
        </div>

        {/* ── Payment model selector + inline config strip ──────────────── */}
        <div className="pm-strip">

          {/* Row A: Model selector + model-specific inline controls */}
          <div className="pm-row">
            {/* Model selector — always visible */}
            <CField label="Model">
              <CSelect
                value={paymentConfig.paymentModel}
                onChange={v => onPaymentConfigChange({ paymentModel: v as PaymentConfig["paymentModel"] })}
                options={MODEL_OPTIONS}
                style={{ minWidth: 160 }}
              />
            </CField>

            {/* ── SUBSCRIPTION inline controls ── */}
            {isSubscription && (
              <>
                <PmDivider />
                <CField label="Cadence">
                  <CSelect
                    value={paymentConfig.subCadence ?? "monthly"}
                    onChange={v => onPaymentConfigChange({ subCadence: v })}
                    options={CADENCE_OPTIONS}
                  />
                </CField>
                <CField label="Term">
                  <CSelect
                    value={paymentConfig.subTerm ?? "12m"}
                    onChange={v => onPaymentConfigChange({ subTerm: v })}
                    options={TERM_OPTIONS}
                  />
                </CField>
                <PmDivider />
                <CField label="Setup fee">
                  <div className="pm-toggle-cell">
                    <CompactToggle label="" on={!!paymentConfig.subSetupFeeEnabled} onChange={v => onPaymentConfigChange({ subSetupFeeEnabled: v })} />
                  </div>
                </CField>
                {paymentConfig.subSetupFeeEnabled && (
                  <>
                    <CField label="Label">
                      <input className="input" value={paymentConfig.subSetupFeeLabel ?? ""} onChange={e => onPaymentConfigChange({ subSetupFeeLabel: e.target.value })} placeholder="Setup fee" style={{ fontSize: 12, padding: "5px 8px", width: 100 }} />
                    </CField>
                    <CField label="Amount">
                      <CNumber value={(paymentConfig.subSetupFeeCents ?? 0) / 100} onChange={v => onPaymentConfigChange({ subSetupFeeCents: Math.round((parseFloat(v) || 0) * 100) })} prefix="$" placeholder="0" min={0} step={0.01} style={{ width: 80 }} />
                    </CField>
                  </>
                )}
              </>
            )}

            {/* ── PAYMENT PLAN inline controls ── */}
            {isPaymentPlan && (
              <>
                <PmDivider />
                <CField label="Deposit %">
                  <CNumber value={depositPct} onChange={v => onPaymentConfigChange({ ppDepositPct: Math.min(100, Math.max(0, parseFloat(v) || 0)) })} min={0} max={100} step={1} placeholder="0" style={{ width: 60 }} />
                </CField>
                <CField label="Label">
                  <input className="input" value={paymentConfig.ppDepositLabel ?? ""} onChange={e => onPaymentConfigChange({ ppDepositLabel: e.target.value })} placeholder="Deposit" style={{ fontSize: 12, padding: "5px 8px", width: 90 }} />
                </CField>
                <CField label="Installments">
                  <CNumber value={paymentConfig.ppInstallments ?? ""} onChange={v => onPaymentConfigChange({ ppInstallments: v })} min={2} placeholder="3" style={{ width: 60 }} />
                </CField>
                <CField label="Interval">
                  <CSelect value={paymentConfig.ppInterval ?? "monthly"} onChange={v => onPaymentConfigChange({ ppInterval: v })} options={INTERVAL_OPTIONS} />
                </CField>
              </>
            )}

            {/* ── DUAL OPTION inline controls ── */}
            {isDualOption && (
              <>
                <PmDivider />
                <CField label="Upfront disc. %">
                  <CNumber value={paymentConfig.dualDiscountPct ?? 0} onChange={v => onPaymentConfigChange({ dualDiscountPct: Math.min(50, Math.max(0, parseFloat(v) || 0)) })} min={0} max={50} step={1} placeholder="0" style={{ width: 60 }} />
                </CField>
                <CField label="Disc. label">
                  <input className="input" value={paymentConfig.dualDiscountLabel ?? ""} onChange={e => onPaymentConfigChange({ dualDiscountLabel: e.target.value })} placeholder="Upfront discount" style={{ fontSize: 12, padding: "5px 8px", width: 120 }} />
                </CField>
                <PmDivider />
                <CField label="Deposit %">
                  <CNumber value={depositPct} onChange={v => onPaymentConfigChange({ ppDepositPct: Math.min(100, Math.max(0, parseFloat(v) || 0)) })} min={0} max={100} step={1} placeholder="0" style={{ width: 60 }} />
                </CField>
                <CField label="Installs">
                  <CNumber value={paymentConfig.ppInstallments ?? ""} onChange={v => onPaymentConfigChange({ ppInstallments: v })} min={2} placeholder="6" style={{ width: 60 }} />
                </CField>
                <CField label="Interval">
                  <CSelect value={paymentConfig.ppInterval ?? "monthly"} onChange={v => onPaymentConfigChange({ ppInterval: v })} options={INTERVAL_OPTIONS} />
                </CField>
              </>
            )}
          </div>

          {/* Row B: Toggles — only shown when model has toggles */}
          {isSubscription && (
            <div className="pm-row pm-toggles">
              {paymentConfig.subTerm !== "open-ended" && (
                <CompactToggle
                  label="Auto-renew"
                  tooltip="When on, subscription rolls into a new term at the same rate with 30-day cancellation notice. When off, subscription ends with 30-day ending notice."
                  on={paymentConfig.subAutoRenew !== false}
                  onChange={v => onPaymentConfigChange({ subAutoRenew: v })}
                />
              )}
              <span className="pm-toggle-sep" aria-hidden="true" />
              <CompactToggle
                label="Cancel anytime"
                tooltip="Allow the payer to cancel their subscription from their portal."
                on={!!paymentConfig.allowPayerCancel}
                onChange={v => onPaymentConfigChange({ allowPayerCancel: v })}
              />
              <CompactToggle
                label="Pause billing"
                tooltip="Allow the payer to pause billing from their portal."
                on={!!paymentConfig.allowPayerPause}
                onChange={v => onPaymentConfigChange({ allowPayerPause: v })}
              />
              <CompactToggle
                label="Skip payment"
                tooltip="Allow the payer to skip one payment per billing cycle."
                on={!!paymentConfig.allowPayerSkip}
                onChange={v => onPaymentConfigChange({ allowPayerSkip: v })}
              />
            </div>
          )}

          {(isPaymentPlan || isDualOption) && (
            <div className="pm-row pm-toggles">
              <CompactToggle
                label="Pay out early"
                tooltip="Allow the payer to settle the remaining balance in full at any time."
                on={!!paymentConfig.allowPayerPayoutFull}
                onChange={v => onPaymentConfigChange({ allowPayerPayoutFull: v })}
              />
            </div>
          )}

          {isDualOption && (paymentConfig.dualDiscountPct ?? 0) === 0 && (
            <p className="pm-hint">No upfront discount set — without an incentive most payers default to the plan. Consider 5–15%.</p>
          )}

        </div>

      </div>
    </div>
  );
}
