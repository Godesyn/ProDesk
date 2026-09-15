/**
 * LineItemRow — single editable line item row.
 *
 * 8-column CSS Grid (ITEM-5 fix):
 *   grip (16px) | type-tag (44px) | category (72px) | name (1fr) | qty (64px) | price (120px) | subtotal (100px) | menu (28px)
 *
 * PHASE2-24: Type tag pill (PROD/ADDON/CUST) in dedicated column 2 — never overlaps category.
 * PHASE2-25: Category pill in dedicated column 3 — click to open category dropdown.
 * PHASE2-26: Reorder arrows (keyboard-accessible) in action menu.
 * PHASE2-27: Duplicate button in action menu.
 * PHASE2-28: Hover drag handle (opacity 0 → 1 on .li-row:hover).
 * PHASE2-29: Three-dot action menu (Duplicate / Move up / Move down / Optional / Lock qty / Delete).
 * PHASE2-38: Row height 56px min.
 * PHASE2-39: Description field hidden when empty; shown on focus or when populated.
 * PHASE2-40: OPTIONAL/LOCK QTY toggles in hover action menu (not inline).
 * PHASE2-43: "client" vocabulary replaced with "payer".
 * FU-6: Full keyboard accessibility — Escape closes menus, Arrow keys navigate items,
 *        Enter/Space activates, role="menu" + role="menuitem" + aria-expanded + aria-haspopup.
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Icon, fmtCurrency } from "./atoms";
import type { LineItem } from "./types";

// ── Category definitions (fallback if no account categories loaded) ───────────
const DEFAULT_CATEGORIES = [
  { code: "strategy",    name: "Strategy",    colourHex: "#3B82F6" },
  { code: "creative",    name: "Creative",    colourHex: "#EC4899" },
  { code: "development", name: "Development", colourHex: "#8B5CF6" },
  { code: "marketing",   name: "Marketing",   colourHex: "#F59E0B" },
  { code: "content",     name: "Content",     colourHex: "#10B981" },
  { code: "other",       name: "Other",       colourHex: "#6B7280" },
];
export type CategoryOption = { code: string; name: string; colourHex?: string };

// PHASE2-24: Type labels for the type tag pill
const TYPE_LABELS: Record<string, string> = {
  product: "PROD",
  addon:   "ADD-ON",
  custom:  "CUST",
};

interface LineItemRowProps {
  item: LineItem;
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
  currency: string;
  isFirst: boolean;
  isLast: boolean;
  /** Account-level categories from trpc.categories.list. Falls back to DEFAULT_CATEGORIES. */
  categories?: CategoryOption[];
}

/**
 * useMenuKeyboard — handles keyboard navigation for a dropdown menu.
 * Supports: ArrowDown/ArrowUp to move focus, Enter/Space to activate,
 * Escape to close, Tab to close and move focus naturally.
 */
function useMenuKeyboard(
  isOpen: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const items = Array.from(
      container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')
    );
    const focused = document.activeElement as HTMLElement;
    const idx = items.indexOf(focused);

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        break;
      case "ArrowDown":
        e.preventDefault();
        if (items.length === 0) break;
        items[(idx + 1) % items.length]?.focus();
        break;
      case "ArrowUp":
        e.preventDefault();
        if (items.length === 0) break;
        items[(idx - 1 + items.length) % items.length]?.focus();
        break;
      case "Tab":
        onClose();
        break;
      case "Home":
        e.preventDefault();
        items[0]?.focus();
        break;
      case "End":
        e.preventDefault();
        items[items.length - 1]?.focus();
        break;
    }
  }, [isOpen, onClose, containerRef]);

  return handleKeyDown;
}

