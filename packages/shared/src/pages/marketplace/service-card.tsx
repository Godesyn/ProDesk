import { Check, Heart } from 'lucide-react';
import { SERVICE_TYPE_DISPLAY_NAME, type ServiceType } from '@server/lib/service-type';
import { AppItemCard } from '../../components/ui/app-item-card';
import { servicePriceSummary } from './pricing';
import type { MarketplaceService } from './types';

/**
 * Marketplace service card — ports `AppServiceCard` (app_service_card.dart) on
 * top of {@link AppItemCard}. Click opens the detail dialog; the artwork fills
 * the tile with the name + price overlaid, and badges layer on top:
 *  • PURCHASED chip (accent) when the brand has bought it before,
 *  • a type chip (top-right),
 *  • a favourite toggle (below the type chip), unless shown from the catalog.
 */
export function ServiceCard({
  service,
  isFavourite,
  hasPurchased,
  isFromCatalog = false,
  onOpen,
  onToggleFavourite,
  trailingActions,
  layout,
}: {
  service: MarketplaceService;
  isFavourite?: boolean;
  hasPurchased?: boolean;
  isFromCatalog?: boolean;
  onOpen: () => void;
  onToggleFavourite?: () => void;
  /** Quick-add is no longer rendered on the card (parity); kept for callers. */
  onQuickAdd?: () => void;
  trailingActions?: React.ReactNode;
  /** `rail` for the fixed-height marketplace rails; `grid` (default) elsewhere; `square` for uniform cover-fit grids. */
  layout?: 'grid' | 'square' | 'rail';
}) {
  const typeLabel = (
    service.type ? SERVICE_TYPE_DISPLAY_NAME[service.type as ServiceType] ?? service.type : ''
  ).toUpperCase();

  return (
    <AppItemCard
      name={service.name}
      priceText={servicePriceSummary(service)}
      imageUrl={service.imageUrl}
      videoUrl={service.videoUrl}
      imageAspectRatio={service.imageAspectRatio}
      onTap={onOpen}
      trailingActions={trailingActions}
      layout={layout}
      badges={() => (
        <>
          {/* Purchased — accent chip on an ink hairline (celebrates the buy). */}
          {hasPurchased && (
            <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-[4px] border border-ink-100 bg-accent px-1.5 py-[3px]">
              <Check className="h-2.5 w-2.5 text-ink-100" strokeWidth={3} />
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.9px] text-ink-100">
                Purchased
              </span>
            </div>
          )}

          {/* Type chip — paper on an ink hairline. */}
          {typeLabel && (
            <div className="absolute right-2 top-2 inline-flex items-center rounded-[4px] border-[0.5px] border-ink-100 bg-[color:rgba(255,255,255,0.95)] px-1.5 py-[3px]">
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.9px] text-ink-100">
                {typeLabel}
              </span>
            </div>
          )}

          {/* Favourite — card-surface square with hairline, below the type chip. */}
          {onToggleFavourite && !isFromCatalog && (
            <button
              type="button"
              aria-label="Toggle favourite"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavourite();
              }}
              className="absolute right-2 top-[30px] grid h-7 w-7 place-items-center rounded-[6px] border-[0.5px] border-ink-100 bg-[color:rgba(255,255,255,0.95)]"
            >
              <Heart
                className={`h-4 w-4 ${isFavourite ? 'fill-danger text-danger' : 'text-ink-60'}`}
              />
            </button>
          )}
        </>
      )}
    />
  );
}
