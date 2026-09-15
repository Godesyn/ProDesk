/**
 * PreviewDrawer — slide-in preview panel showing the proposal page.
 *
 * Two rendering modes:
 *   1. Block-based (preferred): when `blocks` prop is provided, renders via
 *      ProposalRenderer with brand kit tokens applied. This is the full fidelity
 *      preview that matches what the payer will see.
 *   2. Legacy fallback: when no blocks are provided, renders the simplified dark
 *      line-item summary (backward compat for proposals without a template).
 *
 * CSS: .drawer-shroud, .drawer-scrim, .drawer, .drawer-head, .drawer-body,
 *      .drawer-foot, .viewport-toggle, .proposal-page, .dp-section, .dp-eyebrow,
 *      .dp-h1, .dp-h2, .dp-eyebrow-tiny
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Icon, fmtCurrency } from "./atoms";
import type { LineItem, PaymentConfig } from "./types";
import type { Block, BrandKit } from "@/lib/blocks";
import { ProposalRenderer } from "@/components/ProposalRenderer";
import type { MergeFieldContext } from "@/lib/mergeFields";

/** Fixed render width for the proposal — matches the desktop design intent */
const PROPOSAL_RENDER_WIDTH = 1100;

interface PreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  proposalTitle: string;
  clientName: string;
  clientBusiness: string;
  lineItems: LineItem[];
  paymentConfig: PaymentConfig;
  proposalSlug?: string;
  /** When provided, renders the full block-based proposal preview */
  blocks?: Block[] | null;
  brandKit?: BrandKit | null;
  /** Business name for merge fields */
  businessName?: string;
}

type Viewport = "desktop" | "mobile";

