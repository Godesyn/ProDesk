/**
 * ProposalRenderer — single source of truth for rendering any proposal.
 *
 * Used in three contexts:
 *   1. TemplateBuilder preview (sample line items, no interactivity)
 *   2. ProposalBuilder PreviewDrawer (actual proposal line items, no interactivity)
 *   3. ProposalPublic payer-facing page (full interactivity, Stripe payment)
 *
 * Inputs:
 *   - blocks      : Block[] from template.structure.blocks (with proposal overrides merged in)
 *   - brandKit    : BrandKit tokens from the template's brandKitId (or account's brand kit)
 *   - mergeCtx    : MergeFieldContext for {{payer_name}}, {{business_name}}, etc.
 *   - interactive : optional handlers for accept, line item toggle, quantity change, etc.
 *
 * The component:
 *   1. Applies brand kit fonts via loadBrandKitFonts
 *   2. Applies brand kit colours to blocks via applyBrandKitToBlocks
 *   3. Resolves merge fields via resolveBlocksMergeFields
 *   4. Ensures canonical blocks are present (fills missing ones with defaults)
 *   5. Renders blocks via BlockRenderer with AnimatedBlock wrappers
 */
import React, { useState, useEffect, useRef, useMemo } from "react";
import { BlockRenderer } from "@/components/blocks/BlockRenderers";
import type { Block, BrandKit } from "@/lib/blocks";
import {
  applyBrandKitToBlocks,
  loadBrandKitFonts,
  createBlock,
} from "@/lib/blocks";
import { resolveBlocksMergeFields, type MergeFieldContext } from "@/lib/mergeFields";

// ─── Canonical block order ────────────────────────────────────────────────────
// Maps the seven canonical sections to their block types.
// hero          → Hero section (brand, payer name, meta strip)
// value_panels  → Why Us (3-panel value proposition)
// team_cards    → People (team bios)
// roadmap       → Timeline (delivery milestones)
// pricing_table → The Offer (line items, totals)
// accept_pay    → Accept and Pay (CTA, payment method)
// The Engagement Summary is derived from the hero meta strip and pricing block,
// not a separate block type in v1.
export const CANONICAL_BLOCK_TYPES = [
  "hero",
  "value_panels",
  "team_cards",
  "roadmap",
  "pricing_table",
  "accept_pay",
] as const;

/**
 * Ensure all canonical blocks are present in the blocks array.
 * Missing blocks are appended at the end in canonical order.
 * Existing blocks are preserved as-is (including their order).
 */
export function ensureCanonicalBlocks(blocks: Block[]): Block[] {
  const existingTypes = new Set(blocks.map(b => b.type));
  const missing = CANONICAL_BLOCK_TYPES.filter(t => !existingTypes.has(t));
  if (missing.length === 0) return blocks;
  const filledBlocks = [...blocks];
  for (const type of missing) {
    filledBlocks.push(createBlock(type));
  }
  return filledBlocks;
}

