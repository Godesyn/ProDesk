/**
 * Logo Studio router (clients/logo — the AI logo builder + brand-genesis engine).
 *
 * Brand-scoped: every procedure takes `brandId` and gates on
 * `assertBrandAccess(ctx, brandId, 'logo')` (owners/super-admins always pass).
 * Read/write cores live in modules/logo/*; this file is the thin auth + IO seam.
 * Generation goes through the pluggable provider adapter (Claude-SVG today).
 *
 * Pipeline: brief → concepts → studio (edit/iterate) → brand system (write-through
 * to `brands`/`brand_kits` — the moat) → guidelines → assets (export, gated).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, arrayContains, desc, eq, or } from 'drizzle-orm';
import { protectedProcedure, publicProcedure, router } from '../trpc/trpc.js';
import { assertBrandAccess } from '../trpc/permissions.js';
import type { Context } from '../trpc/context.js';
import { brands, featureSubscriptionProducts, featureSubscriptions } from '../db/schema.js';
import { brandOwnerId } from '../modules/feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../modules/feature-subscriptions/feature-keys.js';
import { stripe } from '../modules/stripe/client.js';
import { isAiEnabled } from '../modules/ai/client.js';
import {
  deriveBrandSystem,
  generateConcepts,
  iterateConcept,
  scoreUniqueness,
} from '../modules/logo/generation.js';
import { briefSentence } from '../modules/logo/prompts.js';
import { buildLockups, exportFormat, type ExportFormat } from '../modules/logo/export.js';
import { buildGuidelines } from '../modules/logo/guidelines.js';
import { extractBriefFromConversation } from '../modules/logo/conversation.js';
import { applyBrandSystem } from '../modules/logo/brand-writethrough.js';
import { SHARE_TOKEN_RE } from '../modules/logo/share-link.js';
import { assetStem, buildLogoSuite, SUITE_FILE_COUNT } from '../modules/logo/suite.js';
import {
  resolveExportEntitlement,
  resolveLogoOffer,
  resolveLogoPlan,
} from '../modules/logo/entitlement.js';
import { measureWordmarkAs, normalizeMarkSvg } from '../modules/logo/svg.js';
import { defaultWeight, weightSteps } from '../modules/logo/outline.js';
import {
  applyInspector,
  describeChanges,
  diffInspector,
  firstUndone,
  formatChanges,
  lastApplied,
  markEdit,
  newEdit,
  parseInstruction,
  pushEdit,
  readInspector,
  reapplyEdit,
  revertEdit,
  type InspectorChange,
  type InspectorSettings,
} from '../modules/logo/inspector.js';
import { interpretInstruction } from '../modules/logo/inspector-command.js';
import {
  TYPEFACES,
  TYPEFACE_KEYS,
  snapTypeface,
  type TypefaceKey,
} from '../modules/logo/typefaces.js';
import {
  effectiveWeight,
  resolveAdjust,
  type WordmarkOutline,
} from '../modules/logo/layout.js';
import * as q from '../modules/logo/queries.js';
import * as cmd from '../modules/logo/commands.js';
import type { AiCallCtx } from '../modules/logo/providers/claude.js';
import type {
  GeneratedConcept,
  LogoBrief,
  LogoEdit,
  LogoGeneration,
  LogoSpec,
} from '../modules/logo/types.js';

/* ── validation ─────────────────────────────────────────────────────────── */

