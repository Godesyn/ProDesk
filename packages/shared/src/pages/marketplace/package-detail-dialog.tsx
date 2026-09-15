import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, ShoppingCart, Zap, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { useCurrentUser } from '../../auth/auth-context';
import { useCartOptional } from './cart-store';
import { packagePriceSummary } from './pricing';
import { getIntegrationPrompt } from './integration-prompt';
import { DetailMedia, useDetailMediaPanel } from './detail-media';
import type { MarketplaceService, SelectedAddon } from './types';

interface PackageLine {
  serviceId: string;
  quantity: number;
  selectedVariantId?: string;
  selectedOptions: Record<string, string>;
  selectedAddons: SelectedAddon[];
}

/** A resolved package component carrying the author-configured variant/options/add-ons. */
type PackageComponent = {
  service: MarketplaceService;
  quantity: number;
  selectedVariantId?: string | null;
  selectedOptions?: Record<string, string>;
  selectedAddons?: SelectedAddon[];
};

/**
 * Package detail modal — ports `lib/src/shared/components/package_detail_dialog/*`.
 * Same shape as the service dialog: media panel on the LEFT; header +
 * description + "BENEFITS & FEATURES" + Total Price + "INCLUDED SERVICES" list
 * stacked on the RIGHT; full-width Purchase Now / Add to cart bar below.
 *
 * Resolves the package's component services via `marketplace.packageById`, so it
 * works from a single `packageId`.
 */
