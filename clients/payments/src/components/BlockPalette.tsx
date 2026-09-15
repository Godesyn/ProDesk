/**
 * BlockPalette — Right-side drag-and-drop block palette panel
 *
 * Shows all 25 block types in a 2-col grid, organised into 6 categories.
 * Blocks can be dragged from the palette onto the canvas to insert them.
 * Also supports click-to-append (adds to end of canvas).
 *
 * Drag protocol:
 *   - Each palette item uses useDraggable with id = "palette::{type}"
 *   - The parent DndContext (in ProposalBuilder) handles onDragEnd
 *   - Drop zones are rendered between blocks in the canvas
 */
import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { BLOCK_CATALOG } from "@/lib/blocks";
import type { BlockType } from "@/lib/blocks";

// ── Category metadata ──────────────────────────────────────────────────────────
const CATEGORY_ORDER = [
  "Structure",
  "Content",
  "Pricing",
  "Social Proof",
  "Process & Team",
  "Closing",
];

// Re-map catalog categories to our display categories
const CATEGORY_MAP: Record<string, string> = {
  Layout:       "Structure",
  Media:        "Content",
  Pricing:      "Pricing",
  "Social Proof": "Social Proof",
  Team:         "Process & Team",
  Closing:      "Closing",
};

// ── SVG icons per block type ───────────────────────────────────────────────────
function BlockIcon({ type, size = 20 }: { type: BlockType; size?: number }) {
  const icons: Partial<Record<BlockType, React.ReactNode>> = {
    hero: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="3" width="20" height="14" rx="2"/>
        <path d="M6 10h12M6 13h8"/>
        <circle cx="6" cy="7" r="1" fill="currentColor" stroke="none"/>
      </g>
    ),
    text_block: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M4 6h16M4 10h12M4 14h14M4 18h8"/>
      </g>
    ),
    value_panels: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="5" width="6" height="14" rx="1.5"/>
        <rect x="9" y="5" width="6" height="14" rx="1.5"/>
        <rect x="16" y="5" width="6" height="14" rx="1.5"/>
      </g>
    ),
    stat_bar: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M4 18V10M9 18V6M14 18V12M19 18V8"/>
        <path d="M2 18h20"/>
      </g>
    ),
    divider: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M4 12h16"/>
        <path d="M2 8h20M2 16h20" strokeOpacity="0.3"/>
      </g>
    ),
    spacer: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M12 4v16M8 4l4-2 4 2M8 20l4 2 4-2"/>
      </g>
    ),
    video: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="5" width="20" height="14" rx="2"/>
        <path d="M10 9l6 3-6 3V9z" fill="currentColor" stroke="none"/>
      </g>
    ),
    image_banner: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M2 15l5-5 4 4 3-3 8 6"/>
        <circle cx="8" cy="9" r="1.5" fill="currentColor" stroke="none"/>
      </g>
    ),
    gallery: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="4" width="9" height="7" rx="1.5"/>
        <rect x="13" y="4" width="9" height="7" rx="1.5"/>
        <rect x="2" y="13" width="9" height="7" rx="1.5"/>
        <rect x="13" y="13" width="9" height="7" rx="1.5"/>
      </g>
    ),
    embed: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M8 9l-3 3 3 3M16 9l3 3-3 3M13 8l-2 8"/>
      </g>
    ),
    custom_html: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M7 8l-4 4 4 4M17 8l4 4-4 4M14 5l-4 14"/>
      </g>
    ),
    testimonial: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M3 6h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z"/>
        <path d="M3 6l9 7 9-7"/>
        <path d="M8 10v4M12 9v5M16 10v4" strokeOpacity="0.4"/>
      </g>
    ),
    case_study: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M12 3l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z"/>
      </g>
    ),
    logo_strip: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="8" width="5" height="8" rx="1"/>
        <rect x="9.5" y="8" width="5" height="8" rx="1"/>
        <rect x="17" y="8" width="5" height="8" rx="1"/>
        <path d="M2 12h20" strokeOpacity="0.2"/>
      </g>
    ),
    guarantee: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M12 3l8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3z"/>
        <path d="M9 12l2 2 4-4"/>
      </g>
    ),
    pricing_table: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="4" width="20" height="16" rx="2"/>
        <path d="M2 9h20M8 9v11"/>
        <path d="M11 13h7M11 17h5"/>
      </g>
    ),
    package_selector: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="5" width="6" height="14" rx="1.5"/>
        <rect x="9" y="3" width="6" height="18" rx="1.5"/>
        <rect x="16" y="5" width="6" height="14" rx="1.5"/>
        <circle cx="12" cy="8" r="1.5" fill="currentColor" stroke="none"/>
      </g>
    ),
    comparison: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M12 4v16M4 8h7M4 12h7M4 16h7M13 8h7M13 12h7M13 16h7"/>
        <path d="M2 4h20"/>
      </g>
    ),
    countdown: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <circle cx="12" cy="13" r="8"/>
        <path d="M12 9v4l3 2"/>
        <path d="M10 3h4M12 3v2"/>
      </g>
    ),
    team_cards: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <circle cx="8" cy="8" r="3"/>
        <circle cx="16" cy="8" r="3"/>
        <path d="M2 19c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
        <path d="M14 19c0-2 1.3-3.7 3-4.7"/>
      </g>
    ),
    roadmap: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M4 12h16M4 12l4-4M4 12l4 4"/>
        <circle cx="4" cy="12" r="2" fill="currentColor" stroke="none"/>
        <circle cx="10" cy="12" r="2" fill="currentColor" stroke="none"/>
        <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/>
        <circle cx="20" cy="12" r="2" fill="currentColor" stroke="none"/>
      </g>
    ),
    process_steps: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <circle cx="5" cy="7" r="2" fill="currentColor" stroke="none"/>
        <circle cx="5" cy="12" r="2" fill="currentColor" stroke="none"/>
        <circle cx="5" cy="17" r="2" fill="currentColor" stroke="none"/>
        <path d="M9 7h10M9 12h8M9 17h6"/>
      </g>
    ),
    faq: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M12 8a3 3 0 013 3c0 1.5-1.5 2.5-3 3v1"/>
        <circle cx="12" cy="17" r="0.5" fill="currentColor"/>
        <circle cx="12" cy="12" r="9"/>
      </g>
    ),
    signature: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <path d="M4 16c2-6 4-8 6-6s0 6 2 6 4-4 6-4"/>
        <path d="M4 20h16"/>
        <path d="M16 8l2-2 2 2-2 2-2-2z"/>
      </g>
    ),
    accept_pay: (
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M2 10h20"/>
        <path d="M6 14h4M14 14h4"/>
      </g>
    ),

  };

  const fallback = (
    <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </g>
  );

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {icons[type] ?? fallback}
    </svg>
  );
}

