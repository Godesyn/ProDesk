import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, eq, count, desc, ne, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '../trpc/trpc.js';
import type { Context } from '../trpc/context.js';
import {
  proposals,
  proposalItems,
  proposalPhases,
  proposalDocuments,
  proposalComments,
  purchases,
  pendingPurchases,
  packages,
  agencies,
  brands,
  globalSettings,
  projects,
  userBrands,
  users,
} from '../db/schema.js';
import { createPendingPurchase, type PendingItem } from '../modules/billing/pending-purchase.js';
import { assertAgencyAccess, assertBrandAccess } from '../trpc/permissions.js';
import { recordLockerFile } from '../modules/locker/record.js';
import { verifyInviteToken, signInviteToken } from '../lib/invite-token.js';
import { generateProposalEmailHtml } from '../modules/email/proposal-html.js';
import { paginationInput, page } from '../lib/pagination.js';
import { toMoney } from '../lib/num.js';
import { enqueueEmail } from '../lib/notify.js';
import { onProposalStatusChanged } from './tasks.js';
import { SERVICE_TYPES, isBillingCycleWeekly, type ServiceType } from '../lib/service-type.js';
import { DELIVERABLE_FREQUENCIES, type DeliverableFrequency } from '../lib/deliverable-frequency.js';
import { projectNextCycleAt, projectsPerItem } from '../modules/projects/fulfillment-core.js';
import { scheduleProposalExpiry, expireProposal } from '../modules/proposals/expiry.js';
import { computePayInFull, computePaymentPlan, splitOneOffByPlan, type PaymentPlan as BillingPaymentPlan } from '../modules/billing/pricing.js';

/**
 * Attach each item's `packageName` (resolved from its packageId) so the client
 * can group a package's items under a single header — the same grouping the
 * proposal email/PDF already render. Standalone items get `packageName: null`.
 */
async function withPackageNames<T extends { packageId: string | null }>(ctx: Context, items: T[]): Promise<(T & { packageName: string | null })[]> {
  const pkgIds = [...new Set(items.map((i) => i.packageId).filter((id): id is string => !!id))];
  const rows = pkgIds.length ? await ctx.db.select({ id: packages.id, name: packages.name }).from(packages).where(inArray(packages.id, pkgIds)) : [];
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return items.map((i) => ({ ...i, packageName: i.packageId ? byId.get(i.packageId) ?? 'Package' : null }));
}

/**
 * Attach each item's source-agency name + logo (resolved from its agencyId) so a
 * sales proposal can label a partner agency's line by its real identity (logo +
 * name) instead of a generic "Partner agency" tag.
 */
