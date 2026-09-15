import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { X, Trash2, ShoppingCart } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/layout/empty-state';
import { useCart } from './cart-store';
import { QuantityStepper } from './quantity-stepper';
import { computeSubtotals, computePayInFull, priceLine, packagePriceSummary } from './pricing';
import type { CartLine } from './types';

/** Slide-out shopping cart panel (ports marketplace_cart_panel / cart_drawer). */
export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cart = useCart();
  const [, navigate] = useLocation();

  const subtotals = useMemo(() => computeSubtotals(cart.lines), [cart.lines]);
  const breakdown = computePayInFull(subtotals);

  // Group lines: package lines grouped under their package, loose lines flat.
  const { packages, loose } = useMemo(() => {
    const pkgMap = new Map<string, { name: string; lines: CartLine[] }>();
    const looseLines: CartLine[] = [];
    for (const l of cart.lines) {
      if (l.packageId) {
        if (!pkgMap.has(l.packageId)) pkgMap.set(l.packageId, { name: l.packageName ?? 'Package', lines: [] });
        pkgMap.get(l.packageId)!.lines.push(l);
      } else looseLines.push(l);
    }
    return { packages: [...pkgMap.entries()], loose: looseLines };
  }, [cart.lines]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm" onClick={onClose} />}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-[color:var(--color-border-hairline)] bg-card shadow-xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center justify-between border-b border-[color:var(--color-border-hairline)] p-4">
          <div className="flex items-center gap-2 font-semibold">
            <ShoppingCart className="h-4 w-4" /> Your cart
            {cart.count > 0 && <span className="text-sm text-ink-60">({cart.count})</span>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close cart" className="text-ink-40 hover:text-ink-80">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {cart.lines.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="Your cart is empty" description="Browse the marketplace to add services." />
          ) : (
            <div className="space-y-4">
              {packages.map(([pkgId, pkg]) => {
                // Use the shared package-total helper so the weekly/recurring
                // component shows too (not just the upfront), matching the card.
                const pkgTotalText = packagePriceSummary(
                  pkg.lines.map((l) => ({ service: l.service, quantity: l.quantity })),
                );
                return (
                  <div key={pkgId} className="rounded-[var(--radius-md)] border border-accent/30 bg-accent/[0.04] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-accent">{pkg.name}</span>
                      <button type="button" onClick={() => cart.removePackage(pkgId)} className="text-xs text-ink-40 hover:text-danger">
                        Remove package
                      </button>
                    </div>
                    <div className="space-y-2">
                      {pkg.lines.map((l) => (
                        <CartLineRow key={l.key} line={l} />
                      ))}
                    </div>
                    <div className="mt-2 flex justify-between border-t border-accent/20 pt-2 text-sm">
                      <span className="text-ink-60">Package total</span>
                      <span className="font-medium tabular-nums">{pkgTotalText}</span>
                    </div>
                  </div>
                );
              })}
              {loose.map((l) => (
                <CartLineRow key={l.key} line={l} />
              ))}
            </div>
          )}
        </div>

        {cart.lines.length > 0 && (
          <footer className="space-y-3 border-t border-[color:var(--color-border-hairline)] p-4">
            <div className="space-y-1 text-sm">
              {subtotals.oneOffSubtotal > 0 && (
                <Row label="One-off" value={formatCurrency(subtotals.oneOffSubtotal)} />
              )}
              {subtotals.recurringUpfrontTotal > 0 && (
                <Row label="Recurring setup" value={formatCurrency(subtotals.recurringUpfrontTotal)} />
              )}
              <Row label="Due today" value={formatCurrency(breakdown.upfront)} bold />
              {breakdown.weeklyAfter > 0 && (
                <Row label="Then weekly" value={`${formatCurrency(breakdown.weeklyAfter)}/wk`} />
              )}
            </div>
            <Button
              variant="accent"
              className="w-full"
              onClick={() => {
                onClose();
                navigate('/marketplace/checkout');
              }}
            >
              Checkout
            </Button>
          </footer>
        )}
      </aside>
    </>
  );
}

function CartLineRow({ line }: { line: CartLine }) {
  const cart = useCart();
  const p = priceLine(line);
  const weekly = p.recurringWeekly > 0;
  return (
    <div className="flex gap-3">
      {line.service.imageUrl ? (
        <img src={line.service.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] object-cover" />
      ) : (
        <div className="h-14 w-14 shrink-0 rounded-[var(--radius-sm)] bg-inset" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-medium text-ink-100">{line.service.name}</span>
          <button type="button" onClick={() => cart.remove(line.key)} className="text-ink-30 hover:text-danger" aria-label="Remove">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {Object.keys(line.selectedOptions).length > 0 && (
          <p className="truncate text-[11px] text-ink-40">
            {Object.entries(line.selectedOptions).map(([k, v]) => `${k}: ${v}`).join(' · ')}
          </p>
        )}
        {line.selectedAddons.length > 0 && (
          <p className="truncate text-[11px] text-ink-40">+ {line.selectedAddons.map((a) => a.name).join(', ')}</p>
        )}
        <div className="mt-1 flex items-center justify-between">
          <QuantityStepper value={line.quantity} min={line.minQuantity} onChange={(q) => cart.setQuantity(line.key, q)} />
          <span className="text-sm tabular-nums text-ink-80">
            {formatCurrency(p.oneOff + p.recurringUpfront)}
            {weekly && <span className="text-xs text-ink-40"> +{formatCurrency(p.recurringWeekly)}/wk</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-ink-100' : 'text-ink-60'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
