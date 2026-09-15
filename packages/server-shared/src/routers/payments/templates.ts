/**
 * Payments (EziQuotes) — proposal templates router, ported from
 * server/routers/templates.ts: CRUD + duplicate + static library import.
 * Legacy structures are normalised at read-time via the template-migration
 * module (ported from server/templateMigration.ts). list/create/import take a
 * brandId; id-based procedures resolve the row and gate on its brandId.
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { paymentTemplates } from '../../db/schema.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  createTemplate,
  deleteTemplate,
  getTemplateById,
  listTemplates,
  updateTemplate,
} from '../../modules/payments/db.js';
import { normaliseTemplateStructure } from '../../modules/payments/template-migration.js';

// Library templates (static seed data)
const LIBRARY_TEMPLATES = [
  { id: 'lib-solar', name: 'Solar Installation', category: 'trades', description: 'Full residential solar system proposal with panels, inverter, and installation.', icon: '☀️' },
  { id: 'lib-landscaping', name: 'Landscaping Project', category: 'trades', description: 'Complete landscaping scope with design, materials, and labour.', icon: '🌿' },
  { id: 'lib-web-design', name: 'Website Design & Build', category: 'digital', description: 'Website design, development, and launch package.', icon: '💻' },
  { id: 'lib-seo', name: 'SEO Retainer', category: 'digital', description: 'Monthly SEO services with reporting and optimisation.', icon: '📈' },
  { id: 'lib-photography', name: 'Photography Package', category: 'creative', description: 'Full-day photography coverage with editing and delivery.', icon: '📷' },
  { id: 'lib-consulting', name: 'Business Consulting', category: 'professional', description: 'Strategy consulting engagement with deliverables.', icon: '🎯' },
  { id: 'lib-plumbing', name: 'Plumbing Renovation', category: 'trades', description: 'Bathroom or kitchen plumbing renovation scope.', icon: '🔧' },
  { id: 'lib-electrical', name: 'Electrical Upgrade', category: 'trades', description: 'Switchboard upgrade and rewiring proposal.', icon: '⚡' },
  { id: 'lib-marketing', name: 'Marketing Retainer', category: 'digital', description: 'Monthly digital marketing management package.', icon: '📣' },
  { id: 'lib-events', name: 'Event Management', category: 'events', description: 'Full event planning and coordination package.', icon: '🎉' },
];

/** Load a template row by id (tenancy is asserted by the caller from row.brandId). */
async function loadTemplate(id: string) {
  const [row] = await db.select().from(paymentTemplates).where(eq(paymentTemplates.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}

export const templatesRouter = router({
  list: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const rows = await listTemplates(input.brandId);
      // PHASE2-18: normalise legacy template structures at read-time
      return rows.map((t) => ({
        ...t,
        structure: normaliseTemplateStructure(t.structure, t.name),
      }));
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const template = await loadTemplate(input.id);
      await requirePaymentRead(ctx, template.brandId);
      // PHASE2-18: normalise legacy template structure at read-time
      return {
        ...template,
        structure: normaliseTemplateStructure(template.structure, template.name),
      };
    }),

  create: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      name: z.string().min(1),
      source: z.enum(['library', 'scratch', 'import', 'system']).default('scratch'),
      libraryTemplateId: z.string().optional(),
      structure: z.any().optional(),
      /** Mark this as a system-generated template (used during onboarding) */
      isSystem: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const id = await createTemplate({
        brandId: input.brandId,
        name: input.name,
        source: input.source,
        libraryTemplateId: input.libraryTemplateId,
        structure: input.structure ?? { sections: [], lineItems: [] },
        isSystem: input.isSystem,
      });
      return getTemplateById(id, input.brandId);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      structure: z.any().optional(),
      status: z.enum(['active', 'archived']).optional(),
      defaultLineItems: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const template = await loadTemplate(input.id);
      await requirePaymentWrite(ctx, template.brandId);
      const { id, ...data } = input;
      await updateTemplate(id, template.brandId, data);
      return getTemplateById(id, template.brandId);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const template = await loadTemplate(input.id);
      await requirePaymentWrite(ctx, template.brandId);
      await deleteTemplate(input.id, template.brandId);
      return { success: true };
    }),

  duplicate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const original = await loadTemplate(input.id);
      await requirePaymentWrite(ctx, original.brandId);
      const newId = await createTemplate({
        brandId: original.brandId,
        name: `Copy of ${original.name}`,
        source: original.source ?? 'scratch',
        structure: original.structure ?? { sections: [], lineItems: [] },
      });
      return getTemplateById(newId, original.brandId);
    }),

  // Library templates
  listLibrary: protectedProcedure.query(() => LIBRARY_TEMPLATES),

  importFromLibrary: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), libraryTemplateId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const lib = LIBRARY_TEMPLATES.find((t) => t.id === input.libraryTemplateId);
      if (!lib) throw new TRPCError({ code: 'NOT_FOUND', message: 'Library template not found' });
      const id = await createTemplate({
        brandId: input.brandId,
        name: lib.name,
        source: 'library',
        libraryTemplateId: input.libraryTemplateId,
        structure: { sections: [], lineItems: [], introCopy: lib.description },
      });
      return getTemplateById(id, input.brandId);
    }),
});