async function withAgencyInfo<T extends { agencyId: string | null }>(ctx: Context, items: T[]): Promise<(T & { agencyName: string | null; agencyLogo: string | null })[]> {
  const ids = [...new Set(items.map((i) => i.agencyId).filter((id): id is string => !!id))];
  const rows = ids.length ? await ctx.db.select({ id: agencies.id, name: agencies.businessName, logo: agencies.logoUrl }).from(agencies).where(inArray(agencies.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return items.map((i) => ({ ...i, agencyName: (i.agencyId && byId.get(i.agencyId)?.name) || null, agencyLogo: (i.agencyId && byId.get(i.agencyId)?.logo) || null }));
}

/** Fire task auto-generation for a proposal status change. Best-effort; never blocks the mutation. */
async function notifyProposalStatus(ctx: Context, proposalId: string, status: string): Promise<void> {
  try {
    const p = (await ctx.db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1))[0];
    if (!p) return;
    const brand = p.brandId ? (await ctx.db.select().from(brands).where(eq(brands.id, p.brandId)).limit(1))[0] : null;
    const agency = p.agencyId ? (await ctx.db.select().from(agencies).where(eq(agencies.id, p.agencyId)).limit(1))[0] : null;
    await onProposalStatusChanged(
      {
        proposalId,
        status,
        brandOwnerId: brand?.ownerId ?? null,
        agencySenderId: p.proposalSentById ?? agency?.ownerId ?? null,
        brandName: brand?.businessName ?? null,
        agencyName: agency?.businessName ?? null,
        organizationId: p.brandId ?? null,
      },
      ctx.db,
    );
  } catch {
    /* task generation is best-effort */
  }
}

// No `paid` status: a proposal is terminal at `accepted`, which means the brand
// has paid for it. Payment state lives on the purchase, not the proposal.
const statusEnum = z.enum(['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'changeRequested']);
const itemTypeEnum = z.enum(['service', 'heading', 'custom']);

/** Mirrors `BillingService.computeSubtotals` on the Flutter side. */
function computeSubtotals(items: ProposalItemRow[], excludeBrandExcluded = false) {
  const filtered = items.filter((i) => {
    if (i.type === 'heading') return false;
    if (excludeBrandExcluded && i.isExcludedByBrand) return false;
    return true;
  });
  const oneOff = filtered
    .filter((i) => !i.isRecurring)
    .reduce((s, i) => s + Number(i.amount) * i.quantity, 0);
  const recurringUpfront = filtered
    .filter((i) => i.isRecurring)
    .reduce((s, i) => s + Number(i.upfrontFee ?? 0) * i.quantity, 0);
  const recurringWeekly = filtered
    .filter((i) => i.isRecurring)
    .reduce((s, i) => s + Number(i.amount) * i.quantity, 0);
  return { oneOffSubtotal: oneOff, recurringUpfrontTotal: recurringUpfront, recurringWeeklyTotal: recurringWeekly };
}

type ProposalItemRow = typeof proposalItems.$inferSelect;

/**
 * Rich per-item `amount` snapshot for a proposal item — the SAME shape the
 * marketplace writes via `computeLineAmount` and that Flutter's `PurchaseItem.amount`
 * carries. This is what makes a recurring proposal item turn into a Stripe
 * subscription line: `buildCheckoutLineItems` reads `amount.recurring.weeklyAfter`
 * (via `itemWeekly`) to emit the weekly price. Without it, recurring items were
 * silently skipped at checkout (they only carried `{ oneOffTotal }`).
 *
 * Recurring items IGNORE the payment plan (always setup-today + forever weekly).
 * One-off items under a plan split into a deposit-today + weekly instalments via
 * the shared {@link splitOneOffByPlan}, so a proposal under an instalment plan
 * emits the same Stripe instalment lines the marketplace does (cloud-function
 * parity — `itemsToPurchaseItems` applies `computePaymentPlan` per one-off item).
 *
 * NOTE: delivery fees are intentionally NOT folded in here so the charged total
 * stays equal to what the brand sees in the billing sidebar (its `computeSubtotals`
 * excludes delivery). TODO (BY AI): Flutter charges `upfrontDeliveryFee` /
 * `recurringDeliveryFee` as separate Stripe line items (stripe_service.ts:150-182);
 * port delivery-fee lines into the proposal/marketplace checkout and surface them
 * in the sidebar for full parity.
 */
function proposalItemAmount(it: ProposalItemRow, plan?: PaymentPlan | null) {
  const qty = Math.max(1, it.quantity || 1);
  const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
  const recurring = isBillingCycleWeekly(it.serviceType as ServiceType | null) || !!it.isRecurring;
  if (recurring) {
    return {
      recurring: { upfront: num(it.upfrontFee) * qty, weeklyAfter: num(it.amount) * qty },
      oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 },
      oneOffTotal: 0,
    };
  }
  const oneOffTotal = num(it.amount) * qty;
  return {
    recurring: { upfront: 0, weeklyAfter: 0 },
    oneOff: splitOneOffByPlan(oneOffTotal, plan),
    oneOffTotal,
  };
}

const DEFAULT_TERMS = (validityDays: number) =>
  `1. ACCEPTANCE\nThis proposal is valid for ${validityDays} days from date of issue.\n\n` +
  `2. PAYMENT TERMS\nPayment is due according to the schedule specified.\n\n` +
  `3. SCOPE OF WORK\nServices will be provided as described. Additional work beyond this scope will be quoted separately.\n\n` +
  `4. INTELLECTUAL PROPERTY\nUpon full payment, all deliverables become the property of the client.\n\n` +
  `5. CONFIDENTIALITY\nBoth parties agree to maintain confidentiality of all proprietary information.\n\n` +
  `6. CANCELLATION\nEither party may terminate with 30 days written notice.\n\n` +
  `7. LIABILITY\nOur liability is limited to the total amount paid under this proposal.`;

export const proposalsRouter = router({
  /** List proposals for an agency or a brand. Brands never see drafts. */
  list: protectedProcedure
    .input(
      paginationInput.extend({
        agencyId: z.string().uuid().optional(),
        brandId: z.string().uuid().optional(),
        status: statusEnum.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.agencyId) await assertAgencyAccess(ctx, input.agencyId, 'proposals');
      else if (input.brandId) await assertBrandAccess(ctx, input.brandId, 'proposals');
      else throw new TRPCError({ code: 'BAD_REQUEST', message: 'agencyId or brandId required' });

      const filters = [];
      if (input.agencyId) filters.push(eq(proposals.agencyId, input.agencyId));
      if (input.brandId) {
        filters.push(eq(proposals.brandId, input.brandId));
        // Brands never see drafts (mirrors watchBrandProposals whereNotIn draft).
        filters.push(ne(proposals.status, 'draft'));
      }
      if (input.status) filters.push(eq(proposals.status, input.status));
      const where = and(...filters);

      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(proposals).where(where).orderBy(desc(proposals.createdAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(proposals).where(where),
      ]);

      // Attach the per-proposal upfront + weekly totals so the list card can show
      // the same `$100 + $10 per week` summary as everywhere else, instead of the
      // stored `totalAmount` (which is only the amount due today and hides the
      // recurring weekly cost on subscription proposals).
      const ids = rows.map((r) => r.id);
      const lineItems = ids.length
        ? await ctx.db.select().from(proposalItems).where(inArray(proposalItems.proposalId, ids))
        : [];
      const itemsByProposal = new Map<string, ProposalItemRow[]>();
      for (const it of lineItems) {
        const arr = itemsByProposal.get(it.proposalId);
        if (arr) arr.push(it);
        else itemsByProposal.set(it.proposalId, [it]);
      }
      const enriched = rows.map((r) => {
        const s = computeSubtotals(itemsByProposal.get(r.id) ?? []);
        return { ...r, upfrontTotal: s.oneOffSubtotal + s.recurringUpfrontTotal, weeklyTotal: s.recurringWeeklyTotal };
      });
      return page(enriched, total, input);
    }),

  /**
   * Count of proposals awaiting the current user's action, for the Proposals nav
   * badge. Brand: received proposals not yet opened (`sent`). Agency: proposals
   * the brand sent back for changes (`changeRequested`). Both clear naturally as
   * the user acts (brand opens → `viewed`; agency revises/resends → `sent`/`draft`).
   */
  attentionCount: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid().optional(), brandId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.agencyId) {
        await assertAgencyAccess(ctx, input.agencyId, 'proposals');
        const [{ value }] = await ctx.db
          .select({ value: count() })
          .from(proposals)
          .where(and(eq(proposals.agencyId, input.agencyId), eq(proposals.status, 'changeRequested')));
        return { count: value ?? 0 };
      }
      if (input.brandId) {
        await assertBrandAccess(ctx, input.brandId, 'proposals');
        const [{ value }] = await ctx.db
          .select({ value: count() })
          .from(proposals)
          .where(and(eq(proposals.brandId, input.brandId), eq(proposals.status, 'sent')));
        return { count: value ?? 0 };
      }
      return { count: 0 };
    }),

  /** Full proposal with items, phases, documents and comments. */
  byId: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1))[0];
    if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
    const [items, phases, documents, comments] = await Promise.all([
      ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, input.id)).orderBy(proposalItems.sortOrder),
      ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, input.id)).orderBy(proposalPhases.sortOrder),
      ctx.db.select().from(proposalDocuments).where(eq(proposalDocuments.proposalId, input.id)),
      ctx.db.select().from(proposalComments).where(eq(proposalComments.proposalId, input.id)).orderBy(proposalComments.createdAt),
    ]);
    return { ...proposal, items: await withAgencyInfo(ctx, await withPackageNames(ctx, items)), phases, documents, comments };
  }),

  /**
   * Rendered proposal HTML for the "Download PDF" action — the EXACT same
   * document the client emails when a proposal is sent. Both this and the email
   * worker (jobs/worker.ts `proposal-sent`) call `generateProposalEmailHtml`, so
   * the downloaded PDF and the emailed proposal can never drift: change the
   * template once and both update. We also embed the same signed public
   * "View & Accept Proposal" link the email carries, so a PDF an agency forwards
   * to a client keeps a working accept link. The client renders this HTML in a
   * print window and the browser saves it as PDF.
   */
  pdf: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1))[0];
    if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
    let referralLink: string | undefined;
    if (proposal.brandId) {
      const brand = (await ctx.db.select().from(brands).where(eq(brands.id, proposal.brandId)).limit(1))[0];
      const recipient = (proposal.brandSnapshot?.email as string | undefined) ?? brand?.email ?? '';
      referralLink = `${ctx.clientOrigin}/public/proposal/${await signInviteToken({
        kind: 'proposal',
        email: recipient,
        proposalId: proposal.id,
        brandId: proposal.brandId,
      })}`;
    }
    const rendered = await generateProposalEmailHtml(input.id, { referralLink });
    if (!rendered) throw new TRPCError({ code: 'NOT_FOUND' });
    return { html: rendered.html, subject: rendered.subject };
  }),

  /**
   * Public, read-only proposal fetched by the signed token embedded in the
   * "View & Accept Proposal" email link. Lets a recipient — including one who
   * hasn't signed up yet — review the proposal before signing up / logging in to
   * accept (the token is the secret; no session required). Flips sent → viewed as
   * a side effect so the agency sees it was opened. `brandClaimable` tells the UI
   * whether the agency's referral brand is still unclaimed (so a brand-new signup
   * can adopt it).
   */
  publicByToken: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const invite = await verifyInviteToken(input.token);
    if (!invite || invite.kind !== 'proposal') throw new TRPCError({ code: 'NOT_FOUND', message: 'This proposal link is invalid or has expired.' });
    const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, invite.proposalId)).limit(1))[0];
    if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
    const [items, phases, documents] = await Promise.all([
      ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, proposal.id)).orderBy(proposalItems.sortOrder),
      ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, proposal.id)).orderBy(proposalPhases.sortOrder),
      ctx.db.select().from(proposalDocuments).where(eq(proposalDocuments.proposalId, proposal.id)),
    ]);
    const brand = proposal.brandId ? (await ctx.db.select().from(brands).where(eq(brands.id, proposal.brandId)).limit(1))[0] : null;
    const agency = proposal.agencyId ? (await ctx.db.select().from(agencies).where(eq(agencies.id, proposal.agencyId)).limit(1))[0] : null;
    // The referral brand is "claimable" while no real member has linked to it yet.
    const members = proposal.brandId
      ? await ctx.db.select({ userId: userBrands.userId }).from(userBrands).where(eq(userBrands.brandId, proposal.brandId))
      : [];
    // Best-effort: a public open counts as the brand viewing the proposal.
    if (proposal.status === 'sent') {
      try {
        await ctx.db.update(proposals).set({ status: 'viewed', viewedAt: new Date(), updatedAt: new Date() }).where(eq(proposals.id, proposal.id));
        proposal.status = 'viewed';
        await notifyProposalStatus(ctx, proposal.id, 'viewed');
      } catch { /* best-effort */ }
    }
    return {
      ...proposal,
      items: await withPackageNames(ctx, items),
      phases,
      documents,
      brandName: (proposal.brandSnapshot?.name as string | undefined) ?? brand?.businessName ?? null,
      brandClaimable: !!brand && members.length === 0,
      agency: agency ? { businessName: agency.businessName, logoUrl: agency.logoUrl } : null,
    };
  }),

  /**
   * Connect a tokenized proposal to a brand for the signed-in recipient, then
   * return the proposal id so the client can open it. Two modes:
   *
   *  - claim    (default) → claim the agency's referral brand (the brand the
   *               proposal was already sent to) by linking the current user and
   *               promoting them to owner. The proposal stays pointed at it.
   *  - existing → re-point the proposal at a brand the user already controls
   *               (the "which brand?" chooser / a freshly created brand).
   *
   * The signed token is the authorization to attach this proposal; matches the
   * open-link model used by staff/contractor invites (auth.redeemInvite).
   */
  connectViaToken: protectedProcedure
    .input(z.object({ token: z.string(), mode: z.enum(['claim', 'existing']).default('claim'), brandId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await verifyInviteToken(input.token);
      if (!invite || invite.kind !== 'proposal') throw new TRPCError({ code: 'BAD_REQUEST', message: 'This proposal link is invalid or has expired.' });
      const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, invite.proposalId)).limit(1))[0];
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });

      // Once a proposal has been decided, its brand is settled — don't let the
      // token be used to re-attach it to (or claim it for) a different brand.
      if (proposal.status === 'accepted' || proposal.status === 'rejected' || proposal.status === 'expired') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This proposal has already been responded to.' });
      }

      if (input.mode === 'existing') {
        if (!input.brandId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'A brand is required.' });
        await assertBrandAccess(ctx, input.brandId, 'proposals');
        const target = (await ctx.db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
        await ctx.db
          .update(proposals)
          .set({ brandId: target.id, brandSnapshot: brandSnapshot(target), updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id));
        return { proposalId: proposal.id, brandId: target.id };
      }

      // claim: adopt the agency's referral brand (proposal.brandId == invite.brandId).
      const brandId = invite.brandId;
      const brand = (await ctx.db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
      if (!brand) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
      const existing = await ctx.db.select({ userId: userBrands.userId }).from(userBrands).where(eq(userBrands.brandId, brandId));
      const isMember = existing.some((m) => m.userId === ctx.user.id);
      if (existing.length > 0 && !isMember) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This brand has already been claimed by another account.' });
      }
      if (!isMember) {
        await ctx.db.insert(userBrands).values({ userId: ctx.user.id, brandId }).onConflictDoNothing();
        await ctx.db.update(brands).set({ ownerId: ctx.user.id }).where(eq(brands.id, brandId));
        await ctx.db
          .update(users)
          .set({ selectedBrandId: brandId, ...(ctx.user.role ? {} : { role: 'brandOwner' as const }) })
          .where(eq(users.id, ctx.user.id));
      }
      // Keep the proposal pointed at the (now claimed) referral brand.
      if (proposal.brandId !== brandId) {
        await ctx.db.update(proposals).set({ brandId, updatedAt: new Date() }).where(eq(proposals.id, proposal.id));
      }
      return { proposalId: proposal.id, brandId };
    }),

  /** Payment plans + agency commission settings for the billing sidebar. */
  billingSettings: protectedProcedure.query(async ({ ctx }) => {
    const gs = (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
    return {
      defaultPaymentPlans: (gs?.defaultPaymentPlans ?? []) as PaymentPlan[],
      agencyCommission: Number(gs?.agencyCommission ?? 0),
      affiliateCommission: Number(gs?.affiliateCommission ?? 0),
      salesAgencyCommission: Number(gs?.salesAgencyCommission ?? 0),
    };
  }),

  create: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        brandId: z.string().uuid().optional(),
        title: z.string().min(1),
        validityDays: z.number().int().positive().default(30),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'proposals');
      // Snapshot agency + brand details for the eventual PDF.
      const agency = (await ctx.db.select().from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
      const brand = input.brandId
        ? (await ctx.db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1))[0]
        : undefined;

      const [created] = await ctx.db
        .insert(proposals)
        .values({
          agencyId: input.agencyId,
          brandId: input.brandId,
          title: input.title,
          status: 'draft',
          validityDays: input.validityDays,
          termsAndConditions: DEFAULT_TERMS(input.validityDays),
          proposalSentById: ctx.user.id,
          proposalSentByAgencyId: input.agencyId,
          createdBySalesAgencyId: agency?.isSalesAgency ? input.agencyId : undefined,
          agencySnapshot: agency ? agencySnapshot(agency) : undefined,
          brandSnapshot: brand ? brandSnapshot(brand) : undefined,
        })
        .returning();

      // Seed a default "Phase 1".
      await ctx.db.insert(proposalPhases).values({ proposalId: created.id, name: 'Phase 1', sortOrder: 0, startDelayDays: 0 });
      return created;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        brandId: z.string().uuid().optional(),
        termsAndConditions: z.string().optional(),
        paymentTerms: z.string().optional(),
        clientNotes: z.string().optional(),
        internalNotes: z.string().optional(),
        validityDays: z.number().int().optional(),
        // Non-billable: submitting creates projects internally instead of sending.
        isBillable: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = await loadEditable(ctx, input.id);
      const { id, brandId, ...rest } = input;

      // Re-snapshot brand if it changed.
      let brandSnap;
      if (brandId && brandId !== p.brandId) {
        const brand = (await ctx.db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
        if (brand) brandSnap = brandSnapshot(brand);
      }

      const [updated] = await ctx.db
        .update(proposals)
        .set({
          ...rest,
          ...(brandId !== undefined ? { brandId } : {}),
          ...(brandSnap ? { brandSnapshot: brandSnap } : {}),
        })
        .where(eq(proposals.id, p.id))
        .returning();
      await recomputeTotal(ctx, p.id);
      return updated;
    }),

  /* ── Phases ──────────────────────────────────────────────────────────── */

  addPhase: protectedProcedure
    .input(z.object({ id: z.string().uuid().optional(), proposalId: z.string().uuid(), name: z.string().optional(), startDelayDays: z.number().int().default(14) }))
    .mutation(async ({ ctx, input }) => {
      await loadEditable(ctx, input.proposalId);
      const existing = await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, input.proposalId));
      const [phase] = await ctx.db
        .insert(proposalPhases)
        .values({
          // Honor a client-supplied id so the optimistic phase shares the DB id (see addItem).
          ...(input.id ? { id: input.id } : {}),
          proposalId: input.proposalId,
          name: input.name ?? `Phase ${existing.length + 1}`,
          sortOrder: existing.length,
          startDelayDays: input.startDelayDays,
        })
        .returning();
      return phase;
    }),

  updatePhase: protectedProcedure
    .input(z.object({ id: z.string().uuid(), name: z.string().optional(), startDelayDays: z.number().int().optional(), sortOrder: z.number().int().optional() }))
    .mutation(async ({ ctx, input }) => {
      const phase = (await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.id, input.id)).limit(1))[0];
      if (!phase) throw new TRPCError({ code: 'NOT_FOUND' });
      await loadEditable(ctx, phase.proposalId);
      const { id, ...rest } = input;
      const [updated] = await ctx.db.update(proposalPhases).set(rest).where(eq(proposalPhases.id, id)).returning();
      return updated;
    }),

  /** Remove a phase; its items are reassigned to the first remaining phase. */
  removePhase: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const phase = (await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.id, input.id)).limit(1))[0];
    if (!phase) throw new TRPCError({ code: 'NOT_FOUND' });
    await loadEditable(ctx, phase.proposalId);
    const remaining = (await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, phase.proposalId)))
      .filter((p) => p.id !== input.id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const firstId = remaining[0]?.id ?? null;
    await ctx.db.update(proposalItems).set({ phaseId: firstId }).where(eq(proposalItems.phaseId, input.id));
    await ctx.db.delete(proposalPhases).where(eq(proposalPhases.id, input.id));
    return { id: input.id };
  }),

  /** Persist a full reorder of phases + items in one shot (flat reorder). */
  reorder: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        phases: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
        items: z.array(z.object({ id: z.string().uuid(), phaseId: z.string().uuid().nullable(), sortOrder: z.number().int() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadEditable(ctx, input.proposalId);
      await Promise.all([
        ...input.phases.map((p) => ctx.db.update(proposalPhases).set({ sortOrder: p.sortOrder }).where(eq(proposalPhases.id, p.id))),
        ...input.items.map((i) =>
          ctx.db.update(proposalItems).set({ phaseId: i.phaseId, sortOrder: i.sortOrder }).where(eq(proposalItems.id, i.id)),
        ),
      ]);
      return { ok: true };
    }),

  /* ── Items ───────────────────────────────────────────────────────────── */

  addItem: protectedProcedure
    .input(
      z.object({
        // Optional client-supplied id: the builder generates it for its optimistic
        // row so the cached item shares the eventual DB id — letting follow-up edits
        // target the row even before the refetch lands.
        id: z.string().uuid().optional(),
        proposalId: z.string().uuid(),
        phaseId: z.string().uuid().optional(),
        type: itemTypeEnum.default('service'),
        serviceId: z.string().uuid().optional(),
        packageId: z.string().uuid().optional(),
        agencyId: z.string().uuid().optional(),
        description: z.string().optional(),
        headingText: z.string().optional(),
        amount: z.number().nonnegative().default(0),
        quantity: z.number().int().positive().default(1),
        upfrontFee: z.number().nonnegative().optional(),
        upfrontDeliveryFee: z.number().nonnegative().optional(),
        recurringDeliveryFee: z.number().nonnegative().optional(),
        isRecurring: z.boolean().default(false),
        billingCycle: z.string().optional(),
        serviceType: z.enum(SERVICE_TYPES).optional(),
        deliverableFrequency: z.enum(DELIVERABLE_FREQUENCIES).optional(),
        repeatsEvery: z.number().int().optional(),
        projectDurationDays: z.number().int().optional(),
        isOptional: z.boolean().default(false),
        selectedVariantId: z.string().optional(),
        selectedOptions: z.record(z.string(), z.string()).optional(),
        selectedAddons: z.array(z.any()).optional(),
        commissions: z.record(z.string(), z.number()).optional(),
        upfrontProjectConfig: z.record(z.string(), z.any()).optional(),
        recurringProjectConfig: z.record(z.string(), z.any()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const p = await loadEditable(ctx, input.proposalId);
      const existing = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, input.proposalId));
      const { proposalId, amount, upfrontFee, upfrontDeliveryFee, recurringDeliveryFee, phaseId, ...rest } = input;

      // Default to the last phase when none specified (mirrors _addServiceToPhase).
      let resolvedPhaseId = phaseId;
      if (!resolvedPhaseId) {
        const phases = (await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, proposalId))).sort(
          (a, b) => a.sortOrder - b.sortOrder,
        );
        resolvedPhaseId = phases[phases.length - 1]?.id;
      }

      const [item] = await ctx.db
        .insert(proposalItems)
        .values({
          proposalId,
          phaseId: resolvedPhaseId,
          amount: toMoney(amount),
          upfrontFee: toMoney(upfrontFee),
          upfrontDeliveryFee: toMoney(upfrontDeliveryFee),
          recurringDeliveryFee: toMoney(recurringDeliveryFee),
          sortOrder: existing.length,
          ...rest,
        })
        .returning();
      await recomputeTotal(ctx, p.id);
      return item;
    }),

  /** Add an entire package's items (each tagged with packageId/packageName). */
  addPackage: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid(), packageId: z.string().uuid(), phaseId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const p = await loadEditable(ctx, input.proposalId);
      const pkg = (await ctx.db.select().from(packages).where(eq(packages.id, input.packageId)).limit(1))[0];
      if (!pkg) throw new TRPCError({ code: 'NOT_FOUND', message: 'Package not found' });

      const existing = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, input.proposalId));
      const phases = (await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, input.proposalId))).sort(
        (a, b) => a.sortOrder - b.sortOrder,
      );
      const phaseId = input.phaseId ?? phases[phases.length - 1]?.id;

      const pkgItems = (pkg.items ?? []) as PackageItem[];
      if (pkgItems.length === 0) return [];
      const rows = pkgItems.map((it, idx) => ({
        proposalId: input.proposalId,
        phaseId,
        type: 'service' as const,
        serviceId: it.serviceId ?? undefined,
        packageId: pkg.id,
        agencyId: pkg.agencyId,
        description: it.description ?? it.serviceName ?? pkg.name,
        amount: toMoney(Number(it.amount ?? it.price ?? 0)),
        quantity: it.quantity ?? 1,
        upfrontFee: it.upfrontFee !== undefined ? toMoney(Number(it.upfrontFee)) : undefined,
        isRecurring: it.isRecurring ?? false,
        selectedVariantId: it.selectedVariantId ?? undefined,
        sortOrder: existing.length + idx,
      }));
      const inserted = await ctx.db.insert(proposalItems).values(rows).returning();
      await recomputeTotal(ctx, p.id);
      return inserted;
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        description: z.string().optional(),
        headingText: z.string().optional(),
        amount: z.number().nonnegative().optional(),
        quantity: z.number().int().positive().optional(),
        upfrontFee: z.number().nonnegative().optional(),
        isRecurring: z.boolean().optional(),
        isOptional: z.boolean().optional(),
        phaseId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const item = (await ctx.db.select().from(proposalItems).where(eq(proposalItems.id, input.id)).limit(1))[0];
      if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
      await loadEditable(ctx, item.proposalId);
      const { id, amount, upfrontFee, ...rest } = input;
      const [updated] = await ctx.db
        .update(proposalItems)
        .set({
          ...rest,
          ...(amount !== undefined ? { amount: toMoney(amount)! } : {}),
          ...(upfrontFee !== undefined ? { upfrontFee: toMoney(upfrontFee) } : {}),
        })
        .where(eq(proposalItems.id, id))
        .returning();
      await recomputeTotal(ctx, item.proposalId);
      return updated;
    }),

  removeItem: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const item = (await ctx.db.select().from(proposalItems).where(eq(proposalItems.id, input.id)).limit(1))[0];
    if (!item) throw new TRPCError({ code: 'NOT_FOUND' });
    await loadEditable(ctx, item.proposalId);
    await ctx.db.delete(proposalItems).where(eq(proposalItems.id, input.id));
    await recomputeTotal(ctx, item.proposalId);
    return { id: input.id };
  }),

  /* ── Documents ───────────────────────────────────────────────────────── */

  addDocument: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        url: z.string().url(),
        fileName: z.string().optional(),
        fileType: z.string().optional(),
        fileSize: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadEditable(ctx, input.proposalId);
      const [doc] = await ctx.db.insert(proposalDocuments).values(input).returning();
      // Mirror into the brand's locker (Agency Documents). Only once the proposal
      // is tied to a brand + agency; drafts without a brand are skipped.
      if (proposal.brandId && proposal.agencyId) {
        await recordLockerFile(ctx.db, {
          brandId: proposal.brandId,
          url: input.url,
          name: input.fileName ?? proposal.title ?? 'Proposal document',
          agencyId: proposal.agencyId,
          uploadedBy: ctx.user.id,
          size: input.fileSize ?? null,
          type: input.fileType ?? null,
          category: 'proposal',
          source: 'agency',
          note: `Proposal document${proposal.title ? ` from “${proposal.title}”` : ''}`,
          sourceType: 'proposalDoc',
          sourceId: doc.id,
        }).catch((e) => console.error('[proposals] locker copy failed', (e as Error).message));
      }
      return doc;
    }),

  removeDocument: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const doc = (await ctx.db.select().from(proposalDocuments).where(eq(proposalDocuments.id, input.id)).limit(1))[0];
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
    await loadEditable(ctx, doc.proposalId);
    await ctx.db.delete(proposalDocuments).where(eq(proposalDocuments.id, input.id));
    return { id: input.id };
  }),

  /* ── Comments ────────────────────────────────────────────────────────── */

  addComment: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid(), message: z.string().min(1), authorRole: z.enum(['brand', 'agency', 'sales']) }))
    .mutation(async ({ ctx, input }) => {
      const [comment] = await ctx.db
        .insert(proposalComments)
        .values({
          proposalId: input.proposalId,
          message: input.message,
          authorRole: input.authorRole,
          authorId: ctx.user.id,
          authorName: [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(' ') || ctx.user.email,
        })
        .returning();
      return comment;
    }),

  /* ── Lifecycle ───────────────────────────────────────────────────────── */

  /** Send a draft proposal to the client. Requires a brand + ≥1 non-heading item. */
  send: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const p = await loadEditable(ctx, input.id);
    if (!p.brandId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select a client before sending' });
    const items = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, p.id));
    if (items.filter((i) => i.type !== 'heading').length === 0) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one item before sending' });
    }
    await recomputeTotal(ctx, p.id);
    const validityDays = p.validityDays ?? 30;
    const [updated] = await ctx.db
      .update(proposals)
      .set({
        status: 'sent',
        sentAt: new Date(),
        changeRequestNote: null,
        expiresAt: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000),
      })
      .where(eq(proposals.id, p.id))
      .returning();
    await enqueueEmail('proposal-sent', { proposalId: p.id, origin: ctx.clientOrigin });
    await scheduleProposalExpiry(p.id, updated.expiresAt);
    await notifyProposalStatus(ctx, p.id, 'sent');
    return updated;
  }),

  /**
   * Submit a NON-BILLABLE proposal: instead of sending to a client, create the
   * projects internally (one per non-heading item) and mark the proposal
   * `internal`. Ports create_proposal_save_actions.dart's "Create Projects" path
   * (ProposalStatus.internal / isBillable=false). Projects are agency-internal:
   * seeded at `brief` (cloud-fn parity: on_internal_purchase_written seeds
   * `Brief`) — the agency completes the brief, moves the card to Allocate,
   * assigns + budgets a contractor, then pays at Allocate → Production. Mirrors
   * the complimentary single-item flow (projects.createInternalProject).
   */
  submitInternal: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const p = await loadEditable(ctx, input.id);
    const items = (await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, p.id)))
      .filter((i) => i.type !== 'heading');
    if (items.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one item before creating projects' });
    await recomputeTotal(ctx, p.id);

    // One internal purchase covers all the proposal's items (written PAID — there
    // is no client charge; the agency pays contractors at Allocate → Production).
    const [purchase] = await ctx.db
      .insert(purchases)
      .values({
        brandId: p.brandId ?? null,
        userId: ctx.user.id,
        type: 'proposal',
        status: 'completed',
        isInternal: true,
        viewableToBrand: !!p.brandId,
        proposalId: p.id,
        totalAmount: p.totalAmount,
        paidAt: new Date(),
        completedAt: new Date(),
      })
      .returning();

    const nowMs = Date.now();
    let i = 0;
    for (const it of items) {
      const isWeekly = isBillingCycleWeekly(it.serviceType as ServiceType | null);
      const upfrontCfg = (it.upfrontProjectConfig ?? {}) as { contractorDefaultBudget?: number };
      const recurringCfg = (it.recurringProjectConfig ?? {}) as { contractorDefaultBudget?: number };
      const budget = (isWeekly ? recurringCfg.contractorDefaultBudget : upfrontCfg.contractorDefaultBudget) ?? upfrontCfg.contractorDefaultBudget ?? 0;
      // One project per unit of quantity (on_internal_proposal_written parity).
      const count = projectsPerItem('internal', it.quantity);
      for (let q = 0; q < count; q++) {
        const t = new Date(nowMs + i * 1000);
        i++;
        await ctx.db.insert(projects).values({
          purchaseId: purchase.id,
          agencyId: it.agencyId ?? p.agencyId,
          brandId: p.brandId ?? null,
          serviceId: it.serviceId,
          serviceName: it.description ?? 'Service',
          serviceType: it.serviceType,
          packageId: it.packageId,
          title: it.description ?? 'Service',
          description: it.description,
          // Internal work starts in Brief like every other project; the agency
          // completes the brief, allocates a contractor, then pays at Allocate.
          status: 'brief',
          isInternal: true,
          viewableToBrand: !!p.brandId,
          deliverableFrequency: it.deliverableFrequency,
          repeatsEvery: it.repeatsEvery,
          selectedVariantId: it.selectedVariantId,
          selectedOptions: it.selectedOptions,
          selectedAddons: it.selectedAddons,
          // Freeze config + budget + cycle so internal recurring projects re-cycle
          // (no Stripe sub — agency re-pays each cycle) and carry their config.
          commissions: it.commissions,
          upfrontProjectConfig: it.upfrontProjectConfig,
          recurringProjectConfig: it.recurringProjectConfig,
          upfrontDeliveryFee: it.upfrontDeliveryFee,
          recurringDeliveryFee: it.recurringDeliveryFee,
          contractorBudget: budget > 0 ? Number(budget).toFixed(2) : null,
          cycleCount: 1,
          nextCycleAt: projectNextCycleAt({
            type: it.serviceType as ServiceType | null,
            deliverableFrequency: it.deliverableFrequency as DeliverableFrequency | null,
            repeatsEvery: it.repeatsEvery,
            from: t,
          }),
          createdAt: t,
          updatedAt: t,
        });
      }
    }

    const [updated] = await ctx.db
      .update(proposals)
      .set({ status: 'internal', isBillable: false, decidedAt: new Date() })
      .where(eq(proposals.id, p.id))
      .returning();
    await notifyProposalStatus(ctx, p.id, 'internal');
    return updated;
  }),

  /** Edit-and-resend a change-requested proposal: clears note + brand flags, re-sends. */
  resend: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const p = await loadEditable(ctx, input.id);
    if (!p.brandId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select a client before sending' });
    // Clear brand negotiation flags so the brand starts fresh.
    await ctx.db
      .update(proposalItems)
      .set({ isExcludedByBrand: false, removalProposedByBrand: false })
      .where(eq(proposalItems.proposalId, p.id));
    await recomputeTotal(ctx, p.id);
    const validityDays = p.validityDays ?? 30;
    const [updated] = await ctx.db
      .update(proposals)
      .set({
        status: 'sent',
        sentAt: new Date(),
        changeRequestNote: null,
        expiresAt: new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000),
      })
      .where(eq(proposals.id, p.id))
      .returning();
    await enqueueEmail('proposal-sent', { proposalId: p.id, origin: ctx.clientOrigin });
    await scheduleProposalExpiry(p.id, updated.expiresAt);
    await notifyProposalStatus(ctx, p.id, 'sent');
    return updated;
  }),

  /** Brand opening a sent proposal marks it viewed. */
  markViewed: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1))[0];
    if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
    if (proposal.brandId) await assertBrandAccess(ctx, proposal.brandId, 'proposals');
    if (proposal.status !== 'sent') return proposal; // only sent → viewed
    const [updated] = await ctx.db
      .update(proposals)
      .set({ status: 'viewed', viewedAt: new Date() })
      .where(eq(proposals.id, input.id))
      .returning();
    await notifyProposalStatus(ctx, input.id, 'viewed');
    return updated;
  }),

  /**
   * Brand response to a sent/viewed proposal.
   * - reject.
   * - requestChange: persists per-item removal proposals + a change-request note + a brand comment.
   *
   * Acceptance is NOT handled here: the brand "accepts" by proceeding to
   * checkout (`convertToPurchase`), and the proposal only flips to `accepted`
   * once payment succeeds (see `fulfillPurchase`).
   */
  respond: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        action: z.enum(['reject', 'requestChange']),
        note: z.string().optional(),
        /** Item ids the brand proposed removing (non-optional items). */
        removalProposedItemIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1))[0];
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.brandId) await assertBrandAccess(ctx, proposal.brandId, 'proposals');

      // A proposal can only be acted on while it's still open (mirrors the Flutter
      // BrandActions gate, which only renders decline/request-changes for
      // sent/viewed). Without this guard a recipient could re-point a tokenized
      // proposal at a different brand via connectViaToken and respond again.
      if (proposal.status !== 'sent' && proposal.status !== 'viewed') {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This proposal has already been responded to and can no longer be changed.',
        });
      }

      const proposedRemoval = new Set(input.removalProposedItemIds ?? []);
      const items = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, input.id));

      if (input.action === 'reject') {
        const [updated] = await ctx.db
          .update(proposals)
          .set({ status: 'rejected', decidedAt: new Date() })
          .where(eq(proposals.id, input.id))
          .returning();
        await enqueueEmail('proposal-rejected', { proposalId: input.id });
        await notifyProposalStatus(ctx, input.id, 'rejected');
        return updated;
      }

      // requestChange: persist removal proposals + the change-request note + a brand comment.
      await Promise.all(
        items.map((it) =>
          ctx.db
            .update(proposalItems)
            .set({ removalProposedByBrand: proposedRemoval.has(it.id) })
            .where(eq(proposalItems.id, it.id)),
        ),
      );
      const [updated] = await ctx.db
        .update(proposals)
        .set({ status: 'changeRequested', decidedAt: new Date(), changeRequestNote: input.note })
        .where(eq(proposals.id, input.id))
        .returning();
      if (input.note?.trim()) {
        await ctx.db.insert(proposalComments).values({
          proposalId: input.id,
          message: input.note,
          authorRole: 'brand',
          authorId: ctx.user.id,
          authorName: [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(' ') || ctx.user.email,
        });
      }
      await enqueueEmail('proposal-change-requested', { proposalId: input.id });
      await notifyProposalStatus(ctx, input.id, 'changeRequested');
      return updated;
    }),

  /** Duplicate a proposal (and its phases/items) as a fresh draft. */
  duplicate: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const source = await loadEditable(ctx, input.id);
    const [copy] = await ctx.db
      .insert(proposals)
      .values({
        agencyId: source.agencyId,
        brandId: source.brandId,
        title: `${source.title ?? 'Untitled'} (Copy)`,
        description: source.description,
        status: 'draft',
        validityDays: source.validityDays,
        termsAndConditions: source.termsAndConditions,
        paymentTerms: source.paymentTerms,
        clientNotes: source.clientNotes,
        internalNotes: source.internalNotes,
        agencySnapshot: source.agencySnapshot,
        brandSnapshot: source.brandSnapshot,
        proposalSentById: ctx.user.id,
        proposalSentByAgencyId: source.agencyId,
      })
      .returning();

    const phases = await ctx.db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, source.id));
    const phaseIdMap = new Map<string, string>();
    for (const ph of phases.sort((a, b) => a.sortOrder - b.sortOrder)) {
      const [np] = await ctx.db
        .insert(proposalPhases)
        .values({ proposalId: copy.id, name: ph.name, sortOrder: ph.sortOrder, startDelayDays: ph.startDelayDays })
        .returning();
      phaseIdMap.set(ph.id, np.id);
    }
    const items = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, source.id));
    if (items.length) {
      await ctx.db.insert(proposalItems).values(
        items.map((it) => ({
          proposalId: copy.id,
          phaseId: it.phaseId ? phaseIdMap.get(it.phaseId) ?? null : null,
          type: it.type,
          serviceId: it.serviceId,
          packageId: it.packageId,
          agencyId: it.agencyId,
          description: it.description,
          headingText: it.headingText,
          amount: it.amount,
          quantity: it.quantity,
          upfrontFee: it.upfrontFee,
          upfrontDeliveryFee: it.upfrontDeliveryFee,
          recurringDeliveryFee: it.recurringDeliveryFee,
          isRecurring: it.isRecurring,
          billingCycle: it.billingCycle,
          serviceType: it.serviceType,
          deliverableFrequency: it.deliverableFrequency,
          repeatsEvery: it.repeatsEvery,
          projectDurationDays: it.projectDurationDays,
          isOptional: it.isOptional,
          isExcludedByBrand: false,
          removalProposedByBrand: false,
          selectedVariantId: it.selectedVariantId,
          selectedOptions: it.selectedOptions,
          selectedAddons: it.selectedAddons,
          commissions: it.commissions,
          upfrontProjectConfig: it.upfrontProjectConfig,
          recurringProjectConfig: it.recurringProjectConfig,
          sortOrder: it.sortOrder,
        })),
      );
    }
    await recomputeTotal(ctx, copy.id);
    return copy;
  }),

  /** Delete a draft proposal. */
  delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const p = await loadEditable(ctx, input.id);
    await ctx.db.delete(proposals).where(eq(proposals.id, p.id));
    return { id: p.id };
  }),

  /**
   * Brand "accept" → checkout: turn a proposal into a pending purchase (copying
   * line items, skipping brand-excluded ones) and hand it to the purchases flow
   * for payment. The proposal itself only flips to `accepted` once payment
   * succeeds (see `fulfillPurchase`), so accepting just means "proceed to pay".
   *
   * Idempotent for the brand: any still-unpaid purchase already spawned from this
   * proposal is discarded and rebuilt, so re-clicking Accept (e.g. after
   * abandoning checkout, or after changing optional-item selections) never leaves
   * orphaned pending purchases behind.
   */
  convertToPurchase: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        selectedPaymentPlan: z.any().optional(),
        /** Optional items the brand toggled off before paying. */
        excludedItemIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1))[0];
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      // Marketplace-only: payer (EziQuotes) proposals carry no proposal_items and
      // are fulfilled via trpc.payments.proposals.convertToOrder (WS6), not this
      // marketplace checkout path.
      if (proposal.kind === 'payer') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payer proposals convert via the payments order flow, not marketplace checkout.' });
      }
      if (proposal.brandId) await assertBrandAccess(ctx, proposal.brandId);

      // Lapse a past-due proposal before deciding (also fires if its expiry job
      // was lost), then gate. Only an open proposal can be paid; `accepted`
      // already means paid (set on payment) so re-converting risks a double charge.
      if (await expireProposal(proposal.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This proposal has expired.' });
      }
      if (proposal.status !== 'sent' && proposal.status !== 'viewed') {
        throw new TRPCError({ code: 'CONFLICT', message: 'This proposal is no longer available for payment.' });
      }

      // Persist the brand's optional-item exclusions before building the purchase.
      if (input.excludedItemIds) {
        const excluded = new Set(input.excludedItemIds);
        const all = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, input.id));
        await Promise.all(
          all
            .filter((it) => it.isOptional)
            .map((it) =>
              ctx.db.update(proposalItems).set({ isExcludedByBrand: excluded.has(it.id) }).where(eq(proposalItems.id, it.id)),
            ),
        );
      }

      // Build the payable amounts from the KEPT items (excluding brand-excluded
      // ones), applying any selected instalment plan.
      // Each item gets a RICH `amount` snapshot (one-off vs recurring split) — the
      // same shape the marketplace writes via `computeLineAmount` — so recurring
      // items become Stripe subscription lines at checkout. Previously items only
      // carried `{ oneOffTotal }`, so `itemWeekly` read 0 and every recurring
      // (subscription) line was silently dropped from checkout.
      const allItems = await ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, input.id));
      const items = allItems.filter((i) => !i.isExcludedByBrand);
      const billable = items.filter((i) => i.type !== 'heading');

      const plan = (input.selectedPaymentPlan ?? proposal.selectedPaymentPlan) as PaymentPlan | null | undefined;

      // Phase start delays defer ONLY the recurring weekly retainer of a delayed
      // phase — it begins automatically when the phase activates (the project sits
      // `upcoming` until then, when addSubscriptionItemForProject opens its weekly
      // billing). Everything one-time (one-off prices, recurring setup fees, and any
      // one-off payment-plan instalments) is charged at checkout immediately, even
      // for a delayed phase. buildCheckoutLineItems mirrors this exact split so the
      // stored totals always equal what Stripe charges.
      const phases = await ctx.db
        .select()
        .from(proposalPhases)
        .where(eq(proposalPhases.proposalId, input.id));
      const delayByPhase = new Map(phases.map((p) => [p.id, p.startDelayDays ?? 0]));
      const isDelayedPhaseItem = (it: (typeof billable)[number]) =>
        !!it.phaseId && (delayByPhase.get(it.phaseId) ?? 0) > 0;
      // Items whose recurring weekly is collected at checkout (i.e. not deferred).
      const weeklyStartsNow = billable.filter((it) => !isDelayedPhaseItem(it));

      // Per-item amounts are the SOURCE OF TRUTH for the Stripe lines: one-off items
      // under a plan are split here into a deposit + weekly instalments (recurring
      // items ignore the plan). Derive the purchase totals by summing them so the
      // stored figures and the Stripe lines can't drift (matches the marketplace path).
      const itemAmounts = new Map(items.map((it) => [it.id, proposalItemAmount(it, plan)] as const));
      const sumItems = (
        rows: typeof billable,
        f: (a: ReturnType<typeof proposalItemAmount>) => number,
      ) => rows.reduce((s, it) => s + f(itemAmounts.get(it.id)!), 0);
      // Subtotals describe the FULL proposal value (all phases) and drive the plan
      // label; the charged figures below count only what's billed at checkout.
      const subtotals = {
        oneOffSubtotal: sumItems(billable, (a) => a.oneOffTotal),
        recurringUpfrontTotal: sumItems(billable, (a) => a.recurring.upfront),
        recurringWeeklyTotal: sumItems(billable, (a) => a.recurring.weeklyAfter),
      };
      // Due today = every upfront (one-off price + recurring setup), all phases.
      const dueToday = sumItems(billable, (a) => a.oneOff.upfront + a.recurring.upfront);
      // Weekly billed from checkout = one-off instalments (all phases) + the forever
      // retainer of phases that start now. A delayed retainer is added at activation.
      const weekly =
        sumItems(billable, (a) => a.oneOff.weeklyAfter) +
        sumItems(weeklyStartsNow, (a) => a.recurring.weeklyAfter);
      const planLabel = plan
        ? computePaymentPlan(subtotals, {
            name: plan.name ?? 'Plan',
            upfrontPercentage: plan.upfrontPercentage ?? 0,
            interestRate: plan.interestRate ?? 0,
            durationWeeks: plan.durationWeeks ?? 0,
          } satisfies BillingPaymentPlan).planLabel
        : computePayInFull(subtotals).planLabel;

      // Persist the true payable total so the proposal header/email and the
      // purchase agree on what is charged today (now incl. recurring setup fees).
      await ctx.db.update(proposals).set({ totalAmount: dueToday.toFixed(2), updatedAt: new Date() }).where(eq(proposals.id, input.id));

      // Discard any still-unpaid pending purchase previously spawned from this
      // proposal so a fresh, correctly-totalled one is created. Pending purchases
      // are matched by the proposalId stamped in their snapshot blob.
      await ctx.db.delete(pendingPurchases).where(sql`${pendingPurchases.data} -> 'purchase' ->> 'proposalId' = ${input.id}`);

      // Snapshot platform commission rates at purchase time (mirrors the
      // marketplace `checkoutServices` path) so payout generation has a frozen
      // record and a later rate change can't retroactively alter this order.
      const settings = (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];

      const purchaseValues = {
        brandId: proposal.brandId,
        userId: ctx.user.id,
        type: 'proposal' as const,
        status: 'pendingPayment' as const,
        proposalId: proposal.id,
        proposalSentById: proposal.proposalSentById,
        proposalSentByAgencyId: proposal.proposalSentByAgencyId,
        totalAmount: dueToday.toFixed(2),
        agencyCommission: settings?.agencyCommission ?? null,
        affiliateCommission: settings?.affiliateCommission ?? null,
        prodeskCommission: settings?.prodeskCommission ?? null,
        salesAgencyCommission: settings?.salesAgencyCommission ?? null,
        // Carry the chosen plan; fall back to the one persisted on the
        // proposal so a page refresh before "Proceed to payment" doesn't
        // silently drop the brand's instalment selection.
        selectedPaymentPlan: plan ?? undefined,
        // Mirror the marketplace purchase `amount` so `checkoutPurchase` reads the
        // weekly figure and the UI can show the one-off/recurring split.
        amount: {
          oneOffSubtotal: subtotals.oneOffSubtotal,
          recurringUpfrontTotal: subtotals.recurringUpfrontTotal,
          recurringWeeklyTotal: subtotals.recurringWeeklyTotal,
          dueToday,
          weekly,
          planLabel,
        },
      };

      // Phase start delays → frozen onto each item so fulfillment can start a
      // delayed phase `upcoming` and defer its billing (purchase_fulfillment parity).
      // `delayByPhase` was built above when excluding delayed phases from `dueToday`.
      const itemValues: PendingItem[] = items.map((it) => {
        const amt = itemAmounts.get(it.id)!;
        // One-time money collected at checkout = cycle-1 commission basis:
        // one-off price + recurring setup/upfront. The recurring weekly is
        // EXCLUDED — it's billed and split per cycle (generateCyclePayouts on
        // each weekly invoice), so including it here would double-count it.
        const lineTotal = amt.oneOffTotal + amt.recurring.upfront;
        return {
          // Minted here (not at DB insert) — embedded into Stripe product
          // metadata, so it must match the row created on promotion.
          id: randomUUID(),
          serviceId: it.serviceId,
              packageId: it.packageId,
              agencyId: it.agencyId ?? proposal.agencyId,
              proposalItemId: it.id,
              serviceName: it.description,
              serviceType: it.serviceType,
              description: it.description,
              headingText: it.headingText,
              lineTotal: lineTotal.toFixed(2),
              // Rich one-off/recurring split — `itemWeekly` reads `recurring.weeklyAfter`
              // to emit the Stripe weekly subscription line (see subscription.ts).
              amount: amt as Record<string, unknown>,
              quantity: it.quantity,
              projectDurationDays: it.projectDurationDays,
              deliverableFrequency: it.deliverableFrequency,
              repeatsEvery: it.repeatsEvery,
              isRecurring: it.isRecurring,
              isOptional: it.isOptional,
              isExcludedByBrand: it.isExcludedByBrand,
              selectedVariantId: it.selectedVariantId,
              selectedOptions: it.selectedOptions,
              selectedAddons: it.selectedAddons,
              // ── Frozen snapshot (purchase_fulfillment parity) ──
              commissions: it.commissions,
              upfrontProjectConfig: it.upfrontProjectConfig,
              recurringProjectConfig: it.recurringProjectConfig,
              upfrontDeliveryFee: it.upfrontDeliveryFee,
              recurringDeliveryFee: it.recurringDeliveryFee,
              phaseId: it.phaseId,
              startDelayDays: it.phaseId ? (delayByPhase.get(it.phaseId) ?? null) : null,
              sortOrder: it.sortOrder,
            };
          });

      // Written to `pending_purchases`; promoted into `purchases` on payment.
      const { id } = await createPendingPurchase(ctx.db, purchaseValues, itemValues);
      return { id, ...purchaseValues };
    }),

  /**
   * Persist the selected payment plan onto the proposal so the brand's
   * instalment choice in the billing sidebar survives navigation/refresh and is
   * carried into `convertToPurchase`. Pass `null` for Pay-in-Full. Either the
   * brand (reviewing) or the sending agency (building) may set it.
   */
  setPaymentPlan: protectedProcedure
    .input(z.object({ id: z.string().uuid(), selectedPaymentPlan: z.any().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, input.id)).limit(1))[0];
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      // Allow the brand side first; fall back to the sending agency.
      let ok = false;
      if (proposal.brandId) {
        try {
          await assertBrandAccess(ctx, proposal.brandId);
          ok = true;
        } catch {
          /* not the brand — try the agency below */
        }
      }
      if (!ok) {
        if (!proposal.agencyId) throw new TRPCError({ code: 'FORBIDDEN' });
        await assertAgencyAccess(ctx, proposal.agencyId, 'proposals');
      }
      await ctx.db
        .update(proposals)
        .set({ selectedPaymentPlan: input.selectedPaymentPlan ?? null, updatedAt: new Date() })
        .where(eq(proposals.id, input.id));
      return { ok: true };
    }),
});

