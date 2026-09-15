import { env } from '../../../lib/env.js';
import type { LlmProvider, ProviderFamily } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';

/**
 * The registry is the single source of truth for provider families: which models
 * fill each routing tier, their per-token pricing, and the family-level cache /
 * web-search economics. Adding a family = one entry here + one file implementing
 * LlmProvider. Nothing else in the codebase hard-codes a model id.
 */

export interface ModelSpec {
  /** Concrete provider model id sent on the wire. */
  id: string;
  /** Human label for super-admin / brand UI and the AI-spend report. */
  label: string;
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

export interface FamilySpec {
  family: ProviderFamily;
  /** Human label for the picker. */
  label: string;
  /** The single model this family runs (no tiers). */
  model: ModelSpec;
  /** Cache-read price as a multiple of the input rate (Anthropic 0.1×; Gemini ~0.25×). */
  cacheReadMult: number;
  /** Cache-write price as a multiple of the input rate (Anthropic 1.25×; Gemini implicit → 1×, but 0 tokens reported). */
  cacheWriteMult: number;
  /** USD per hosted web-search request, billed on top of tokens. */
  webSearchUsd: number;
}

/**
 * Family catalogue — one model per family (no tiers). Prices are USD/1M tokens;
 * keep in sync with each provider's pricing page (see pricing.ts consumers).
 */
export const FAMILIES: Record<ProviderFamily, FamilySpec> = {
  anthropic: {
    family: 'anthropic',
    label: 'Claude (Anthropic)',
    model: { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', input: 3, output: 15 },
    cacheReadMult: 0.1,
    cacheWriteMult: 1.25,
    webSearchUsd: 0.01,
  },
  gemini: {
    family: 'gemini',
    label: 'Gemini (Google)',
    model: { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', input: 1.5, output: 7.5 },
    // Gemini implicit caching discounts cached input ~75% and has no separate
    // cache-write charge (we report 0 cache-write tokens, so the multiplier is moot).
    cacheReadMult: 0.25,
    cacheWriteMult: 1,
    // google_search grounding: ~$14 / 1,000 requests after a daily free tier, so
    // this is an upper bound on real spend. Keep in sync with Google's pricing.
    webSearchUsd: 0.014,
  },
};

/* ──────────────────────────────────────────────────────────────────────────
 * MODEL CATALOGUE
 *
 * Every model a super-admin may assign to an AI feature, across all families.
 *
 * This does NOT reopen the "one model per family" rule. That rule governs what a
 * BRAND picks: a tenant choosing their assistant should pick a provider, not read
 * a tier list, and `FAMILIES` above still gives them exactly one model per family.
 * The catalogue is the platform's own menu — the super-admin deciding what runs a
 * feature nobody else should have to think about.
 *
 * Every entry must be priced. `lookupModel` searches here, and an unregistered
 * model id prices at ZERO, which would silently under-report the feature's spend
 * in the AI-spend report.
 * ────────────────────────────────────────────────────────────────────────── */

export interface CatalogueEntry {
  family: ProviderFamily;
  model: ModelSpec;
  /** One line on what this model is for, shown beside it in the picker. */
  note: string;
}

export const MODEL_CATALOGUE: CatalogueEntry[] = [
  {
    family: 'anthropic',
    model: { id: 'claude-opus-5', label: 'Claude Opus 5', input: 5, output: 25 },
    note: 'Most capable. For work where a wrong answer is expensive.',
  },
  {
    family: 'anthropic',
    model: { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', input: 3, output: 15 },
    note: 'The balanced default. Near-Opus quality on most tasks.',
  },
  {
    family: 'anthropic',
    model: { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', input: 1, output: 5 },
    note: 'Fast and cheap, for short well-defined tasks.',
  },
  {
    family: 'gemini',
    model: { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', input: 1.5, output: 7.5 },
    note: 'Google’s general-purpose model.',
  },
  {
    family: 'gemini',
    model: {
      id: 'gemini-3.1-flash-lite',
      label: 'Gemini 3.1 Flash-Lite',
      input: 0.25,
      output: 1.5,
    },
    // Gemini 2.5 Flash-Lite is cheaper ($0.10/$0.40) but retires 16 Oct 2026 —
    // not somewhere to put a feature that has to keep working.
    note: 'Cheapest option. Good for high-volume, low-difficulty work.',
  },
];

export function catalogueEntry(modelId: string): CatalogueEntry | undefined {
  return MODEL_CATALOGUE.find((e) => e.model.id === modelId);
}

/**
 * AI FEATURES — every call site whose model a super-admin can choose.
 *
 * Keyed by `ai_usage.source`, so the picker and the spend report are describing
 * the same thing and a feature can't drift between them.
 *
 * The Strategy assistant is deliberately ABSENT. Its model follows the brand's
 * own provider choice (`resolveBrandFamily`), which is a tenant decision, not a
 * platform one — overriding it here would silently ignore what the brand picked.
 */
export interface AiFeature {
  source: string;
  label: string;
  /** The product this belongs to, for grouping in the UI. */
  group: string;
  /** Why this feature is cheap or expensive to run — the buying decision. */
  hint: string;
  /** Used when the super-admin has expressed no preference. */
  defaultModelId: string;
}

const CHEAP = 'gemini-3.1-flash-lite';
const BALANCED = 'claude-sonnet-5';

export const AI_FEATURES: AiFeature[] = [
  // Outreach — the highest-volume call sites in the product.
  { source: 'outreach_classify', label: 'Reply classification', group: 'Outreach', defaultModelId: CHEAP, hint: 'One short reply sorted into five buckets. Runs on every reply.' },
  { source: 'outreach_draft', label: 'Reply drafting', group: 'Outreach', defaultModelId: CHEAP, hint: 'A human approves every draft before it sends.' },
  { source: 'outreach_personalise', label: 'List personalisation', group: 'Outreach', defaultModelId: CHEAP, hint: 'A short phrase per prospect. Thousands per month.' },
  // Logo Studio — creative work where quality is the product.
  { source: 'logo_brief', label: 'Brief', group: 'Logo Studio', defaultModelId: BALANCED, hint: 'Turns a conversation into a structured brief.' },
  { source: 'logo_concept', label: 'Concepts', group: 'Logo Studio', defaultModelId: BALANCED, hint: 'Generates editable SVG marks. Quality is the product here.' },
  { source: 'logo_iterate', label: 'Iterate', group: 'Logo Studio', defaultModelId: BALANCED, hint: 'Conversational edits to an existing mark.' },
  { source: 'logo_variants', label: 'Variants', group: 'Logo Studio', defaultModelId: BALANCED, hint: 'Derives reversed, mono and stacked lockups.' },
  { source: 'logo_system', label: 'Design system', group: 'Logo Studio', defaultModelId: BALANCED, hint: 'Derives palette and type from a chosen mark.' },
  { source: 'logo_inspector', label: 'Inspector commands', group: 'Logo Studio', defaultModelId: CHEAP, hint: 'Plain language to inspector settings. Mechanical.' },
  { source: 'logo_uniqueness', label: 'Uniqueness score', group: 'Logo Studio', defaultModelId: CHEAP, hint: 'Scores distinctiveness 0–100.' },
  // Payments (EziQuotes).
  { source: 'proposal_draft', label: 'Proposal draft', group: 'Payments', defaultModelId: BALANCED, hint: 'Client-facing copy. Goes out under our name.' },
  { source: 'proposal_rewrite', label: 'Tone rewrite', group: 'Payments', defaultModelId: BALANCED, hint: 'Inline rewrite of a selected passage.' },
  { source: 'proposal_suggest', label: 'Improvement suggestions', group: 'Payments', defaultModelId: CHEAP, hint: 'Suggestions on save. Advisory only.' },
  { source: 'proposal_score', label: 'Proposal score', group: 'Payments', defaultModelId: CHEAP, hint: 'A quality number, not prose.' },
  { source: 'proposal_win_loss', label: 'Win/loss analysis', group: 'Payments', defaultModelId: BALANCED, hint: 'Reads a set of outcomes and explains them.' },
  { source: 'pricing_benchmark', label: 'Pricing benchmark', group: 'Payments', defaultModelId: BALANCED, hint: 'Competitor price comparison.' },
  { source: 'upsell_recommendations', label: 'Upsell suggestions', group: 'Payments', defaultModelId: CHEAP, hint: 'Add-on suggestions from an existing proposal.' },
  { source: 'block_copy', label: 'Block copy', group: 'Payments', defaultModelId: CHEAP, hint: 'Short copy for one proposal block.' },
  { source: 'sequence_rewrite', label: 'Follow-up rewrite', group: 'Payments', defaultModelId: CHEAP, hint: 'Rewrites one follow-up touchpoint.' },
  // Reviews (Verdiict).
  { source: 'review_generate', label: 'Review copy', group: 'Reviews', defaultModelId: BALANCED, hint: 'Public-facing copy written for a real customer.' },
];

export function featureFor(source: string): AiFeature | undefined {
  return AI_FEATURES.find((f) => f.source === source);
}

/** All families the app knows about, in preference order (default picks the first available). */
export const ALL_FAMILIES: ProviderFamily[] = ['anthropic', 'gemini'];

/** Whether a family's API key is configured (so it can actually run). */
export function familyHasKey(family: ProviderFamily): boolean {
  switch (family) {
    case 'anthropic':
      return !!env.ANTHROPIC_API_KEY;
    case 'gemini':
      return !!env.GEMINI_API_KEY;
    default:
      return false;
  }
}

/** Families whose API key is present — the universe before super-admin exclusions. */
export function availableFamilies(): ProviderFamily[] {
  return ALL_FAMILIES.filter(familyHasKey);
}

/**
 * Families a brand may actually use: available (key present) minus the super-admin
 * exclusion set. Super-admin control is EXCLUSION-based — everything is on by
 * default; disabling removes it here.
 */
export function enabledFamilies(disabled: string[] = []): ProviderFamily[] {
  const off = new Set(disabled);
  return availableFamilies().filter((f) => !off.has(f));
}

/** Any provider at all configured → the AI assistant is enabled. */
export function isAiEnabled(): boolean {
  return availableFamilies().length > 0;
}

/**
 * Resolve which family a turn runs on. The brand's saved choice wins when it's
 * still enabled; otherwise fall back to the first enabled family (preference
 * order in ALL_FAMILIES). Returns null only when NO family is enabled.
 */
export function resolveFamily(opts: { disabled?: string[]; brandChoice?: string | null }): ProviderFamily | null {
  const enabled = enabledFamilies(opts.disabled ?? []);
  if (enabled.length === 0) return null;
  const choice = opts.brandChoice as ProviderFamily | null | undefined;
  if (choice && enabled.includes(choice)) return choice;
  return enabled[0];
}

/** The concrete model for a family. */
export function resolveModel(family: ProviderFamily): ModelSpec {
  return FAMILIES[family].model;
}

/**
 * Reverse lookup: which family + model spec owns a concrete model id.
 *
 * Searches the catalogue as well as the family models — an unregistered id
 * prices at zero, so leaving one out would make that feature look free in the
 * AI-spend report.
 */
export function lookupModel(modelId: string): { family: FamilySpec; model: ModelSpec } | undefined {
  for (const family of Object.values(FAMILIES)) {
    if (family.model.id === modelId) return { family, model: family.model };
  }
  const entry = catalogueEntry(modelId);
  // A catalogue model borrows its family's cache/web-search economics, which is
  // what `priceUsage` needs beyond the per-token rates.
  if (entry) return { family: FAMILIES[entry.family], model: entry.model };
  return undefined;
}

/** Human label for a model id (falls back to the raw id). Used by the AI-spend report. */
export function modelLabel(modelId: string): string {
  return lookupModel(modelId)?.model.label ?? modelId;
}

export interface FamilyInfo {
  family: ProviderFamily;
  label: string;
  /** Label of the family's model (shown in admin/brand UI). */
  model: string;
  /** Whether this family's API key is configured (unconfigured families can't run). */
  hasKey: boolean;
}

/** Metadata for every known family — for the super-admin and brand pickers. Pure
 *  data; constructs no provider clients. */
export function listFamilies(): FamilyInfo[] {
  return ALL_FAMILIES.map((f) => ({
    family: f,
    label: FAMILIES[f].label,
    model: FAMILIES[f].model.label,
    hasKey: familyHasKey(f),
  }));
}

// ── Provider instances (lazy singletons, one per family) ───────────────────────

const _instances = new Map<ProviderFamily, LlmProvider>();

/** Get the concrete provider for a family, constructing it once. Throws if its key is missing. */
export function getProvider(family: ProviderFamily): LlmProvider {
  const existing = _instances.get(family);
  if (existing) return existing;
  if (!familyHasKey(family)) {
    throw new Error(`[ai] provider family "${family}" is not configured (missing API key).`);
  }
  const created: LlmProvider = family === 'gemini' ? new GeminiProvider() : new AnthropicProvider();
  _instances.set(family, created);
  return created;
}
