import { z } from 'zod';
import { and, eq, isNull, or, asc, inArray, like } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc/trpc.js';
import { spotForms, spotComponents, brands, agencies, files } from '../db/schema.js';
import type { DB } from '../db/index.js';
import type { Context } from '../trpc/context.js';
import { assertAgencyAccess, assertBrandViewAccess } from '../trpc/permissions.js';
import { onComponentPendingApproval, onComponentApproved } from './tasks.js';
import { recordLockerFiles, answerUrls, fileNameFromUrl, INFOHUB_FILE_QUESTION_TYPES } from '../modules/locker/record.js';
import { isEmptyAnswer, provisionDefaultForm, deprovisionDefaultForm } from '../modules/spot/provision.js';

/**
 * SPOT — brand-profile custom forms (templates) + the filled components a brand
 * answers. Templates live in `spot_forms`:
 *   - agencyId null & brandId null → global/default template (admin-managed)
 *   - agencyId set                 → an agency's reusable template
 *   - brandId set                  → a brand's own one-off custom section
 * Components live in `spot_components` (always brand-scoped). Ports
 * spot_repository.dart + the spot/brand/component Cloud Function triggers
 * (default-template provisioning, removeUnansweredKeys, approval tasks).
 *
 * Question shape (SpotQuestionModel): { id, text, type, options[], isRequired }.
 * type ∈ text | single_select | multi_select | date | address | url | number |
 *        price | email | file_upload | carousel | cover_photo | color_palette |
 *        audio_upload | phone.
 */
const questionType = z.enum([
  'text', 'single_select', 'multi_select', 'date', 'address', 'url', 'number',
  'price', 'email', 'file_upload', 'carousel', 'cover_photo', 'color_palette', 'audio_upload', 'phone',
]);

const questionSchema = z.object({
  id: z.string(),
  text: z.string(),
  type: questionType,
  options: z.array(z.string()).default([]),
  isRequired: z.boolean().default(true),
});

type SpotQuestion = z.infer<typeof questionSchema>;

/* ── Provisioning helpers ──────────────────────────────────────────────────
 * The Firestore-trigger-parity default-template fan-out lives in
 * `modules/spot/provision.ts` (imported above) so the connection chokepoint can
 * reuse it without an import cycle. Question-prune stays here as it is only used
 * by the form-edit mutations below. */

/**
 * on_form_written: when a template's questions change, strip answers for deleted
 * questions from every component using it — but only when that answer is empty,
 * so real client data is never silently discarded. Ports
 * removeUnansweredKeysFromComponents.
 */
async function pruneRemovedQuestionAnswers(templateId: string, removedQuestionIds: string[], db: DB): Promise<void> {
  if (!removedQuestionIds.length) return;
  const comps = await db.select().from(spotComponents).where(eq(spotComponents.templateId, templateId));
  for (const c of comps) {
    const answers = { ...((c.answers as Record<string, unknown>) ?? {}) };
    let changed = false;
    for (const qid of removedQuestionIds) {
      if (qid in answers && isEmptyAnswer(answers[qid])) { delete answers[qid]; changed = true; }
    }
    if (changed) await db.update(spotComponents).set({ answers }).where(eq(spotComponents.id, c.id));
  }
}

/**
 * Mirror of the Flutter client_detail_screen editability rule
 * (`isEditable = template.agencyId == agencyId || component.agencyId == agencyId`):
 * the brand owner / brand staff / super-admin (viaAgencyId === null) may mutate
 * any of the brand's sections, but a CONNECTED AGENCY may only touch sections it
 * owns. Prevents one agency editing the brand's own or another agency's sections.
 */
function assertCanMutateComponent(
  access: { viaAgencyId: string | null },
  comp: { agencyId: string | null },
): void {
  if (access.viaAgencyId && comp.agencyId !== access.viaAgencyId) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This section is managed by the brand or another agency' });
  }
}