/* ── helpers ─────────────────────────────────────────────────────────────── */

type PaymentPlan = { name?: string; upfrontPercentage?: number; interestRate?: number; durationWeeks?: number; isActive?: boolean };
type PackageItem = {
  serviceId?: string;
  serviceName?: string;
  description?: string;
  amount?: number;
  price?: number;
  quantity?: number;
  upfrontFee?: number;
  isRecurring?: boolean;
  selectedVariantId?: string;
};

function agencySnapshot(a: typeof agencies.$inferSelect): Record<string, unknown> {
  return {
    name: a.businessName,
    email: a.businessEmail,
    phone: a.phone,
    address: a.address,
    logo: a.logoUrl,
  };
}

function brandSnapshot(b: typeof brands.$inferSelect): Record<string, unknown> {
  return { name: b.businessName, email: b.email, phone: b.phone, address: b.address };
}

/** Load a proposal and assert the caller can edit it (agency-side). */
async function loadEditable(ctx: Context, id: string) {
  const proposal = (await ctx.db.select().from(proposals).where(eq(proposals.id, id)).limit(1))[0];
  if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
  if (proposal.agencyId) await assertAgencyAccess(ctx, proposal.agencyId, 'proposals');
  return proposal;
}

/** Recompute totalAmount: subtotal of non-heading, non-excluded items. */
async function recomputeTotal(ctx: Context, proposalId: string) {
  const [proposal, items] = await Promise.all([
    ctx.db.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1).then((r) => r[0]),
    ctx.db.select().from(proposalItems).where(eq(proposalItems.proposalId, proposalId)),
  ]);
  if (!proposal) return;
  const subs = computeSubtotals(items, false);
  // Keep agencyIds in sync with the per-item agencies (inter-agency/sales
  // proposals span multiple agencies; createdBySalesAgencyId marks the seller).
  const agencyIds = [...new Set(items.map((i) => i.agencyId).filter(Boolean))] as string[];
  await ctx.db
    .update(proposals)
    .set({ totalAmount: subs.oneOffSubtotal.toFixed(2), agencyIds: agencyIds.length ? agencyIds : null })
    .where(eq(proposals.id, proposalId));
}

/**
 * Generate INV-{year}-{0001} — a per-agency sequential number, mirroring the
 * Flutter `generateInvoiceNumber(agencyId)` (counts the agency's proposals + 1).
 * Exported so payment fulfillment can stamp the invoice number when a proposal
 * is accepted-on-payment.
 */
export async function generateInvoiceNumber(db: Context['db'], agencyId: string | null): Promise<string> {
  const year = new Date().getFullYear();
  const where = agencyId ? eq(proposals.agencyId, agencyId) : undefined;
  const [{ value }] = await db.select({ value: count() }).from(proposals).where(where);
  const seq = (Number(value) + 1).toString().padStart(4, '0');
  return `INV-${year}-${seq}`;
}
