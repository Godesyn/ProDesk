import { useState } from 'react';
import { Link } from 'wouter';
import {
  CreditCard,
  Copy,
  FileText,
  KeyRound,
  Link2,
  ListChecks,
  ScrollText,
  Check,
} from 'lucide-react';
import { brandShort, type Item, type ItemType } from '../data/mock';
import { Aperture, Pips } from './primitives';

/**
 * The Vault ledger — shared by /vault and /b/:brandId.
 *
 * Deliberately a table, not cards: this screen is about volume. Rows are 48px,
 * hairline-ruled, and the whole thing is driven from the keyboard.
 *
 * THE CORE INVERSION (DESIGN.md §5.1): Copy is the PRIMARY action — one click,
 * no reveal, the clipboard self-clears in 45s and the act is written to the
 * register. The Aperture (press and hold) is the deliberate, slower path. Every
 * competitor makes reveal primary and copy secondary, which is worse UX *and*
 * worse security: the value ends up on screen when all you wanted was it in a form.
 */

const GLYPH: Record<ItemType, typeof KeyRound> = {
  login: KeyRound,
  card: CreditCard,
  note: FileText,
  key: KeyRound,
  licence: ScrollText,
  recovery: ListChecks,
  delegation: Link2,
};

function Row({
  item,
  selected,
  onToggle,
  showBrand,
}: {
  item: Item;
  selected: boolean;
  onToggle: () => void;
  showBrand: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const Glyph = GLYPH[item.type];

  const copy = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      className="ledger-row flex items-center gap-3 px-3 py-2.5 sm:px-4"
      data-selected={selected}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="h-3.5 w-3.5 flex-none accent-[var(--pigment)]"
        aria-label={`Select ${item.name}`}
      />

      <Glyph
        className="h-4 w-4 flex-none"
        style={{
          color:
            item.type === 'delegation' ? 'var(--pigment)' : 'var(--ink-3)',
        }}
      />

      <Link href={`/item/${item.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.name}</span>
        <span className="block truncate text-xs text-[var(--ink-3)]">
          {item.identity}
        </span>
      </Link>

      {showBrand && (
        <span className="spec hidden w-24 flex-none truncate md:block">
          {brandShort(item.brandId)}
        </span>
      )}

      <span className="hidden flex-none sm:block">
        <Pips health={item.health} />
      </span>

      <span className="spec hidden w-12 flex-none text-right lg:block">
        {item.lastUsed ?? '—'}
      </span>

      {/* Delegated access is NOT a secret — there is nothing to copy or reveal,
          so the row says what it is instead of offering controls that lie. */}
      {item.type === 'delegation' ? (
        <span className="chip flex-none" data-tone="pigment">
          Granted
        </span>
      ) : (
        <span className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={copy}
            className="press grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--ink-3)] transition hover:bg-[var(--stage-2)] hover:text-[var(--ink)]"
            title="Copy password — clears in 45s"
            aria-label="Copy password"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" style={{ color: 'var(--pigment)' }} />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
          <Aperture open={open} onOpenChange={setOpen} />
        </span>
      )}
    </div>
  );
}

export function ItemLedger({
  items,
  showBrand = true,
}: {
  items: Item[];
  showBrand?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <>
      <div
        className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
        style={{ background: 'var(--card)' }}
      >
        {items.length === 0 ? (
          <p className="px-4 py-14 text-center text-sm text-[var(--ink-3)]">
            No keys match those filters.
          </p>
        ) : (
          items.map((it) => (
            <Row
              key={it.id}
              item={it}
              selected={selected.includes(it.id)}
              onToggle={() => toggle(it.id)}
              showBrand={showBrand}
            />
          ))
        )}
      </div>

      {/* Keyboard bindings live on the screen, not behind a help modal. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="spec">J / K MOVE</span>
        <span className="spec">C COPY</span>
        <span className="spec">SPACE HOLD TO REVEAL</span>
        <span className="spec">↵ OPEN</span>
      </div>

      {/* Bulk bar — only present when something is selected. */}
      {selected.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div
            className="pop pointer-events-auto flex flex-wrap items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-4 py-2.5 shadow-[var(--shadow-3)]"
            style={{ background: 'var(--card)' }}
          >
            <span className="num mr-2 text-sm font-semibold">
              {selected.length} selected
            </span>
            {['Move', 'Share', 'Tag', 'Queue rotation'].map((a) => (
              <button
                key={a}
                type="button"
                className="press rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition hover:bg-[var(--stage-2)]"
              >
                {a}
              </button>
            ))}
            <button
              type="button"
              className="press rounded-[var(--radius-pill)] px-3 py-1.5 text-xs font-semibold"
              style={{ color: 'var(--alarm)' }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="press ml-1 rounded-[var(--radius-pill)] px-2 py-1.5 text-xs text-[var(--ink-3)]"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </>
  );
}
