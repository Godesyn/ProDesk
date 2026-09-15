/* Prodesk — Services (product-hub), the brand's own catalogue.
   Services the brand publishes through its derived "shadow" agency, created
   and edited via the shared agency Service editor (brand variant). */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import type { RouterOutputs } from '@server/trpc/router';
import { Dialog } from '@shared/components/ui/dialog';
import {
  ServiceEditorDialog,
  draftFromService,
  type ServiceDraft,
} from '@shared/pages/agency/service-editor';
import { servicePriceSummary } from '@shared/pages/marketplace/pricing';
import type { MarketplaceService } from '@shared/pages/marketplace/types';
import {
  SERVICE_TYPE_DISPLAY_NAME,
  type ServiceType,
} from '@server/lib/service-type';
import { pushToast } from './ui';
import { FndHeader, FndToolbar, FndEmpty } from './fnd-shared';
import type { Brand, SuiteApp } from './data';

type Service = RouterOutputs['services']['list']['items'][number];

function serviceTypeLabel(type: string): string {
  return SERVICE_TYPE_DISPLAY_NAME[type as ServiceType] ?? type;
}

/** Prodesk's canonical one-line price: `$100`, `$10 per week`, `$100 + $10 per week`. */
function servicePrice(s: Service): string {
  return servicePriceSummary(s as unknown as MarketplaceService);
}

export function ProductsTool({ app, brand }: { app: SuiteApp; brand: Brand }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  // Services are published through the brand's derived "shadow" agency.
  const agencyId = brand.derivedAgencyId ?? null;

  const [search, setSearch] = useState('');
  // null = closed, {} = create, { initial } = edit an existing service.
  const [editor, setEditor] = useState<{ initial?: ServiceDraft } | null>(null);

  const servicesQ = useQuery({
    ...trpc.services.list.queryOptions({
      agencyId: agencyId ?? '',
      includeInactive: true,
      limit: 500,
      ...(search ? { search } : {}),
    }),
    enabled: !!agencyId,
  });
  const serviceItems = servicesQ.data?.items ?? [];

  const startCreate = () => {
    if (!agencyId) {
      pushToast(
        'This brand’s service catalogue isn’t ready yet. Please try again shortly.',
        'error',
      );
      return;
    }
    setEditor({});
  };

  return (
    <div>
      <FndHeader
        app={{
          icon: app.icon || 'product',
          name: app.name,
          tag: 'Everything you sell, in one catalogue',
        }}
        brand={brand}
        pill="Source of truth"
        count={agencyId ? serviceItems.length : undefined}
        countLabel="services"
        primaryLabel="Add service"
        onPrimary={startCreate}
      />

      <FndToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search services"
      />

      <div className="pd-fnd-table">
        <div className="pd-prd-row pd-fnd-head">
          <span>Name</span>
          <span className="pd-hide-sm">Type</span>
          <span>Price</span>
        </div>
        {!agencyId && (
          <FndEmpty line="This brand’s service catalogue isn’t ready yet. Please try again shortly." />
        )}
        {agencyId && servicesQ.isLoading && (
          <div
            style={{
              padding: '40px 0',
              textAlign: 'center',
              color: 'var(--ink-3)',
              fontSize: 14,
            }}
          >
            Loading…
          </div>
        )}
        {agencyId && !servicesQ.isLoading && serviceItems.length === 0 && (
          <FndEmpty
            line={
              search
                ? `No services match "${search}".`
                : 'No services yet. Publish the first service you offer.'
            }
            cta="Add service"
            onCta={startCreate}
          />
        )}
        {agencyId &&
          serviceItems.map((s) => (
            <button
              key={s.id}
              type="button"
              className="pd-prd-row pd-fnd-row"
              onClick={() => setEditor({ initial: draftFromService(s) })}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'var(--ink)',
                  }}
                >
                  {s.name}
                </span>
                {s.description && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12,
                      color: 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.description}
                  </span>
                )}
              </span>
              <span
                className="pd-hide-sm"
                style={{ fontSize: 13, color: 'var(--ink)' }}
              >
                {serviceTypeLabel(s.type)}
              </span>
              <span className="mono" style={{ fontSize: 13 }}>
                {servicePrice(s)}
              </span>
            </button>
          ))}
      </div>

      {editor && agencyId && (
        <Dialog
          open
          onOpenChange={(o) => {
            if (!o) setEditor(null);
          }}
        >
          <ServiceEditorDialog
            variant="brand"
            agencyId={agencyId}
            initial={editor.initial}
            onDone={() => {
              setEditor(null);
              qc.invalidateQueries({ queryKey: trpc.services.list.queryKey() });
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
