import { z } from 'zod';
import { and, eq, isNull, asc, max } from 'drizzle-orm';
import { router, publicProcedure, protectedProcedure } from '../trpc/trpc.js';
import { services, serviceHeadings } from '../db/schema.js';
import { assertAgencyAccess } from '../trpc/permissions.js';
import { countBrandServices, listBrandServices } from '../modules/services/queries.js';
import { paginationInput, page } from '../lib/pagination.js';
import { SERVICE_TYPES, isBillingCycleWeekly } from '../lib/service-type.js';
import { DELIVERABLE_FREQUENCIES } from '../lib/deliverable-frequency.js';

const serviceTypeEnum = z.enum(SERVICE_TYPES);
const deliverableFrequencyEnum = z.enum(DELIVERABLE_FREQUENCIES);

// Rich sub-structures stored as jsonb. Kept loose (passthrough) so the editor can
// evolve field-by-field without a schema change — mirrors the Flutter models.
// ServiceVariant: a generated option-combination with per-variant price diffs.
// Mirrors the Flutter model (service_variant.dart): { id, options, *Difference }
// — there is NO `name` field (the combo is described by `options`).
const variant = z.object({
  id: z.string(),
  options: z.record(z.string(), z.string()).optional(),
  oneOffUpfrontDifference: z.number().optional(),
  recurringUpfrontDifference: z.number().optional(),
  recurringWeeklyDifference: z.number().optional(),
}).passthrough();
const option = z.object({ id: z.string(), name: z.string(), choices: z.array(z.any()).optional(), isRequired: z.boolean().optional() }).passthrough();
const addon = z.object({ id: z.string(), name: z.string(), price: z.number().optional(), description: z.string().optional() }).passthrough();
// ServiceStaff: { userId, name, commission?, meetingDurationMinutes?, googleCalendarLinked? }
const assignedStaff = z.object({ userId: z.string(), name: z.string().optional() }).passthrough();
const customField = z.object({ id: z.string(), label: z.string(), type: z.string() }).passthrough();

const upsertInput = z.object({
  name: z.string().min(1),
  // Short description shown in catalog/marketplace listings — required on
  // create (the partial() update schema relaxes it back to optional).
  description: z.string().min(1, 'Short description is required'),
  type: serviceTypeEnum.default('oneOffService'),
  price: z.number().nonnegative().optional(),
  upfrontFee: z.number().nonnegative().optional(),
  recurringFee: z.number().nonnegative().optional(),
  upfrontDeliveryFee: z.number().nonnegative().optional(),
  recurringDeliveryFee: z.number().nonnegative().optional(),
  disciplines: z.array(z.string()).optional(),
  imageUrl: z.string().url().optional(),
  imagePath: z.string().optional(),
  // Cover aspect ratio (w/h), measured client-side at upload (Flutter parity).
  imageAspectRatio: z.number().positive().optional(),
  videoUrl: z.string().url().optional(),
  videoPath: z.string().optional(),
  isActive: z.boolean().default(true),
  allowBuyNow: z.boolean().default(true),
  allowBookMeeting: z.boolean().default(false),
  allowSalesProposal: z.boolean().default(true),
  // Infin8 stage/substage grouping.
  stage: z.string().optional(),
  subStage: z.string().optional(),
  // Recurring config.
  deliverableFrequency: deliverableFrequencyEnum.optional(),
  repeatsEvery: z.number().int().positive().optional(),
  // Digital product.
  digitalProductFileUrl: z.string().optional(),
  digitalProductFileName: z.string().optional(),
  // Rich editor jsonb collections.
  variants: z.array(variant).optional(),
  options: z.array(option).optional(),
  addons: z.array(addon).optional(),
  assignedStaff: z.array(assignedStaff).optional(),
  customFields: z.array(customField).optional(),
  upfrontProjectConfig: z.any().optional(),
  recurringProjectConfig: z.any().optional(),
  // Commissions.
  salesPersonCommissions: z.record(z.string(), z.number()).optional(),
  productionManagerCommission: z.number().nonnegative().optional(),
  briefingManagerCommission: z.number().nonnegative().optional(),
  internalApprovalCommission: z.number().nonnegative().optional(),
  sortOrder: z.number().int().optional(),
});

// numeric/pct columns round-trip as strings in drizzle; coerce at the boundary.
const num = (v: number | undefined) => (v === undefined ? undefined : String(v));

/** Translate the typed input into a drizzle insert/update payload (money→string). */
function toRow(input: z.infer<typeof upsertInput>) {
  const { price, upfrontFee, recurringFee, upfrontDeliveryFee, recurringDeliveryFee, productionManagerCommission, briefingManagerCommission, internalApprovalCommission, ...rest } = input;
  return {
    ...rest,
    price: num(price),
    upfrontFee: num(upfrontFee),
    recurringFee: num(recurringFee),
    upfrontDeliveryFee: num(upfrontDeliveryFee),
    recurringDeliveryFee: num(recurringDeliveryFee),
    productionManagerCommission: num(productionManagerCommission),
    briefingManagerCommission: num(briefingManagerCommission),
    internalApprovalCommission: num(internalApprovalCommission),
  };
}

