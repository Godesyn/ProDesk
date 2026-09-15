import { useMemo, useState } from 'react';
import { GripVertical, ListChecks, Trash2 } from 'lucide-react';
import { SortableList } from '../../components/ui/sortable-list';
import { CatalogPanel, type AddServicePayload } from '../proposals/catalog-panel';
import { ServiceDetailDialog } from '../marketplace/service-detail-dialog';
import { asMaybePrice } from '../marketplace/pricing';
import type { MarketplaceService, ServiceAddon, ServiceOption } from '../marketplace/types';
import { buildPackageItem, configuredPriceFor, type PackageItem } from './package-shared';

/**
 * "Services & Line Items" card — a 1:1 port of `PackageCatalogAndItemsSection`:
 * the shared create-proposal catalog (`CatalogPanel`, services-only) on the left
 * and the reorderable included-items list on the right. Services with options /
 * add-ons open the shared detail dialog so the buyer's exact configuration (and
 * price) is captured before adding.
 */
export function PackageServicesSection({
  agencyId,
  services,
  items,
  onAdd,
  onRemove,
  onReorder,
}: {
  agencyId: string;
  services: MarketplaceService[];
  items: PackageItem[];
  onAdd: (item: PackageItem) => void;
  onRemove: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [configService, setConfigService] = useState<MarketplaceService | null>(null);

  const addedServiceIds = useMemo(() => new Set(items.map((i) => i.serviceId)), [items]);
  const byId = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  function handleAdd(payload: AddServicePayload) {
    const service = byId.get(payload.serviceId);
    if (!service) return;
    const hasConfig = ((service.options as ServiceOption[] | null)?.length ?? 0) > 0 || ((service.addons as ServiceAddon[] | null)?.length ?? 0) > 0;
    if (hasConfig) {
      setConfigService(service);
    } else {
      onAdd(buildPackageItem(service, { sortOrder: items.length }));
    }
  }

  return (
    <div className="rounded-[14px] border border-[color:var(--color-border-hairline)] bg-card p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <ListChecks className="h-[18px] w-[18px] text-ink-80" />
        <h3 className="text-base font-semibold text-ink-100">Services &amp; Line Items</h3>
      </div>
      <p className="text-[13px] text-ink-60">
        Select services to include in this package. Adding a package to checkout will unpack these services automatically.
      </p>

      <div className="mt-4 flex flex-col gap-4 md:h-[560px] md:flex-row">
        {/* Catalog — the shared create-proposal catalog in services-only mode. */}
        <div className="h-[400px] md:h-full md:w-[300px]">
          <CatalogPanel agencyId={agencyId} servicesOnly addedServiceIds={addedServiceIds} onAddService={handleAdd} />
        </div>

        <div className="hidden w-px shrink-0 bg-[color:var(--color-border-hairline)] md:block" />

        {/* Included services. */}
        <div className="flex min-h-[300px] flex-1 flex-col md:min-h-0">
          <div className="mb-3 text-sm font-semibold text-ink-100">Included Services</div>
          {items.length === 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-inset p-6 text-center text-sm text-ink-60">
              No services added yet.
            </div>
          ) : (
            <div className="-mr-1 flex-1 overflow-y-auto pr-1">
              <SortableList items={items} getId={(i) => i.id} onReorder={onReorder}>
                {({ item, handleProps }) => <PackageItemRow item={item} handleProps={handleProps} onRemove={() => onRemove(item.id)} />}
              </SortableList>
            </div>
          )}
        </div>
      </div>

      {/* Configuration dialog for services with options / add-ons. */}
      {configService && (
        <ServiceDetailDialog
          service={configService}
          open
          onOpenChange={(o) => !o && setConfigService(null)}
          purchasable={false}
          onSelectConfiguration={({ selectedVariantId, selectedOptions, selectedAddons }) => {
            const { price, upfront } = configuredPriceFor(configService, selectedVariantId, selectedAddons);
            onAdd(
              buildPackageItem(configService, {
                sortOrder: items.length,
                selectedVariantId,
                selectedOptions,
                selectedAddons,
                configuredPrice: price,
                configuredUpfrontFee: upfront,
              }),
            );
            setConfigService(null);
          }}
        />
      )}
    </div>
  );
}

/** A single included-service row (ports `PackageItemRow`). */
function PackageItemRow({
  item,
  handleProps,
  onRemove,
}: {
  item: PackageItem;
  handleProps: Record<string, unknown>;
  onRemove: () => void;
}) {
  const optionSummary = Object.entries(item.selectedOptions ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return (
    <div className="mb-2 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-3">
      <button
        type="button"
        {...handleProps}
        className="mt-0.5 cursor-grab text-ink-40 hover:text-ink-60 active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-ink-100">{item.serviceName}</div>
        {optionSummary && <div className="truncate text-[11px] text-ink-60">{optionSummary}</div>}
        <div className="mt-1 text-xs">
          <span className="font-bold tabular-nums text-ink-100">
            {item.isRecurring ? `${asMaybePrice(item.amount)} / Weekly` : asMaybePrice(item.amount)}
          </span>
          {item.upfrontFee != null && item.upfrontFee > 0 && (
            <span className="text-ink-60"> + {asMaybePrice(item.upfrontFee)} setup</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-danger hover:bg-inset"
        aria-label="Remove item"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
