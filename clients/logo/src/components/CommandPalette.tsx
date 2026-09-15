import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, type LucideIcon } from 'lucide-react';

/**
 * The ⌘K command palette. The topbar has always advertised a ⌘K chip; this makes
 * it real — every pipeline stage, the studio actions, and project switching are
 * reachable without the rail, which matters most on mobile where the rail is
 * behind a drawer.
 */
export interface CommandItem {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  /** Extra words to match on that aren't in the visible label. */
  keywords?: string;
  hint?: string;
  run: () => void | Promise<void>;
}

function score(item: CommandItem, q: string): boolean {
  if (!q) return true;
  const haystack = `${item.label} ${item.group} ${item.keywords ?? ''}`.toLowerCase();
  // Every typed word must appear somewhere — cheap fuzzy that feels predictable.
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: CommandItem[];
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => items.filter((i) => score(i, query)), [items, query]);

  // Reset and focus each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  // Keep the highlighted row in view when navigating by keyboard.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  useEffect(() => {
    if (active >= matches.length) setActive(0);
  }, [matches.length, active]);

  if (!open) return null;

  const runAt = (index: number) => {
    const item = matches[index];
    if (!item) return;
    onClose();
    void item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (matches.length ? (i + 1) % matches.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (matches.length ? (i - 1 + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    }
  };

  // Group headers are emitted inline as the list is walked.
  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] sm:pt-[16vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        className="absolute inset-0 cursor-default bg-[rgba(14,14,12,0.45)]"
        onClick={onClose}
        aria-label="Close command palette"
        tabIndex={-1}
      />
      <div
        className="pop relative w-full max-w-[560px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] shadow-[var(--shadow-3)]"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-[var(--hair)] px-4">
          <Search className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a stage, or run an action…"
            className="h-12 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
            aria-label="Search commands"
          />
          <kbd className="spec hidden shrink-0 rounded border border-[var(--hair-2)] px-1.5 py-0.5 sm:block" style={{ fontSize: 9 }}>
            ESC
          </kbd>
        </div>

        <ul ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {matches.map((item, i) => {
            const Icon = item.icon;
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id}>
                {header && (
                  <p className="spec px-2 pb-1 pt-3 first:pt-1" style={{ fontSize: 9 }}>
                    {header}
                  </p>
                )}
                <button
                  data-index={i}
                  onClick={() => runAt(i)}
                  onMouseMove={() => setActive(i)}
                  data-active={i === active}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2.5 text-left transition data-[active=true]:bg-[var(--stage-2)]"
                >
                  <Icon className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--ink)]">
                    {item.label}
                  </span>
                  {item.hint && (
                    <span className="spec shrink-0" style={{ fontSize: 9 }}>
                      {item.hint}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {!matches.length && (
            <li className="px-3 py-8 text-center text-sm text-[var(--ink-3)]">Nothing matches that.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