export function LineItemRow({
  item, onChange, onRemove, onMoveUp, onMoveDown, onDuplicate, currency, isFirst, isLast,
  categories: categoriesProp,
}: LineItemRowProps) {
  const categories = categoriesProp && categoriesProp.length > 0 ? categoriesProp : DEFAULT_CATEGORIES;
  const [editingPrice, setEditingPrice] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const priceRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const catTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (editingPrice) priceRef.current?.focus(); }, [editingPrice]);
  useEffect(() => { if (editingQty) qtyRef.current?.focus(); }, [editingQty]);

  useEffect(() => {
    if (menuOpen) {
      // Calculate position from trigger button
      if (menuTriggerRef.current) {
        const rect = menuTriggerRef.current.getBoundingClientRect();
        setMenuPos({
          top: rect.bottom + 4,
          right: window.innerWidth - rect.right,
        });
      }
      // Focus first menu item after portal renders
      const t = setTimeout(() => {
        menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
      }, 10);
      return () => clearTimeout(t);
    } else {
      setMenuPos(null);
    }
  }, [menuOpen]);

  useEffect(() => {
    if (catOpen && catRef.current) {
      const firstItem = catRef.current.querySelector<HTMLElement>('[role="menuitem"]');
      firstItem?.focus();
    }
  }, [catOpen]);

  useEffect(() => {
    if (!catOpen && !menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (catOpen && catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false);
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [catOpen, menuOpen]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuTriggerRef.current?.focus();
  }, []);

  const closeCat = useCallback(() => {
    setCatOpen(false);
    catTriggerRef.current?.focus();
  }, []);

  const menuKeyDown = useMenuKeyboard(menuOpen, closeMenu, menuRef);
  const catKeyDown = useMenuKeyboard(catOpen, closeCat, catRef);

  const activeCat = categories.find(c => c.code === item.categoryCode);
  const subtotal = item.quantity * item.unitPriceCents;
  const showDesc = descFocused || !!(item.description?.trim());

  return (
    <div className="li-row">

      {/* COL 1: Grip — hover-only via CSS .li-row:hover .li-grip */}
      <div className="li-grip" title="Drag to reorder" aria-hidden="true">
        <Icon name="grip" size={12} />
      </div>

      {/* COL 2: Type tag pill (PROD / ADD-ON / CUST) */}
      <div style={{ display: "flex", alignItems: "center" }}>
        <span
          className="tag-pill"
          aria-label={`Type: ${TYPE_LABELS[item.type] ?? item.type}`}
          title={`Type: ${TYPE_LABELS[item.type] ?? item.type}`}
          style={{ fontSize: 9, letterSpacing: "0.07em" }}
        >
          {TYPE_LABELS[item.type] ?? item.type.toUpperCase()}
        </span>
      </div>

      {/* COL 3: Category pill — click to open category dropdown */}
      <div style={{ position: "relative" }} ref={catRef} onKeyDown={catKeyDown}>
        <button
          ref={catTriggerRef}
          type="button"
          onClick={() => setCatOpen(o => !o)}
          title="Change category"
          aria-haspopup="menu"
          aria-expanded={catOpen}
          aria-label={`Category: ${activeCat?.name ?? "None"}`}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          {item.categoryCode && activeCat ? (
            <span
              className="tag-pill tinted"
              style={{
                background: activeCat.colourHex ? `${activeCat.colourHex}22` : "var(--bg-inset)",
                color: activeCat.colourHex ?? "var(--ink)",
                borderColor: activeCat.colourHex ? `${activeCat.colourHex}55` : "var(--border-1)",
                fontSize: 9,
                letterSpacing: "0.07em",
                maxWidth: 68,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {activeCat.name.toUpperCase()}
            </span>
          ) : (
            <span
              className="tag-pill"
              style={{ color: "var(--ink-30)", borderStyle: "dashed", fontSize: 9 }}
            >
              —
            </span>
          )}
        </button>

        {/* Category dropdown */}
        {catOpen && (
          <div
            role="menu"
            aria-label="Select category"
            style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
              background: "var(--bg-card)", border: "1px solid var(--border-1)",
              borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              minWidth: 150, padding: "4px 0",
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { onChange({ categoryCode: undefined, category: undefined }); closeCat(); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 12px", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--ink-60)" }}
            >
              — No category
            </button>
            {categories.map(cat => (
              <button
                key={cat.code}
                type="button"
                role="menuitem"
                aria-checked={item.categoryCode === cat.code}
                onClick={() => { onChange({ categoryCode: cat.code, category: cat.name }); closeCat(); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                  padding: "6px 12px",
                  background: item.categoryCode === cat.code ? "var(--bg-inset)" : "none",
                  border: "none", cursor: "pointer", fontSize: 12, color: "var(--ink-80)",
                }}
              >
                <span
                  style={{ width: 10, height: 10, borderRadius: 2, background: cat.colourHex ?? "#888", flexShrink: 0 }}
                  aria-hidden="true"
                />
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* COL 4: Name + optional description + status badges */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <input
          className="li-name"
          value={item.name}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Item name"
          onFocus={() => setDescFocused(true)}
          onBlur={() => setDescFocused(false)}
          style={{ minWidth: 0, width: "100%" }}
          aria-label="Item name"
        />
        {showDesc && (
          <input
            className="li-desc"
            value={item.description ?? ""}
            onChange={e => onChange({ description: e.target.value })}
            placeholder="Description (optional)"
            autoFocus={descFocused && !item.description}
            onFocus={() => setDescFocused(true)}
            onBlur={() => setDescFocused(false)}
            aria-label="Item description"
          />
        )}
        {(item.optional || item.isQuantityEditable) && (
          <div style={{ display: "flex", gap: 6, marginTop: 1 }} aria-live="polite">
            {item.optional && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--warn)",
                display: "inline-flex", alignItems: "center", gap: 3,
              }}>
                <svg width={8} height={8} viewBox="0 0 16 16" fill="var(--warn)" stroke="var(--warn)" strokeWidth="1.5" aria-hidden="true">
                  <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" strokeLinejoin="round"/>
                </svg>
                Optional
              </span>
            )}
            {item.isQuantityEditable && (
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--info)",
                display: "inline-flex", alignItems: "center", gap: 3,
              }}>
                <Icon name="lock" size={8} />
                Qty editable
              </span>
            )}
          </div>
        )}
      </div>

      {/* COL 5: Quantity */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {editingQty ? (
          <input
            ref={qtyRef}
            type="number"
            className="li-qty-input input"
            value={item.quantity}
            onChange={e => onChange({ quantity: Math.max(0, parseFloat(e.target.value) || 0) })}
            onBlur={() => setEditingQty(false)}
            onKeyDown={e => { if (e.key === "Escape" || e.key === "Enter") setEditingQty(false); }}
            min={0} step={1}
            style={{ width: 56, textAlign: "center" }}
            aria-label="Quantity"
          />
        ) : (
          <button
            type="button"
            className="li-qty"
            onClick={() => setEditingQty(true)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingQty(true); }}}
            title="Click to edit quantity"
            aria-label={`Quantity: ${item.quantity}. Press Enter to edit.`}
          >
            {item.quantity}
          </button>
        )}
      </div>

      {/* COL 6: Unit price */}
      <div style={{ position: "relative" }}>
        {editingPrice ? (
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 11, color: "var(--ink-60)" }} aria-hidden="true">$</span>
            <input
              ref={priceRef}
              type="number"
              className="li-price-input input"
              value={item.unitPriceCents / 100}
              onChange={e => onChange({ unitPriceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
              onBlur={() => setEditingPrice(false)}
              onKeyDown={e => { if (e.key === "Escape" || e.key === "Enter") setEditingPrice(false); }}
              min={0} step={0.01}
              style={{ width: "100%", paddingLeft: 20, textAlign: "right" }}
              aria-label="Unit price"
            />
          </div>
        ) : (
          <button
            type="button"
            className="li-price"
            onClick={() => setEditingPrice(true)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEditingPrice(true); }}}
            title="Click to edit price"
            aria-label={`Unit price: ${fmtCurrency(item.unitPriceCents, currency)}. Press Enter to edit.`}
          >
            {fmtCurrency(item.unitPriceCents, currency)}
          </button>
        )}
      </div>

      {/* COL 7: Subtotal */}
      <div className="li-subtotal" aria-label={`Subtotal: ${fmtCurrency(subtotal, currency)}`}>
        {fmtCurrency(subtotal, currency)}
      </div>

      {/* COL 8: Three-dot action menu — portal-based so it escapes all overflow contexts */}
      <div className="li-menu" style={{ position: "relative" }}>
        <button
          ref={menuTriggerRef}
          type="button"
          className="btn-icon"
          onClick={() => setMenuOpen(o => !o)}
          title="Row actions"
          aria-label={`Actions for ${item.name || "this item"}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="8" cy="3" r="1.3"/>
            <circle cx="8" cy="8" r="1.3"/>
            <circle cx="8" cy="13" r="1.3"/>
          </svg>
        </button>

        {menuOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${item.name || "this item"}`}
            onKeyDown={menuKeyDown}
            style={{
              position: "fixed",
              top: menuPos.top,
              right: menuPos.right,
              zIndex: 9999,
              background: "var(--bg-card)",
              border: "1px solid var(--border-1)",
              borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
              minWidth: 160,
              padding: "4px 0",
            }}
          >
            <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onDuplicate(); closeMenu(); }}>
              <Icon name="copy" size={12} />
              Duplicate
            </button>
            <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onMoveUp(); closeMenu(); }} disabled={isFirst} aria-disabled={isFirst}>
              <Icon name="up" size={12} />
              Move up
            </button>
            <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onMoveDown(); closeMenu(); }} disabled={isLast} aria-disabled={isLast}>
              <Icon name="down" size={12} />
              Move down
            </button>
            <div style={{ height: 1, background: "var(--border-1)", margin: "4px 0" }} role="separator" />
            <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onChange({ optional: !item.optional }); closeMenu(); }} style={{ color: item.optional ? "var(--warn)" : undefined }} aria-pressed={item.optional}>
              <svg width={12} height={12} viewBox="0 0 16 16" fill={item.optional ? "var(--warn)" : "none"} stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" strokeLinejoin="round"/>
              </svg>
              {item.optional ? "Remove optional" : "Mark optional"}
            </button>
            <button type="button" role="menuitem" className="row-menu-item" onClick={() => { onChange({ isQuantityEditable: !item.isQuantityEditable }); closeMenu(); }} style={{ color: item.isQuantityEditable ? "var(--info)" : undefined }} aria-pressed={item.isQuantityEditable}>
              <Icon name="lock" size={12} />
              {item.isQuantityEditable ? "Lock quantity" : "Allow qty edit"}
            </button>
            <div style={{ height: 1, background: "var(--border-1)", margin: "4px 0" }} role="separator" />
            <button type="button" role="menuitem" className="row-menu-item danger" onClick={() => { onRemove(); closeMenu(); }}>
              <Icon name="x" size={12} />
              Delete
            </button>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
