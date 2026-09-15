import { z } from 'zod';
import { and, eq, count, desc, asc, ilike, isNull, sql, notInArray, inArray, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import {
  agencies,
  brands,
  brandAgencyConnections,
  brandAgencyConnectionRequests,
  agencyContractorConnections,
  contractors,
  projects,
  services,
  users,
} from '../db/schema.js';
import { assertAgencyAccess, assertBrandAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import { enqueueEmail } from '../lib/notify.js';
import { emailBaseUrl } from '../modules/email/branding.js';
import { createContractorThread, handleContractorRemovedFromAgency } from '../modules/chat/threads.js';
import { onContractorConnectionRequest, onBrandAgencyConnectionRequest, onBrandAgencyConnectionAccepted, clearTasksByEntity } from './tasks.js';
import { maybeResetUserRole } from '../lib/user-role.js';
import { connectBrandToAgency } from '../modules/connections/connect.js';

/** Resolve agency owner-id + name for task/thread side-effects. */
async function agencyMeta(db: typeof import('../db/index.js').db, agencyId: string) {
  const a = (await db.select({ ownerId: agencies.ownerId, name: agencies.businessName }).from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0];
  return { ownerId: a?.ownerId ?? null, name: a?.name ?? null };
}

export const connectionsRouter = router({
  /** Brands connected to an agency (the agency's clients). */
  agencyClients: protectedProcedure
    .input(paginationInput.extend({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'clients');
      const where = eq(brandAgencyConnections.agencyId, input.agencyId);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ connection: brandAgencyConnections, brand: brands })
          .from(brandAgencyConnections)
          .innerJoin(brands, eq(brandAgencyConnections.brandId, brands.id))
          .where(where)
          .orderBy(desc(brandAgencyConnections.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(brandAgencyConnections).where(where),
      ]);
      return page(rows.map((r) => ({ ...r.brand, connectionId: r.connection.id, connectedAt: r.connection.createdAt })), total, input);
    }),

  /** Agencies connected to a brand. */
  brandAgencies: protectedProcedure
    .input(paginationInput.extend({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const where = eq(brandAgencyConnections.brandId, input.brandId);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ connection: brandAgencyConnections, agency: agencies })
          .from(brandAgencyConnections)
          .innerJoin(agencies, eq(brandAgencyConnections.agencyId, agencies.id))
          .where(where)
          .orderBy(desc(brandAgencyConnections.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(brandAgencyConnections).where(where),
      ]);
      return page(rows.map((r) => ({ ...r.agency, connectionId: r.connection.id, connectedAt: r.connection.createdAt })), total, input);
    }),

  /** Contractors connected to an agency, optionally filtered by status. */
  agencyContractors: protectedProcedure
    .input(paginationInput.extend({ agencyId: z.string().uuid(), status: z.enum(['pendingInvite', 'pendingApplication', 'active', 'rejected', 'revoked']).optional() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'manageContractors');
      const filters = [eq(agencyContractorConnections.agencyId, input.agencyId)];
      if (input.status) filters.push(eq(agencyContractorConnections.status, input.status));
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          // The contractor's profile picture lives on the linked `users` row
          // (contractors.id == users.id), not on the contractors table itself.
          .select({ connection: agencyContractorConnections, contractor: contractors, profileUrl: users.profileUrl })
          .from(agencyContractorConnections)
          .leftJoin(contractors, eq(agencyContractorConnections.contractorId, contractors.id))
          .leftJoin(users, eq(users.id, contractors.id))
          .where(where)
          .orderBy(desc(agencyContractorConnections.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(agencyContractorConnections).where(where),
      ]);
      return page(
        rows.map((r) => ({ ...r.connection, contractor: r.contractor ? { ...r.contractor, profileUrl: r.profileUrl } : null })),
        total,
        input,
      );
    }),

  /**
   * Invite a contractor either by existing user-id or by email. The email path
   * (invite_contractor_dialog.dart) supports inviting people who don't yet have
   * an account: if no matching user exists we enqueue an email invite and return
   * a pending marker (no connection row until they sign up & accept).
   * Ports the invite-by-email + invite-existing flows.
   */
  inviteContractor: protectedProcedure
    .input(
      z
        .object({ agencyId: z.string().uuid(), note: z.string().optional(), contractorId: z.string().uuid().optional(), email: z.string().email().optional() })
        .refine((v) => v.contractorId || v.email, { message: 'Provide a contractor or an email' }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'manageContractors');

      // Resolve the target user-id: explicit id, or look up by email.
      let contractorId = input.contractorId ?? null;
      if (!contractorId && input.email) {
        const u = (await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1))[0];
        contractorId = u?.id ?? null;
      }

      // No account yet → persist an email-only pendingInvite row so it shows in
      // the agency's pending list, then email the signed invite link. The row is
      // reconciled (contractor_id filled, pending_email cleared) when they sign
      // up & redeem the link in contractor.create.
      if (!contractorId) {
        // Re-inviting an email that was previously removed (rejected/revoked) must
        // re-arm the row to pendingInvite — otherwise the conflict would silently
        // keep it closed and it'd never reappear in the agency's pending list.
        const [created] = await ctx.db
          .insert(agencyContractorConnections)
          .values({ agencyId: input.agencyId, pendingEmail: input.email, status: 'pendingInvite', initiatedByUserId: ctx.user.id, note: input.note })
          .onConflictDoUpdate({
            target: [agencyContractorConnections.agencyId, agencyContractorConnections.pendingEmail],
            targetWhere: sql`${agencyContractorConnections.pendingEmail} is not null`,
            setWhere: inArray(agencyContractorConnections.status, ['rejected', 'revoked']),
            set: { status: 'pendingInvite', note: input.note, initiatedByUserId: ctx.user.id, respondedAt: null, updatedAt: new Date() },
          })
          .returning();
        await enqueueEmail('contractor-invite', { agencyId: input.agencyId, email: input.email, note: input.note, origin: ctx.clientOrigin });
        return { pendingEmail: input.email ?? null, created: created ?? null };
      }

      // Drop any stale email-only invite to this same person (created before they
      // had an account) so the contractor-keyed row below doesn't leave a ghost
      // pending row beside it.
      if (input.email) {
        await ctx.db
          .delete(agencyContractorConnections)
          .where(and(eq(agencyContractorConnections.agencyId, input.agencyId), eq(agencyContractorConnections.pendingEmail, input.email)));
      }

      // Upsert the contractor-keyed invite. A previously rejected/revoked row is
      // re-armed to pendingInvite (re-inviting a removed contractor MUST work — a
      // plain onConflictDoNothing would silently keep it closed, producing no
      // pending row and no task). An active or still-pending row is left untouched
      // (no downgrade); the upsert then returns nothing, so the task/email below
      // are correctly skipped.
      const [created] = await ctx.db
        .insert(agencyContractorConnections)
        .values({ agencyId: input.agencyId, contractorId, status: 'pendingInvite', initiatedByUserId: ctx.user.id, note: input.note })
        .onConflictDoUpdate({
          target: [agencyContractorConnections.agencyId, agencyContractorConnections.contractorId],
          targetWhere: sql`${agencyContractorConnections.contractorId} is not null`,
          setWhere: inArray(agencyContractorConnections.status, ['rejected', 'revoked']),
          set: { status: 'pendingInvite', note: input.note, initiatedByUserId: ctx.user.id, respondedAt: null, updatedAt: new Date() },
        })
        .returning();

      if (created) {
        const meta = await agencyMeta(ctx.db, input.agencyId);
        await onContractorConnectionRequest(
          { connectionId: created.id, status: 'pendingInvite', agencyId: input.agencyId, contractorId, agencyOwnerId: meta.ownerId, agencyName: meta.name },
          ctx.db,
        );
        await enqueueEmail('contractor-invite', { agencyId: input.agencyId, contractorId, note: input.note, origin: ctx.clientOrigin });
      }
      // A 1:1 chat thread is created when the contractor accepts (see respondToContractorInvite).
      return { pendingEmail: null, created: created ?? null };
    }),

  /**
   * Explore ALL platform contractors (the agency Contractors screen's "Explore
   * Contractors" talent-discovery rail). This is a DEFAULT-AGENCY-only capability
   * — staff_contractor_list.dart gates the entire section on `agency.platformVerified`,
   * so non-default agencies are rejected here. Paginated newest-first (ports
   * ExploreContractorsNotifier, pageSize 6); each row carries this agency's
   * current connection status so the card can render Invite / Pending / Connected.
   */
  exploreContractors: protectedProcedure
    .input(paginationInput.extend({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'manageContractors');
      const agency = (await ctx.db.select({ platformVerified: agencies.platformVerified }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
      if (!agency?.platformVerified) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only default agencies can explore platform contractors.' });
      }
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          // Profile picture comes from the linked `users` row (contractors.id == users.id).
          .select({ contractor: contractors, connection: agencyContractorConnections, profileUrl: users.profileUrl })
          .from(contractors)
          .leftJoin(
            agencyContractorConnections,
            and(eq(agencyContractorConnections.contractorId, contractors.id), eq(agencyContractorConnections.agencyId, input.agencyId)),
          )
          .leftJoin(users, eq(users.id, contractors.id))
          .orderBy(desc(contractors.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(contractors),
      ]);
      return page(
        rows.map((r) => ({ ...r.contractor, profileUrl: r.profileUrl, connection: r.connection })),
        total,
        input,
      );
    }),

  respondToContractorInvite: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid(), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const conn = (await ctx.db.select().from(agencyContractorConnections).where(eq(agencyContractorConnections.id, input.connectionId)).limit(1))[0];
      if (!conn) throw new Error('Connection not found');
      if (conn.contractorId !== ctx.user.id) throw new Error('Not your invitation');
      const [updated] = await ctx.db
        .update(agencyContractorConnections)
        .set({ status: input.accept ? 'active' : 'rejected', respondedAt: new Date() })
        .where(eq(agencyContractorConnections.id, input.connectionId))
        .returning();
      if (input.accept) await createContractorThread(conn.agencyId, conn.contractorId, ctx.db);
      // Complete the contractor-side connection task either way.
      await onContractorConnectionRequest(
        { connectionId: conn.id, status: updated.status, agencyId: conn.agencyId, contractorId: conn.contractorId },
        ctx.db,
      );
      return updated;
    }),

  /** Agency requests a brand received (for the brand to accept). */
  brandPendingRequests: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      return ctx.db
        .select({ request: brandAgencyConnectionRequests, agency: agencies })
        .from(brandAgencyConnectionRequests)
        .innerJoin(agencies, eq(brandAgencyConnectionRequests.agencyId, agencies.id))
        .where(eq(brandAgencyConnectionRequests.brandId, input.brandId))
        .then((rows) => rows.map((r) => ({ ...r.request, agency: r.agency })));
    }),

  /** Agency approves/rejects a contractor's application. */
  respondToApplication: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid(), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const conn = (await ctx.db.select().from(agencyContractorConnections).where(eq(agencyContractorConnections.id, input.connectionId)).limit(1))[0];
      if (!conn) throw new Error('Connection not found');
      if (!conn.contractorId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invite has no account yet.' });
      await assertAgencyAccess(ctx, conn.agencyId, 'manageContractors');
      const [updated] = await ctx.db
        .update(agencyContractorConnections)
        .set({ status: input.accept ? 'active' : 'rejected', respondedAt: new Date() })
        .where(eq(agencyContractorConnections.id, input.connectionId))
        .returning();
      if (input.accept) await createContractorThread(conn.agencyId, conn.contractorId, ctx.db);
      await onContractorConnectionRequest(
        { connectionId: conn.id, status: updated.status, agencyId: conn.agencyId, contractorId: conn.contractorId },
        ctx.db,
      );
      return updated;
    }),

  /**
   * Remove or revoke a contractor's connection to an agency. Sets the status to
   * `revoked`, archives the agency↔contractor chat threads, and clears any open
   * connection task. Ports handleContractorRemovedFromAgency.
   */
  removeContractor: protectedProcedure
    .input(z.object({ connectionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conn = (await ctx.db.select().from(agencyContractorConnections).where(eq(agencyContractorConnections.id, input.connectionId)).limit(1))[0];
      if (!conn) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
      await assertAgencyAccess(ctx, conn.agencyId, 'manageContractors');

      // Email-only invite placeholder (no account yet) → just delete the row;
      // there's no chat thread or user role to unwind.
      if (!conn.contractorId) {
        await ctx.db.delete(agencyContractorConnections).where(eq(agencyContractorConnections.id, input.connectionId));
        return conn;
      }

      const [updated] = await ctx.db
        .update(agencyContractorConnections)
        .set({ status: 'revoked', respondedAt: new Date() })
        .where(eq(agencyContractorConnections.id, input.connectionId))
        .returning();
      await handleContractorRemovedFromAgency(conn.agencyId, conn.contractorId, ctx.db);
      // Removing the invite/connection deletes any open (pending-invite) task, and
      // drops the contractor back to role-selection if this was their only identity.
      await clearTasksByEntity(conn.id, ctx.db);
      await maybeResetUserRole(ctx.db, conn.contractorId);
      return updated;
    }),

  /**
   * Search brands the agency could request a connection with (search_brands_dialog).
   *
   * This is a DEFAULT-AGENCY-gated capability (ports brand_repository.searchBrands
   * + search_brands_dialog.dart): platform **default** agencies search the entire
   * brand directory by business name OR email and may request a connection with
   * anyone; **non-default** agencies cannot browse the directory — they may only
   * resolve a brand by its EXACT email (then request it, or fall back to an email
   * invitation via `sendBrandReferralInvite`). Each row carries `alreadyConnected`
   * so the dialog can render a "Connected" pill instead of a Request button.
   */
  searchBrands: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), search: z.string().default(''), limit: z.number().min(1).max(25).default(10) }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'clients');
      const agency = (await ctx.db.select({ platformVerified: agencies.platformVerified }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
      const platformVerified = agency?.platformVerified ?? false;
      const q = input.search.trim();

      // Match on the brand's own email AND the owner's account email — many brands
      // have no brands.email set, so the owner's email is the searchable fallback.
      // `email` surfaces brands.email when present, else the owner's account email.
      const cols = {
        id: brands.id,
        businessName: brands.businessName,
        email: sql<string | null>`coalesce(${brands.email}, ${users.email})`,
        logoUrl: brands.logoUrl,
        industry: brands.industry,
      };
      let rows: { id: string; businessName: string; email: string | null; logoUrl: string | null; industry: string | null }[] = [];
      if (platformVerified) {
        if (!q) return [];
        rows = await ctx.db
          .select(cols)
          .from(brands)
          .innerJoin(users, eq(users.id, brands.ownerId))
          .where(or(ilike(brands.businessName, `%${q}%`), ilike(brands.email, `%${q}%`), ilike(users.email, `%${q}%`))!)
          .orderBy(asc(brands.businessName))
          .limit(input.limit);
      } else {
        // Non-default: exact-email lookup only (mirrors searchBrandsByEmail). A
        // non-email query yields nothing, which drives the dialog's "enter a valid
        // email"/"Send Invitation Email" branch. One email (owner account) can own
        // multiple brands, so return them all — not just the first.
        const isEmail = q.includes('@') && q.includes('.');
        if (!isEmail) return [];
        rows = await ctx.db
          .select(cols)
          .from(brands)
          .innerJoin(users, eq(users.id, brands.ownerId))
          .where(or(sql`lower(${brands.email}) = lower(${q})`, sql`lower(${users.email}) = lower(${q})`)!)
          .orderBy(asc(brands.businessName))
          .limit(input.limit);
      }

      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const connected = await ctx.db
        .select({ brandId: brandAgencyConnections.brandId })
        .from(brandAgencyConnections)
        .where(and(eq(brandAgencyConnections.agencyId, input.agencyId), inArray(brandAgencyConnections.brandId, ids)));
      const connectedSet = new Set(connected.map((c) => c.brandId));
      return rows.map((r) => ({ ...r, alreadyConnected: connectedSet.has(r.id) }));
    }),

  /**
   * Non-default agencies invite a brand by email (search_brands_dialog's email
   * branch → _sendEmailInvitation). Sends a referral-invite email whose signup
   * link stamps this agency as the referrer (`?ref=<agencyId>`), so the brand is
   * attributed on sign-up. Ports userRepository.sendReferralInviteEmail.
   */
  sendBrandReferralInvite: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'clients');
      const agency = (await ctx.db.select({ businessName: agencies.businessName }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
      if (!agency) throw new TRPCError({ code: 'NOT_FOUND', message: 'Agency not found' });
      const signupUrl = `${emailBaseUrl(ctx.clientOrigin)}/signup?ref=${input.agencyId}&email=${encodeURIComponent(input.email)}`;
      await enqueueEmail('referral-invite', { email: input.email, inviterName: agency.businessName, signupUrl });
      return { sent: true };
    }),

  requestBrandConnection: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'clients');
      const [created] = await ctx.db
        .insert(brandAgencyConnectionRequests)
        .values({ agencyId: input.agencyId, brandId: input.brandId, createdBy: ctx.user.id })
        .onConflictDoNothing({ target: [brandAgencyConnectionRequests.brandId, brandAgencyConnectionRequests.agencyId] })
        .returning();
      if (created) {
        await enqueueEmail('connection-request', { requestId: created.id });
        const meta = await agencyMeta(ctx.db, input.agencyId);
        const brand = (await ctx.db.select({ ownerId: brands.ownerId, businessName: brands.businessName }).from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
        if (brand?.ownerId) {
          await onBrandAgencyConnectionRequest(
            { requestId: created.id, brandOwnerId: brand.ownerId, brandName: brand.businessName, agencyId: input.agencyId, agencyName: meta.name },
            ctx.db,
          );
        }
      }
      return created ?? null;
    }),

  /** Brand accepts an agency's request → creates the connection and clears the request. */
  acceptBrandRequest: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const req = (await ctx.db.select().from(brandAgencyConnectionRequests).where(eq(brandAgencyConnectionRequests.id, input.requestId)).limit(1))[0];
      if (!req) throw new Error('Request not found');
      await assertBrandAccess(ctx, req.brandId, 'staffManagement');
      // Establish the connection, open the chat threads, and provision the agency's
      // default Info Hub sections — all via the shared chokepoint.
      const { connection } = await connectBrandToAgency(req.brandId, req.agencyId, ctx.db);
      await onBrandAgencyConnectionAccepted(input.requestId, ctx.db);
      await ctx.db.delete(brandAgencyConnectionRequests).where(eq(brandAgencyConnectionRequests.id, input.requestId));
      return connection ?? null;
    }),

  /**
   * Agencies a brand can discover & connect with (the brand "Add New Agency"
   * search dialog). Ports agency_repository.searchAgencies, which makes this a
   * DEFAULT-AGENCY-gated surface: a brand only finds **verified + default**
   * agencies by text (name / description / email / discipline), UNION any agency
   * (default or not) that owns a service matching the query. Non-default agencies
   * are otherwise invisible to brand discovery. Excludes already-connected
   * agencies; default-first then alphabetical.
   */
  browseAgencies: protectedProcedure
    .input(paginationInput.extend({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const connected = await ctx.db
        .select({ agencyId: brandAgencyConnections.agencyId })
        .from(brandAgencyConnections)
        .where(eq(brandAgencyConnections.brandId, input.brandId));
      const connectedIds = connected.map((c) => c.agencyId);

      const defaultVerified = and(eq(agencies.emailVerified, true), eq(agencies.platformVerified, true));
      let visibility;
      if (input.search) {
        const q = `%${input.search}%`;
        // Agencies surfaced because one of their services matches the query
        // (mirrors searchAgencies' service scan — any agency, not just default).
        const svcRows = await ctx.db
          .select({ id: services.agencyId })
          .from(services)
          .where(and(isNull(services.deletedAt), or(ilike(services.name, q), ilike(services.description, q))!));
        const svcAgencyIds = [...new Set(svcRows.map((r) => r.id).filter((id): id is string => !!id))];
        const textMatch = and(
          defaultVerified,
          or(
            ilike(agencies.businessName, q),
            ilike(agencies.description, q),
            ilike(agencies.shortDescription, q),
            ilike(agencies.businessEmail, q),
            sql`EXISTS (SELECT 1 FROM unnest(coalesce(${agencies.disciplines}, '{}')) d WHERE d ILIKE ${q})`,
          )!,
        );
        visibility = svcAgencyIds.length ? or(textMatch, inArray(agencies.id, svcAgencyIds))! : textMatch!;
      } else {
        visibility = defaultVerified!;
      }

      const filters = [visibility];
      if (connectedIds.length) filters.push(notInArray(agencies.id, connectedIds));
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({
            id: agencies.id,
            businessName: agencies.businessName,
            logoUrl: agencies.logoUrl,
            description: agencies.description,
            shortDescription: agencies.shortDescription,
            disciplines: agencies.disciplines,
            emailVerified: agencies.emailVerified,
            platformVerified: agencies.platformVerified,
            businessEmail: agencies.businessEmail,
          })
          .from(agencies)
          .where(where)
          .orderBy(desc(agencies.platformVerified), agencies.businessName)
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(agencies).where(where),
      ]);
      return page(rows, total, input);
    }),

  /**
   * Recommended agencies for a brand (the agencies empty-state / "get you
   * started" rail). Ports recommendedAgenciesProvider: ONLY platform **default**
   * agencies, ranked by amortized project volume, top N — excluding any the brand
   * is already connected to and any soft-deleted (username = 'deleted') agency.
   * Non-default agencies never surface here. Shape mirrors browseAgencies items.
   */
  recommendedAgencies: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), limit: z.number().min(1).max(20).default(5) }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const connected = await ctx.db
        .select({ agencyId: brandAgencyConnections.agencyId })
        .from(brandAgencyConnections)
        .where(eq(brandAgencyConnections.brandId, input.brandId));
      const connectedIds = connected.map((c) => c.agencyId);
      const filters = [eq(agencies.platformVerified, true), sql`coalesce(lower(${agencies.username}), '') <> 'deleted'`];
      if (connectedIds.length) filters.push(notInArray(agencies.id, connectedIds));
      return ctx.db
        .select({
          id: agencies.id,
          businessName: agencies.businessName,
          logoUrl: agencies.logoUrl,
          description: agencies.description,
          shortDescription: agencies.shortDescription,
          disciplines: agencies.disciplines,
          emailVerified: agencies.emailVerified,
          platformVerified: agencies.platformVerified,
          businessEmail: agencies.businessEmail,
        })
        .from(agencies)
        .where(and(...filters))
        .orderBy(sql`coalesce(${agencies.ammortizedProjectCount}, 0) desc`, agencies.businessName)
        .limit(input.limit);
    }),

  /**
   * Brand-initiated connection. Brands self-connect (no agency gatekeeping): the
   * connection is created immediately (autoAccept), threads are opened, and any
   * inverse pending request is cleared. Ports requestAgencyConnection(autoAccept:true).
   */
  requestAgencyConnection: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      // Brand-initiated connections auto-accept: establish the connection, open the
      // brand↔agency chat threads, and provision the agency's default Info Hub
      // sections — all via the shared chokepoint. No approval task is needed.
      const { connection, created } = await connectBrandToAgency(input.brandId, input.agencyId, ctx.db);
      // Clear any inverse agency-initiated request that may exist.
      await ctx.db
        .delete(brandAgencyConnectionRequests)
        .where(and(eq(brandAgencyConnectionRequests.brandId, input.brandId), eq(brandAgencyConnectionRequests.agencyId, input.agencyId)));
      // Notify the agency only for a genuinely new link (idempotent re-connects stay quiet).
      if (created && connection) await enqueueEmail('connection-request', { connectionId: connection.id });
      return connection ?? null;
    }),

  /**
   * Connected agencies for a brand WITH per-agency project stats (Purchases /
   * Active / Done) for the agencies table + details dialog. Ports the
   * brandProjectsProvider aggregation in agencies_screen.dart.
   */
  brandAgenciesWithStats: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const rows = await ctx.db
        .select({ connection: brandAgencyConnections, agency: agencies })
        .from(brandAgencyConnections)
        .innerJoin(agencies, eq(brandAgencyConnections.agencyId, agencies.id))
        .where(eq(brandAgencyConnections.brandId, input.brandId))
        .orderBy(desc(agencies.emailVerified), agencies.businessName);

      // Aggregate project counts per agency for this brand in one pass.
      const stats = await ctx.db
        .select({
          agencyId: projects.agencyId,
          total: count(),
          active: sql<number>`count(*) filter (where ${projects.status} <> 'completed')`,
          done: sql<number>`count(*) filter (where ${projects.status} = 'completed')`,
          brief: sql<number>`count(*) filter (where ${projects.status} = 'brief')`,
          allocate: sql<number>`count(*) filter (where ${projects.status} = 'allocate')`,
          production: sql<number>`count(*) filter (where ${projects.status} = 'production')`,
          approval: sql<number>`count(*) filter (where ${projects.status} = 'clientApproval')`,
        })
        .from(projects)
        .where(and(eq(projects.brandId, input.brandId), isNull(projects.deletedAt)))
        .groupBy(projects.agencyId);
      const byAgency = new Map(stats.map((s) => [s.agencyId, s]));

      return rows.map((r) => {
        const s = byAgency.get(r.agency.id);
        return {
          ...r.agency,
          connectionId: r.connection.id,
          connectedAt: r.connection.createdAt,
          stats: {
            total: Number(s?.total ?? 0),
            active: Number(s?.active ?? 0),
            done: Number(s?.done ?? 0),
            brief: Number(s?.brief ?? 0),
            allocate: Number(s?.allocate ?? 0),
            production: Number(s?.production ?? 0),
            approval: Number(s?.approval ?? 0),
          },
        };
      });
    }),

  /** Find the brand↔agency group ("all") chat thread id, for the Chat action. */
  brandAgencyThread: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const conn = (
        await ctx.db
          .select({ id: brandAgencyConnections.id })
          .from(brandAgencyConnections)
          .where(and(eq(brandAgencyConnections.brandId, input.brandId), eq(brandAgencyConnections.agencyId, input.agencyId)))
          .limit(1)
      )[0];
      return { connectionId: conn?.id ?? null };
    }),
});
