import { LayoutGrid } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AppItemCard } from '../../components/ui/app-item-card';
import { useTRPC } from '../../lib/trpc';
import { packagePriceSummary } from './pricing';
import type { MarketplaceService } from './types';

interface MarketplacePackage {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  videoUrl?: string | null;
  imageAspectRatio?: number | null;
  agencyName?: string | null;
  agencyLogo?: string | null;
}

/**
 * Featured package card — ports `AppPackageCard` (app_package_card.dart) on top
 * of {@link AppItemCard}. The artwork fills the tile with name + total price
 * overlaid and a PACKAGE chip top-right.
 *
 * Like Flutter, tapping ALWAYS opens the package detail dialog (via `onOpen`);
 * it never adds to the cart directly — the add-to-cart action lives inside the
 * detail dialog's bottom bar. In the catalog `trailingActions` (an Edit button)
 * render beneath the media, mirroring `CatalogCard`'s package branch.
 */
export function PackageCard({
  pkg,
  onOpen,
  trailingActions,
  layout,
}: {
  pkg: MarketplacePackage;
  onOpen?: () => void;
  trailingActions?: React.ReactNode;
  /** `rail` for the fixed-height marketplace rails; `grid` (default) elsewhere. */
  layout?: 'grid' | 'rail';
}) {
  const trpc = useTRPC();
  // Eagerly load the breakdown so the price label can render up front (parity
  // with the Flutter card, which computes it synchronously from package items).
  const detail = useQuery(trpc.marketplace.packageById.queryOptions({ id: pkg.id }));
  const services = detail.data?.services as
    | { service: MarketplaceService; quantity: number }[]
    | undefined;

  const priceText = services?.length ? packagePriceSummary(services) : '';

  return (
    <AppItemCard
      name={pkg.name}
      priceText={priceText}
      imageUrl={pkg.imageUrl}
      videoUrl={pkg.videoUrl}
      imageAspectRatio={pkg.imageAspectRatio}
      onTap={onOpen ?? (() => {})}
      trailingActions={trailingActions}
      layout={layout}
      badges={() => (
        // Type chip — flat ink fill (the brand book bans gradients).
        <div className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-[4px] bg-ink-100 px-1.5 py-[3px]">
          <LayoutGrid className="h-2.5 w-2.5 text-paper" />
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.9px] text-paper">
            Package
          </span>
        </div>
      )}
    />
  );
}