/** Permission gate for a (possibly new) template based on its ownership. */
async function assertFormOwnership(ctx: Context, form: { agencyId?: string | null; brandId?: string | null }): Promise<void> {
  if (form.brandId) { await assertBrandViewAccess(ctx, form.brandId, { brandPermission: 'brandBusinessInfo' }); return; }
  if (form.agencyId) { await assertAgencyAccess(ctx, form.agencyId, 'agencyBusinessInfo'); return; }
  // Global/default templates are admin-only.
  if (!ctx.user?.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only platform admins manage global templates' });
}

export const spotRouter = router({
  /* ── Templates (forms) ───────────────────────────────────────────────── */

  /** Templates offered in a brand's "Create Section" picker.
   *
   * Templates only ever belong to an agency or the platform (global) — brands
   * never own templates. Who sees what:
   *   - A plain BRAND owner (no `agencyId`) sees ONLY global/platform templates.
   *     A brand must NEVER see an agency's templates — those are the agency's to
   *     view and add to the brand from the client's hub.
   *   - An AGENCY managing a client's hub (passes its `agencyId`) sees ONLY its
   *     own templates.
   * Already-added templates are filtered out client-side so the picker only shows
   * additions. */
  listFormsForBrand: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      await assertBrandViewAccess(ctx, input.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients' });
      if (input.agencyId) {
        // Agency acting on a client's hub → only that agency's own templates.
        // Gated by `clients` (managing a client), not the agency's own Info Hub perm.
        await assertAgencyAccess(ctx, input.agencyId, 'clients');
        return ctx.db.select().from(spotForms).where(eq(spotForms.agencyId, input.agencyId)).orderBy(asc(spotForms.name));
      }
      // Brand self-service → global/platform templates only (never agency templates).
      return ctx.db
        .select()
        .from(spotForms)
        .where(and(isNull(spotForms.agencyId), isNull(spotForms.brandId)))
        .orderBy(asc(spotForms.name));
    }),

  /** List an agency's own templates (the agency form builder), or the global
   * defaults when no agency is given (super-admin template manager). */
  listForms: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.agencyId) {
        await assertAgencyAccess(ctx, input.agencyId, 'agencyBusinessInfo');
        return ctx.db.select().from(spotForms).where(eq(spotForms.agencyId, input.agencyId)).orderBy(asc(spotForms.name));
      }
      // Global/default templates (admin-managed).
      return ctx.db
        .select()
        .from(spotForms)
        .where(and(isNull(spotForms.agencyId), isNull(spotForms.brandId)))
        .orderBy(asc(spotForms.name));
    }),

  createForm: protectedProcedure
    .input(
      z.object({
        // Templates are agency-scoped (agencyId set) or global (admin, agencyId omitted).
        // Brands never own templates, so there is no brandId here.
        agencyId: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        questions: z.array(questionSchema).default([]),
        isDefault: z.boolean().optional(),
        isSecret: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertFormOwnership(ctx, input);
      const [created] = await ctx.db.insert(spotForms).values(input).returning();
      // Agency/global defaults auto-provision onto brands.
      if (created.isDefault) await provisionDefaultForm(created, ctx.db);
      return created;
    }),

  updateForm: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        questions: z.array(questionSchema).optional(),
        isDefault: z.boolean().optional(),
        isSecret: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const form = (await ctx.db.select().from(spotForms).where(eq(spotForms.id, input.id)).limit(1))[0];
      if (!form) throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' });
      await assertFormOwnership(ctx, form);

      // Detect questions removed in this edit so we can prune their answers.
      const removedQuestionIds = input.questions
        ? ((form.questions as SpotQuestion[]) ?? [])
            .map((q) => q.id)
            .filter((id) => !input.questions!.some((q) => q.id === id))
        : [];

      const wasDefault = form.isDefault;
      const { id, ...rest } = input;
      const [updated] = await ctx.db.update(spotForms).set(rest).where(eq(spotForms.id, id)).returning();

      if (removedQuestionIds.length) await pruneRemovedQuestionAnswers(id, removedQuestionIds, ctx.db);
      if (!updated.brandId && input.isDefault !== undefined && input.isDefault !== wasDefault) {
        if (input.isDefault) await provisionDefaultForm(updated, ctx.db);
        else await deprovisionDefaultForm(id, ctx.db);
      }
      return updated;
    }),

  deleteForm: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const form = (await ctx.db.select().from(spotForms).where(eq(spotForms.id, input.id)).limit(1))[0];
      if (!form) throw new TRPCError({ code: 'NOT_FOUND', message: 'Form not found' });
      await assertFormOwnership(ctx, form);
      await ctx.db.delete(spotForms).where(eq(spotForms.id, input.id));
      return { id: input.id };
    }),

  /* ── Components (filled sections on a brand profile) ──────────────────── */

  /** Components for a brand's Info Hub builder. The brand/admin sees every
   * section; a connected agency sees only its own sections plus the ones the
   * brand has made public. Each component carries its RESOLVED questions (from its
   * template, or inline for a template-less brand-own section) so the brand can
   * render and fill agency-added sections WITHOUT ever being handed the agency's
   * templates. */
  listComponents: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      // `actingAgencyId` makes the agency identity authoritative when viewing a
      // client's hub, so the agency sees ONLY its own sections + public ones (and,
      // via assertCanMutateComponent, can edit only its own) even if the operator
      // is also a member of the brand.
      const access = await assertBrandViewAccess(ctx, input.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      const scope = access.viaAgencyId
        ? and(
            eq(spotComponents.brandId, input.brandId),
            or(eq(spotComponents.agencyId, access.viaAgencyId), eq(spotComponents.isPublic, true)),
          )
        : eq(spotComponents.brandId, input.brandId);
      const comps = await ctx.db.select().from(spotComponents).where(scope).orderBy(asc(spotComponents.order));
      const questionsByComp = await resolveComponentQuestions(comps, ctx.db);
      return comps.map((c) => ({ ...c, questions: questionsByComp.get(c.id) ?? [] }));
    }),

  /** Public, non-secret components for a brand's public profile (no auth), each
   * joined with its template questions so the page can render labels in order. */
  publicProfile: publicProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const brand = (
        await ctx.db
          .select({ id: brands.id, businessName: brands.businessName, logoUrl: brands.logoUrl, website: brands.website, industry: brands.industry })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1)
      )[0];
      if (!brand) return null;
      const comps = await ctx.db
        .select()
        .from(spotComponents)
        .where(and(eq(spotComponents.brandId, input.brandId), eq(spotComponents.isPublic, true), eq(spotComponents.isSecret, false)))
        .orderBy(asc(spotComponents.order));
      const questionsByComp = await resolveComponentQuestions(comps, ctx.db);
      return {
        brand,
        sections: comps.map((c) => ({ ...c, questions: questionsByComp.get(c.id) ?? [] })),
      };
    }),

  /** A single public section (the /public/brand/form/:id share link). */
  publicComponent: publicProcedure
    .input(z.object({ componentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const comp = (await ctx.db.select().from(spotComponents).where(eq(spotComponents.id, input.componentId)).limit(1))[0];
      if (!comp || !comp.isPublic || comp.isSecret) return null;
      const brand = (
        await ctx.db
          .select({ id: brands.id, businessName: brands.businessName, logoUrl: brands.logoUrl, website: brands.website })
          .from(brands)
          .where(eq(brands.id, comp.brandId))
          .limit(1)
      )[0];
      const questionsByComp = await resolveComponentQuestions([comp], ctx.db);
      return { brand, section: { ...comp, questions: questionsByComp.get(comp.id) ?? [] } };
    }),

  /**
   * Create a component from an existing template (snapshots the template id+name).
   * The new section is appended at the end of the brand's ordering.
   */
  createComponent: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        templateId: z.string().uuid(),
        templateName: z.string(),
        agencyId: z.string().uuid().optional(),
        answers: z.record(z.string(), z.unknown()).default({}),
        isSecret: z.boolean().optional(),
        questionOrder: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // `actingAgencyId` makes the agency identity authoritative when the agency
      // adds this section from a client's hub, so `viaAgencyId` (and therefore the
      // section's ownership) is the agency even if the operator is also a brand member.
      const access = await assertBrandViewAccess(ctx, input.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      // When added by a connected agency, the section is owned by that agency
      // (matches AppAddFormsDialog setting component.agencyId = widget.agencyId).
      const agencyId = access.viaAgencyId ?? input.agencyId ?? null;
      const nextOrder = await nextComponentOrder(input.brandId, ctx.db);
      const [created] = await ctx.db
        .insert(spotComponents)
        .values({ ...input, agencyId, order: nextOrder, createdByUserId: ctx.user.id })
        .returning();
      // Only an agency adding a section on the brand's behalf raises a "review it"
      // task for the brand owner (component_editor "Save & Submit for Approval").
      // The brand owner / admin adding their own section needs no approval.
      if (access.viaAgencyId) await notifyPendingApproval(created, agencyId, ctx.db);
      return created;
    }),

  /**
   * Build a new section in one step. Behaviour depends on who creates it:
   *   - A connected AGENCY or a SUPER-ADMIN creates a reusable template (agency- or
   *     global-scoped, optionally default) PLUS the component that renders it on
   *     the brand. Templates only ever belong to an agency or the platform.
   *   - A plain BRAND owner creates a template-LESS component: brands never own
   *     templates, so the section's questions are stored INLINE on the component
   *     (templateId null). Nothing lands in `spot_forms`.
   * Ports the inline form builder on business_info_screen.dart.
   */
  createCustomSection: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        // The agency the caller is acting as (set when building from a client's hub).
        // Needed because a user who owns BOTH the agency and the brand resolves as
        // the brand owner server-side, which would otherwise mis-scope the template.
        agencyId: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        questions: z.array(questionSchema).default([]),
        isSecret: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // `actingAgencyId` makes the agency identity authoritative (see createComponent),
      // so an agency building a section on a client's hub owns it even when the
      // operator is also a member of the brand.
      const access = await assertBrandViewAccess(ctx, input.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      // The owning agency: trust the acting agency the client named, falling back to
      // the agency access was granted through. Validate any named agency the access
      // check didn't already vouch for, so a caller can't tag a template to an agency
      // they don't control.
      if (input.agencyId && input.agencyId !== access.viaAgencyId) {
        await assertAgencyAccess(ctx, input.agencyId, 'clients');
      }
      const ownerAgencyId = input.agencyId ?? access.viaAgencyId ?? null;

      // Plain BRAND owner (no acting agency, not a super-admin): create a
      // template-less component holding its questions inline. Brands never own
      // templates, so nothing is written to `spot_forms`.
      if (!ownerAgencyId && !ctx.user.isSuperAdmin) {
        const nextOrder = await nextComponentOrder(input.brandId, ctx.db);
        const [created] = await ctx.db
          .insert(spotComponents)
          .values({
            brandId: input.brandId,
            templateId: null,
            templateName: input.name,
            agencyId: null,
            questions: input.questions,
            answers: {},
            isSecret: input.isSecret ?? false,
            order: nextOrder,
            createdByUserId: ctx.user.id,
          })
          .returning();
        return { form: null, component: created };
      }

      // Agency / super-admin: create the reusable template + its component.
      // Scope: an agency → that agency (reusable across its brands), otherwise
      // (super-admin with no agency) → global. Both may be marked default.
      const scope = ownerAgencyId
        ? { agencyId: ownerAgencyId, brandId: null }
        : { agencyId: null, brandId: null };
      const isDefault = input.isDefault ?? false;
      const [form] = await ctx.db
        .insert(spotForms)
        .values({ ...scope, name: input.name, description: input.description, questions: input.questions, isSecret: input.isSecret ?? false, isDefault })
        .returning();
      const nextOrder = await nextComponentOrder(input.brandId, ctx.db);
      const [created] = await ctx.db
        .insert(spotComponents)
        .values({
          brandId: input.brandId,
          templateId: form.id,
          templateName: form.name,
          // Tag ownership so the agency that built this section can keep editing it.
          agencyId: ownerAgencyId,
          answers: {},
          isSecret: form.isSecret,
          order: nextOrder,
          createdByUserId: ctx.user.id,
        })
        .returning();
      // Only a section a connected agency adds on the brand's behalf (real agency
      // access, not the brand owner) needs the brand owner's approval.
      if (access.viaAgencyId) await notifyPendingApproval(created, access.viaAgencyId, ctx.db);
      // A default template also fans out to the creator's other brands
      // (ensureComponentForBrand skips this brand — its component already exists).
      if (isDefault) await provisionDefaultForm(form, ctx.db);
      return { form, component: created };
    }),

  /** Persist a component's answers (the editable SpotFormFullView fields). */
  updateAnswers: protectedProcedure
    .input(z.object({ id: z.string().uuid(), agencyId: z.string().uuid().optional(), answers: z.record(z.string(), z.unknown()), questionOrder: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const comp = (await ctx.db.select().from(spotComponents).where(eq(spotComponents.id, input.id)).limit(1))[0];
      if (!comp) throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      const access = await assertBrandViewAccess(ctx, comp.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      assertCanMutateComponent(access, comp);
      const [updated] = await ctx.db
        .update(spotComponents)
        .set({ answers: input.answers, ...(input.questionOrder ? { questionOrder: input.questionOrder } : {}) })
        .where(eq(spotComponents.id, input.id))
        .returning();
      await recordComponentAnswerFiles(ctx.db, updated, input.answers);
      return updated;
    }),

  /** General component update (templateName rename, secret flag, question order). */
  updateComponent: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        agencyId: z.string().uuid().optional(),
        templateName: z.string().optional(),
        isSecret: z.boolean().optional(),
        questionOrder: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const comp = (await ctx.db.select().from(spotComponents).where(eq(spotComponents.id, input.id)).limit(1))[0];
      if (!comp) throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      const access = await assertBrandViewAccess(ctx, comp.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      assertCanMutateComponent(access, comp);
      const { id, agencyId: _actingAgencyId, ...rest } = input;
      const [updated] = await ctx.db.update(spotComponents).set(rest).where(eq(spotComponents.id, id)).returning();
      return updated;
    }),

  /** Toggle whether a component shows on the public brand profile (Share Profile). */
  toggleVisibility: protectedProcedure
    .input(z.object({ id: z.string().uuid(), agencyId: z.string().uuid().optional(), isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const comp = (await ctx.db.select().from(spotComponents).where(eq(spotComponents.id, input.id)).limit(1))[0];
      if (!comp) throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      if (comp.isSecret && input.isPublic) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Secret sections cannot be made public' });
      const access = await assertBrandViewAccess(ctx, comp.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      assertCanMutateComponent(access, comp);
      // Only the brand (owner/staff/super-admin) controls public visibility; an agency
      // managing the hub may edit its own sections but not publish them.
      if (access.viaAgencyId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the brand can change a section’s visibility' });
      const [updated] = await ctx.db.update(spotComponents).set({ isPublic: input.isPublic }).where(eq(spotComponents.id, input.id)).returning();
      // Move this section's locker files between Agency Documents and Public Brand Assets.
      await syncInfoHubLockerVisibility(ctx.db, updated, input.isPublic);
      // Making a section public resolves the brand owner's "review it" task.
      if (input.isPublic) await onComponentApproved(input.id, ctx.db);
      return updated;
    }),

  /** Persist a drag-reorder of the brand's components (Info Hub reorderable list). */
  reorderComponents: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), agencyId: z.string().uuid().optional(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertBrandViewAccess(ctx, input.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      // Section ordering belongs to the brand; an agency managing the hub can't reorder it.
      if (access.viaAgencyId) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the brand can reorder its sections' });
      await Promise.all(
        input.orderedIds.map((id, i) =>
          ctx.db.update(spotComponents).set({ order: i }).where(and(eq(spotComponents.id, id), eq(spotComponents.brandId, input.brandId))),
        ),
      );
      return { ok: true };
    }),

  deleteComponent: protectedProcedure
    .input(z.object({ id: z.string().uuid(), agencyId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const comp = (await ctx.db.select().from(spotComponents).where(eq(spotComponents.id, input.id)).limit(1))[0];
      if (!comp) throw new TRPCError({ code: 'NOT_FOUND', message: 'Component not found' });
      const access = await assertBrandViewAccess(ctx, comp.brandId, { brandPermission: 'brandBusinessInfo', agencyPermission: 'clients', actingAgencyId: input.agencyId });
      assertCanMutateComponent(access, comp);
      await ctx.db.delete(spotComponents).where(eq(spotComponents.id, input.id));
      await onComponentApproved(input.id, ctx.db); // resolve any pending "review it" task
      // Legacy cleanup: brand-owned sections no longer create templates (their
      // questions are inline, templateId null), but any pre-existing brand-scoped
      // template is removed once its last component is gone.
      if (comp.templateId) {
        const tpl = (await ctx.db.select().from(spotForms).where(eq(spotForms.id, comp.templateId)).limit(1))[0];
        if (tpl?.brandId) {
          const others = await ctx.db.select({ id: spotComponents.id }).from(spotComponents).where(eq(spotComponents.templateId, comp.templateId)).limit(1);
          if (!others.length) await ctx.db.delete(spotForms).where(eq(spotForms.id, comp.templateId));
        }
      }
      return { id: input.id };
    }),
});

/* ── Small shared internals ───────────────────────────────────────────────── */

async function nextComponentOrder(brandId: string, db: DB): Promise<number> {
  const rows = await db.select({ order: spotComponents.order }).from(spotComponents).where(eq(spotComponents.brandId, brandId));
  return rows.reduce((m, r) => Math.max(m, r.order + 1), 0);
}

async function loadQuestions(templateIds: string[], db: DB): Promise<Map<string, SpotQuestion[]>> {
  const ids = [...new Set(templateIds)];
  if (!ids.length) return new Map();
  const forms = await db.select({ id: spotForms.id, questions: spotForms.questions }).from(spotForms).where(inArray(spotForms.id, ids));
  return new Map(forms.map((f) => [f.id, (f.questions as SpotQuestion[]) ?? []]));
}

/**
 * Resolve each component's questions: from its template, or — for a template-less
 * (brand-own) section — from the questions stored inline on the component itself.
 * Returns a map keyed by component id.
 */
async function resolveComponentQuestions(
  comps: { id: string; templateId: string | null; questions?: unknown }[],
  db: DB,
): Promise<Map<string, SpotQuestion[]>> {
  const templateIds = comps.map((c) => c.templateId).filter((id): id is string => !!id);
  const byTemplate = await loadQuestions(templateIds, db);
  return new Map(
    comps.map((c) => [
      c.id,
      c.templateId ? (byTemplate.get(c.templateId) ?? []) : ((c.questions as SpotQuestion[]) ?? []),
    ]),
  );
}

/* ── Document Locker feed ──────────────────────────────────────────────────
 * Info Hub file answers flow into the brand's document locker. Append-only:
 * replacing a file keeps the old one as history. Agency-owned sections land in
 * Agency Documents (and Public Brand Assets when the section is public);
 * brand-owned sections land in Public/Private by the section's public state.
 */
type SpotComponentRow = typeof spotComponents.$inferSelect;

async function recordComponentAnswerFiles(db: DB, comp: SpotComponentRow, answers: Record<string, unknown>): Promise<void> {
  try {
    const questions = (await resolveComponentQuestions([comp], db)).get(comp.id) ?? [];
    const fileQs = questions.filter((q) => INFOHUB_FILE_QUESTION_TYPES.has(q.type));
    if (!fileQs.length) return;
    const isPublic = comp.isPublic && !comp.isSecret;
    const rows = fileQs.flatMap((q) =>
      answerUrls(answers[q.id])
        .filter((u) => u.startsWith('http'))
        .map((url) => ({
          brandId: comp.brandId,
          url,
          // The actual uploaded file's name (from the URL); the question label is
          // only a fallback when the URL carries no usable name.
          name: fileNameFromUrl(url, q.text || 'Info Hub file'),
          agencyId: comp.agencyId ?? null,
          uploadedBy: comp.createdByUserId ?? null,
          category: 'infohub',
          source: comp.agencyId ? 'agency' : 'brand',
          note: `From Info Hub${comp.templateName ? ` · ${comp.templateName}` : ''}${q.text ? ` (${q.text})` : ''}`,
          isPublic,
          // Agency sections always live in Agency Documents (never private);
          // a brand-owned section that isn't public is a Private Document.
          isPrivate: comp.agencyId ? false : !isPublic,
          sourceType: 'infohub' as const,
          sourceId: `${comp.id}:${q.id}:${url}`,
        })),
    );
    if (rows.length) await recordLockerFiles(db, rows);
  } catch (err) {
    console.error('[spot] recordComponentAnswerFiles failed', (err as Error).message);
  }
}

/**
 * The lone non-insert locker write: publishing/unpublishing a section flips its
 * derived files between Agency Documents and Public Brand Assets (and, for a
 * brand-owned section, Private ↔ Public). Never deletes a row; rows the brand
 * removed locally (deletedAt) are skipped.
 */
async function syncInfoHubLockerVisibility(db: DB, comp: SpotComponentRow, nextPublic: boolean): Promise<void> {
  try {
    const pub = nextPublic && !comp.isSecret;
    await db
      .update(files)
      .set({ isPublic: pub, isPrivate: comp.agencyId ? false : !pub })
      .where(and(eq(files.sourceType, 'infohub'), like(files.sourceId, `${comp.id}:%`), isNull(files.deletedAt)));
  } catch (err) {
    console.error('[spot] syncInfoHubLockerVisibility failed', (err as Error).message);
  }
}

async function notifyPendingApproval(
  created: typeof spotComponents.$inferSelect,
  agencyId: string | null,
  db: DB,
): Promise<void> {
  if (created.isPublic) return;
  const brand = (await db.select().from(brands).where(eq(brands.id, created.brandId)).limit(1))[0];
  const agency = agencyId ? (await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0] : null;
  if (brand?.ownerId) {
    await onComponentPendingApproval(
      {
        componentId: created.id,
        brandOwnerId: brand.ownerId,
        brandId: brand.id,
        brandName: brand.businessName,
        templateName: created.templateName,
        agencyName: agency?.businessName ?? null,
      },
      db,
    );
  }
}
