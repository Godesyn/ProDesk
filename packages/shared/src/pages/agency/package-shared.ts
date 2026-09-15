import { isWeekly } from '../marketplace/pricing';
import type { MarketplaceService, SelectedAddon, ServiceVariant } from '../marketplace/types';

/**
 * A configured component line of a package — a trimmed `ProposalItem` (ports
 * `buildPackageProposalItem`). Persisted into `packages.items` (jsonb); the
 * server's `packageItem` schema keeps `serviceId` + `quantity` and passes the
 * rest through, and `marketplace.packageById` resolves the components by
 * `serviceId`.
 */
export interface PackageItem {
  id: string;
  type: 'service';
  serviceId: string;
  serviceName: string;
  description?: string;
  /** Configured unit price (weekly fee for recurring, else the one-off price). */
  amount: number;
  quantity: number;
  isRecurring: boolean;
  billingCycle?: string;
  /** Setup fee for recurring services. */
  upfrontFee?: number;
  selectedVariantId?: string;
  selectedOptions: Record<string, string>;
  selectedAddons: SelectedAddon[];
  sortOrder: number;
}

const rid = () => (crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v) || 0);

/**
 * Resolve a cover aspect ratio from the promo video URL when no image was
 * uploaded — a 1:1 port of `inferAspectRatioFromVideoUrl` (YouTube → 16:9,
 * anything else → 4:3, empty → none).
 */
export function inferAspectRatioFromVideoUrl(videoUrl: string): number | null {
  const t = videoUrl.trim();
  if (!t) return null;
  return t.includes('youtube.com') || t.includes('youtu.be') ? 16 / 9 : 4 / 3;
}

/**
 * Build a `PackageItem` for a service being added to the package (ports
 * `buildPackageProposalItem`). When the user configured the service through the
 * detail dialog, the resolved price/upfront are passed in; otherwise the base
 * service price is used.
 */
export function buildPackageItem(
  service: MarketplaceService,
  opts: {
    sortOrder: number;
    selectedVariantId?: string;
    selectedOptions?: Record<string, string>;
    selectedAddons?: SelectedAddon[];
    configuredPrice?: number;
    configuredUpfrontFee?: number;
  },
): PackageItem {
  const recurring = isWeekly(service);
  const baseAmount = recurring ? num(service.recurringFee) : num(service.price);
  const baseUpfront = recurring ? num(service.upfrontFee) : undefined;
  return {
    id: rid(),
    type: 'service',
    serviceId: service.id,
    serviceName: service.name,
    description: service.description ?? undefined,
    amount: opts.configuredPrice ?? baseAmount,
    quantity: 1,
    isRecurring: recurring,
    billingCycle: recurring ? 'Weekly' : undefined,
    upfrontFee: opts.configuredUpfrontFee ?? baseUpfront,
    selectedVariantId: opts.selectedVariantId,
    selectedOptions: opts.selectedOptions ?? {},
    selectedAddons: opts.selectedAddons ?? [],
    sortOrder: opts.sortOrder,
  };
}

/**
 * Resolve the configured price + upfront for a service configuration — a 1:1
 * port of `ServiceModel.priceWithFeatures` + the package catalog's
 * `onSelectConfiguration` mapping. NB: this deliberately mirrors Flutter and
 * does NOT add delivery fees, and a weekly service's upfront uses the variant /
 * add-on `oneOffUpfrontDifference` (the recurring weekly uses
 * `recurringWeeklyDifference`).
 */
export function configuredPriceFor(
  service: MarketplaceService,
  selectedVariantId: string | undefined,
  selectedAddons: SelectedAddon[],
): { price: number; upfront?: number } {
  const variant = ((service.variants ?? []) as ServiceVariant[]).find((v) => v.id === selectedVariantId);
  if (isWeekly(service)) {
    let upfront = num(service.upfrontFee);
    let recurring = num(service.recurringFee);
    if (variant) {
      upfront += variant.oneOffUpfrontDifference ?? 0;
      recurring += variant.recurringWeeklyDifference ?? 0;
    }
    for (const a of selectedAddons) {
      upfront += a.oneOffUpfrontDifference ?? 0;
      recurring += a.recurringWeeklyDifference ?? 0;
    }
    // Flutter: configuredPrice = price.recurring; configuredUpfrontFee = upfront > 0 ? upfront : null.
    return { price: recurring, upfront: upfront > 0 ? upfront : undefined };
  }
  let base = num(service.price);
  if (variant) base += variant.oneOffUpfrontDifference ?? 0;
  for (const a of selectedAddons) base += a.oneOffUpfrontDifference ?? 0;
  // Flutter: configuredPrice = price.upfront; configuredUpfrontFee = 0 → null.
  return { price: base };
}

/**
 * Hydrate a stored package item into a renderable `PackageItem`. Items written
 * by the new builder already carry every field; legacy `{serviceId, quantity}`
 * rows are back-filled from the resolved service so totals + labels render.
 */
export function hydrateItem(raw: any, byId: Map<string, MarketplaceService>, sortOrder: number): PackageItem | null {
  const serviceId: string | undefined = raw?.serviceId;
  if (!serviceId) return null;
  const svc = byId.get(serviceId);
  const recurring = raw?.isRecurring ?? (svc ? isWeekly(svc) : false);
  const fallbackAmount = svc ? (recurring ? num(svc.recurringFee) : num(svc.price)) : 0;
  return {
    id: raw?.id ?? `${serviceId}:${sortOrder}`,
    type: 'service',
    serviceId,
    serviceName: raw?.serviceName ?? svc?.name ?? 'Unnamed Item',
    description: raw?.description ?? svc?.description ?? undefined,
    amount: raw?.amount != null ? num(raw.amount) : fallbackAmount,
    quantity: raw?.quantity ?? 1,
    isRecurring: recurring,
    billingCycle: raw?.billingCycle ?? (recurring ? 'Weekly' : undefined),
    upfrontFee: raw?.upfrontFee != null ? num(raw.upfrontFee) : recurring && svc ? num(svc.upfrontFee) : undefined,
    selectedVariantId: raw?.selectedVariantId,
    selectedOptions: raw?.selectedOptions ?? {},
    selectedAddons: raw?.selectedAddons ?? [],
    sortOrder,
  };
}
