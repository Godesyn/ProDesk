import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CornerDownLeft, Search } from 'lucide-react';
import { ITEMS, brandShort, type Item } from '../data/mock';
import { Pips } from './primitives';

/**
 * ⌘K QUICK FIND — the most-used interaction in any password manager, so it gets
 * the most attention (DESIGN.md §5.1).
 *
 * The whole point is that you can go from keyboard shortcut to pasted password
 * in under a second WITHOUT the value ever being drawn on screen:
 *
 *   Enter    copy the password and dismiss
 *   ⇧Enter   copy the username
 *   ⌘Enter   open the site and copy
 *   →        open the item sheet
 *
 * Searches names, identities, URLs and tags across every brand at once — the
 * cross-brand reach is only possible because KEYMASTR is a user-level app.
 */
export function QuickFind({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = needle
      ? ITEMS.filter((it) =>
          [it.name, it.identity, it.url ?? '', it.tags.join(' ')]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : // No query → the keys you reach for most, not an empty void.
        ITEMS.filter((it) => it.lastUsed).slice(0, 6);
    return pool.slice(0, 8);
  }, [q]);

  useEffect(() => {
    if (open) {
      setQ('');
      setI(0);
      setToast(null);
      // Focus after paint so the overlay animation doesn't eat the caret.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setI(0), [q]);

  if (!open) return null;

  const act = (item: Item, what: string) => {
    setToast(`${what} · ${item.name} — clears in 45s`);
    window.setTimeout(onClose, 700);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setI((n) => Math.min(n + 1, results.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setI((n) => Math.max(n - 1, 0));
    }
    const hit = results[i];
    if (!hit) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onClose();
      navigate(`/item/${hit.id}`);
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) act(hit, 'Opened site · copied password');
      else if (e.shiftKey) act(hit, 'Copied username');
      else act(hit, 'Copied password');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
      style={{ background: 'rgba(14,14,12,0.44)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Find a key"
    >
      <div
        className="pop w-full max-w-xl overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)] shadow-[var(--shadow-3)]"
        style={{ background: 'var(--card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--hair)] px-4">
          <Search className="h-4 w-4 flex-none text-[var(--ink-3)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Find a key across every brand…"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-[var(--ink-3)]"
          />
          <span className="spec flex-none">ESC</span>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1">
          {results.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-[var(--ink-3)]">
              Nothing matches <span className="quill">“{q}”</span>.
            </p>
          )}
          {results.map((it, n) => (
            <button
              key={it.id}
              type="button"
              onMouseEnter={() => setI(n)}
              onClick={() => act(it, 'Copied password')}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
              style={{ background: n === i ? 'var(--stage-2)' : 'transparent' }}
            >
              <Pips health={it.health} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{it.name}</span>
                <span className="block truncate text-xs text-[var(--ink-3)]">
                  {it.identity}
                </span>
              </span>
              <span className="spec flex-none">{brandShort(it.brandId)}</span>
              {n === i && (
                <CornerDownLeft className="h-3.5 w-3.5 flex-none text-[var(--ink-3)]" />
              )}
            </button>
          ))}
        </div>

        {/* The bindings are always on screen — discoverable without a modal. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--hair)] px-4 py-2.5">
          <span className="spec">↵ copy password</span>
          <span className="spec">⇧↵ username</span>
          <span className="spec">⌘↵ open site</span>
          <span className="spec">→ open</span>
        </div>

        {toast && (
          <div
            className="pop border-t px-4 py-2.5 text-xs font-medium"
            style={{
              borderColor: 'var(--pigment)',
              background: 'var(--pigment-soft)',
              color: 'var(--pigment)',
            }}
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