export const servicesRouter = router({
  /** Paginated catalog for an agency (brands see live only). */
  list: publicProcedure
    // Catalog views load the agency's whole list, so allow a larger ceiling than the shared default.
    .input(paginationInput.extend({ limit: z.number().int().min(1).max(500).default(20), agencyId: z.string().uuid(), includeInactive: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      // Shared catalog query core (also backs the AI list_brand_services tool).
      const opts = { search: input.search, includeInactive: input.includeInactive };
      const [rows, total] = await Promise.all([
        listBrandServices(ctx.db, input.agencyId, { ...opts, limit: input.limit, offset: input.offset }),
        countBrandServices(ctx.db, input.agencyId, opts),
      ]);
      return page(rows, total, input);
    }),

  byId: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return (await ctx.db.select().from(services).where(eq(services.id, input.id)).limit(1))[0] ?? null;
  }),

  create: protectedProcedure
    // Price is mandatory on create: recurring-billed types need a recurring fee,
    // everything else a one-time price. (Update is partial, so it stays optional.)
    .input(
      upsertInput.extend({ agencyId: z.string().uuid() }).superRefine((v, ctx) => {
        const ok = isBillingCycleWeekly(v.type) ? (v.recurringFee ?? 0) > 0 : (v.price ?? 0) > 0;
        if (!ok) {
          ctx.addIssue({
            code: 'custom',
            message: isBillingCycleWeekly(v.type) ? 'Recurring fee is required.' : 'Price is required.',
            path: [isBillingCycleWeekly(v.type) ? 'recurringFee' : 'price'],
          });
        }
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'catalog');
      const { agencyId, ...service } = input;
      const [created] = await ctx.db.insert(services).values({ agencyId, ...toRow(service) }).returning();
      return created;
    }),

  update: protectedProcedure
    .input(upsertInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (await ctx.db.select().from(services).where(eq(services.id, input.id)).limit(1))[0];
      if (!existing) throw new Error('Service not found');
      await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
      const { id, ...service } = input;
      const [updated] = await ctx.db.update(services).set(toRow(service as z.infer<typeof upsertInput>)).where(eq(services.id, id)).returning();
      return updated;
    }),

  /** Toggle active/inactive (catalog isActive toggle / un-archive). */
  setActive: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (await ctx.db.select().from(services).where(eq(services.id, input.id)).limit(1))[0];
      if (!existing) throw new Error('Service not found');
      await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
      const [updated] = await ctx.db.update(services).set({ isActive: input.isActive }).where(eq(services.id, input.id)).returning();
      return updated;
    }),

  /** Soft delete. */
  archive: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const existing = (await ctx.db.select().from(services).where(eq(services.id, input.id)).limit(1))[0];
    if (!existing) throw new Error('Service not found');
    await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
    await ctx.db.update(services).set({ deletedAt: new Date() }).where(eq(services.id, input.id));
    return { id: input.id };
  }),

  /* ── Catalog section headings ─────────────────────────────────────────────
   * Headings are first-class rows in `service_headings` (NOT services). They
   * share the per-agency `sortOrder` sequence with services so the organize
   * dialog can interleave and reorder them as one list. */

  /** Live (non-deleted) headings for an agency, in catalog order. */
  headings: publicProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(serviceHeadings)
        .where(and(eq(serviceHeadings.agencyId, input.agencyId), isNull(serviceHeadings.deletedAt)))
        .orderBy(asc(serviceHeadings.sortOrder));
    }),

  /** Create a heading, appended after the current last catalog item. */
  addHeading: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), text: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'catalog');
      const [[svc], [hd]] = await Promise.all([
        ctx.db.select({ m: max(services.sortOrder) }).from(services).where(and(eq(services.agencyId, input.agencyId), isNull(services.deletedAt))),
        ctx.db.select({ m: max(serviceHeadings.sortOrder) }).from(serviceHeadings).where(and(eq(serviceHeadings.agencyId, input.agencyId), isNull(serviceHeadings.deletedAt))),
      ]);
      const next = Math.max(svc?.m ?? -1, hd?.m ?? -1) + 1;
      const [created] = await ctx.db.insert(serviceHeadings).values({ agencyId: input.agencyId, text: input.text, sortOrder: next }).returning();
      return created;
    }),

  /** Rename a heading. */
  updateHeading: protectedProcedure
    .input(z.object({ id: z.string().uuid(), text: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = (await ctx.db.select().from(serviceHeadings).where(eq(serviceHeadings.id, input.id)).limit(1))[0];
      if (!existing) throw new Error('Heading not found');
      await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
      const [updated] = await ctx.db.update(serviceHeadings).set({ text: input.text }).where(eq(serviceHeadings.id, input.id)).returning();
      return updated;
    }),

  /** Soft-delete a heading. */
  deleteHeading: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (await ctx.db.select().from(serviceHeadings).where(eq(serviceHeadings.id, input.id)).limit(1))[0];
      if (!existing) throw new Error('Heading not found');
      await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
      await ctx.db.update(serviceHeadings).set({ deletedAt: new Date() }).where(eq(serviceHeadings.id, input.id));
      return { id: input.id };
    }),

  /**
   * Persist a manual catalog ordering (organize-services drag dialog). The list
   * interleaves services and headings, so each item carries its `kind` and the
   * new `sortOrder` is written back to the matching table.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        items: z.array(z.object({ kind: z.enum(['service', 'heading']), id: z.string().uuid() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'catalog');
      await Promise.all(
        input.items.map((it, i) =>
          it.kind === 'service'
            ? ctx.db.update(services).set({ sortOrder: i }).where(and(eq(services.id, it.id), eq(services.agencyId, input.agencyId)))
            : ctx.db.update(serviceHeadings).set({ sortOrder: i }).where(and(eq(serviceHeadings.id, it.id), eq(serviceHeadings.agencyId, input.agencyId))),
        ),
      );
      return { ok: true };
    }),
});