// ── Draggable palette item ─────────────────────────────────────────────────────
function PaletteItem({
  type,
  label,
  system,
  disabled,
  onClickAdd,
}: {
  type: BlockType;
  label: string;
  system?: boolean;
  disabled?: boolean;
  onClickAdd: (type: BlockType) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette::${type}`,
    data: { type, source: "palette" },
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => !disabled && onClickAdd(type)}
      className="relative group cursor-grab active:cursor-grabbing select-none"
      style={{
        opacity: isDragging ? 0.4 : disabled ? 0.35 : 1,
        transition: "opacity 0.15s",
      }}
      title={disabled ? "Only one Accept & Pay block allowed" : `Add ${label}`}
    >
      <div
        className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all group-hover:scale-[1.02]"
        style={{
          background: isDragging
            ? "rgba(101,245,201,0.15)"
            : "rgba(255,255,255,0.08)",
          border: isDragging
            ? "1.5px solid rgba(101,245,201,0.5)"
            : "1.5px solid rgba(255,255,255,0.12)",
          transition: "all 0.15s ease",
        }}
      >
        {/* Icon */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
          style={{
            background: system
              ? "rgba(101,245,201,0.18)"
              : "rgba(255,255,255,0.12)",
            color: system ? "#65F5C9" : "#e8e8e8",
          }}
        >
          <BlockIcon type={type} size={18} />
        </div>
        {/* Label */}
        <span
          className="text-[11px] font-semibold text-center leading-tight"
          style={{ color: system ? "#65F5C9" : "#d4d4d4" }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

// ── DragOverlay ghost ──────────────────────────────────────────────────────────
export function PaletteDragOverlay({ type }: { type: BlockType }) {
  const item = BLOCK_CATALOG.find(b => b.type === type);
  if (!item) return null;
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl shadow-2xl"
      style={{
        background: "#1a1a1a",
        border: "1px solid rgba(101,245,201,0.4)",
        color: "rgba(255,255,255,0.9)",
        pointerEvents: "none",
        width: 140,
      }}
    >
      <div
        className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
        style={{ background: "rgba(101,245,201,0.12)", color: "#65F5C9" }}
      >
        <BlockIcon type={type} size={16} />
      </div>
      <span className="text-[12px] font-semibold truncate">{item.label}</span>
    </div>
  );
}

// ── Main BlockPalette panel ────────────────────────────────────────────────────
interface DefaultLineItem {
  id: string;
  name: string;
  description?: string;
  quantity: number;
  unitPriceCents: number;
  optional?: boolean;
}

interface BlockPaletteProps {
  /** Called when user clicks a block (append to end) */
  onAddBlock: (type: BlockType) => void;
  /** Types that are already at max count (e.g. accept_pay) */
  disabledTypes?: BlockType[];
  /** Default line items for this template */
  defaultLineItems?: DefaultLineItem[];
  onDefaultLineItemsChange?: (items: DefaultLineItem[]) => void;
}

export function BlockPalette({
  onAddBlock,
  disabledTypes = [],
  defaultLineItems = [],
  onDefaultLineItemsChange,
}: BlockPaletteProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"blocks" | "products">("blocks");

  // Group catalog items into display categories
  const grouped = CATEGORY_ORDER.reduce<Record<string, typeof BLOCK_CATALOG>>((acc, cat) => {
    acc[cat] = [];
    return acc;
  }, {});

  for (const item of BLOCK_CATALOG) {
    const displayCat = CATEGORY_MAP[item.category] ?? item.category;
    if (!grouped[displayCat]) grouped[displayCat] = [];
    grouped[displayCat].push(item);
  }

  // Filter by search
  const query = search.toLowerCase().trim();
  const filteredGrouped = query
    ? { "Search results": BLOCK_CATALOG.filter(b =>
        b.label.toLowerCase().includes(query) ||
        b.description.toLowerCase().includes(query)
      )}
    : grouped;

  const totalVisible = Object.values(filteredGrouped).flat().length;

  return (
    <div
      className="flex-shrink-0 flex flex-col overflow-hidden"
      style={{
        width: 280,
        background: "#161616",
        borderLeft: "1.5px solid rgba(255,255,255,0.1)",
      }}
    >
      <>
            {/* Header with tab switcher */}
            <div
              className="flex-shrink-0 px-4 pt-3.5 pb-0"
              style={{ borderBottom: "1.5px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-bold" style={{ color: "#f0f0f0" }}>
                  {activeTab === "blocks" ? "Blocks" : "Default Products"}
                </div>
                <div />
              </div>
              {/* Tab switcher */}
              <div className="flex gap-1 mb-0">
                {(["blocks", "products"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className="flex-1 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all"
                    style={{
                      background: activeTab === tab ? "rgba(255,255,255,0.08)" : "transparent",
                      color: activeTab === tab ? "#f0f0f0" : "#666",
                      borderBottom: activeTab === tab ? "2px solid #65F5C9" : "2px solid transparent",
                    }}
                  >
                    {tab === "blocks" ? "Blocks" : "Products"}
                  </button>
                ))}
              </div>
            </div>

            {/* Products tab */}
            {activeTab === "products" && (
              <div className="flex-1 overflow-y-auto px-3 py-3">
                <p className="text-[11px] mb-3" style={{ color: "#888" }}>
                  These items pre-populate when a proposal is created from this template.
                </p>
                <div className="space-y-2">
                  {defaultLineItems.map((item, idx) => (
                    <div key={item.id} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.05)", border: "1.5px solid rgba(255,255,255,0.1)" }}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <input
                            value={item.name}
                            onChange={e => {
                              const next = [...defaultLineItems];
                              next[idx] = { ...item, name: e.target.value };
                              onDefaultLineItemsChange?.(next);
                            }}
                            placeholder="Product / service name"
                            className="w-full text-[12px] font-medium bg-transparent outline-none"
                            style={{ color: "#e0e0e0" }}
                          />
                          <input
                            value={item.description ?? ""}
                            onChange={e => {
                              const next = [...defaultLineItems];
                              next[idx] = { ...item, description: e.target.value };
                              onDefaultLineItemsChange?.(next);
                            }}
                            placeholder="Description (optional)"
                            className="w-full text-[11px] bg-transparent outline-none mt-0.5"
                            style={{ color: "#666" }}
                          />
                        </div>
                        <button
                          title={item.optional ? "Optional" : "Required"}
                          onClick={() => {
                            const next = [...defaultLineItems];
                            next[idx] = { ...item, optional: !item.optional };
                            onDefaultLineItemsChange?.(next);
                          }}
                          className="p-1 rounded transition-all"
                          style={{ color: item.optional ? "#f59e0b" : "#555" }}
                        >
                          <svg width="11" height="11" viewBox="0 0 16 16" fill={item.optional ? "#f59e0b" : "none"} stroke="currentColor" strokeWidth="1.5">
                            <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => onDefaultLineItemsChange?.(defaultLineItems.filter((_, i) => i !== idx))}
                          className="p-1 rounded transition-opacity hover:opacity-60"
                          style={{ color: "#555" }}
                        >
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-[10px]" style={{ color: "#666" }}>Qty</span>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => {
                            const next = [...defaultLineItems];
                            next[idx] = { ...item, quantity: Math.max(0, parseFloat(e.target.value) || 0) };
                            onDefaultLineItemsChange?.(next);
                          }}
                          className="w-12 text-[11px] text-center rounded-lg px-1 py-1"
                          style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", color: "#e0e0e0" }}
                          min={0} step={1}
                        />
                        <span className="text-[10px]" style={{ color: "#666" }}>× $</span>
                        <input
                          type="number"
                          value={item.unitPriceCents / 100}
                          onChange={e => {
                            const next = [...defaultLineItems];
                            next[idx] = { ...item, unitPriceCents: Math.round((parseFloat(e.target.value) || 0) * 100) };
                            onDefaultLineItemsChange?.(next);
                          }}
                          className="flex-1 text-[11px] text-right rounded-lg px-2 py-1"
                          style={{ background: "rgba(255,255,255,0.07)", border: "1.5px solid rgba(255,255,255,0.12)", color: "#e0e0e0" }}
                          min={0} step={0.01}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => onDefaultLineItemsChange?.([...defaultLineItems, {
                    id: Math.random().toString(36).slice(2),
                    name: "",
                    quantity: 1,
                    unitPriceCents: 0,
                    optional: false,
                  }])}
                  className="mt-3 w-full py-2 rounded-xl text-[12px] font-medium transition-all hover:opacity-80"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1.5px dashed rgba(255,255,255,0.15)", color: "#888" }}
                >
                  + Add product
                </button>
              </div>
            )}

            {/* Blocks tab content */}
            {activeTab === "blocks" && <>
            {/* Search */}
            <div className="flex-shrink-0 px-3 py-2.5" style={{ borderBottom: "1.5px solid rgba(255,255,255,0.08)" }}>
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  width="12" height="12" viewBox="0 0 12 12" fill="none"
                  style={{ color: "#666" }}
                >
                  <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <input
                  type="text"
                  placeholder="Search blocks…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-7 pr-3 py-1.5 text-[12px] rounded-lg outline-none"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1.5px solid rgba(255,255,255,0.12)",
                    color: "#e0e0e0",
                  }}
                />
              </div>
            </div>

            {/* Block grid — scrollable */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {totalVisible === 0 && (
                <div className="text-center py-8" style={{ color: "var(--ink-40)" }}>
                  <p className="text-[12px]">No blocks match "{search}"</p>
                </div>
              )}
              {Object.entries(filteredGrouped).map(([category, items]) => {
                if (items.length === 0) return null;
                return (
                  <div key={category}>
                    {/* Category header */}
                    <div
                      className="text-[10px] font-semibold tracking-[0.1em] uppercase mb-2 px-0.5"
                      style={{ color: "#666" }}
                    >
                      {category}
                    </div>
                    {/* 2-col grid */}
                    <div className="grid grid-cols-2 gap-1.5">
                      {items.map(item => (
                        <PaletteItem
                          key={item.type}
                          type={item.type}
                          label={item.label}
                          system={item.system}
                          disabled={disabledTypes.includes(item.type)}
                          onClickAdd={onAddBlock}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Footer hint */}
              <div
                className="text-center py-3 text-[10.5px]"
                style={{ color: "#555", borderTop: "1.5px solid rgba(255,255,255,0.07)" }}
              >
                Drag a block onto the canvas<br/>or click to append
              </div>
            </div>
            </>}
      </>
    </div>
  );
}
