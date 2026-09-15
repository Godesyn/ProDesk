import { Fragment } from 'react';
import { Check } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../../ui/dropdown-menu';
import { cn } from '../../../lib/utils';
import { ContextOptionItem } from './context-option-item';
import { sectionLabel, type ContextOption } from './context-option';

/**
 * The grouped option list inside the selector overlay — port of
 * lib/src/shared/components/context_selector/context_dropdown_items.dart.
 * Groups by type (ADMIN / AGENCIES / BRANDS / CONTRACTOR) with a header per
 * group and a divider between groups; disabled (deleted) rows are non-clickable.
 */
export function ContextDropdownItems({
  options,
  onSelect,
  activeId,
}: {
  options: ContextOption[];
  onSelect: (o: ContextOption) => void;
  /** The context currently in effect — takes the accent treatment + a check. */
  activeId?: string | null;
}) {
  let lastType: ContextOption['type'] | null = null;

  return (
    <>
      {options.map((option) => {
        const newGroup = lastType !== option.type;
        const showDivider = newGroup && lastType !== null;
        const header = newGroup ? sectionLabel(option.type) : null;
        lastType = option.type;

        // Subtle status tint (the row's right-aligned Badge carries the label) —
        // a faint fill + matching left rule reads cleaner than a hard full border.
        const statusTint =
          option.status === 'pending'
            ? 'border-l-2 border-l-warn bg-warn/[0.06]'
            : option.status === 'deleted'
              ? 'border-l-2 border-l-danger bg-danger/[0.06]'
              : '';
        const hasStatus = statusTint !== '';

        // The context in effect carries the accent, so it reads as CHOSEN rather
        // than just another row. The 12% tint + accent text is deliberately the
        // SAME pair the side panel uses for its active row (.psp-theme-accent:
        // `color-mix(--color-accent 12%)` + `--color-accent`), so a brand looks
        // identically selected in either switcher.
        //
        // Never a solid `bg-accent`: that is the full-saturation white-label
        // colour and would swallow the label. Both this and `focus:bg-inset`
        // resolve off the runtime --accent-h/s/l channels, so the pair re-themes
        // together for a white-labelled agency.
        //
        // `focus:` still wins while the row is hovered/keyboard-focused — the
        // check and accent text keep it identifiable as current.
        //
        // A context can be BOTH active and pending, and the status tint is also a
        // background utility — two at equal specificity would let stylesheet order
        // decide the winner. The more urgent signal keeps the fill, so the accent
        // background is dropped on a status row; its check, weight and accent text
        // still mark it current.
        const isActive = !!activeId && option.id === activeId;

        return (
          <Fragment key={option.id}>
            {showDivider && <DropdownMenuSeparator />}
            {header && <DropdownMenuLabel className="uppercase tracking-wider">{header}</DropdownMenuLabel>}
            <DropdownMenuItem
              disabled={option.isDisabled}
              onSelect={() => onSelect(option)}
              className={cn(
                statusTint,
                isActive && 'font-semibold text-accent',
                isActive && !hasStatus && 'bg-accent/12',
              )}
            >
              {/* ContextOptionItem's root is w-full, so it needs a min-w-0 flex-1
                  wrapper or it claims the whole row and shoves the check out
                  (same pattern as the trigger in context-selector.tsx). */}
              <span className="min-w-0 flex-1">
                <ContextOptionItem option={option} inOverlay />
              </span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />}
            </DropdownMenuItem>
          </Fragment>
        );
      })}
    </>
  );
}
