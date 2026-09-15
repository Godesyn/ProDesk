/**
 * ProposalCanvas — True WYSIWYG modular proposal editor
 *
 * The canvas renders blocks exactly as the client will see them.
 * In edit mode, hovering a block reveals a floating toolbar:
 *   ↑↓ move  |  ⊕ duplicate  |  🎨 style  |  ✕ delete
 * Between blocks, a "+" button opens the block picker.
 * Text is edited directly via contentEditable (Editable component).
 */
import React, { useState, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  type Block, type BlockType, type BlockData, type BlockStyles,
  BLOCK_CATALOG, createBlock,
  type PricingTableData,
} from "@/lib/blocks";

import { BlockRenderer } from "@/components/blocks/BlockRenderers";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";

// Colour presets for the role toggle — mirrors PRODESK_STYLES in blocks.ts
// These are used to instantly apply the correct colours when switching block roles
const ROLE_STYLES: Record<"dark" | "light" | "accent", Partial<BlockStyles>> = {
  dark:   { bg: "#0A0A0A", accent: "#D9F542", text: "#F4F1E8", textMuted: "rgba(244,241,232,0.55)", scheme: "dark",  blockRole: "dark" },
  light:  { bg: "#F4F1E8", accent: "#D9F542", text: "#0A0A0A", textMuted: "rgba(10,10,10,0.55)",   scheme: "light", blockRole: "light" },
  accent: { bg: "#D9F542", accent: "#0A0A0A", text: "#0A0A0A", textMuted: "rgba(10,10,10,0.65)",   scheme: "light", blockRole: "accent" },
};

