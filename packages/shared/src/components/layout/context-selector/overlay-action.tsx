import type { LucideIcon } from 'lucide-react';

/**
 * A footer action row in the context-selector overlay (e.g. "Add role") —
 * port of lib/src/shared/components/context_selector/overlay_action.dart.
 */
export function OverlayAction({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-ui-sm text-ink-80 transition-colors hover:bg-inset"
    >
      <Icon className="h-4 w-4 shrink-0 text-ink-40" />
      <span className="truncate">{label}</span>
    </button>
  );
}
