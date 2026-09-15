import { eq } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { brandNotes, globalSettings } from '../../db/schema.js';
import {
  catalogueEntry,
  familyHasKey,
  featureFor,
  getProvider,
  resolveFamily,
  resolveModel,
} from './providers/registry.js';
import type { LlmProvider, NeutralMessage, ProviderFamily } from './providers/types.js';
import { recordAiUsage, type AiUsageSource } from './usage.js';

/**
 * Runtime resolution of which provider family a turn runs on. Two inputs:
 *   • the super-admin EXCLUSION set (global_settings.disabled_ai_providers), and
 *   • the brand's chosen family (brand_notes.selected_ai_provider).
 * See registry.resolveFamily for the precedence rules.
 */

/** Families the super-admin has turned off (exclusion-based; empty = none). */
export async function getDisabledFamilies(db: DB): Promise<string[]> {
  const [row] = await db
    .select({ disabled: globalSettings.disabledAiProviders })
    .from(globalSettings)
    .where(eq(globalSettings.id, 1))
    .limit(1);
  return row?.disabled ?? [];
}

/** The super-admin's per-feature model assignments: source → model id. */
export async function getFeatureModels(db: DB): Promise<Record<string, string>> {
  const [row] = await db
    .select({ models: globalSettings.aiFeatureModels })
    .from(globalSettings)
    .where(eq(globalSettings.id, 1))
    .limit(1);
  return row?.models ?? {};
}

/**
 * Which model an AI feature should run on, and whether it can.
 *
 * Order: the super-admin's assignment → the feature's declared default → give up
 * and let the caller fall back to family resolution. At each step the model's
 * family must have an API key and not be globally disabled, so an assignment
 * pointing at an unconfigured provider degrades to the default rather than
 * failing the feature. A cost setting must never be the reason something breaks.
 */
export async function resolveFeatureModel(
  db: DB,
  source: AiUsageSource,
): Promise<{ provider: LlmProvider; model: string } | null> {
  const feature = featureFor(source);
  if (!feature) return null;

  const [assignments, disabled] = await Promise.all([
    getFeatureModels(db),
    getDisabledFamilies(db),
  ]);

  for (const candidateId of [assignments[source], feature.defaultModelId]) {
    if (!candidateId) continue;
    const entry = catalogueEntry(candidateId);
    if (!entry) continue;
    if (!familyHasKey(entry.family) || disabled.includes(entry.family)) continue;
    return { provider: getProvider(entry.family), model: entry.model.id };
  }
  return null;
}

/**
 * Resolve the family for a brand from its saved choice + the global exclusions.
 * Returns null only when NO family is enabled (assistant effectively disabled).
 */
export async function resolveBrandFamily(db: DB, brandId: string): Promise<ProviderFamily | null> {
  const [disabled, note] = await Promise.all([
    getDisabledFamilies(db),
    db
      .select({ choice: brandNotes.selectedAiProvider })
      .from(brandNotes)
      .where(eq(brandNotes.brandId, brandId))
      .limit(1)
      .then((r) => r[0]),
  ]);
  return resolveFamily({ disabled, brandChoice: note?.choice ?? null });
}

/** The default family when there's no brand context (global one-shot helpers). */
export async function resolveDefaultFamily(db: DB): Promise<ProviderFamily | null> {
  return resolveFamily({ disabled: await getDisabledFamilies(db) });
}

/** Bundle a family's provider instance with its single concrete model id. */
export function providerBundle(family: ProviderFamily): {
  family: ProviderFamily;
  provider: LlmProvider;
  model: string;
} {
  return {
    family,
    provider: getProvider(family),
    model: resolveModel(family).id,
  };
}

/**
 * One-shot completion helper for the non-streaming AI features (compaction,
 * continuations, card regenerate, proposals, review copy, …). Resolves the
 * family (explicit → brand default → global default → first available), runs a
 * single completion on the family's model, records spend, and returns the reply text.
 * `db` is optional so the public review-capture flow (which may have no db handle
 * for usage logging) can still run; without it, spend isn't recorded and the
 * family falls back to the first configured one.
 */
export async function completeOnce(opts: {
  db?: DB;
  source: AiUsageSource;
  system?: string | string[];
  /** A single user string, or an explicit neutral message list. */
  prompt: string | NeutralMessage[];
  maxTokens: number;
  /** Explicit family; when omitted, resolves the default from the db (or first available). */
  family?: ProviderFamily | null;
  /**
   * Skip the super-admin's per-feature model assignment for this call.
   *
   * Set it only where the model is a TENANT decision — the Strategy assistant,
   * whose family the brand chooses. Every other call site should leave it alone
   * so the AI Models screen actually governs it.
   */
  ignoreFeatureModel?: boolean;
  brandId?: string | null;
  threadId?: string | null;
  userId?: string | null;
  client?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  // The super-admin's choice for this feature wins, when there is one and it can
  // actually run. Needs a db handle — the public review-capture path has none and
  // falls through to family resolution, as it always did.
  let bundle: { provider: LlmProvider; model: string } | null =
    opts.db && !opts.ignoreFeatureModel
      ? await resolveFeatureModel(opts.db, opts.source)
      : null;

  if (!bundle) {
    const family =
      opts.family ?? (opts.db ? await resolveDefaultFamily(opts.db) : resolveFamily({}));
    if (!family) throw new Error('No AI provider family is enabled.');
    bundle = providerBundle(family);
  }
  const model = bundle.model;
  const messages: NeutralMessage[] =
    typeof opts.prompt === 'string' ? [{ role: 'user', content: opts.prompt }] : opts.prompt;
  const res = await bundle.provider.complete({
    modelId: model,
    maxTokens: opts.maxTokens,
    system: opts.system,
    messages,
    signal: opts.signal,
  });
  if (opts.db) {
    await recordAiUsage({
      db: opts.db,
      source: opts.source,
      model,
      usage: res.usage,
      brandId: opts.brandId ?? null,
      threadId: opts.threadId ?? null,
      userId: opts.userId ?? null,
      client: opts.client ?? null,
    });
  }
  return res.text;
}
