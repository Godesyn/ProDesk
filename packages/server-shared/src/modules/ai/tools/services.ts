/**
 * Brand services-catalog tools (the brand's own offerings, via its derived shadow agency).
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { SERVICE_TYPE_DISPLAY_NAME, isBillingCycleWeekly } from '../../../lib/service-type.js';
import { getBrandService, listBrandServices, listBrandServiceNames } from '../../services/queries.js';
import { obj, CREATE_ANYWAY_PROP, findSimilarByName, similarExistsResult } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function serviceTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, pendingActions, getShadowAgencyId } = ctx;
  return [
    {
      def: {
        name: 'list_brand_services',
        description: [
          "List THIS brand's own services catalog (the services this brand offers to its customers — distinct from marketplace services which are offered BY agencies TO this brand). Capped at 50 rows, in catalog order.",
          'Returns { count, services } where services is an array of:',
          '- id: service UUID. Pass this as serviceId to get_brand_service for full detail.',
          '- name: service name.',
          '- description: short service description (may be null).',
          '- type: the service type as a human-readable label (e.g. "One off Service", "Subscription", "Recurring Service", "Digital Product").',
          '- price: the base/one-off price as a STRING decimal in AUD dollars (e.g. "500.00"). May be null for recurring-only types.',
          '- recurringFee: the recurring fee as a STRING decimal in AUD dollars. May be null for one-off types.',
          '- isActive: boolean — whether the service is currently live and visible.',
          '- stage: Infin8 taxonomy stage label (may be null).',
          '- createdAt: ISO timestamp.',
        ].join('\n'),
        input_schema: obj({
          search: { type: 'string', description: 'Optional case-insensitive substring filter matched against the service name. Omit to list all.' },
          includeInactive: { type: 'boolean', description: 'If true, include inactive (draft/paused) services. Default false (active only).' },
        }),
      },
      run: async (input: Record<string, unknown>) => {
        const agencyId = await getShadowAgencyId();
        if (!agencyId) return { count: 0, services: [] };
        // Shared catalog query core (also backs tRPC services.list), capped at 50.
        const rows = await listBrandServices(db, agencyId, {
          search: typeof input.search === 'string' ? input.search : undefined,
          includeInactive: input.includeInactive === true,
          limit: 50,
        });
        return {
          count: rows.length,
          services: rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            type: SERVICE_TYPE_DISPLAY_NAME[r.type] ?? r.type,
            price: r.price,
            recurringFee: r.recurringFee,
            isActive: r.isActive,
            stage: r.stage,
            createdAt: r.createdAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_brand_service',
        description: [
          "Get the full detail of ONE of this brand's own services. Use after list_brand_services when the user asks about a specific service.",
          'Returns { error } if the serviceId does not belong to this brand. Otherwise returns an object:',
          '- id, name, description, type (human-readable label), price (STRING AUD dollars or null), upfrontFee, recurringFee, stage, subStage, isActive, allowBuyNow, allowBookMeeting, disciplines (array of strings or null), createdAt.',
        ].join('\n'),
        input_schema: obj(
          { serviceId: { type: 'string', description: "The service's id (the `id` field from list_brand_services). Must belong to this brand." } },
          ['serviceId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const serviceId = String(input.serviceId ?? '');
        const agencyId = await getShadowAgencyId();
        if (!agencyId) return { error: 'This brand does not have a services catalog yet.' };
        const svc = await getBrandService(db, agencyId, serviceId);
        if (!svc) return { error: 'That service does not belong to this brand.' };
        // Project the model-facing subset (full row also carries editor-only fields).
        return {
          id: svc.id,
          name: svc.name,
          description: svc.description,
          type: SERVICE_TYPE_DISPLAY_NAME[svc.type] ?? svc.type,
          price: svc.price,
          upfrontFee: svc.upfrontFee,
          recurringFee: svc.recurringFee,
          stage: svc.stage,
          subStage: svc.subStage,
          isActive: svc.isActive,
          allowBuyNow: svc.allowBuyNow,
          allowBookMeeting: svc.allowBookMeeting,
          disciplines: svc.disciplines,
          createdAt: svc.createdAt,
        };
      },
    },
    {
      def: {
        name: 'create_brand_service',
        description: [
          "Propose creating a new service in this brand's own services catalog. This surfaces a confirm card; the service is only created when the USER clicks confirm.",
          'Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is created yet. Never claim the service exists. On failure returns { error }.',
          'DUPLICATE GUARD: if the catalog already has a SIMILAR service, the tool returns { status: "similar_exists", similar } instead of proposing anything. When that happens, do NOT create — tell the user what already exists and ask whether they want a new one anyway (then re-call with createAnyway: true) or to edit the existing one instead.',
          'Note: the brand must have a services catalog initialised (most brands do). If not, the tool returns an error explaining the catalog is not available.',
        ].join('\n'),
        input_schema: obj(
          {
            name: { type: 'string', description: 'Service name (1+ characters, required).' },
            description: { type: 'string', description: 'Short service description shown in the catalog (1+ characters, required).' },
            type: {
              type: 'string',
              description: 'Service type. One of: "oneOffService" (default), "subscription", "recurringService", "oneOffProductShips", "recurringProductShips", "digitalProduct". Omit for a standard one-off service.',
              enum: ['oneOffService', 'subscription', 'recurringService', 'oneOffProductShips', 'recurringProductShips', 'digitalProduct'],
            },
            price: { type: 'number', description: 'Base/one-off price in AUD dollars (e.g. 500 = $500). Required for one-off types (oneOffService, oneOffProductShips, digitalProduct). Not used for recurring-only types.' },
            recurringFee: { type: 'number', description: 'Recurring fee in AUD dollars. Required for recurring/subscription types (subscription, recurringService, recurringProductShips). Not used for one-off types.' },
            stage: { type: 'string', description: 'Optional Infin8 stage label for categorisation (e.g. "CRE8", "ACCELER8").' },
            ...CREATE_ANYWAY_PROP,
          },
          ['name', 'description'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const agencyId = await getShadowAgencyId();
        if (!agencyId) return { error: 'This brand does not have a services catalog. The catalog is created automatically — please contact support if this persists.' };
        const name = String(input.name ?? '').trim();
        const description = String(input.description ?? '').trim();
        if (!name) return { error: 'A service name is required.' };
        if (!description) return { error: 'A service description is required.' };
        // Unless the user already confirmed, surface any SIMILAR existing service
        // so the model can ask before creating a likely-duplicate.
        if (input.createAnyway !== true) {
          const similar = findSimilarByName(name, await listBrandServiceNames(db, agencyId));
          if (similar.length) {
            return similarExistsResult('service', similar, 'To change an existing one instead, direct the user to edit it in the Services app.');
          }
        }
        const type = typeof input.type === 'string' ? input.type : 'oneOffService';
        const validTypes = ['oneOffService', 'subscription', 'recurringService', 'oneOffProductShips', 'recurringProductShips', 'digitalProduct'];
        if (!validTypes.includes(type)) return { error: `Invalid service type. Must be one of: ${validTypes.join(', ')}.` };
        const price = typeof input.price === 'number' ? input.price : undefined;
        const recurringFee = typeof input.recurringFee === 'number' ? input.recurringFee : undefined;
        // Validate pricing: recurring types need recurringFee, one-off types need price.
        const isRecurring = isBillingCycleWeekly(type as any);
        if (isRecurring && (!recurringFee || recurringFee <= 0)) {
          return { error: 'A recurring fee is required for subscription/recurring service types.' };
        }
        if (!isRecurring && (!price || price <= 0)) {
          return { error: 'A price is required for one-off service types.' };
        }
        if (price !== undefined && price < 0) return { error: 'Price cannot be negative.' };
        if (recurringFee !== undefined && recurringFee < 0) return { error: 'Recurring fee cannot be negative.' };
        const stage = typeof input.stage === 'string' ? input.stage.trim() : undefined;
        const displayType = SERVICE_TYPE_DISPLAY_NAME[type as keyof typeof SERVICE_TYPE_DISPLAY_NAME] ?? type;
        pendingActions.push({
          kind: 'create_service',
          toolUseId,
          payload: { agencyId, name, description, type, displayType, price: price ?? null, recurringFee: recurringFee ?? null, stage: stage ?? null },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm.' };
      },
    },
  ];
}