export function PreviewDrawer({
  open, onClose, proposalTitle, clientName, clientBusiness, lineItems, paymentConfig, proposalSlug,
  blocks, brandKit, businessName,
}: PreviewDrawerProps) {
  const [viewport, setViewport] = useState<Viewport>("desktop");
  // Local block state so optional item toggles work interactively in preview
  // Default to empty array (not null/undefined) to avoid null.find crash in ProposalRenderer
  const [localBlocks, setLocalBlocks] = useState<Block[]>(blocks ?? []);
  // Sync localBlocks when the incoming blocks prop changes (e.g. builder saves)
  useEffect(() => { setLocalBlocks(blocks ?? []); }, [blocks]);
  // Handle optional item toggle in preview — updates local state only, not the DB
  const handleLineItemToggle = useCallback((id: string, selected: boolean) => {
    setLocalBlocks(prev => {
      if (!prev) return prev;
      return prev.map(block => {
        if (block.type !== "pricing_table") return block;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = block.data as any;
        const items: Array<Record<string, unknown>> = data.lineItems ?? [];
        const updated = items.map(item =>
          item.id === id ? { ...item, selected } : item
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { ...block, data: { ...data, lineItems: updated } } as Block;
      });
    });
  }, []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState<number | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!bodyRef.current) return;
      const w = bodyRef.current.clientWidth;
      if (w <= 0) return;
      const s = Math.min(1, w / PROPOSAL_RENDER_WIDTH);
      setScale(s);
      // After scale is applied, measure the inner content height to set the outer container height
      // so the drawer-body can scroll correctly
      requestAnimationFrame(() => {
        if (innerRef.current) {
          setScaledHeight(Math.round(innerRef.current.scrollHeight * s));
        }
      });
    };
    // Measure after drawer transition (300ms) + small buffer
    const t = setTimeout(measure, 350);
    const ro = new ResizeObserver(measure);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [open, viewport]);

  const subtotalCents = lineItems
    .filter(i => i.type !== "break")
    .reduce((sum, i) => sum + i.quantity * i.unitPriceCents, 0);

  const taxRate = paymentConfig.defaultTaxRate / 100;
  const taxCents = Math.round(subtotalCents * taxRate);
  const totalCents = subtotalCents + taxCents;

  // Group line items by section (legacy fallback only)
  const sections: { label: string; items: LineItem[] }[] = [];
  let current: { label: string; items: LineItem[] } = { label: "", items: [] };
  for (const item of lineItems) {
    if (item.type === "break") {
      if (current.items.length > 0) sections.push(current);
      current = { label: item.breakLabel ?? "", items: [] };
    } else {
      current.items.push(item);
    }
  }
  if (current.items.length > 0) sections.push(current);

  // Merge field context for ProposalRenderer
  const mergeCtx: MergeFieldContext = {
    clientName: clientName || null,
    businessName: businessName || null,
    proposalTitle: proposalTitle || null,
    totalCents,
    subtotalCents,
    taxCents,
    currency: paymentConfig.currency || null,
  };

  const hasBlocks = blocks && blocks.length > 0;

  return (
    <div className={`drawer-shroud${open ? " open" : ""}`}>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer">
        {/* Header */}
        <div className="drawer-head">
          <div className="title-block">
            <h2>{proposalTitle || "Untitled proposal"}</h2>
            <span className="sub">Preview · {clientBusiness || clientName || "Client"}</span>
          </div>
          <div className="viewport-toggle">
            <button
              type="button"
              className={viewport === "desktop" ? "on" : ""}
              onClick={() => setViewport("desktop")}
              title="Desktop view"
            >
              <Icon name="desktop" size={12} />
              Desktop
            </button>
            <button
              type="button"
              className={viewport === "mobile" ? "on" : ""}
              onClick={() => setViewport("mobile")}
              title="Mobile view"
            >
              <Icon name="mobile" size={12} />
              Mobile
            </button>
          </div>
          <button type="button" className="btn-icon drawer-close" onClick={onClose} title="Close preview">
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="drawer-body" ref={bodyRef}>
          {hasBlocks ? (
            /* ── Block-based full-fidelity preview ── */
            viewport === "mobile" ? (
              /* Mobile: fixed 390px frame, centred */
              <div style={{ display: "flex", justifyContent: "center", padding: "16px 0", background: "var(--ink)" }}>
                <div style={{ width: 390, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(244,241,232,0.12)" }}>
                  <ProposalRenderer
                    blocks={localBlocks}
                    brandKit={brandKit}
                    mergeCtx={mergeCtx}
                    enforceCanonical={false}
                    previewMode={true}
                    onLineItemToggle={handleLineItemToggle}
                    paymentConfig={{ ...paymentConfig, paymentModel: paymentConfig.paymentModel }}
                  />
                </div>
              </div>
            ) : (
              /* Desktop: render at full width then scale down to fit drawer */
              <div style={{
                background: "var(--ink)",
                /* height must equal scaled content height so drawer-body can scroll */
                height: scaledHeight ? scaledHeight : undefined,
                position: "relative",
              }}>
                <div ref={innerRef} style={{
                  width: PROPOSAL_RENDER_WIDTH,
                  transformOrigin: "top left",
                  transform: scale < 1 ? `scale(${scale})` : undefined,
                  position: scale < 1 ? "absolute" : undefined,
                  top: 0, left: 0,
                }}>
                  <ProposalRenderer
                    blocks={localBlocks}
                    brandKit={brandKit}
                    mergeCtx={mergeCtx}
                    enforceCanonical={false}
                    previewMode={true}
                    onLineItemToggle={handleLineItemToggle}
                    paymentConfig={{ ...paymentConfig, paymentModel: paymentConfig.paymentModel }}
                  />
                </div>
              </div>
            )
          ) : (
            /* ── Legacy line-item summary fallback ── */
            <div className={`proposal-page${viewport === "mobile" ? " mobile" : ""}`}>
              {/* Cover section */}
              <div className="dp-section">
                <div className="dp-eyebrow">
                  <span className="num">01</span>
                  PROPOSAL
                </div>
                <h1 className="dp-h1">
                  {proposalTitle || "Untitled proposal"}
                </h1>
                {clientName && (
                  <p style={{ color: "rgba(244,241,232,0.6)", fontSize: 16, marginTop: 8 }}>
                    Prepared for {clientName}{clientBusiness ? ` · ${clientBusiness}` : ""}
                  </p>
                )}
              </div>

              {/* Line items sections */}
              {sections.map((sec, si) => (
                <div key={si} className="dp-section">
                  {sec.label && (
                    <div className="dp-eyebrow-tiny">{sec.label}</div>
                  )}
                  {sec.items.map((item) => (
                    <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "12px 0", borderBottom: "1px solid rgba(244,241,232,0.08)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, color: "var(--paper)", marginBottom: 2 }}>{item.name}</div>
                        {item.description && (
                          <div style={{ fontSize: 13, color: "rgba(244,241,232,0.55)", lineHeight: 1.5 }}>{item.description}</div>
                        )}
                        {item.optional && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--volt)", marginTop: 4, display: "inline-block" }}>Optional</span>
                        )}
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--paper)" }}>
                          {fmtCurrency(item.quantity * item.unitPriceCents, paymentConfig.currency)}
                        </div>
                        {item.quantity !== 1 && (
                          <div style={{ fontSize: 11, color: "rgba(244,241,232,0.4)" }}>
                            {item.quantity} × {fmtCurrency(item.unitPriceCents, paymentConfig.currency)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {/* Totals section */}
              <div className="dp-section">
                <div className="dp-eyebrow-tiny">Investment summary</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "rgba(244,241,232,0.6)" }}>
                    <span>Subtotal</span>
                    <span style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(subtotalCents, paymentConfig.currency)}</span>
                  </div>
                  {taxRate > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: "rgba(244,241,232,0.6)" }}>
                      <span>GST ({paymentConfig.defaultTaxRate}%)</span>
                      <span style={{ fontFamily: "var(--font-mono)" }}>{fmtCurrency(taxCents, paymentConfig.currency)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid rgba(244,241,232,0.12)" }}>
                    <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--paper)" }}>Total</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 24, fontWeight: 700, color: "var(--volt)" }}>
                      {fmtCurrency(totalCents, paymentConfig.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* CTA section */}
              <div className="dp-section" style={{ textAlign: "center" }}>
                <button
                  type="button"
                  style={{
                    background: "var(--volt)", color: "var(--ink)",
                    border: "none", borderRadius: 8,
                    padding: "14px 32px",
                    fontSize: 15, fontWeight: 700, cursor: "pointer",
                    width: "100%", maxWidth: 320,
                  }}
                >
                  Accept &amp; Pay
                </button>
                <p style={{ fontSize: 12, color: "rgba(244,241,232,0.4)", marginTop: 12 }}>
                  Powered by EziQuotes · Secure checkout
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="drawer-foot">
          {proposalSlug && (
            <a
              href={`/p/${proposalSlug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              <Icon name="link" size={11} />
              Open live link
            </a>
          )}
          <span className="meta">Preview only · Changes save automatically</span>
        </div>
      </div>
    </div>
  );
}
