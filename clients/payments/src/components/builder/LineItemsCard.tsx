/**
 * LineItemsCard — the hero card containing the line items list.
 * CSS: .card.lineitems-card, .card-head, .li-list, .li-empty, .li-header-row
 */
import { Icon } from "./atoms";
import { LineItemRow } from "./LineItemRow";
import { SectionBreakRow } from "./SectionBreakRow";
import type { LineItem } from "./types";
import type { CategoryOption } from "./LineItemRow";

interface LineItemsCardProps {
  items: LineItem[];
  currency: string;
  onUpdate: (id: string, patch: Partial<LineItem>) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  onDuplicate: (id: string) => void;
  onAddCustom: () => void;
  onAddSection: () => void;
  /** Account-level categories from trpc.categories.list — passed through to each row. */
  categories?: CategoryOption[];
}

export function LineItemsCard({
  items, currency, onUpdate, onRemove, onMoveUp, onMoveDown, onDuplicate, onAddCustom, onAddSection,
  categories,
}: LineItemsCardProps) {
  // Count section breaks to number them
  let sectionCount = 0;

  const nonBreakItems = items.filter(i => i.type !== "break");

  return (
    <div className="card lineitems-card" style={{ marginBottom: "6rem" }}>
      {/* Header row */}
      <div className="card-head">
        <div>
          <h2>Line items</h2>
          <div className="sub">{nonBreakItems.length} item{nonBreakItems.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="actions">
          <button type="button" className="btn-icon" onClick={onAddSection} title="Add section break">
            <Icon name="section" size={14} />
          </button>
          <button type="button" className="btn" onClick={onAddCustom} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="plus" size={12} />
            Add item
          </button>
        </div>
      </div>

      {/* Column header — matches 8-column li-row grid: grip | type | category | item | qty | price | subtotal | menu */}
      {items.length > 0 && (
        <div
          className="li-row"
          style={{
            borderBottom: "1px solid var(--border-1)",
            background: "var(--bg-inset)",
            padding: "6px 20px",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--ink-60)",
            minHeight: "auto",
          }}
          role="row"
          aria-label="Line items column headers"
        >
          <div aria-hidden="true" />  {/* grip */}
          <div>Type</div>             {/* type-tag */}
          <div>Cat.</div>             {/* category */}
          <div>Item</div>             {/* name */}
          <div style={{ textAlign: "center" }}>Qty</div>
          <div style={{ textAlign: "right" }}>Unit price</div>
          <div style={{ textAlign: "right" }}>Subtotal</div>
          <div aria-hidden="true" />  {/* menu */}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && (
        <div className="li-empty">
          <div className="glyph">
            <Icon name="plus" size={24} />
          </div>
          <h3>No items yet</h3>
          <p>Add items from the catalog on the right, or create a custom line item.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="btn primary" onClick={onAddCustom} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="plus" size={12} />
              Add custom item
            </button>
            <button type="button" className="btn" onClick={onAddSection} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Icon name="section" size={12} />
              Add section
            </button>
          </div>
        </div>
      )}

      {/* Line items list */}
      <div className="li-list">
        {items.map((item, idx) => {
          if (item.type === "break") {
            sectionCount++;
            return (
              <SectionBreakRow
                key={item.id}
                item={item}
                sectionNumber={sectionCount}
                onChange={patch => onUpdate(item.id, patch)}
                onRemove={() => onRemove(item.id)}
              />
            );
          }
          return (
            <LineItemRow
              key={item.id}
              item={item}
              currency={currency}
              onChange={patch => onUpdate(item.id, patch)}
              onRemove={() => onRemove(item.id)}
              onMoveUp={() => onMoveUp(item.id)}
              onMoveDown={() => onMoveDown(item.id)}
              onDuplicate={() => onDuplicate(item.id)}
              isFirst={idx === 0}
              isLast={idx === items.length - 1}
              categories={categories}
            />
          );
        })}
      </div>
    </div>
  );
}
