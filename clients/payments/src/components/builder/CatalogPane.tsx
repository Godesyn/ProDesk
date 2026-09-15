/**
 * CatalogPane — right-hand catalog with tabs (Products, Add-ons), search, and cards.
 * Item 6: Accessible category filter (popover), single-column list layout, name-first cards.
 * CSS: .catalog-pane, .cat-head, .cat-tabs, .cat-tab, .cat-search-row, .cat-search,
 *      .cat-filter, .cat-scroll, .cat-group, .cat-group-label, .cat-grid, .cat-card,
 *      .cat-empty
 */
import { useState, useMemo, useRef, useEffect } from "react";
import { Icon, TagPill, fmtCurrency } from "./atoms";
import type { CatalogProduct, LineItem } from "./types";

type CatalogTab = "products" | "addons";

interface CatalogPaneProps {
  products: CatalogProduct[];
  addons: CatalogProduct[];
  onAddItem: (item: Partial<LineItem>) => void;
  onAddSection: () => void;
  onAddCustom: () => void;
  currency: string;
}

const CATEGORY_ORDER = ["BRND", "STR", "DEV", "MRKT", "CONT", "ADV"];
const CATEGORY_NAMES: Record<string, string> = {
  BRND: "Brand", STR: "Strategy", DEV: "Development",
  MRKT: "Marketing", CONT: "Content", ADV: "Advertising",
};

export function CatalogPane({
  products, addons, onAddItem, onAddSection: _onAddSection, onAddCustom, currency,
}: CatalogPaneProps) {
  const [tab, setTab] = useState<CatalogTab>("products");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  const items = tab === "products" ? products : addons;

  // Close filter popover on outside click
  useEffect(() => {
    if (!filterOpen) return;
    function onDown(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  const filtered = useMemo(() => {
    let list = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q));
    }
    if (filterCat !== "all") {
      list = list.filter(p => p.categoryCode === filterCat);
    }
    return list;
  }, [items, search, filterCat]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogProduct[]>();
    for (const p of filtered) {
      const cat = p.categoryCode ?? "OTHER";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [filtered]);

  function handleAdd(p: CatalogProduct) {
    setFlashId(p.id);
    setTimeout(() => setFlashId(null), 500);
    onAddItem({
      id: crypto.randomUUID(),
      type: tab === "addons" ? "addon" : "product",
      name: p.name,
      description: p.description,
      quantity: 1,
      unitPriceCents: p.priceCents ?? p.basePriceCents ?? 0,
      taxBehaviour: "exclusive",
      taxRate: 10,
      category: p.category,
      categoryCode: p.categoryCode,
    });
  }

  const cats = Array.from(new Set(items.map(p => p.categoryCode).filter(Boolean))) as string[];
  const activeCatName = filterCat === "all" ? "All categories" : (CATEGORY_NAMES[filterCat] ?? filterCat);

  return (
    <div className="catalog-pane">
      {/* Header */}
      <div className="cat-head">
        <div className="title-row">
          <h2>Catalog</h2>
          <span className="sub">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="cat-tabs">
          {(["products", "addons"] as CatalogTab[]).map(t => (
            <button
              key={t}
              type="button"
              className={`cat-tab${tab === t ? " on" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "products" ? "Products" : "Add-ons"}
              {t === "products" && <span className="badge">{products.length}</span>}
              {t === "addons" && <span className="badge">{addons.length}</span>}
            </button>
          ))}
        </div>
        <div className="cat-search-row">
          <div className="cat-search">
            <Icon name="search" size={14} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search catalog…"
              aria-label="Search catalog"
            />
          </div>
          {cats.length > 1 && (
            <div className="cat-filter" ref={filterRef} style={{ position: "relative" }}>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen(o => !o)}
                className={filterCat !== "all" ? "active" : ""}
              >
                <Icon name="filter" size={12} />
                <span>{activeCatName}</span>
                <Icon name="chevron-down" size={10} />
              </button>
              {filterOpen && (
                <div
                  role="listbox"
                  aria-label="Filter by category"
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    right: 0,
                        background: "var(--bg-card)",
                        border: "1px solid var(--border-1)",
                    borderRadius: 8,
                    boxShadow: "0 4px 16px rgba(0,0,0,.12)",
                    zIndex: 50,
                    minWidth: 160,
                    overflow: "hidden",
                  }}
                >
                  {["all", ...cats].map(c => (
                    <button
                      key={c}
                      type="button"
                      role="option"
                      aria-selected={filterCat === c}
                      onClick={() => { setFilterCat(c); setFilterOpen(false); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 12px",
                        background: filterCat === c ? "var(--accent-10)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 13,
                        color: "var(--ink)",
                        textAlign: "left",
                      }}
                    >
                      {c !== "all" && <TagPill code={c} name="" />}
                      <span>{c === "all" ? "All categories" : (CATEGORY_NAMES[c] ?? c)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable catalog body */}
      <div className="cat-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
        {filtered.length === 0 ? (
          <div className="cat-empty">
            <div className="glyph"><Icon name="search" size={24} /></div>
            <h3>No results</h3>
            <p>Try a different search or filter, or add a custom item.</p>
            <div className="ctas">
              <button type="button" className="link" onClick={onAddCustom}>Add custom item</button>
            </div>
          </div>
        ) : (
          grouped.map(([cat, catItems]) => (
            <div key={cat} className="cat-group">
              <div className="cat-group-label" style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-60)" }}>{CATEGORY_NAMES[cat] ?? cat}</span>
                <span style={{ fontSize: 11, color: "var(--ink-40)", marginLeft: "auto" }}>{catItems.length}</span>
              </div>
              {/* Single-column list — name first, price right-aligned */}
              <div className="cat-list" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {catItems.map(p => (
                  <div
                    key={p.id}
                    className={`cat-card list${tab === "addons" ? " addon" : ""}${flashId === p.id ? " flash" : ""}`}
                    onClick={() => handleAdd(p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && handleAdd(p)}
                    aria-label={`Add ${p.name} — ${fmtCurrency(p.priceCents ?? p.basePriceCents ?? 0, currency)}`}
                  >
                    <div className="cat-card-body">
                      <div className="cat-card-name">{p.name}</div>
                      {p.description && (
                        <div className="cat-card-desc">{p.description}</div>
                      )}
                    </div>
                    <div className="cat-card-price">
                      {fmtCurrency(p.priceCents ?? p.basePriceCents ?? 0, currency)}
                    </div>
                    <div className="cat-card-add">
                      <Icon name="plus" size={13} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
