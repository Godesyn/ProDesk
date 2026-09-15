/**
 * Agency relationship tools: connected/verified agencies, marketplace discovery, and outreach drafts.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { agencies, brandAgencyConnections, services } from '../../../db/schema.js';
import { obj } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function agencyTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'list_connected_agencies',
        description: [
          'List the agencies this brand is actively connected to (its established working relationships). Takes no arguments.',
          'Returns { count, agencies } where count is the number of rows and agencies is an array of:',
          '- id: agency UUID. Pass this as agencyId to compose_agency_message.',
          '- name: agency business name.',
          '- platformVerified: boolean. true = a Prodesk-curated/verified agency (shows the verified mark). false = a normal connected agency, NOT unverified-as-in-untrusted.',
          '- disciplines: ARRAY of strings — the creative/marketing disciplines the agency offers (may be null/empty).',
          '- website: agency website URL (may be null).',
          '- shortDescription: a one-line agency blurb (may be null).',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const rows = await db
          .select({
            id: agencies.id,
            name: agencies.businessName,
            platformVerified: agencies.platformVerified,
            disciplines: agencies.disciplines,
            website: agencies.website,
            shortDescription: agencies.shortDescription,
          })
          .from(brandAgencyConnections)
          .innerJoin(agencies, eq(brandAgencyConnections.agencyId, agencies.id))
          .where(eq(brandAgencyConnections.brandId, brandId));
        return { count: rows.length, agencies: rows };
      },
    },
    {
      def: {
        name: 'list_platform_verified_agencies',
        description: [
          'List Prodesk platform-verified agencies the brand could choose to work with (discovery — these are NOT necessarily connected yet). Takes no arguments. Capped at 50 rows.',
          'Returns { count, agencies } where agencies is an array of:',
          '- id: agency UUID.',
          '- name: agency business name.',
          '- disciplines: ARRAY of strings — disciplines offered (may be null/empty).',
          '- shortDescription: one-line blurb (may be null).',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        const rows = await db
          .select({
            id: agencies.id,
            name: agencies.businessName,
            disciplines: agencies.disciplines,
            shortDescription: agencies.shortDescription,
          })
          .from(agencies)
          .where(and(eq(agencies.platformVerified, true), eq(agencies.emailVerified, true)))
          .limit(50);
        return { count: rows.length, agencies: rows };
      },
    },
    {
      def: {
        name: 'compose_agency_message',
        description: [
          'Draft a message for the brand to send to one of its CONNECTED agencies. This does NOT send anything — it surfaces a draft the user must review and confirm. Use when the user wants to reach out to an agency.',
          'Returns { status: "awaiting_confirmation" } on success — this means the draft was shown to the user, NOT that it was sent. Never tell the user the message was sent. On failure returns { error } (e.g. the agencyId is not a connected agency).',
        ].join('\n'),
        input_schema: obj(
          {
            agencyId: { type: 'string', description: 'The connected agency\'s id (the `id` field from list_connected_agencies). Must be an agency this brand is connected to, or the call returns an error.' },
            message: { type: 'string', description: 'The drafted message body, in plain text. Match the brand\'s tone of voice.' },
          },
          ['agencyId', 'message'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const agencyId = String(input.agencyId ?? '');
        const message = String(input.message ?? '').trim();
        if (!message) return { error: 'The message body cannot be empty.' };
        // Verify the agency is actually connected to this brand before proposing.
        const conn = (
          await db
            .select({ name: agencies.businessName })
            .from(brandAgencyConnections)
            .innerJoin(agencies, eq(brandAgencyConnections.agencyId, agencies.id))
            .where(and(eq(brandAgencyConnections.brandId, brandId), eq(brandAgencyConnections.agencyId, agencyId)))
            .limit(1)
        )[0];
        if (!conn) return { error: 'That agency is not connected to this brand.' };
        pendingActions.push({ kind: 'agency_message', toolUseId, payload: { agencyId, agencyName: conn.name, message } });
        return { status: 'awaiting_confirmation', note: 'Draft surfaced to the user for review. Do not assume it was sent.' };
      },
    },
    {
      def: {
        name: 'request_agency_connection',
        description: [
          'Propose CONNECTING this brand with a platform-verified agency it is not yet connected to (use the agencies from list_platform_verified_agencies). This surfaces a confirm card; the connection is only created when the USER clicks confirm. A brand-initiated connection takes effect immediately on confirm (it does not require the agency to accept).',
          'Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is connected yet. Never tell the user they are connected. On failure returns { error } (e.g. not a connectable agency, or already connected).',
        ].join('\n'),
        input_schema: obj(
          { agencyId: { type: 'string', description: 'The agency\'s id (the `id` field from list_platform_verified_agencies). Must be a platform-verified agency this brand is NOT already connected to.' } },
          ['agencyId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const agencyId = String(input.agencyId ?? '');
        // Must be a platform-verified, email-verified agency (what the brand can
        // discover/connect to) that the brand is NOT already connected to.
        const ag = (
          await db
            .select({ name: agencies.businessName })
            .from(agencies)
            .where(and(eq(agencies.id, agencyId), eq(agencies.platformVerified, true), eq(agencies.emailVerified, true)))
            .limit(1)
        )[0];
        if (!ag) return { error: 'That is not a connectable platform-verified agency.' };
        const existing = (
          await db
            .select({ id: brandAgencyConnections.id })
            .from(brandAgencyConnections)
            .where(and(eq(brandAgencyConnections.brandId, brandId), eq(brandAgencyConnections.agencyId, agencyId)))
            .limit(1)
        )[0];
        if (existing) return { error: 'This brand is already connected to that agency.' };
        pendingActions.push({ kind: 'agency_connection', toolUseId, payload: { agencyId, agencyName: ag.name } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is connected until they confirm.' };
      },
    },
    {
      def: {
        name: 'list_marketplace_services',
        description: [
          'Browse marketplace services available to THIS brand — only active, buyable services from connected OR platform-verified agencies. Capped at 40 rows.',
          'Returns { count, services } where services is an array of:',
          '- id: service UUID.',
          '- name: service name.',
          '- description: free-text service description (may be null).',
          '- price: the headline/base price as a STRING decimal in AUD dollars (e.g. "1500.00"). This is NOT cents — "1500.00" means $1,500, not $15. May be null if unpriced. There may be additional fees (upfront/recurring) not surfaced here, so describe it as a starting/base price.',
          '- stage: a free-text marketing-funnel / Infin8 taxonomy label categorising the service (may be null). Not an enum — do not guess a fixed list.',
          '- agencyName: the agency offering the service.',
        ].join('\n'),
        input_schema: obj({ search: { type: 'string', description: 'Optional case-insensitive filter matched against the service NAME (substring). Omit to list everything visible.' } }),
      },
      run: async (input: Record<string, unknown>) => {
        // Brand-visible services = connected agencies + platform-verified agencies,
        // active + buyable, from email-verified agencies.
        const connected = await db
          .select({ id: brandAgencyConnections.agencyId })
          .from(brandAgencyConnections)
          .where(eq(brandAgencyConnections.brandId, brandId));
        const connectedIds = connected.map((c) => c.id);
        const search = typeof input.search === 'string' ? input.search.trim() : '';
        const visibility = connectedIds.length
          ? or(eq(agencies.platformVerified, true), inArray(services.agencyId, connectedIds))!
          : eq(agencies.platformVerified, true);
        const filters = [
          isNull(services.deletedAt),
          eq(services.isActive, true),
          eq(services.allowBuyNow, true),
          eq(agencies.emailVerified, true),
          visibility,
        ];
        if (search) filters.push(sql`${services.name} ilike ${'%' + search + '%'}`);
        const rows = await db
          .select({
            id: services.id,
            name: services.name,
            description: services.description,
            price: services.price,
            stage: services.stage,
            agencyName: agencies.businessName,
          })
          .from(services)
          .innerJoin(agencies, eq(services.agencyId, agencies.id))
          .where(and(...filters))
          .limit(40);
        return { count: rows.length, services: rows };
      },
    },
    {
      def: {
        name: 'draft_marketplace_inquiry',
        description: [
          'Draft an inquiry message about a specific marketplace service (e.g. to ask the offering agency about scope, timing or price). Does NOT send — surfaces a draft for the user to review and send themselves. Use when the user is interested in a service from list_marketplace_services and wants to reach out.',
          'Returns { status: "awaiting_confirmation" } on success — the draft was shown to the user, NOT sent. Never claim it was sent. On failure returns { error } (e.g. the serviceId is not visible to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            serviceId: { type: 'string', description: 'The service\'s id (the `id` field from list_marketplace_services). Must be a service currently visible/buyable to this brand, or the call returns an error.' },
            message: { type: 'string', description: 'The drafted inquiry, in plain text. Match the brand\'s tone of voice.' },
          },
          ['serviceId', 'message'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const serviceId = String(input.serviceId ?? '');
        const message = String(input.message ?? '').trim();
        if (!message) return { error: 'The inquiry body cannot be empty.' };
        // Re-check the service is visible/buyable to this brand (same rules as
        // list_marketplace_services) before surfacing the draft.
        const connected = await db
          .select({ id: brandAgencyConnections.agencyId })
          .from(brandAgencyConnections)
          .where(eq(brandAgencyConnections.brandId, brandId));
        const connectedIds = connected.map((c) => c.id);
        const visibility = connectedIds.length
          ? or(eq(agencies.platformVerified, true), inArray(services.agencyId, connectedIds))!
          : eq(agencies.platformVerified, true);
        const svc = (
          await db
            .select({ id: services.id, name: services.name, agencyId: services.agencyId, agencyName: agencies.businessName })
            .from(services)
            .innerJoin(agencies, eq(services.agencyId, agencies.id))
            .where(
              and(
                eq(services.id, serviceId),
                isNull(services.deletedAt),
                eq(services.isActive, true),
                eq(services.allowBuyNow, true),
                eq(agencies.emailVerified, true),
                visibility,
              ),
            )
            .limit(1)
        )[0];
        if (!svc) return { error: 'That service is not available to this brand.' };
        pendingActions.push({
          kind: 'marketplace_inquiry',
          toolUseId,
          payload: { serviceId: svc.id, serviceName: svc.name, agencyId: svc.agencyId, agencyName: svc.agencyName, message },
        });
        return { status: 'awaiting_confirmation', note: 'Draft surfaced to the user for review. Do not assume it was sent.' };
      },
    },
  ];
}
