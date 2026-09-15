/**
 * SectionBreakRow — visual section divider within the line items list.
 * CSS: .li-section, .li-section .grip, .li-section .label-wrap, .li-section .num, .li-section .label
 */
import { useRef, useEffect } from "react";
import { Icon } from "./atoms";
import type { LineItem } from "./types";

interface SectionBreakRowProps {
  item: LineItem;
  sectionNumber: number;
  onChange: (patch: Partial<LineItem>) => void;
  onRemove: () => void;
}

export function SectionBreakRow({
  item, sectionNumber, onChange, onRemove,
}: SectionBreakRowProps) {
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (labelRef.current && labelRef.current.textContent !== (item.breakLabel ?? "")) {
      labelRef.current.textContent = item.breakLabel ?? "";
    }
  }, [item.breakLabel]);

  return (
    <div className="li-section">
      <div className="grip">
        <Icon name="grip" size={12} />
      </div>
      <div className="label-wrap">
        <span className="num">§{sectionNumber}</span>
        <span
          ref={labelRef}
          className="label"
          contentEditable
          suppressContentEditableWarning
          onBlur={e => onChange({ breakLabel: e.currentTarget.textContent ?? "" })}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          spellCheck={false}
        />
        <span className="rule" />
      </div>
      <button
        type="button"
        className="btn-icon menu"
        onClick={onRemove}
        title="Remove section"
      >
        <Icon name="x" size={11} />
      </button>
    </div>
  );
}