export function PackageDetailDialog({
  packageId,
  agencyName,
  open,
  onOpenChange,
  purchasable = true,
  isFromCatalog = false,
  onBuyNow,
}: {
  packageId: string;
  agencyName?: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  purchasable?: boolean;
  isFromCatalog?: boolean;
  /** Buy every component service immediately (skip the cart). */
  onBuyNow?: (lines: PackageLine[]) => void;
}) {
  const trpc = useTRPC();
  // Optional: the catalog opens this preview with `purchasable={false}`, so no
  // CartProvider wraps the page and the add-to-cart path is unreachable.
  const cart = useCartOptional();
  const { data: currentUser } = useCurrentUser();
  const detail = useQuery(trpc.marketplace.packageById.queryOptions({ id: packageId }));
  const pkg = detail.data;

  const services = (pkg?.services ?? []) as PackageComponent[];

  // Dedup component services by id, summing quantity — for DISPLAY + total only
  // (Flutter right-content). Cart / buy iterate the raw components so each
  // carries its own configured variant/options/add-ons.
  const included = useMemo(() => {
    const map = new Map<string, { service: MarketplaceService; quantity: number }>();
    for (const { service, quantity } of services) {
      const prev = map.get(service.id);
      map.set(service.id, { service, quantity: (prev?.quantity ?? 0) + (quantity > 0 ? quantity : 1) });
    }
    return [...map.values()];
  }, [services]);

  const disciplines = ((pkg?.disciplines ?? []) as string[]).filter(Boolean);
  const priceText = included.length ? packagePriceSummary(included) : '';

  // Size the media panel to the cover's aspect ratio (Flutter parity).
  const { panelStyle, onAspect } = useDetailMediaPanel({
    imageAspectRatio: (pkg as { imageAspectRatio?: number | null } | undefined)?.imageAspectRatio,
    videoUrl: pkg?.videoUrl,
  });

  const lines = (): PackageLine[] =>
    services.map((c) => ({
      serviceId: c.service.id,
      quantity: c.quantity > 0 ? c.quantity : 1,
      selectedVariantId: c.selectedVariantId ?? undefined,
      selectedOptions: c.selectedOptions ?? {},
      selectedAddons: c.selectedAddons ?? [],
    }));

  const addToCart = () => {
    if (!cart || !pkg || !services.length) return;
    for (const c of services) {
      const qty = c.quantity > 0 ? c.quantity : 1;
      cart.add({
        service: c.service,
        quantity: qty,
        minQuantity: qty,
        selectedVariantId: c.selectedVariantId ?? undefined,
        selectedOptions: c.selectedOptions ?? {},
        selectedAddons: c.selectedAddons ?? [],
        packageId: pkg.id,
        packageName: pkg.name,
      });
    }
    onOpenChange(false);
    toast.success('Package added to cart');
  };

  const copyIntegrationPrompt = async () => {
    if (!pkg) return;
    const prompt = getIntegrationPrompt(pkg.id, currentUser?.id ?? '', pkg.agencyId, { isPackage: true });
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success('Integration prompt copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="flex h-[85vh] w-[92vw] max-w-[1600px] flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-full flex-col">
          {/* Mobile: the whole media+content stack scrolls as one; desktop keeps
              the side-by-side with only the content column scrolling. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
            {/* Left: media panel, sized to the cover's aspect ratio; contained. */}
            <div className="relative aspect-video w-full shrink-0 bg-paper md:aspect-auto md:w-[44%]" style={panelStyle}>
              <DetailMedia imageUrl={pkg?.imageUrl} videoUrl={pkg?.videoUrl} onAspect={onAspect} />
            </div>
            <div className="hidden w-px bg-[color:var(--color-border-hairline)] md:block" />

            {/* Right: content (scrolls independently on desktop). */}
            <div className="p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
              {detail.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-7 w-2/3" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : !pkg ? (
                <p className="text-sm text-ink-60">Package not found.</p>
              ) : (
                <>
                  {/* Header. */}
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenChange(false)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-60 hover:bg-inset"
                      aria-label="Back"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                    <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
                      {isFromCatalog && (
                        <button
                          type="button"
                          onClick={copyIntegrationPrompt}
                          title="Copy package integration prompt"
                          className="inline-flex items-center gap-1 rounded-[6px] border border-[color:var(--color-border-default)] bg-inset px-2 py-1 text-[11px] font-medium text-ink-60 hover:text-ink-100"
                        >
                          <Share2 className="h-3 w-3" /> Copy prompt
                        </button>
                      )}
                      {agencyName && (
                        <span className="rounded-[6px] border border-[color:var(--color-border-default)] bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-60">
                          {agencyName}
                        </span>
                      )}
                      <span className="rounded-[6px] border border-[color:var(--color-border-default)] bg-inset px-2.5 py-1 text-[11px] font-medium text-ink-60">
                        Package
                      </span>
                    </div>
                  </div>
                  <h2 className="mt-3 text-2xl font-bold leading-tight text-ink-100">{pkg.name}</h2>

                  {pkg.description && (
                    <p className="mt-5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink-60">{pkg.description}</p>
                  )}

                  {/* BENEFITS & FEATURES — package disciplines. */}
                  {disciplines.length > 0 && (
                    <div className="mt-8">
                      <div className="mb-4 flex items-center gap-2">
                        <span className="h-4 w-[3px] bg-ink-100" />
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[1.2px] text-ink-40">
                          Benefits &amp; Features
                        </span>
                      </div>
                      <ul className="space-y-3">
                        {disciplines.map((d) => (
                          <li key={d} className="flex items-start gap-3">
                            <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success/15">
                              <Check className="h-2.5 w-2.5 text-success" strokeWidth={3} />
                            </span>
                            <span className="text-sm text-ink-80">{d}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-6 border-t border-[color:var(--color-border-hairline)]" />
                    </div>
                  )}

                  {/* Total price. */}
                  <div className={`${disciplines.length ? 'mt-6' : 'mt-8'}`}>
                    <p className="text-xs font-medium text-ink-40">Total Price</p>
                    <p className="mt-1 whitespace-pre-line text-[28px] font-bold leading-tight tabular-nums text-ink-100">{priceText}</p>
                  </div>

                  {/* INCLUDED SERVICES list. */}
                  {included.length > 0 && (
                    <div className="mt-6">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="h-4 w-[3px] bg-ink-100" />
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[1.2px] text-ink-40">
                          Included Services
                        </span>
                      </div>
                      <div className="space-y-2">
                        {included.map(({ service, quantity }) => (
                          <div
                            key={service.id}
                            className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-inset/40 p-3"
                          >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-inset text-ink-60">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                            <span className="flex-1 text-sm text-ink-100">{service.name}</span>
                            <span className="rounded-full bg-inset px-2.5 py-1 text-xs font-bold text-ink-80">x{quantity}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Full-width action bar (Flutter PackageDetailBottomBar). */}
          {purchasable && pkg && included.length > 0 && (
            <div className="shrink-0 border-t border-[color:var(--color-border-hairline)] bg-inset/30 p-4">
              <div className="flex flex-col gap-2 sm:flex-row">
                {onBuyNow && (
                  <Button variant="accent" className="flex-1" onClick={() => onBuyNow(lines())}>
                    <Zap className="mr-1.5 h-4 w-4" /> Purchase Now
                  </Button>
                )}
                <Button variant="outline" className="flex-1" onClick={addToCart}>
                  <ShoppingCart className="mr-1.5 h-4 w-4" /> Add to cart
                </Button>
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="mt-3 w-full text-center text-xs text-ink-40 hover:text-ink-60"
              >
                Maybe Later
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
