/**
 * ContentCard — PHASE2-31: Expose copy editing in the full Proposals builder.
 *
 * Collapsible card below MetadataCard. Lets the vendor edit the key text fields
 * that appear in the proposal's hero and intro sections without opening the
 * full TemplateBuilder canvas.
 *
 * Fields:
 *   - Hero eyebrow (short label above the headline, e.g. "Proposal for Acme Co")
 *   - Hero headline (large bold heading)
 *   - Hero subheadline (supporting line)
 *   - Intro / overview paragraph
 *   - Next steps copy (what happens after acceptance)
 *
 * These values are stored in canvasBlocks (hero.eyebrow, hero.headline, etc.)
 * and passed back via onBlocksChange so the preview stays in sync.
 */
import { useState, useCallback } from "react";
import { Icon } from "./atoms";
import type { Block } from "@/lib/blocks";

interface ContentCardProps {
  blocks: Block[];
  onBlocksChange: (blocks: Block[]) => void;
}

function patchBlock(blocks: Block[], type: string, patch: Record<string, unknown>): Block[] {
  return blocks.map(b => b.type === type
    ? { ...b, data: { ...(b.data as unknown as Record<string, unknown>), ...patch } as unknown as Block["data"] }
    : b
  );
}

export function ContentCard({ blocks, onBlocksChange }: ContentCardProps) {
  const [open, setOpen] = useState(false);

  const heroBlock = blocks.find(b => b.type === "hero");
  const heroData = (heroBlock?.data ?? {}) as Record<string, string>;

  const handleHero = useCallback((patch: Record<string, string>) => {
    onBlocksChange(patchBlock(blocks, "hero", patch));
  }, [blocks, onBlocksChange]);

  return (
    <div className="card content-card">
      {/* Collapsible header */}
      <button
        type="button"
        className="card-head"
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", cursor: "pointer", background: "none", border: "none", padding: 0, textAlign: "left" }}
      >
        <div>
          <h2>Proposal copy</h2>
          <div className="sub">Hero text, intro, next steps</div>
        </div>
        <div className="actions">
          <Icon name={open ? "chevup" : "chevdown"} size={14} />
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Eyebrow */}
          <div className="field-group">
            <label className="field-label">Eyebrow label</label>
            <input
              className="input"
              value={heroData.eyebrow ?? ""}
              onChange={e => handleHero({ eyebrow: e.target.value })}
              placeholder="e.g. Proposal for Acme Co"
            />
          </div>

          {/* Headline */}
          <div className="field-group">
            <label className="field-label">Headline</label>
            <input
              className="input"
              value={heroData.headline ?? ""}
              onChange={e => handleHero({ headline: e.target.value })}
              placeholder="e.g. Brand Identity & Website"
            />
          </div>

          {/* Subheadline */}
          <div className="field-group">
            <label className="field-label">Subheadline</label>
            <input
              className="input"
              value={heroData.subheadline ?? ""}
              onChange={e => handleHero({ subheadline: e.target.value })}
              placeholder="One-line supporting statement"
            />
          </div>

          {/* Intro paragraph */}
          <div className="field-group">
            <label className="field-label">Intro / overview</label>
            <textarea
              className="input"
              value={heroData.introCopy ?? ""}
              onChange={e => handleHero({ introCopy: e.target.value })}
              placeholder="Brief overview of the engagement…"
              rows={3}
              style={{ resize: "vertical" }}
            />
          </div>

          {/* Next steps copy */}
          <div className="field-group">
            <label className="field-label">Next steps copy</label>
            <textarea
              className="input"
              value={heroData.nextStepsCopy ?? ""}
              onChange={e => handleHero({ nextStepsCopy: e.target.value })}
              placeholder="What happens after the payer accepts…"
              rows={2}
              style={{ resize: "vertical" }}
            />
          </div>

          <p style={{ fontSize: 11, color: "var(--ink-40)", margin: 0, lineHeight: 1.5 }}>
            These fields update the proposal preview. For full block-level editing, open the template in the Template Builder.
          </p>
        </div>
      )}
    </div>
  );
}