// ============================================================
// Canvas drop zone (for palette drag-and-drop)
// ============================================================
function CanvasDropZone({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="transition-all"
      style={{
        height: isOver ? 56 : 4,
        background: isOver ? "rgba(101,245,201,0.12)" : "transparent",
        border: isOver ? "2px dashed rgba(101,245,201,0.5)" : "2px dashed transparent",
        borderRadius: 8,
        margin: isOver ? "4px 16px" : "0 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "all 0.15s ease",
      }}
    >
      {isOver && (
        <span style={{ color: "rgba(101,245,201,0.8)", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em" }}>
          DROP HERE
        </span>
      )}
    </div>
  );
}

// ============================================================
// Style picker colours
// ============================================================
const ACCENT_PRESETS = [
  "#65F5C9", "#FFE566", "#FF6B6B", "#7EB8FF", "#C084FC",
  "#FB923C", "#34D399", "#F472B6", "#FFFFFF", "#A3A3A3",
];
const BG_PRESETS = [
  "#000000", "#0A0A0A", "#04100E", "#0D1117", "#0F0F23",
  "#1A0A00", "#0A001A", "#001A0A", "#111111", "#1C1C1E",
];

// ============================================================
// Block picker modal
// ============================================================
interface BlockPickerProps {
  onSelect: (type: BlockType) => void;
  onClose: () => void;
  disabledTypes?: BlockType[];
}
function BlockPicker({ onSelect, onClose, disabledTypes = [] }: BlockPickerProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(BLOCK_CATALOG.map(b => b.category)));
  const filtered = BLOCK_CATALOG.filter(item => {
    const matchesSearch = !search || item.label.toLowerCase().includes(search.toLowerCase()) || item.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !activeCategory || item.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const grouped: Record<string, typeof BLOCK_CATALOG> = {};
  filtered.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
      <div
        className="relative rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col"
        style={{ background: "#111", border: "1px solid rgba(255,255,255,0.1)", maxHeight: "85vh" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
          <h3 className="text-[17px] font-semibold m-0 text-white">Add a block</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors" style={{ color: "rgba(255,255,255,0.6)" }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Search + category filter */}
        <div className="p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search blocks..."
            autoFocus
            className="w-full rounded-xl px-4 py-2.5 text-[14px] outline-none mb-3"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff" }}
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveCategory(null)}
              className="px-3 py-1 rounded-full text-[12px] font-medium transition-colors"
              style={{ background: !activeCategory ? "#65F5C9" : "rgba(255,255,255,0.06)", color: !activeCategory ? "#000" : "rgba(255,255,255,0.6)" }}
            >All</button>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                className="px-3 py-1 rounded-full text-[12px] font-medium transition-colors"
                style={{ background: activeCategory === cat ? "#65F5C9" : "rgba(255,255,255,0.06)", color: activeCategory === cat ? "#000" : "rgba(255,255,255,0.6)" }}
              >{cat}</button>
            ))}
          </div>
        </div>

        {/* Block grid */}
        <div className="overflow-y-auto p-4 space-y-5">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <div className="text-[10.5px] tracking-[0.14em] uppercase font-semibold mb-2" style={{ color: "rgba(255,255,255,0.35)" }}>{category}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {items.map(item => {
                  const disabled = disabledTypes.includes(item.type);
                  return (
                    <button
                      key={item.type}
                      disabled={disabled}
                      onClick={() => { onSelect(item.type); onClose(); }}
                      className="text-left p-4 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    >
                      <div className="text-[13px] font-semibold text-white mb-1">{item.label}</div>
                      <div className="text-[11px] leading-snug" style={{ color: "rgba(255,255,255,0.45)" }}>{item.description}</div>
                      {item.system && <div className="text-[10px] mt-2 tracking-[0.1em] uppercase" style={{ color: "#65F5C9" }}>System</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12" style={{ color: "rgba(255,255,255,0.35)" }}>
              <p className="text-[14px] m-0">No blocks match "{search}"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Style editor popover
// ============================================================
interface StyleEditorProps {
  styles: BlockStyles;
  onChange: (styles: BlockStyles) => void;
  onClose: () => void;
}
const FONT_OPTIONS = [
  { label: "System", value: "" },
  { label: "Inter", value: "'Inter', sans-serif" },
  { label: "Playfair Display", value: "'Playfair Display', serif" },
  { label: "Space Grotesk", value: "'Space Grotesk', sans-serif" },
  { label: "DM Serif Display", value: "'DM Serif Display', serif" },
  { label: "Syne", value: "'Syne', sans-serif" },
  { label: "Bebas Neue", value: "'Bebas Neue', sans-serif" },
  { label: "Cormorant Garamond", value: "'Cormorant Garamond', serif" },
];

function StyleEditor({ styles, onChange, onClose }: StyleEditorProps) {
  const [tab, setTab] = useState<"colors" | "font" | "spacing" | "background" | "animation">("colors");
  const [bgUrlInput, setBgUrlInput] = useState(styles.bgImageUrl ?? "");
  return (
    <div className="absolute right-0 top-10 z-[150] rounded-xl shadow-2xl w-[280px]" style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.12)" }} onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-[12px] font-semibold text-white tracking-[0.06em] uppercase">Block style</span>
        <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
        </button>
      </div>
           {/* Tabs */}
      <div className="flex border-b overflow-x-auto" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        {(["colors", "font", "spacing", "background", "animation"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className="flex-1 py-2 text-[11px] font-medium capitalize transition-colors" style={{ color: tab === t ? "#65F5C9" : "rgba(255,255,255,0.45)", borderBottom: tab === t ? "2px solid #65F5C9" : "2px solid transparent" }}>{t}</button>
        ))}
      </div>

      <div className="p-4">
        {tab === "colors" && (
          <>
            <div className="mb-3">
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Background</div>
              <div className="flex flex-wrap gap-[6px]">
                {BG_PRESETS.map(c => (
                  <button key={c} onClick={() => onChange({ ...styles, bg: c })} className="w-6 h-6 rounded-full transition-transform hover:scale-110 active:scale-95" style={{ background: c, border: styles.bg === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)", boxShadow: styles.bg === c ? "0 0 0 2px rgba(255,255,255,0.4)" : "none" }} />
                ))}
              </div>
              <input type="color" value={styles.bg ?? "#000000"} onChange={e => onChange({ ...styles, bg: e.target.value })} className="mt-2 w-full h-7 rounded cursor-pointer" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)" }} />
            </div>
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Accent colour</div>
              <div className="flex flex-wrap gap-[6px]">
                {ACCENT_PRESETS.map(c => (
                  <button key={c} onClick={() => onChange({ ...styles, accent: c })} className="w-6 h-6 rounded-full transition-transform hover:scale-110 active:scale-95" style={{ background: c, border: styles.accent === c ? "2px solid #fff" : "1px solid rgba(255,255,255,0.2)", boxShadow: styles.accent === c ? `0 0 0 2px ${c}66` : "none" }} />
                ))}
              </div>
              <input type="color" value={styles.accent ?? "#65F5C9"} onChange={e => onChange({ ...styles, accent: e.target.value })} className="mt-2 w-full h-7 rounded cursor-pointer" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)" }} />
            </div>
            <div className="mt-3">
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Text colour</div>
              <div className="flex flex-wrap gap-[6px]">
                {["#ffffff","#f5f3ef","#e8e4dc","#0A0A0A","#1a1a1a","#333333"].map(c => (
                  <button key={c} onClick={() => onChange({ ...styles, text: c })} className="w-6 h-6 rounded-full transition-transform hover:scale-110 active:scale-95" style={{ background: c, border: styles.text === c ? "2px solid #65F5C9" : "1px solid rgba(255,255,255,0.2)", boxShadow: styles.text === c ? "0 0 0 2px rgba(101,245,201,0.4)" : "none" }} />
                ))}
              </div>
              <input type="color" value={styles.text ?? "#ffffff"} onChange={e => onChange({ ...styles, text: e.target.value })} className="mt-2 w-full h-7 rounded cursor-pointer" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)" }} />
              <div className="mt-1.5 text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>Auto-corrects if contrast is too low</div>
            </div>
          </>
        )}

        {tab === "font" && (
          <div className="space-y-3">
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Heading font</div>
              <div className="grid grid-cols-2 gap-1.5">
                {FONT_OPTIONS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => onChange({ ...styles, fontHeading: f.value || undefined })}
                    className="px-2 py-2 rounded-lg text-[12px] text-left transition-colors"
                    style={{ background: styles.fontHeading === (f.value || undefined) ? "rgba(101,245,201,0.15)" : "rgba(255,255,255,0.04)", border: styles.fontHeading === (f.value || undefined) ? "1px solid #65F5C9" : "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)", fontFamily: f.value || undefined }}
                  >{f.label}</button>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "spacing" && (
          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-[10.5px] tracking-[0.12em] uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Padding top</div>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>{styles.paddingTop ?? 80}px</span>
              </div>
              <input type="range" min={0} max={240} step={8} value={styles.paddingTop ?? 80} onChange={e => onChange({ ...styles, paddingTop: Number(e.target.value) })} className="w-full accent-[#65F5C9]" />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-[10.5px] tracking-[0.12em] uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Padding bottom</div>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>{styles.paddingBottom ?? 80}px</span>
              </div>
              <input type="range" min={0} max={240} step={8} value={styles.paddingBottom ?? 80} onChange={e => onChange({ ...styles, paddingBottom: Number(e.target.value) })} className="w-full accent-[#65F5C9]" />
            </div>
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Width</div>
              <div className="flex gap-2">
                {(["full", "contained", "narrow"] as const).map(w => (
                  <button key={w} onClick={() => onChange({ ...styles, width: w })} className="flex-1 py-1.5 rounded-lg text-[11px] capitalize transition-colors" style={{ background: styles.width === w ? "rgba(101,245,201,0.15)" : "rgba(255,255,255,0.04)", border: styles.width === w ? "1px solid #65F5C9" : "1px solid rgba(255,255,255,0.08)", color: styles.width === w ? "#65F5C9" : "rgba(255,255,255,0.6)" }}>{w}</button>
                ))}
              </div>
            </div>
            {/* Columns */}
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Columns</div>
              <div className="flex gap-2">
                {([1, 2, 3] as const).map(n => (
                  <button key={n} onClick={() => onChange({ ...styles, columns: n })} className="flex-1 py-1.5 rounded-lg text-[11px] transition-colors" style={{ background: (styles.columns ?? 1) === n ? "rgba(101,245,201,0.15)" : "rgba(255,255,255,0.04)", border: (styles.columns ?? 1) === n ? "1px solid #65F5C9" : "1px solid rgba(255,255,255,0.08)", color: (styles.columns ?? 1) === n ? "#65F5C9" : "rgba(255,255,255,0.6)" }}>{n}</button>
                ))}
              </div>
            </div>
          </div>
        )}
         {tab === "background" && (
          <div className="space-y-4">
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Image URL</div>
              <input
                type="text"
                value={bgUrlInput}
                onChange={e => setBgUrlInput(e.target.value)}
                onBlur={() => onChange({ ...styles, bgImageUrl: bgUrlInput || undefined })}
                placeholder="https://..."
                className="w-full rounded-lg px-3 py-2 text-[12px] outline-none"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#fff" }}
              />
              {bgUrlInput && (
                <button
                  onClick={() => { setBgUrlInput(""); onChange({ ...styles, bgImageUrl: undefined }); }}
                  className="mt-2 text-[11px] transition-colors"
                  style={{ color: "#ff6b6b" }}
                >Remove image</button>
              )}
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-[10.5px] tracking-[0.12em] uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Overlay opacity</div>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>{Math.round((styles.bgImageOpacity ?? 0.5) * 100)}%</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05}
                value={styles.bgImageOpacity ?? 0.5}
                onChange={e => onChange({ ...styles, bgImageOpacity: Number(e.target.value) })}
                className="w-full accent-[#65F5C9]"
              />
              <div className="flex justify-between text-[10px] mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>
                <span>Transparent</span><span>Opaque</span>
              </div>
            </div>
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Colour scheme</div>
              <div className="flex gap-2">
                {(["dark", "light"] as const).map(s => (
                  <button key={s} onClick={() => onChange({ ...styles, scheme: s })} className="flex-1 py-1.5 rounded-lg text-[11px] capitalize transition-colors" style={{ background: styles.scheme === s ? "rgba(101,245,201,0.15)" : "rgba(255,255,255,0.04)", border: styles.scheme === s ? "1px solid #65F5C9" : "1px solid rgba(255,255,255,0.08)", color: styles.scheme === s ? "#65F5C9" : "rgba(255,255,255,0.6)" }}>{s}</button>
                ))}
              </div>
            </div>
          </div>
        )}
        {tab === "animation" && (
          <div className="space-y-4">
            <div>
              <div className="text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: "rgba(255,255,255,0.45)" }}>Entrance animation</div>
              <div className="grid grid-cols-2 gap-1.5">
                {(["none", "fade", "slide-up", "slide-left", "zoom"] as const).map(a => (
                  <button key={a} onClick={() => onChange({ ...styles, animation: a === "none" ? undefined : a })} className="py-1.5 rounded-lg text-[11px] capitalize transition-colors" style={{ background: (styles.animation ?? "none") === a ? "rgba(101,245,201,0.15)" : "rgba(255,255,255,0.04)", border: (styles.animation ?? "none") === a ? "1px solid #65F5C9" : "1px solid rgba(255,255,255,0.08)", color: (styles.animation ?? "none") === a ? "#65F5C9" : "rgba(255,255,255,0.6)" }}>{a}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-[10.5px] tracking-[0.12em] uppercase" style={{ color: "rgba(255,255,255,0.45)" }}>Animation delay</div>
                <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.6)" }}>{styles.animationDelay ?? 0}ms</span>
              </div>
              <input type="range" min={0} max={800} step={100} value={styles.animationDelay ?? 0} onChange={e => onChange({ ...styles, animationDelay: Number(e.target.value) })} className="w-full accent-[#65F5C9]" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
// ============================================================
// Sortable block wrapper
// ============================================================
interface SortableBlockProps {
  block: Block;
  index: number;
  totalBlocks: number;
  isEditing: boolean;
  onDataChange: (id: string, data: BlockData) => void;
  onStyleChange: (id: string, styles: BlockStyles) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddAfter: (index: number) => void;
  onLock: (id: string, locked: boolean) => void;
  allBlocks: Block[];
  // Pricing/Accept pass-through
  totalCents?: number;
  currency?: string;
  lineItems?: PricingTableData["lineItems"];
  subtotalCents?: number;
  taxCents?: number;
  taxLabel?: string;
  onAccept?: () => void;
  accepted?: boolean;
  onAddLineItem?: () => void;
  brandKit?: { darkColor?: string | null; lightColor?: string | null; accentColor?: string | null } | null;
}

function SortableBlock({
  block, index, totalBlocks, isEditing,
  onDataChange, onStyleChange, onMove, onDuplicate, onDelete, onAddAfter, onLock, allBlocks,
  totalCents, currency, lineItems, subtotalCents, taxCents, taxLabel, onAccept, accepted, onAddLineItem,
}: SortableBlockProps) {
  const [hovered, setHovered] = useState(false);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiTone, setAiTone] = useState<"professional"|"friendly"|"bold"|"luxury">("professional");
  const [aiSuggestions, setAiSuggestions] = useState<Array<{label:string;headline:string;body:string}>>([]);
  const trpc = useTRPC();
  const brandId = useBrandId();
  const suggestCopyMutation = useMutation({
    ...trpc.payments.ai.suggestBlockCopy.mutationOptions(),
    onSuccess: (data: any) => setAiSuggestions(data?.suggestions ?? []),
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: "relative",
  };

  const isSystem = block.type === "accept_pay";

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={() => isEditing && setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowStyleEditor(false); }}
    >
      {/* Floating toolbar — centred at top of section */}
      {isEditing && hovered && (
        <div
          className="absolute top-3 left-1/2 -translate-x-1/2 z-[130] flex items-center gap-1 rounded-xl px-2 py-[6px] shadow-xl"
          style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(12px)" }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); setShowStyleEditor(false); }}
        >
          {/* Drag handle */}
          <button {...attributes} {...listeners} className="w-7 h-7 flex items-center justify-center rounded-lg cursor-grab active:cursor-grabbing hover:bg-white/10 transition-colors" style={{ color: "rgba(255,255,255,0.5)" }} title="Drag to reorder">
            <svg width="12" height="10" viewBox="0 0 12 10" fill="none"><path d="M1 2h10M1 5h10M1 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          {/* Move up */}
          <button disabled={index === 0} onClick={() => onMove(block.id, -1)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors disabled:opacity-30" style={{ color: "rgba(255,255,255,0.7)" }} title="Move up">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 9V1M1 5l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {/* Move down */}
          <button disabled={index >= totalBlocks - 1} onClick={() => onMove(block.id, 1)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors disabled:opacity-30" style={{ color: "rgba(255,255,255,0.7)" }} title="Move down">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5 1v8M1 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          {/* Block role toggle — Dark / Light / Accent */}
          {!isSystem && (() => {
            const role = block.styles?.blockRole ?? (block.styles?.bg ? (block.styles.bg === '#D9F542' || block.styles.bg === '#C6F135' ? 'accent' : (parseInt((block.styles.bg ?? '#000').replace('#','').slice(0,2), 16) < 128 ? 'dark' : 'light')) : 'dark');
            const roleLabels: Record<string, string> = { dark: '◼', light: '◻', accent: '◈' };
            const roleColors: Record<string, string> = { dark: 'rgba(255,255,255,0.5)', light: 'rgba(255,255,255,0.5)', accent: '#D9F542' };
            const nextRole: Record<string, 'dark' | 'light' | 'accent'> = { dark: 'light', light: 'accent', accent: 'dark' };
            const roleTooltips: Record<string, string> = { dark: 'Dark section (click to switch to Light)', light: 'Light section (click to switch to Accent)', accent: 'Accent section (click to switch to Dark)' };
            return (
              <button
                onClick={() => {
                  const nr = nextRole[role];
                  onStyleChange(block.id, { ...block.styles, ...ROLE_STYLES[nr] });
                }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-[13px] font-bold"
                style={{ color: roleColors[role] }}
                title={roleTooltips[role]}
              >{roleLabels[role]}</button>
            );
          })()}
          {/* Style */}
          <div className="relative">
            <button onClick={() => setShowStyleEditor(v => !v)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors" style={{ color: "rgba(255,255,255,0.7)", background: showStyleEditor ? "rgba(255,255,255,0.12)" : undefined }} title="Style">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2"/><circle cx="6" cy="6" r="2" fill="currentColor"/></svg>
            </button>
            {showStyleEditor && (
              <StyleEditor styles={block.styles} onChange={s => onStyleChange(block.id, s)} onClose={() => setShowStyleEditor(false)} />
            )}
          </div>
          {/* Duplicate */}
          {!isSystem && (
            <button onClick={() => onDuplicate(block.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors" style={{ color: "rgba(255,255,255,0.7)" }} title="Duplicate">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 7.5H2A1.5 1.5 0 0 1 .5 6V2A1.5 1.5 0 0 1 2 .5h4A1.5 1.5 0 0 1 7.5 2v1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
            </button>
          )}
          {/* AI Copy */}
          {!isSystem && (
            <div className="relative">
              <button
                onClick={() => { setShowAiPanel(v => !v); setShowStyleEditor(false); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
                style={{ color: showAiPanel ? "#65F5C9" : "rgba(255,255,255,0.7)", background: showAiPanel ? "rgba(101,245,201,0.12)" : undefined }}
                title="AI copy suggestions"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1L7.5 4.5L11 6L7.5 7.5L6 11L4.5 7.5L1 6L4.5 4.5L6 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>
              </button>
              {showAiPanel && (
                <div
                  className="absolute right-0 top-10 z-[200] rounded-2xl shadow-2xl"
                  style={{ width: 300, background: "#111", border: "1px solid rgba(255,255,255,0.12)", padding: 14 }}
                  onClick={e => e.stopPropagation()}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#65F5C9", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>AI Copy Suggestions</div>
                  <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
                    {(["professional","friendly","bold","luxury"] as const).map(t => (
                      <button key={t} onClick={() => setAiTone(t)}
                        style={{ fontSize: 10, padding: "3px 8px", borderRadius: 20, border: "1px solid", borderColor: aiTone === t ? "#65F5C9" : "rgba(255,255,255,0.15)", color: aiTone === t ? "#65F5C9" : "rgba(255,255,255,0.5)", background: "transparent", cursor: "pointer", textTransform: "capitalize" }}
                      >{t}</button>
                    ))}
                  </div>
                  <button
                    onClick={() => suggestCopyMutation.mutate({ brandId: brandId!, blockType: block.type, currentContent: JSON.stringify(block.data).slice(0, 300), tone: aiTone })}
                    disabled={suggestCopyMutation.isPending || !brandId}
                    style={{ width: "100%", padding: "7px 12px", borderRadius: 10, background: "#65F5C9", color: "#000", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", marginBottom: 10 }}
                  >{suggestCopyMutation.isPending ? "Generating…" : "Generate Suggestions"}</button>
                  {aiSuggestions.map((s, i) => (
                    <div key={i} style={{ marginBottom: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#65F5C9", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{s.headline}</div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{s.body}</div>
                      <button
                        onClick={() => { onDataChange(block.id, { ...block.data, headline: s.headline, body: s.body, text: s.headline + "\n" + s.body } as any); setShowAiPanel(false); }}
                        style={{ marginTop: 6, fontSize: 10, padding: "3px 8px", borderRadius: 6, background: "rgba(101,245,201,0.15)", color: "#65F5C9", border: "1px solid rgba(101,245,201,0.3)", cursor: "pointer" }}
                      >Apply</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Lock */}
          {!isSystem && (
            <button
              onClick={() => onLock(block.id, !block.locked)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
              style={{ color: block.locked ? "#65F5C9" : "rgba(255,255,255,0.5)", background: block.locked ? "rgba(101,245,201,0.12)" : undefined }}
              title={block.locked ? "Unlock block" : "Lock block (prevent editing)"}
            >
              {block.locked ? (
                <svg width="11" height="12" viewBox="0 0 11 12" fill="none"><rect x="1" y="5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              ) : (
                <svg width="11" height="12" viewBox="0 0 11 12" fill="none"><rect x="1" y="5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 5V3.5a2 2 0 0 1 4 0V4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="2 1"/></svg>
              )}
            </button>
          )}
          {/* Delete */}
          {!isSystem && (
            <button onClick={() => onDelete(block.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/20 transition-colors" style={{ color: "#ff6b6b" }} title="Delete block">
              <svg width="11" height="12" viewBox="0 0 11 12" fill="none"><path d="M1 3h9M4 3V1.5h3V3M2 3l.5 7.5a1 1 0 0 0 1 .5h4a1 1 0 0 0 1-.5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          )}
        </div>
      )}

      {/* Block content — wrapped in a relative container for bgImage support */}
      <div className="relative overflow-hidden">
        {block.styles.bgImageUrl && (
          <>
            <div
              className="absolute inset-0 z-0"
              style={{
                backgroundImage: `url(${block.styles.bgImageUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            <div
              className="absolute inset-0 z-[1]"
              style={{ background: block.styles.bg ?? "#000", opacity: block.styles.bgImageOpacity ?? 0.5 }}
            />
          </>
        )}
        <div className="relative z-[2]">
          {block.locked && isEditing && (
            <div className="absolute inset-0 z-[50] cursor-not-allowed" style={{ background: "rgba(101,245,201,0.03)", border: "1px solid rgba(101,245,201,0.15)", borderRadius: 4 }}>
              <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-md" style={{ background: "rgba(101,245,201,0.15)", color: "#65F5C9", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em" }}>
                <svg width="9" height="10" viewBox="0 0 11 12" fill="none"><rect x="1" y="5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M3.5 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                LOCKED
              </div>
            </div>
          )}
          <BlockRenderer
            block={block}
            onDataChange={isEditing && !block.locked ? (data) => onDataChange(block.id, data) : undefined}
            onAddLineItem={isEditing && !block.locked ? onAddLineItem : undefined}
            allBlocks={allBlocks}
            totalCents={totalCents}
            currency={currency}
            lineItems={lineItems}
            subtotalCents={subtotalCents}
            taxCents={taxCents}
            taxLabel={taxLabel}
            onAccept={onAccept}
            accepted={accepted}
          />
        </div>
      </div>

      {/* Add block button between sections */}
      {isEditing && !isSystem && (
        <div className="flex items-center justify-center py-2 opacity-0 hover:opacity-100 transition-opacity group" style={{ position: "relative", zIndex: 10 }}>
          <button
            onClick={() => onAddAfter(index)}
            className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium transition-all hover:scale-105 active:scale-95"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)" }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Add block
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Main ProposalCanvas
// ============================================================
export interface ProposalCanvasProps {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  isEditing?: boolean;
  // For accept_pay block — pass live pricing data
  totalCents?: number;
  currency?: string;
  lineItems?: PricingTableData["lineItems"];
  subtotalCents?: number;
  taxCents?: number;
  taxLabel?: string;
  onAccept?: () => void;
  accepted?: boolean;
  onAddLineItem?: () => void;
  /** External drag-end handler (from parent DndContext for palette drops) */
  onExternalDragEnd?: (activeId: string, overId: string | null) => void;
  /** Brand kit — used to make the role toggle apply brand-kit colours instantly */
  brandKit?: { darkColor?: string | null; lightColor?: string | null; accentColor?: string | null } | null;
}

export function ProposalCanvas({
  blocks, onChange, isEditing = true,
  totalCents = 0, currency = "AUD", lineItems = [],
  subtotalCents, taxCents, taxLabel = "GST",
  onAccept, accepted, onAddLineItem,
  brandKit,
}: ProposalCanvasProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertAfterIndex, setInsertAfterIndex] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // handleDragEnd is used by the inner DndContext for block reordering
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex(b => b.id === active.id);
      const newIndex = blocks.findIndex(b => b.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onChange(arrayMove(blocks, oldIndex, newIndex));
      }
    }
  }, [blocks, onChange]);

  const handleDataChange = useCallback((id: string, data: BlockData) => {
    onChange(blocks.map(b => b.id === id ? { ...b, data } : b));
  }, [blocks, onChange]);

  const handleStyleChange = useCallback((id: string, styles: BlockStyles) => {
    onChange(blocks.map(b => b.id === id ? { ...b, styles } : b));
  }, [blocks, onChange]);

  const handleMove = useCallback((id: string, dir: -1 | 1) => {
    const idx = blocks.findIndex(b => b.id === id);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= blocks.length) return;
    onChange(arrayMove(blocks, idx, newIdx));
  }, [blocks, onChange]);

  const handleDuplicate = useCallback((id: string) => {
    const idx = blocks.findIndex(b => b.id === id);
    const block = blocks[idx];
    const clone = { ...block, id: crypto.randomUUID(), data: { ...block.data } };
    const next = [...blocks];
    next.splice(idx + 1, 0, clone);
    onChange(next);
  }, [blocks, onChange]);

  const handleDelete = useCallback((id: string) => {
    onChange(blocks.filter(b => b.id !== id));
  }, [blocks, onChange]);

  const handleLock = useCallback((id: string, locked: boolean) => {
    onChange(blocks.map(b => b.id === id ? { ...b, locked } : b));
  }, [blocks, onChange]);

  const handleAddAfter = useCallback((index: number) => {
    setInsertAfterIndex(index);
    setPickerOpen(true);
  }, []);

  const handlePickerSelect = useCallback((type: BlockType) => {
    const newBlock = createBlock(type);
    const insertAt = insertAfterIndex !== null ? insertAfterIndex + 1 : blocks.length;
    const next = [...blocks];
    next.splice(insertAt, 0, newBlock);
    onChange(next);
    setPickerOpen(false);
    setInsertAfterIndex(null);
  }, [blocks, onChange, insertAfterIndex]);

  // Determine which types to disable in picker (e.g. only one accept_pay)
  const existingTypes = blocks.map(b => b.type);
  const disabledTypes: BlockType[] = existingTypes.includes("accept_pay") ? ["accept_pay"] : [];

  // Expose the reorder handler so parent can call it for palette drops
  // (not needed since we use the inner DndContext for reordering)

  return (
    <div className="relative w-full" style={{ background: "#000", minHeight: "100vh" }}>
      {/* Top add block button */}
      {isEditing && blocks.length === 0 && (
        <div className="flex items-center justify-center min-h-[60vh]">
          <button
            onClick={() => { setInsertAfterIndex(-1); setPickerOpen(true); }}
            className="flex flex-col items-center gap-3 p-8 rounded-2xl transition-all hover:scale-105 active:scale-95"
            style={{ border: "2px dashed rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.5)" }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M16 4v24M4 16h24" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            <span className="text-[14px] font-medium">Add your first block</span>
          </button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          {/* Drop zone before first block */}
          {isEditing && <CanvasDropZone id="drop-zone::-1" />}
          {blocks.map((block, index) => {
            // For accept_pay, pass the live pricing data
            const isPricing = block.type === "pricing_table";
            const pricingData = isPricing ? (block.data as PricingTableData) : undefined;
            return (
              <React.Fragment key={block.id}>
                <SortableBlock
                  block={block}
                  index={index}
                  totalBlocks={blocks.length}
                  isEditing={isEditing}
                  onDataChange={handleDataChange}
                  onStyleChange={handleStyleChange}
                  onMove={handleMove}
                  onDuplicate={handleDuplicate}
                  onDelete={handleDelete}
                  onAddAfter={handleAddAfter}
                  onLock={handleLock}
                  allBlocks={blocks}
                  totalCents={pricingData?.totalCents ?? totalCents}
                  currency={pricingData?.currency ?? currency}
                  lineItems={pricingData?.lineItems ?? lineItems}
                  subtotalCents={pricingData?.subtotalCents ?? subtotalCents}
                  taxCents={pricingData?.taxCents ?? taxCents}
                  taxLabel={pricingData?.taxLabel ?? taxLabel}
                  onAccept={onAccept}
                  accepted={accepted}
                  onAddLineItem={onAddLineItem}
                  brandKit={brandKit}
                />
                {/* Drop zone after each block */}
                {isEditing && <CanvasDropZone id={`drop-zone::${index}`} />}
              </React.Fragment>
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Bottom add block button */}
      {isEditing && blocks.length > 0 && (
        <div className="flex items-center justify-center py-10">
          <button
            onClick={() => { setInsertAfterIndex(blocks.length - 1); setPickerOpen(true); }}
            className="flex items-center gap-2 px-5 py-[10px] rounded-full text-[13px] font-medium transition-all hover:scale-105 active:scale-95"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.6)" }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            Add block
          </button>
        </div>
      )}

      {/* Block picker modal */}
      {pickerOpen && (
        <BlockPicker
          onSelect={handlePickerSelect}
          onClose={() => { setPickerOpen(false); setInsertAfterIndex(null); }}
          disabledTypes={disabledTypes}
        />
      )}
    </div>
  );
}

export default ProposalCanvas;
