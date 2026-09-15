/**
 * ThankYouEditor — Full-width editor + live preview for the post-payment success page.
 *
 * Renders in the "Thank-you pages" tab on the Templates page.
 * Loads saved thankYouConfig from the account, lets the user edit headline / strap / steps,
 * and shows a live preview using ProposalSuccess with the account's brand kit colours.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { toast } from "sonner";
import { ProposalSuccess, DEFAULT_PROPOSAL_DATA } from "@/components/ProposalPreview";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = { stamp: string; title: string; body: string };
type Config = { headline: string; strap: string; steps: Step[] };

const DEFAULT_CONFIG: Config = {
  headline: "You're in. Welcome.",
  strap: "We'll be in touch within 24 hours with onboarding details. In the meantime, here's what to expect.",
  steps: [
    { stamp: "TODAY", title: "Engagement letter", body: "Lands in your inbox in the next hour." },
    { stamp: "DAY 1", title: "Kickoff call booked", body: "We'll reach out to schedule a 30-minute setup call." },
    { stamp: "DAY 1–10", title: "Onboarding begins", body: "We get everything set up. You don't lift a finger." },
  ],
};

// ─── Step row editor ──────────────────────────────────────────────────────────
function StepRow({
  step, index, onChange, onRemove,
}: {
  step: Step; index: number;
  onChange: (i: number, field: keyof Step, val: string) => void;
  onRemove: (i: number) => void;
}) {
  const inp: React.CSSProperties = {
    width: "100%", padding: "7px 10px", fontSize: 13,
    border: "1px solid var(--border-1)", borderRadius: 7,
    background: "var(--bg-card)", color: "var(--ink)",
    fontFamily: "inherit", outline: "none",
    transition: "border-color 150ms",
  };
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "80px 1fr 1fr auto", gap: 8,
      alignItems: "start", padding: "10px 0",
      borderBottom: "1px solid var(--border-1)",
    }}>
      <div>
        <label style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--ink-40)", display: "block", marginBottom: 4 }}>STAMP</label>
        <input style={inp} value={step.stamp} onChange={e => onChange(index, "stamp", e.target.value)} placeholder="TODAY" />
      </div>
      <div>
        <label style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--ink-40)", display: "block", marginBottom: 4 }}>TITLE</label>
        <input style={inp} value={step.title} onChange={e => onChange(index, "title", e.target.value)} placeholder="Step title" />
      </div>
      <div>
        <label style={{ fontSize: 10, fontFamily: "var(--font-mono)", letterSpacing: "0.08em", color: "var(--ink-40)", display: "block", marginBottom: 4 }}>DESCRIPTION</label>
        <input style={inp} value={step.body} onChange={e => onChange(index, "body", e.target.value)} placeholder="What happens in this step" />
      </div>
      <button
        onClick={() => onRemove(index)}
        title="Remove step"
        style={{
          marginTop: 20, width: 28, height: 28, borderRadius: 6,
          border: "1px solid var(--border-1)", background: "transparent",
          color: "var(--ink-40)", cursor: "pointer", fontSize: 16,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "color 150ms, border-color 150ms",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.borderColor = "#ef4444"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "var(--ink-40)"; e.currentTarget.style.borderColor = "var(--border-1)"; }}
      >×</button>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────
export function ThankYouEditor() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: savedConfig, isLoading } = useQuery({
    ...trpc.payments.accounts.getThankYouConfig.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: brandKit } = useQuery({
    ...trpc.payments.accounts.getBrandKit.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const updateMutation = useMutation(trpc.payments.accounts.updateThankYouConfig.mutationOptions());

  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Seed from saved config once loaded
  useEffect(() => {
    if (savedConfig) {
      setConfig({
        headline: savedConfig.headline ?? DEFAULT_CONFIG.headline,
        strap: savedConfig.strap ?? DEFAULT_CONFIG.strap,
        steps: (savedConfig.steps ?? DEFAULT_CONFIG.steps) as Step[],
      });
    }
  }, [savedConfig]);

  const set = <K extends keyof Config>(key: K, val: Config[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  };

  const handleStepChange = (i: number, field: keyof Step, val: string) => {
    const next = config.steps.map((s, idx) => idx === i ? { ...s, [field]: val } : s);
    set("steps", next);
  };

  const handleAddStep = () => {
    if (config.steps.length >= 6) return;
    set("steps", [...config.steps, { stamp: "DAY X", title: "New step", body: "Describe what happens." }]);
  };

  const handleRemoveStep = (i: number) => {
    set("steps", config.steps.filter((_, idx) => idx !== i));
  };

  const handleSave = async () => {
    if (!brandId) return;
    try {
      await updateMutation.mutateAsync({ brandId, ...config });
      setDirty(false);
      toast.success("Thank-you page saved");
    } catch {
      toast.error("Failed to save");
    }
  };

  const inp: React.CSSProperties = {
    width: "100%", padding: "9px 12px", fontSize: 14,
    border: "1px solid var(--border-1)", borderRadius: 8,
    background: "var(--bg-card)", color: "var(--ink)",
    fontFamily: "inherit", outline: "none", boxSizing: "border-box",
    transition: "border-color 150ms",
  };

  // Build a preview ProposalData using brand kit info
  const previewData = {
    ...DEFAULT_PROPOSAL_DATA,
    customer: (brandKit as any)?.businessName ?? "Your Business",
    recipient: "Client Name",
    footer: {
      entity: (brandKit as any)?.businessName ?? "Your Business",
      abn: (brandKit as any)?.abn ?? "",
      loc: "",
    },
  };

  if (isLoading) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "var(--ink-40)" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>LOADING…</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-40)", marginBottom: 4 }}>THANK-YOU PAGE · ALL PROPOSALS</div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em" }}>Post-payment success page</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-60)" }}>
            This page is shown to clients after they pay. It uses your brand colours automatically.
            {" "}<button
              onClick={() => setPreviewOpen(true)}
              style={{ background: "none", border: "none", color: "var(--ink)", textDecoration: "underline", cursor: "pointer", fontSize: 13, padding: 0 }}
            >Preview full page →</button>
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => setPreviewOpen(true)}>Preview</button>
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={!dirty || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>

      {/* Two-column layout: editor left, mini-preview right */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 24, alignItems: "start" }}>
        {/* Editor */}
        <div className="pnl" style={{ padding: 24 }}>
          {/* Headline */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "var(--ink-60)", display: "block", marginBottom: 6 }}>HEADLINE</label>
            <input
              style={{ ...inp, fontSize: 16, fontWeight: 700 }}
              value={config.headline}
              onChange={e => set("headline", e.target.value)}
              placeholder="You're in. Welcome."
              maxLength={200}
            />
            <div style={{ fontSize: 11, color: "var(--ink-40)", marginTop: 4 }}>
              The big text clients see first. Keep it short and celebratory.
            </div>
          </div>

          {/* Strap */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "var(--ink-60)", display: "block", marginBottom: 6 }}>SUBHEADING</label>
            <textarea
              style={{ ...inp, minHeight: 72, resize: "vertical" } as React.CSSProperties}
              value={config.strap}
              onChange={e => set("strap", e.target.value)}
              placeholder="We'll be in touch within 24 hours…"
              maxLength={500}
            />
            <div style={{ fontSize: 11, color: "var(--ink-40)", marginTop: 4 }}>
              A brief sentence about what happens next.
            </div>
          </div>

          {/* Steps */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label style={{ fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: "0.1em", color: "var(--ink-60)" }}>
                NEXT STEPS <span style={{ opacity: 0.5 }}>({config.steps.length}/6)</span>
              </label>
              <button
                className="btn sm ghost"
                onClick={handleAddStep}
                disabled={config.steps.length >= 6}
              >+ Add step</button>
            </div>
            {config.steps.length === 0 && (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--ink-40)", fontSize: 13 }}>
                No steps yet. Add steps to show clients what happens after payment.
              </div>
            )}
            {config.steps.map((step, i) => (
              <StepRow key={i} step={step} index={i} onChange={handleStepChange} onRemove={handleRemoveStep} />
            ))}
          </div>

          {/* Brand colour note */}
          <div style={{ marginTop: 20, padding: "12px 14px", background: "var(--bg-inset)", borderRadius: 8, fontSize: 12, color: "var(--ink-60)", display: "flex", gap: 8, alignItems: "flex-start" }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>🎨</span>
            <span>
              Background, accent, and text colours are pulled from your{" "}
              <a href="/settings?tab=brand" style={{ color: "var(--ink)", fontWeight: 600 }}>Brand Kit</a>.
              {" "}Update your brand colours there to see them reflected here.
            </span>
          </div>
        </div>

        {/* Mini preview */}
        <div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", color: "var(--ink-40)", marginBottom: 8 }}>LIVE PREVIEW</div>
          <div style={{
            borderRadius: 12, overflow: "hidden",
            border: "1px solid var(--border-1)",
            transform: "scale(0.55)", transformOrigin: "top left",
            width: "calc(100% / 0.55)",
            height: 560,
            pointerEvents: "none",
          }}>
            <ProposalSuccess
              theme="digital"
              data={previewData}
              thankYouConfig={config}
              brandKit={brandKit as any}
            />
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-40)", textAlign: "center" }}>
            Scaled preview — <button onClick={() => setPreviewOpen(true)} style={{ background: "none", border: "none", color: "var(--ink)", textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0 }}>open full preview →</button>
          </div>
        </div>
      </div>

      {/* Full-page preview overlay */}
      {previewOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 500,
          background: "var(--bg)",
          overflow: "auto",
        }}>
          <div style={{
            position: "sticky", top: 0, zIndex: 10,
            background: "var(--card)", borderBottom: "1px solid var(--border-1)",
            padding: "10px 20px", display: "flex", alignItems: "center", gap: 12,
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", color: "var(--ink-60)" }}>PREVIEW · THANK-YOU PAGE</span>
            <div style={{ flex: 1 }} />
            <button className="btn sm ghost" onClick={() => setPreviewOpen(false)}>Close preview ×</button>
          </div>
          <ProposalSuccess
            theme="digital"
            data={previewData}
            thankYouConfig={config}
            brandKit={brandKit as any}
          />
        </div>
      )}
    </div>
  );
}