const briefSchema = z.object({
  businessName: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160).optional(),
  industry: z.string().trim().max(80).optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  personality: z.object({
    classicModern: z.number().int().min(0).max(4),
    seriousPlayful: z.number().int().min(0).max(4),
    minimalExpressive: z.number().int().min(0).max(4),
    geometricOrganic: z.number().int().min(0).max(4),
  }),
  markType: z.enum(['monogram', 'geometric', 'combination', 'wordmark', 'surprise']),
  monochromeFirst: z.boolean().default(true),
  colorLeaning: z.string().trim().max(80).optional(),
  initials: z.string().trim().max(4).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Everything the editor's inspector controls, as one flat patch. Ranges mirror
 * modules/logo/inspector.ts LIMITS — the module clamps too, so a value that slips
 * past here still lands inside what the editor itself can express.
 */
const settingsSchema = z
  .object({
    scale: z.number().min(0.2).max(2),
    strokeWidth: z.number().min(0.5).max(24).nullable(),
    gap: z.number().min(0).max(2.5),
    clearspace: z.number().min(0.25).max(3),
    hidden: z.array(z.string().max(64)).max(24),
    // Derived from the registry, not restated: a face added to typefaces.ts that
    // the input schema still rejects is a picker button that silently 400s.
    typeface: z.enum(TYPEFACE_KEYS as [TypefaceKey, ...TypefaceKey[]]),
    // The widest any shipped axis runs; the real per-face range is enforced when
    // the face is instanced, so an out-of-range weight snaps rather than 400s.
    wordmarkWeight: z.number().min(100).max(1000).nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  })
  .partial();

/** A neutral default brief for procedures that can run before a brief is saved. */
function defaultBrief(businessName: string): LogoBrief {
  return {
    businessName,
    keywords: [],
    personality: { classicModern: 2, seriousPlayful: 2, minimalExpressive: 2, geometricOrganic: 2 },
    markType: 'surprise',
    monochromeFirst: true,
  };
}

/** Rebuild a GeneratedConcept from a persisted row (for iterate/derive/score). */
function conceptFromRow(gen: {
  name: string;
  kind: string;
  note: string | null;
  svg: string;
}, spec: LogoSpec): GeneratedConcept {
  return {
    name: gen.name,
    kind: (['monogram', 'geometric', 'combination', 'wordmark'].includes(gen.kind)
      ? gen.kind
      : 'geometric') as GeneratedConcept['kind'],
    note: gen.note ?? '',
    svg: gen.svg,
    spec,
  };
}

/* ── helpers ────────────────────────────────────────────────────────────── */

function aiCtx(ctx: Context, brandId: string): AiCallCtx {
  return { db: ctx.db, brandId, userId: ctx.user?.id ?? null, client: ctx.client ?? null };
}

async function requireGeneration(ctx: Context, generationId: string) {
  const gen = await q.getGeneration(ctx.db, generationId);
  if (!gen) throw new TRPCError({ code: 'NOT_FOUND', message: 'Concept not found' });
  await assertBrandAccess(ctx, gen.brandId, 'logo');
  return gen;
}

async function requireProject(ctx: Context, projectId: string) {
  const project = await q.getProject(ctx.db, projectId);
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  await assertBrandAccess(ctx, project.brandId, 'logo');
  return project;
}

async function brandName(ctx: Context, brandId: string): Promise<string> {
  const [b] = await ctx.db
    .select({ businessName: brands.businessName })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return b?.businessName ?? 'My Brand';
}

function wordmarkOf(project: { brief: LogoBrief | null } | null, fallback: string): string {
  return project?.brief?.businessName?.trim() || fallback;
}

/**
 * The shipped typefaces, as the inspector's typography picker needs them —
 * including each face's real weight ladder, so the picker can only offer weights
 * the binary can actually cut.
 *
 * Built lazily and memoised: `weightSteps` reads the `wght` axis out of every
 * shipped binary, and doing eleven of those at module load would tax every boot
 * of the backend for a payload only the studio ever asks for.
 */
let typefaceOptionsCache:
  | {
      key: TypefaceKey;
      label: string;
      cssFamily: string;
      category: string;
      /** The weights this face can be set in, ascending. One entry = a static face. */
      weights: number[];
      /** The face's own display weight — what `null` in the settings resolves to. */
      defaultWeight: number;
    }[]
  | null = null;

function typefaceOptions() {
  typefaceOptionsCache ??= Object.values(TYPEFACES).map((t) => ({
    key: t.key,
    label: t.label,
    cssFamily: t.cssFamily,
    category: t.category,
    weights: weightSteps(t.key),
    defaultWeight: defaultWeight(t.key),
  }));
  return typefaceOptionsCache;
}

/** How the outline matrix is keyed. Mirrored by the client's lookup. */
function outlineKey(typeface: TypefaceKey, weight: number): string {
  return `${typeface}:${weight}`;
}

/**
 * Measure the wordmark into the matrix the browser recomposes from: EVERY shipped
 * typeface at its own display weight, plus EVERY weight of the current face.
 *
 * Both halves exist for the same reason — typeface and weight are inspector
 * controls, and having the measurement already in hand is what lets a click
 * repaint on the next frame instead of round-tripping to the only machine with
 * the font binaries. A measurement is font-unit based, so one per cell covers
 * every lockup size.
 *
 * WHY NOT THE FULL CROSS PRODUCT: outline path data for a short name runs a few KB
 * per cell, so eleven faces × seven weights would put a half-megabyte of paths on
 * a payload that is already outline-dominated. Switching FACE is the rarer move,
 * and it already goes through a mutation that returns a fresh payload — so the new
 * face's ladder arrives with it, and the client falls back to that face's default
 * weight for the one frame in between.
 */
function wordmarkOutlines(wordmark: string, spec: LogoSpec): Record<string, WordmarkOutline | null> {
  const out: Record<string, WordmarkOutline | null> = {};
  // Each face at the cut it would ACTUALLY be set in if you switched to it — not
  // at its own default. Same number of cells, but now a typeface click hits the
  // matrix instead of missing it and rendering the wrong weight for a round trip.
  const want = resolveAdjust(spec.adjust).wordmarkWeight;
  for (const key of TYPEFACE_KEYS) {
    const w = effectiveWeight(weightSteps(key), defaultWeight(key), want);
    out[outlineKey(key, w)] = measureWordmarkAs(wordmark, key, w);
  }
  const current = snapTypeface(spec.fonts?.heading);
  for (const w of weightSteps(current)) {
    const k = outlineKey(current, w);
    if (!(k in out)) out[k] = measureWordmarkAs(wordmark, current, w);
  }
  return out;
}

/**
 * The editor's view of a generation. Shared by `get` and by every mutation that
 * changes the mark, so the client is handed a complete, consistent state after
 * each one rather than having to refetch and re-render from scratch.
 */
async function editorPayload(ctx: Context, gen: LogoGeneration) {
  const project = await q.getProject(ctx.db, gen.projectId);
  const wordmark = wordmarkOf(project, await brandName(ctx, gen.brandId));
  const view = q.toConceptView(gen);
  return {
    concept: view,
    lockups: buildLockups(gen, view.spec, wordmark, false),
    wordmark,
    settings: readInspector(view.spec),
    outlines: wordmarkOutlines(wordmark, view.spec),
    typefaces: typefaceOptions(),
    edits: view.edits,
  };
}

/**
 * How many individual files a finished mark yields on the Assets screen: the
 * twelve-file suite in both formats, plus the print PDF and the guidelines PDF.
 * Shown as the "Assets ready" stat; derived from the suite so adding a form to
 * modules/logo/suite.ts can't leave the number stale.
 */
const EXPORTABLE_FILE_COUNT = SUITE_FILE_COUNT * 2 + 2;

/* ── router ─────────────────────────────────────────────────────────────── */

export const logoRouter = router({
  /** Studio-home snapshot: active project, chosen mark, counts, capabilities. */
  overview: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        /** Pin a specific project; omitted = the brand's most recent one. */
        projectId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { isOwner } = await assertBrandAccess(ctx, input.brandId, 'logo');
      const pinned = input.projectId ? await q.getProject(ctx.db, input.projectId) : null;
      // A pinned project from another brand must never leak through.
      const project =
        pinned && pinned.brandId === input.brandId
          ? pinned
          : await q.getActiveProject(ctx.db, input.brandId);
      const chosen = project ? await q.getChosenGeneration(ctx.db, project) : null;
      const [generationCount, entitlement, name] = await Promise.all([
        q.countGenerations(ctx.db, input.brandId),
        resolveExportEntitlement(ctx.db, input.brandId),
        brandName(ctx, input.brandId),
      ]);
      return {
        isOwner,
        brandName: name,
        aiEnabled: isAiEnabled(),
        project: project
          ? {
              id: project.id,
              name: project.name,
              status: project.status,
              brief: project.brief,
              rightsAssignedAt: project.rightsAssignedAt?.toISOString() ?? null,
              shared: Boolean(project.shareToken),
            }
          : null,
        chosen: chosen ? q.toConceptView(chosen) : null,
        generationCount,
        /** Downloadable files the chosen mark currently yields (drives the stat). */
        assetCount: chosen ? EXPORTABLE_FILE_COUNT : 0,
        entitlement,
      };
    }),

  project: router({
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'logo');
        const rows = await q.listProjectSummaries(ctx.db, input.brandId);
        return rows.map(({ project, chosenSvg, conceptCount }) => ({
          id: project.id,
          name: project.name,
          status: project.status,
          updatedAt: project.updatedAt.toISOString(),
          /** This project's OWN committed mark (null while none is chosen). */
          chosenSvg,
          conceptCount,
        }));
      }),

    /** Make a project the active one (see commands.touchProject). */
    open: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const updated = await cmd.touchProject(ctx.db, project.id);
        return {
          id: project.id,
          name: project.name,
          status: updated?.status ?? project.status,
          brief: project.brief,
        };
      }),

    /** Rename a design project. */
    rename: protectedProcedure
      .input(z.object({ projectId: z.string().uuid(), name: z.string().trim().min(1).max(80) }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        await cmd.renameProject(ctx.db, project.id, input.name);
        return { success: true };
      }),

    /** Get-or-create the active project (called on entering the studio). */
    ensure: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'logo');
        const name = await brandName(ctx, input.brandId);
        const project = await cmd.ensureProject(ctx.db, input.brandId, name, ctx.user?.id ?? null);
        return { id: project.id, name: project.name, status: project.status, brief: project.brief };
      }),

    /** Start a fresh mark (new project). */
    create: protectedProcedure
      .input(z.object({ brandId: z.string().uuid(), name: z.string().trim().max(80).optional() }))
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'logo');
        const name = input.name || (await brandName(ctx, input.brandId));
        const project = await cmd.createProject(ctx.db, input.brandId, name, ctx.user?.id ?? null);
        return { id: project.id, name: project.name, status: project.status };
      }),
  }),

  brief: router({
    /** Save the brief and advance to the concepts stage. */
    save: protectedProcedure
      .input(z.object({ projectId: z.string().uuid(), brief: briefSchema }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const updated = await cmd.saveBrief(ctx.db, project.id, input.brief as LogoBrief);
        return {
          id: updated.id,
          status: updated.status,
          sentence: briefSentence(input.brief as LogoBrief),
        };
      }),

    /**
     * Conversation mode: advance the chat one turn and get back the studio's reply
     * plus its best structured brief so far. Does NOT persist — the client saves
     * through `brief.save` when the user commits, so an exploratory chat never
     * clobbers a brief they were happy with.
     */
    converse: protectedProcedure
      .input(
        z.object({
          projectId: z.string().uuid(),
          turns: z
            .array(
              z.object({
                role: z.enum(['user', 'assistant']),
                content: z.string().trim().min(1).max(2000),
              }),
            )
            .min(1)
            .max(24),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const name = wordmarkOf(project, await brandName(ctx, project.brandId));
        const result = await extractBriefFromConversation(aiCtx(ctx, project.brandId), {
          turns: input.turns,
          brandName: name,
          current: project.brief,
        });
        return {
          reply: result.reply,
          brief: result.brief,
          ready: result.ready,
          fallback: result.fallback,
          sentence: briefSentence(result.brief),
        };
      }),
  }),

  concepts: router({
    /** Generate a contact sheet of concepts from the project's brief. */
    generate: protectedProcedure
      .input(
        z.object({
          projectId: z.string().uuid(),
          count: z.number().int().min(1).max(6).default(6),
          avoid: z.array(z.string()).max(24).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        if (!project.brief)
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Save a brief first' });
        const existing = await q.listGenerations(ctx.db, project.id);
        const result = await generateConcepts(
          aiCtx(ctx, project.brandId),
          project.brief,
          input.count,
          {
            offset: existing.length,
            avoid: input.avoid,
            styleLock: project.styleLock
              ? { descriptors: project.styleLock.descriptors, palette: project.styleLock.palette }
              : null,
          },
        );
        const rows = await cmd.insertGenerations(
          ctx.db,
          project.id,
          project.brandId,
          result.concepts,
          result.provider,
          briefSentence(project.brief),
        );
        await cmd.setProjectStatus(ctx.db, project.id, 'concepts');
        return {
          concepts: rows.map(q.toConceptView),
          fallback: result.fallback,
          provider: result.provider,
        };
      }),

    list: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        return q.listGenerations(ctx.db, project.id);
      }),

    toggleSave: protectedProcedure
      .input(z.object({ generationId: z.string().uuid(), saved: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await requireGeneration(ctx, input.generationId);
        await cmd.toggleSaved(ctx.db, input.generationId, input.saved);
        return { success: true };
      }),

    /** Commit to a direction → advances the project into the studio. */
    choose: protectedProcedure
      .input(z.object({ projectId: z.string().uuid(), generationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const gen = await requireGeneration(ctx, input.generationId);
        if (gen.projectId !== project.id)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Concept is not in this project' });
        const updated = await cmd.chooseGeneration(ctx.db, project.id, gen.id);
        // Lock the committed direction's style so later "generate more" rounds stay
        // in the same visual family instead of wandering off the chosen look.
        const view = q.toConceptView(gen);
        await cmd.setStyleLock(ctx.db, project.id, {
          descriptors: [gen.kind, view.spec.geometry].filter(Boolean).slice(0, 4),
          palette: view.spec.palette,
          fonts: view.spec.fonts,
          lockedAt: new Date().toISOString(),
        });
        return { id: updated.id, status: updated.status, chosenGenerationId: updated.chosenGenerationId };
      }),
  }),

  studio: router({
    /**
     * The editor payload for a generation: the mark, every derived lockup, and —
     * crucially — the INGREDIENTS the browser needs to recompose those lockups
     * itself (`outlines`).
     *
     * Composition is pure maths over (mark SVG + a measured wordmark + the
     * adjustment); only the measuring needs the font binaries. Measuring all three
     * shipped typefaces once, here, is what lets the editor answer a slider drag
     * or a typeface switch on the next frame instead of after a round trip — and
     * because the client runs the very same `composeLockup`, what it paints is
     * byte-for-byte what the export will produce.
     */
    get: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        return editorPayload(ctx, gen);
      }),

    /**
     * Persist an editor edit (SVG source, name/note, and/or inspector settings).
     * SVG is re-sanitised.
     *
     * Settings changes come back as `changes` — every field that moved, with what
     * it was and what it became — and are journalled on the generation so the
     * history strip has something to show and undo has something to step back
     * through.
     */
    update: protectedProcedure
      .input(
        z.object({
          generationId: z.string().uuid(),
          svg: z.string().max(80_000).optional(),
          name: z.string().trim().max(40).optional(),
          note: z.string().trim().max(160).optional(),
          settings: settingsSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const view = q.toConceptView(gen);
        const patch: {
          svg?: string;
          spec?: LogoSpec;
          name?: string;
          note?: string;
          edits?: LogoEdit[];
        } = {};

        if (input.svg !== undefined) {
          const clean = normalizeMarkSvg(input.svg);
          if (!clean) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid SVG' });
          patch.svg = clean;
        }
        if (input.name !== undefined) patch.name = input.name;
        if (input.note !== undefined) patch.note = input.note;

        let changes: InspectorChange[] = [];
        if (input.settings) {
          const before = readInspector(view.spec);
          const spec = applyInspector(view.spec, input.settings);
          changes = diffInspector(before, readInspector(spec));
          if (changes.length) {
            patch.spec = spec;
            patch.edits = pushEdit(view.edits, newEdit(changes, 'user'));
          }
        }

        const updated = Object.keys(patch).length
          ? await cmd.updateGeneration(ctx.db, gen.id, patch)
          : gen;
        return { ...(await editorPayload(ctx, updated)), changes: formatChanges(changes) };
      }),

    /**
     * Drive the inspector with plain language.
     *
     * The instruction is triaged first: a settings change (size, weight, spacing,
     * clearspace, typeface, colour, hiding an element) is applied here and
     * reported field-by-field; anything that really wants the artwork redrawn
     * falls through to the generation engine and mints a new version, exactly as
     * the copilot always did. Either way the caller learns which happened from
     * `kind`, and an inspector change carries the full before/after so the client
     * can offer a genuine undo of what the agent just did.
     *
     * The triage is a guess, so the redraw path can hand the instruction BACK:
     * the iteration engine knows the inspector's vocabulary and refuses to draw
     * a settings change. A refusal lands on the deterministic parser, and only
     * an instruction neither engine can place as a setting is reported as one
     * nothing could be done with. Nobody loses their mark to a misread verb.
     */
    command: protectedProcedure
      .input(
        z.object({
          generationId: z.string().uuid(),
          instruction: z.string().trim().min(1).max(400),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const view = q.toConceptView(gen);
        const before = readInspector(view.spec);
        const elements = view.spec.elements ?? [];

        /** Journal a settings patch and shape the editor payload around it. */
        const applyPatch = async (
          patch: Partial<InspectorSettings>,
          reply: string,
          fallback: boolean,
        ) => {
          const spec = applyInspector(view.spec, patch);
          const changes = diffInspector(before, readInspector(spec));
          if (!changes.length) {
            return {
              kind: 'noop' as const,
              reply: 'That is already how it is set.',
              changes: [],
              fallback,
            };
          }
          const edit = newEdit(changes, 'agent');
          const updated = await cmd.updateGeneration(ctx.db, gen.id, {
            spec,
            edits: pushEdit(view.edits, edit),
          });
          return {
            kind: 'inspector' as const,
            reply: reply || describeChanges(changes),
            changes: formatChanges(changes),
            fallback,
            ...(await editorPayload(ctx, updated)),
          };
        };

        const interpreted = await interpretInstruction(aiCtx(ctx, gen.brandId), {
          instruction: input.instruction,
          current: before,
          elements,
        });
        if (interpreted.handled) {
          return applyPatch(interpreted.patch, interpreted.reply, interpreted.fallback);
        }

        // Not a settings change — redraw the mark as a new version.
        const project = await q.getProject(ctx.db, gen.projectId);
        const brief = project?.brief ?? defaultBrief(await brandName(ctx, gen.brandId));
        const iterated = await iterateConcept(
          aiCtx(ctx, gen.brandId),
          brief,
          conceptFromRow(gen, view.spec),
          input.instruction,
        );

        // The drawing engine recognised a control the inspector owns, so the
        // triage was wrong in the expensive direction. Word-match it instead of
        // minting a version: the mark the user chose is not collateral.
        if (iterated.declined) {
          const parsed = parseInstruction(input.instruction, before, elements);
          if (parsed.handled) return applyPatch(parsed.patch, parsed.reply, true);
          return {
            kind: 'noop' as const,
            reply: iterated.reason,
            changes: [],
            fallback: false,
          };
        }

        const row = await cmd.insertIteration(
          ctx.db,
          gen.projectId,
          gen.brandId,
          gen.id,
          iterated.concept,
          iterated.provider,
          input.instruction,
        );
        return {
          kind: 'iterate' as const,
          concept: q.toConceptView(row),
          fallback: iterated.fallback,
          changes: [],
          reply: '',
        };
      }),

    /**
     * Step back across the last inspector change on this mark.
     *
     * Returns `undone: null` when the journal is empty, which is the client's cue
     * to fall back to the VERSION lineage instead (undo then means "open the mark
     * this one was refined from"). The two together are what the editor's single
     * undo button walks: settings first, then versions.
     */
    undo: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const view = q.toConceptView(gen);
        const edit = lastApplied(view.edits);
        if (!edit) return { undone: null, changes: [], ...(await editorPayload(ctx, gen)) };
        const updated = await cmd.updateGeneration(ctx.db, gen.id, {
          spec: revertEdit(view.spec, edit),
          edits: markEdit(view.edits, edit.id, true),
        });
        return {
          undone: edit,
          // Reported the way it was actually applied: back to the "from" values.
          changes: formatChanges(
            edit.changes.map((c) => ({ ...c, from: c.to, to: c.from })),
          ),
          ...(await editorPayload(ctx, updated)),
        };
      }),

    /** Re-apply the oldest undone inspector change. */
    redo: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const view = q.toConceptView(gen);
        const edit = firstUndone(view.edits);
        if (!edit) return { redone: null, changes: [], ...(await editorPayload(ctx, gen)) };
        const updated = await cmd.updateGeneration(ctx.db, gen.id, {
          spec: reapplyEdit(view.spec, edit),
          edits: markEdit(view.edits, edit.id, false),
        });
        return {
          redone: edit,
          changes: formatChanges(edit.changes),
          ...(await editorPayload(ctx, updated)),
        };
      }),

    /**
     * The mark's version lineage — every ancestor back to the original, plus the
     * refinements made FROM the current one. Drives the editor's history strip
     * alongside the current mark's own inspector journal.
     */
    history: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const [lineage, children] = await Promise.all([
          q.getLineage(ctx.db, gen.id),
          q.listChildren(ctx.db, gen.id),
        ]);
        return { lineage, children, edits: gen.edits ?? [] };
      }),

    /**
     * Conversational iteration: refine a mark with plain language → new version.
     *
     * Unlike `command`, this endpoint is only ever reached when the caller has
     * already decided it wants new artwork — so a declined instruction (one the
     * engine reads as an inspector setting) mints nothing and comes back with
     * `declined` set, leaving the current mark as the answer.
     */
    iterate: protectedProcedure
      .input(
        z.object({
          generationId: z.string().uuid(),
          instruction: z.string().trim().min(1).max(400),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const project = await q.getProject(ctx.db, gen.projectId);
        const view = q.toConceptView(gen);
        const brief = project?.brief ?? defaultBrief(await brandName(ctx, gen.brandId));
        const iterated = await iterateConcept(
          aiCtx(ctx, gen.brandId),
          brief,
          conceptFromRow(gen, view.spec),
          input.instruction,
        );
        if (iterated.declined) {
          return { concept: view, fallback: false, declined: iterated.reason };
        }
        const row = await cmd.insertIteration(
          ctx.db,
          gen.projectId,
          gen.brandId,
          gen.id,
          iterated.concept,
          iterated.provider,
          input.instruction,
        );
        return { concept: q.toConceptView(row), fallback: iterated.fallback, declined: '' };
      }),

    /** Score + persist the mark's distinctiveness (the openly-shown uniqueness). */
    uniqueness: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const project = await q.getProject(ctx.db, gen.projectId);
        const view = q.toConceptView(gen);
        const brief = project?.brief ?? defaultBrief(await brandName(ctx, gen.brandId));
        const score = await scoreUniqueness(
          aiCtx(ctx, gen.brandId),
          brief,
          conceptFromRow(gen, view.spec),
        );
        await cmd.setUniqueness(ctx.db, gen.id, score);
        return { uniqueness: score };
      }),
  }),

  system: router({
    /** Derive (but don't yet write) a palette + type system from the chosen mark. */
    derive: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const chosen = await q.getChosenGeneration(ctx.db, project);
        if (!chosen)
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Choose a concept first' });
        const brief = project.brief ?? defaultBrief(project.name);
        const view = q.toConceptView(chosen);
        return deriveBrandSystem(aiCtx(ctx, project.brandId), brief, conceptFromRow(chosen, view.spec));
      }),

    /**
     * Apply the chosen mark + derived system to the brand — the suite moat.
     *
     * NOT named `apply`: tRPC reserves `then`/`call`/`apply` as router keys
     * (they collide with Function.prototype), and using one throws at router
     * construction — i.e. the backend refuses to boot. `pushToSuite` also matches
     * the button the user actually presses.
     */
    pushToSuite: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const chosen = await q.getChosenGeneration(ctx.db, project);
        if (!chosen)
          throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Choose a concept first' });
        const brief = project.brief ?? defaultBrief(project.name);
        const view = q.toConceptView(chosen);
        const system = await deriveBrandSystem(
          aiCtx(ctx, project.brandId),
          brief,
          conceptFromRow(chosen, view.spec),
        );
        const wordmark = wordmarkOf(project, await brandName(ctx, project.brandId));
        const applied = await applyBrandSystem(
          ctx.db,
          project.brandId,
          chosen,
          wordmark,
          system,
          ctx.user?.id ?? null,
        );
        await cmd.setProjectStatus(ctx.db, project.id, 'system');
        return { applied, system };
      }),
  }),

  guidelines: router({
    /** Living brand guidelines derived from the chosen mark + palette. */
    get: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const project = await q.getProject(ctx.db, gen.projectId);
        const wordmark = wordmarkOf(project, await brandName(ctx, gen.brandId));
        const view = q.toConceptView(gen);
        return {
          concept: view,
          lockups: buildLockups(gen, view.spec, wordmark, false),
          ...buildGuidelines(view.spec),
          shareToken: project?.shareToken ?? null,
        };
      }),

    /**
     * Publish the public share link, returning it. Idempotent — pressing it again
     * hands back the same link.
     *
     * There is no revoke: a rulebook link is meant to be pasted into a brief and
     * forwarded, and a button that silently 404s every copy already in circulation
     * is the wrong default for that. The link is read-only and account-blind.
     */
    share: protectedProcedure
      .input(z.object({ projectId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const project = await requireProject(ctx, input.projectId);
        const name = wordmarkOf(project, await brandName(ctx, project.brandId));
        const token = await cmd.ensureGuidelinesShare(ctx.db, project.id, name);
        return { shareToken: token };
      }),

    /**
     * PUBLIC read of a shared rulebook. Unauthenticated by design — the token IS
     * the credential. Returns only what a rulebook needs (never the brief, the
     * other concepts, or anything about the account).
     *
     * Two token shapes are accepted: the readable `brand-slug/v2` minted today,
     * and the 32-hex tokens minted before it. Old links keep working.
     */
    public: publicProcedure
      .input(
        z.object({
          token: z.string().trim().min(3).max(96).regex(SHARE_TOKEN_RE, 'Malformed link'),
        }),
      )
      .query(async ({ ctx, input }) => {
        const project = await q.getProjectByShareToken(ctx.db, input.token);
        if (!project || !project.chosenGenerationId)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'This guidelines link is not available.' });
        const gen = await q.getChosenGeneration(ctx.db, project);
        if (!gen)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'This guidelines link is not available.' });
        const view = q.toConceptView(gen);
        const wordmark = project.brief?.businessName?.trim() || project.name;
        return {
          brandName: wordmark,
          markName: view.name,
          svg: view.svg,
          palette: view.spec.palette,
          fonts: view.spec.fonts,
          lockups: buildLockups(gen, view.spec, wordmark, false),
          /**
           * The twelve delivered files. Sent to the PUBLIC page because a shared
           * rulebook exists so a printer or a developer can use the logo, and the
           * suite is the artwork they need — the same set the owner exports, so
           * neither side can be handed a different logo than the other.
           */
          suite: buildLogoSuite({ mark: view.svg, wordmark, spec: view.spec }),
          stem: assetStem(view.name),
          ...buildGuidelines(view.spec),
        };
      }),
  }),

  /**
   * Unauthenticated surface for the marketing landing page (`/` for signed-out
   * visitors). Nothing here touches a brand — it only describes what Logo Studio
   * costs, so the page never has to hardcode a price.
   */
  public: router({
    /**
     * Advertised price. Every field is null while pricing is undecided (no
     * `logo_builder` product exists yet), and the landing renders price-less
     * "free to design" copy in that case.
     */
    offer: publicProcedure.query(async ({ ctx }) => {
      const offer = await resolveLogoOffer(ctx.db);
      return {
        unitAmount: offer?.amount ?? null,
        currency: offer?.currency ?? null,
        interval: offer?.interval ?? null,
        features: offer?.features ?? [],
      };
    }),
  }),

  assets: router({
    /** Current export entitlement (drives the pay-on-download bar). */
    entitlement: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'logo');
        return resolveExportEntitlement(ctx.db, input.brandId);
      }),

    /**
     * Entitlement PLUS the sellable plan, so the download bar can offer a real
     * subscribe action. `product` is null while pricing is undecided; purchase
     * runs through the shared `featureSubscriptions.checkout`.
     */
    plan: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'logo');
        return resolveLogoPlan(ctx.db, input.brandId);
      }),

    /**
     * The twelve-file logo suite for the chosen mark — six forms, each in the
     * brand colour and in monochrome (modules/logo/suite.ts).
     *
     * A read, deliberately UNGATED: it is the same artwork the studio already
     * paints on screen, and it is what the suite grid renders. Taking the files
     * away is `claim` below.
     */
    suite: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const project = await q.getProject(ctx.db, gen.projectId);
        const wordmark = wordmarkOf(project, await brandName(ctx, gen.brandId));
        const view = q.toConceptView(gen);
        return {
          suite: buildLogoSuite({ mark: view.svg, wordmark, spec: view.spec }),
          stem: assetStem(view.name),
          fileCount: SUITE_FILE_COUNT,
        };
      }),

    /**
     * Claim a suite download that the BROWSER assembled.
     *
     * The suite zips are built client-side from lockups the page already holds, so
     * there is nothing to upload and nothing to rasterise on a worker — but the two
     * facts a server-side export records are unchanged: the subscription has to
     * allow it, and "you own it when you download" has to be stamped. This is that
     * boundary, and the client awaits it BEFORE it starts zipping so a blocked
     * download never produces a file.
     */
    claim: protectedProcedure
      .input(z.object({ generationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const ent = await resolveExportEntitlement(ctx.db, gen.brandId);
        if (!ent.allowed)
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'A Logo Studio subscription is required to download assets.',
          });
        await cmd.stampRightsOnce(ctx.db, gen.projectId);
        await cmd.setProjectStatus(ctx.db, gen.projectId, 'complete');
        return { fileCount: SUITE_FILE_COUNT };
      }),

    /** Export a format bundle. Gated at THIS boundary (designing stays free). */
    export: protectedProcedure
      .input(
        z.object({
          generationId: z.string().uuid(),
          format: z.enum(['svg', 'png', 'pdf', 'favicon', 'social', 'guidelines']),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const gen = await requireGeneration(ctx, input.generationId);
        const ent = await resolveExportEntitlement(ctx.db, gen.brandId);
        if (!ent.allowed)
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'A Logo Studio subscription is required to download assets.',
          });
        const project = await q.getProject(ctx.db, gen.projectId);
        const name = await brandName(ctx, gen.brandId);
        const wordmark = wordmarkOf(project, name);
        const asset = await exportFormat(
          gen.brandId,
          gen,
          wordmark,
          input.format as ExportFormat,
          name,
        );
        // "You own it when you download" — record when the rights transferred.
        await cmd.stampRightsOnce(ctx.db, gen.projectId);
        await cmd.setProjectStatus(ctx.db, gen.projectId, 'complete');
        return asset;
      }),
  }),

  /**
   * Billing surface for the in-app Account screen. The plan itself is
   * `assets.plan`, the subscription is the shared `featureSubscriptions.*`, and
   * card-on-file management reuses the tool-agnostic
   * `shortLinks.{paymentMethod,createSetupIntent,setDefaultPaymentMethod}` (they
   * operate on the brand owner's Stripe customer, not on short links). Only the
   * invoice history has to be scoped to Logo Studio's own subscription, which is
   * what this exists for.
   */
  billing: router({
    /**
     * Past Stripe invoices for the brand owner's Logo Studio subscription ONLY
     * (mirrors signatures.invoices — hard-scoped by feature key so no other
     * tool's charges leak in). Empty while pricing is deferred and nobody is
     * subscribed.
     */
    invoices: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'payments');
        if (!stripe) return [];
        const ownerId = await brandOwnerId(ctx.db, input.brandId);
        if (!ownerId) return [];
        const [sub] = await ctx.db
          .select({
            stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
            stripeCustomerId: featureSubscriptions.stripeCustomerId,
          })
          .from(featureSubscriptions)
          .innerJoin(
            featureSubscriptionProducts,
            eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
          )
          .where(
            and(
              eq(featureSubscriptions.userId, ownerId),
              or(
                eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.LOGO),
                arrayContains(featureSubscriptionProducts.featureKeys, [FEATURE_KEYS.LOGO]),
              ),
            ),
          )
          .orderBy(desc(featureSubscriptions.createdAt))
          .limit(1);
        if (!sub?.stripeSubscriptionId || !sub.stripeCustomerId) return [];

        const res = await stripe.invoices.list({
          customer: sub.stripeCustomerId,
          subscription: sub.stripeSubscriptionId,
          limit: 24,
        });
        return res.data.map((inv) => ({
          id: inv.id,
          number: inv.number ?? inv.id,
          created: inv.created ? new Date(inv.created * 1000) : null,
          periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
          periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
          amount: (inv.amount_paid || inv.amount_due || inv.total || 0) / 100,
          currency: (inv.currency ?? 'aud').toUpperCase(),
          status: inv.status ?? 'open',
          pdfUrl: inv.invoice_pdf ?? null,
          hostedUrl: inv.hosted_invoice_url ?? null,
        }));
      }),
  }),
});
