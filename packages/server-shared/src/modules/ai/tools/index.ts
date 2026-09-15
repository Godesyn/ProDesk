import { eq } from 'drizzle-orm';
import type { DB } from '../../../db/index.js';
import { brands } from '../../../db/schema.js';
import type { PendingAction, ToolDef, ToolEntry, ToolModuleCtx } from './types.js';
import { brandTools } from './brand.js';
import { agencyTools } from './agencies.js';
import { projectTools } from './projects.js';
import { reviewTools } from './reviews.js';
import { reviewEmbedTools } from './review-embeds.js';
import { linkTools } from './links.js';
import { signatureTools } from './signatures.js';
import { serviceTools } from './services.js';
import { billingTools } from './billing.js';
import { interactionTools } from './interaction.js';
import { messengerTools } from './messenger.js';
import { planTools } from './plan.js';

export type { ActionBilling, PendingAction, ToolDef, ToolEntry, ToolModuleCtx } from './types.js';

/**
 * Build the tool set for one AI turn, hard-bound to a single brandId. Every read
 * tool is scoped to this brand, so the model can never reach another brand's
 * data regardless of what it passes. Action (write) tools don't execute
 * server-side — they record a PendingAction the client must confirm.
 *
 * Adding a tool = add one { def, run } entry to the matching domain module
 * (tools/<domain>.ts); it is registered here automatically. Keep tool order
 * stable within a module — the serialized tool list is part of the prompt-cache
 * prefix, so reordering invalidates the cache once.
 */
/**
 * Registry tools an AI skill must unlock — offered only when that skill is on
 * for the brand (its name is in the enabled skill-tool set). Absent-when-locked:
 * these live at the END of the entry list so a toggle never shifts another
 * tool's position (the serialized tool list is part of the prompt-cache prefix,
 * so only the toggled skill's turn pays the invalidation). `web_search` is NOT
 * here — it's a hosted provider capability gated separately in chat.ts.
 */
const SKILL_GATED_TOOL_NAMES = new Set<string>(['request_user_location']);

export function buildTools(opts: { db: DB; brandId: string; userId?: string | null; threadId: string; skillTools?: ReadonlySet<string> }) {
  const { db, brandId, threadId } = opts;
  const userId = opts.userId ?? null;
  const skillTools = opts.skillTools ?? new Set<string>();
  const pendingActions: PendingAction[] = [];
  // Mutable holder read by chat.ts after the turn: did the model ask to be
  // re-invoked once all its cards settle (request_settlement_followup)?
  const flags = { settlementFollowup: false };

  // Lazy-resolved shadow agency id for the brand. The shadow agency is an
  // implementation detail — the AI never mentions it; it presents these
  // services as "your services" / "brand's services catalog".
  let _shadowAgencyId: string | null | undefined;
  async function getShadowAgencyId(): Promise<string | null> {
    if (_shadowAgencyId !== undefined) return _shadowAgencyId;
    const [b] = await db
      .select({ derivedToAgencyId: brands.derivedToAgencyId })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);
    _shadowAgencyId = b?.derivedToAgencyId ?? null;
    return _shadowAgencyId;
  }

  const ctx: ToolModuleCtx = { db, brandId, userId, threadId, pendingActions, flags, getShadowAgencyId };

  // Tool search deferral policy: the core Prodesk domains (brand, agencies,
  // projects), billing (the paid-action rules require those tools by name) and
  // the interaction mechanics stay loaded in context every turn. The satellite
  // apps (reviews, embeds, links, signatures, services catalog) are deferred —
  // the model discovers their schemas on demand via the tool-search tool, which
  // keeps the context lean and tool selection sharp. See ToolDef.defer_loading.
  const defer = (entries: ToolEntry[]): ToolEntry[] =>
    entries.map((e) => ({ ...e, def: { ...e.def, defer_loading: true } }));

  const entries: ToolEntry[] = [
    ...brandTools(ctx),
    ...agencyTools(ctx),
    ...projectTools(ctx),
    ...defer(reviewTools(ctx)),
    ...defer(reviewEmbedTools(ctx)),
    ...defer(linkTools(ctx)),
    ...defer(signatureTools(ctx)),
    ...defer(serviceTools(ctx)),
    // Deferred like the other satellites: the messenger is a big surface (nine
    // tools) that most turns never touch, and its schemas are long. The model
    // discovers them via tool search the moment a turn is about chat.
    ...defer(messengerTools(ctx)),
    ...billingTools(ctx),
    ...interactionTools(ctx),
    ...planTools(ctx),
  ]
    // Drop skill-gated tools whose unlocking skill is off for this brand.
    .filter((e) => !SKILL_GATED_TOOL_NAMES.has(e.def.name) || skillTools.has(e.def.name));
  const byName = new Map(entries.map((e) => [e.def.name, e] as const));
  if (byName.size !== entries.length) {
    throw new Error('[ai] duplicate tool name in tool registry');
  }
  const toolDefs: ToolDef[] = entries.map((e) => e.def);

  async function runTool(name: string, input: Record<string, unknown>, toolUseId: string): Promise<unknown> {
    const entry = byName.get(name);
    if (!entry) return { error: `Unknown tool: ${name}` };
    return entry.run(input, toolUseId);
  }

  return { toolDefs, runTool, pendingActions, flags };
}
