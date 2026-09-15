import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CartLine, MarketplaceService, SelectedAddon } from './types';

/*
 * NOTE: the Drizzle schema has no cart table, so the cart is persisted
 * CLIENT-SIDE in localStorage, keyed per brand. This mirrors the Flutter
 * `brandCart/{brandId}` document closely enough for parity (add / remove /
 * update-quantity / configurable de-duplication / package grouping / min-qty),
 * but is not shared across devices. If cross-device carts are needed later,
 * add a `brand_carts` table + a marketplace.cart router — listed under deferred.
 */

interface AddArgs {
  service: MarketplaceService;
  quantity?: number;
  selectedVariantId?: string;
  selectedOptions?: Record<string, string>;
  selectedAddons?: SelectedAddon[];
  packageId?: string;
  packageName?: string;
  /** Minimum quantity (package items enforce a floor). */
  minQuantity?: number;
}

interface CartContextValue {
  lines: CartLine[];
  count: number;
  add: (args: AddArgs) => void;
  remove: (key: string) => void;
  setQuantity: (key: string, quantity: number) => void;
  removePackage: (packageId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function lineKey(a: {
  serviceId: string;
  selectedVariantId?: string;
  selectedOptions?: Record<string, string>;
  selectedAddons?: SelectedAddon[];
  packageId?: string;
}) {
  const opts = Object.entries(a.selectedOptions ?? {})
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  const addons = (a.selectedAddons ?? [])
    .map((x) => x.id)
    .sort()
    .join(',');
  return [a.serviceId, a.selectedVariantId ?? '', opts, addons, a.packageId ?? ''].join('|');
}

const storageKey = (brandId: string | null) => `prodesk.cart.${brandId ?? 'anon'}`;

/**
 * Clear a brand's cart directly in localStorage — used by the payment-success
 * page once the Stripe webhook has CONFIRMED the purchase. The cart is never
 * emptied on the "Checkout" click; only a confirmed payment clears it. A live
 * CartProvider in any tab picks this up via the `storage` event below.
 */
export function clearCartStorage(brandId: string | null): void {
  try {
    localStorage.removeItem(storageKey(brandId));
  } catch {
    /* ignore */
  }
}

export function CartProvider({ brandId, children }: { brandId: string | null; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  // Load the cart for the active brand whenever it changes.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(brandId));
      setLines(raw ? (JSON.parse(raw) as CartLine[]) : []);
    } catch {
      setLines([]);
    }
  }, [brandId]);

  // Sync across tabs: when another tab mutates THIS brand's cart in localStorage
  // — notably the payment-success tab clearing it after a confirmed payment —
  // reflect it here so the cart empties without a manual refresh.
  useEffect(() => {
    const key = storageKey(brandId);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      try {
        setLines(e.newValue ? (JSON.parse(e.newValue) as CartLine[]) : []);
      } catch {
        setLines([]);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [brandId]);

  // Write-through persistence: every mutation updates state AND localStorage in
  // the same step. We deliberately do NOT persist via a `useEffect([lines])` —
  // such an effect runs on mount / brand-change BEFORE the load effect's
  // `setLines` has applied and writes a stale empty array over the saved cart
  // (and doubly so under StrictMode, which double-invokes effects). That was the
  // "cart not persisting" bug: the cart was wiped on every refresh.
  const update = useCallback(
    (fn: (prev: CartLine[]) => CartLine[]) =>
      setLines((prev) => {
        const next = fn(prev);
        try {
          localStorage.setItem(storageKey(brandId), JSON.stringify(next));
        } catch {
          /* quota / private mode — ignore */
        }
        return next;
      }),
    [brandId],
  );

  const add = useCallback(
    (args: AddArgs) => {
      const key = lineKey({
        serviceId: args.service.id,
        selectedVariantId: args.selectedVariantId,
        selectedOptions: args.selectedOptions,
        selectedAddons: args.selectedAddons,
        packageId: args.packageId,
      });
      const qty = args.quantity ?? 1;
      update((prev) => {
        const idx = prev.findIndex((l) => l.key === key);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
          return next;
        }
        return [
          ...prev,
          {
            key,
            service: args.service,
            quantity: Math.max(qty, args.minQuantity ?? 1),
            minQuantity: args.minQuantity ?? 1,
            selectedVariantId: args.selectedVariantId,
            selectedOptions: args.selectedOptions ?? {},
            selectedAddons: args.selectedAddons ?? [],
            packageId: args.packageId,
            packageName: args.packageName,
          },
        ];
      });
    },
    [update],
  );

  const remove = useCallback((key: string) => update((prev) => prev.filter((l) => l.key !== key)), [update]);

  const setQuantity = useCallback(
    (key: string, quantity: number) => {
      update((prev) => {
        if (quantity <= 0) return prev.filter((l) => l.key !== key);
        return prev.map((l) => (l.key === key ? { ...l, quantity: Math.max(quantity, l.minQuantity) } : l));
      });
    },
    [update],
  );

  const removePackage = useCallback(
    (packageId: string) => update((prev) => prev.filter((l) => l.packageId !== packageId)),
    [update],
  );

  const clear = useCallback(() => update(() => []), [update]);

  const value = useMemo<CartContextValue>(
    () => ({ lines, count: lines.reduce((n, l) => n + l.quantity, 0), add, remove, setQuantity, removePackage, clear }),
    [lines, add, remove, setQuantity, removePackage, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useCartOptional();
  if (!ctx) throw new Error('useCart must be used within a CartProvider');
  return ctx;
}

/**
 * Non-throwing cart accessor for components that legitimately render both inside
 * and outside a buying context. The marketplace cards (PackageCard,
 * ServiceDetailDialog) are reused by the agency Catalog page — which manages the
 * agency's own offerings and has no CartProvider — where their add-to-cart paths
 * are unreachable (the card's tap is overridden / the dialog is non-purchasable).
 * Returns null when no CartProvider is present; callers must guard the add paths.
 */
export function useCartOptional(): CartContextValue | null {
  return useContext(CartContext);
}