// ─── Scroll animation wrapper ─────────────────────────────────────────────────
function AnimatedBlock({
  children,
  animation,
  delay,
  id,
}: {
  children: React.ReactNode;
  animation?: string;
  delay?: number;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!animation || animation === "none");
  useEffect(() => {
    if (!animation || animation === "none") {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { threshold: 0.08 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [animation]);
  const animClass =
    animation && animation !== "none" ? `block-anim-${animation}` : "";
  return (
    <div
      ref={ref}
      id={id}
      className={visible && animClass ? animClass : undefined}
      style={
        visible && animClass
          ? { animationDelay: `${delay ?? 0}ms` }
          : {
              opacity:
                animation && animation !== "none" ? 0 : undefined,
            }
      }
    >
      {children}
    </div>
  );
}

// ─── ProposalRenderer props ───────────────────────────────────────────────────
export interface ProposalRendererProps {
  /** Raw blocks from template.structure.blocks (or proposal.structure.blocks for overrides) */
  blocks: Block[];
  /** Brand kit tokens — applied to block colours and fonts */
  brandKit?: BrandKit | null;
  /** Merge field context — resolves {{payer_name}}, {{business_name}}, etc. */
  mergeCtx?: MergeFieldContext;
  /** Whether to enforce canonical block presence (default: true) */
  enforceCanonical?: boolean;
  /** Whether to render in preview mode (no interactivity, no animations) */
  previewMode?: boolean;
  // ── Interactive handlers (payer-facing page only) ──
  onAccept?: () => void;
  accepted?: boolean;
  onLineItemToggle?: (id: string, selected: boolean) => void;
  onQuantityChange?: (id: string, qty: number) => void;
  onTierSelect?: (tierId: string) => void;
  onSign?: (data: {
    signatureData?: string;
    typedName?: string;
    signatureType: "draw" | "type";
  }) => void;
  /** Stripe payment element node injected into accept_pay block */
  payElement?: React.ReactNode;
  /** Proposal expiry ISO string for countdown block */
  proposalExpiresAt?: string;
  /** Called when blocks change due to interactive state (e.g. optional add-ons toggled) */
  onBlocksChange?: (blocks: Block[]) => void;
  /** Payment configuration — wired into AcceptPayRenderer for engagement summary (ITEM-9f) */
  paymentConfig?: Record<string, unknown>;
}

/**
 * ProposalRenderer — renders a proposal from blocks + brand kit.
 *
 * This is the single rendering contract used by:
 *   - TemplateBuilder (preview panel)
 *   - ProposalBuilder (PreviewDrawer)
 *   - ProposalPublic (payer-facing page)
 */
export function ProposalRenderer({
  blocks: inputBlocks,
  brandKit,
  mergeCtx,
  enforceCanonical = true,
  previewMode = false,
  onAccept,
  accepted,
  onLineItemToggle,
  onQuantityChange,
  onTierSelect,
  onSign,
  payElement,
  proposalExpiresAt,
  paymentConfig,
}: ProposalRendererProps) {
  // Load brand kit fonts
  useEffect(() => {
    if (brandKit) loadBrandKitFonts(brandKit);
  }, [brandKit?.headingFont, brandKit?.bodyFont]);

  // Apply brand kit + merge fields + canonical enforcement
  const processedBlocks = useMemo(() => {
    // Guard against null/undefined blocks (e.g. while data is loading)
    let blocks: Block[] = Array.isArray(inputBlocks) ? inputBlocks : [];
    // 1. Ensure canonical blocks are present
    if (enforceCanonical) {
      blocks = ensureCanonicalBlocks(blocks);
    }
    // 2. Apply brand kit colours/fonts to block styles
    if (brandKit) {
      blocks = applyBrandKitToBlocks(blocks, brandKit);
    }
    // 3. Resolve merge fields
    if (mergeCtx) {
      blocks = resolveBlocksMergeFields(blocks as unknown[], mergeCtx) as Block[];
    }
    return blocks;
  }, [
    inputBlocks,
    enforceCanonical,
    brandKit?.primaryColor,
    brandKit?.accentColor,
    brandKit?.darkColor,
    brandKit?.lightColor,
    brandKit?.headingFont,
    brandKit?.bodyFont,
    mergeCtx?.clientName,
    mergeCtx?.businessName,
    mergeCtx?.proposalTitle,
  ]);

  // Compute totals from pricing_table block
  const pricingBlock = processedBlocks.find(b => b.type === "pricing_table");
  const totalCents = pricingBlock ? (pricingBlock.data as any).totalCents ?? 0 : 0;
  const subtotalCents = pricingBlock
    ? (pricingBlock.data as any).subtotalCents ?? totalCents
    : totalCents;
  const taxCents = pricingBlock ? (pricingBlock.data as any).taxCents ?? 0 : 0;
  const taxLabel = pricingBlock ? (pricingBlock.data as any).taxLabel ?? "GST" : "GST";
  const lineItems = pricingBlock ? (pricingBlock.data as any).lineItems ?? [] : [];
  const currency = pricingBlock ? (pricingBlock.data as any).currency ?? "AUD" : "AUD";

  return (
    <div className="proposal-renderer">
      {processedBlocks.map(block => {
        const animation = previewMode ? "none" : block.styles?.animation;
        const delay = previewMode ? 0 : block.styles?.animationDelay;
        return (
          <AnimatedBlock key={block.id} animation={animation} delay={delay} id={block.type === "accept_pay" ? "accept-pay" : undefined}>
            <BlockRenderer
              block={block}
              totalCents={totalCents}
              subtotalCents={subtotalCents}
              taxCents={taxCents}
              taxLabel={taxLabel}
              lineItems={lineItems}
              currency={currency}
              onAccept={onAccept}
              accepted={accepted}
              interactiveMode={!previewMode || !!onLineItemToggle}
              onLineItemToggle={onLineItemToggle}
              onQuantityChange={onQuantityChange}
              onTierSelect={onTierSelect}
              onSign={
                block.type === "signature" ? onSign : undefined
              }
              readOnly={
                block.type === "signature" &&
                !!(block.data as any).isSigned
              }
              allBlocks={processedBlocks}
              proposalExpiresAt={proposalExpiresAt}
              paymentConfig={paymentConfig}
              payElement={block.type === "accept_pay" ? payElement : undefined}
            />
          </AnimatedBlock>
        );
      })}
    </div>
  );
}

export default ProposalRenderer;
