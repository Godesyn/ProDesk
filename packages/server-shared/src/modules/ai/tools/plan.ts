/**
 * Plan / to-do tools — the assistant's own multi-step implementation plan for
 * this thread. UNLIKE every other write tool, these are SILENT and execute
 * server-side immediately (no confirm card): the plan is the assistant's working
 * memory of a big task, shown read-only to the user in the Strategy To-Do panel.
 *
 * Each item has two levels: a short `title` (~4-5 words led by ONE emoji, the
 * gist) and a fuller markdown `description`. Items carry a status the assistant
 * ticks as it works (pending → in_progress → done). The panel updates live via
 * pingPlanChanged, and the current plan is fed back into the model's context on
 * every turn (see memory.ts describePlan) so it edits THIS plan by position
 * instead of forgetting it and rebuilding a checklist in chat.
 *
 * `set_plan` replaces the WHOLE plan — used to create it, to rewrite it from
 * scratch when the user pivots to an unrelated task, or to dispose of it entirely
 * (pass an empty list). `update_plan_item` ticks/edits one existing item by its
 * 1-based position, or removes it (remove: true). Positions are returned from
 * every call so the model can reference them.
 */
import { and, asc, eq } from 'drizzle-orm';
import { aiPlanItems } from '../../../db/schema.js';
import { pingPlanChanged } from '../../../lib/realtime.js';
import { obj } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

const STATUSES = ['pending', 'in_progress', 'done'] as const;
type PlanStatus = (typeof STATUSES)[number];

const normStatus = (v: unknown): PlanStatus =>
  typeof v === 'string' && (STATUSES as readonly string[]).includes(v) ? (v as PlanStatus) : 'pending';

export function planTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, threadId } = ctx;

  // The plan as the model should see it back: 1-based positions it can address.
  async function snapshot() {
    const rows = await db
      .select({
        title: aiPlanItems.title,
        description: aiPlanItems.description,
        status: aiPlanItems.status,
        position: aiPlanItems.position,
      })
      .from(aiPlanItems)
      .where(eq(aiPlanItems.threadId, threadId))
      .orderBy(asc(aiPlanItems.position), asc(aiPlanItems.createdAt));
    return rows.map((r, i) => ({
      position: i + 1,
      title: r.title,
      description: r.description,
      status: r.status,
    }));
  }

  return [
    {
      def: {
        name: 'set_plan',
        description: [
          "Create or completely REPLACE this thread's to-do plan — the assistant's own step-by-step plan for a multi-step task, shown read-only to the user in their To-Do panel (NOT a confirm card; it saves immediately).",
          'Use this when you take on a big/multi-step request (e.g. "help me set up X"): lay out the steps first, then work through them, calling update_plan_item to tick each one as you go.',
          'Because it REPLACES the whole plan, also use it when the user pivots to an unrelated task — rewrite the plan fresh for the new task, unbiased by the old one — or pass an EMPTY items array to dispose of the plan entirely.',
          'Do NOT use for trivial one-step requests. The panel holds the full canonical plan; when you first create it, also briefly announce the plan in chat so the user sees where you\'re headed — but never keep re-typing the whole list turn after turn.',
          'Input: { items: [{ title, description?, status? }] }.',
          '- title: SHORT, ~4-5 words, and MUST start with ONE relevant emoji then a space — the gist the user reads at a glance (e.g. "🎯 Draft brand positioning", "💳 Set up billing").',
          '- description: RICH Markdown — the fuller detail the user reads when they open this item in the panel (it renders as Markdown). Use headings, bold, bullet/numbered lists, tables and `inline code` wherever they aid readability; never a plain wall of text.',
          '- status: OPTIONAL one of "pending" | "in_progress" | "done" (defaults to "pending").',
          'Returns { ok, count, items } with each item\'s 1-based position for later update_plan_item calls.',
        ].join('\n'),
        input_schema: obj(
          {
            items: {
              type: 'array',
              description: 'The full ordered list of plan items. An empty array clears the plan.',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  title: { type: 'string', description: 'Short gist, ~4-5 words, starting with one relevant emoji then a space (e.g. "🎯 Draft brand positioning").' },
                  description: { type: 'string', description: 'Rich Markdown detail shown when the user opens the item.' },
                  status: { type: 'string', enum: [...STATUSES] },
                },
                required: ['title'],
              },
            },
          },
          ['items'],
        ),
      },
      run: async (input) => {
        const raw = Array.isArray(input.items) ? (input.items as Array<Record<string, unknown>>) : [];
        const items = raw
          .map((it) => ({
            title: typeof it.title === 'string' ? it.title.trim() : '',
            description: typeof it.description === 'string' ? it.description : '',
            status: normStatus(it.status),
          }))
          .filter((it) => it.title);

        await db.transaction(async (tx) => {
          await tx.delete(aiPlanItems).where(eq(aiPlanItems.threadId, threadId));
          if (items.length) {
            await tx.insert(aiPlanItems).values(
              items.map((it, i) => ({
                threadId,
                brandId,
                title: it.title,
                description: it.description,
                status: it.status,
                position: i,
              })),
            );
          }
        });
        void pingPlanChanged(threadId);
        const snap = await snapshot();
        return { ok: true, count: snap.length, items: snap };
      },
    },
    {
      def: {
        name: 'update_plan_item',
        description: [
          "Update ONE existing item in this thread's to-do plan by its 1-based position — mainly to tick its status as you make progress (e.g. mark step 2 in_progress, then done), to lightly edit its title/description, or to REMOVE it (remove: true) when a step no longer belongs.",
          'Prefer this over set_plan for incremental progress and single-item removals so the user watches the plan advance instead of it being rebuilt from scratch.',
          'After ticking or editing an item, mention just THAT one task in your chat reply (e.g. "✅ Billing\'s set up — now onto inviting your team"); do NOT restate the whole to-do list, and say nothing about the plan on turns where no item changed.',
          'title keeps the "one emoji + short gist" shape; description is rich Markdown shown when the user opens the item.',
          'Input: { position, status?, title?, description?, remove? }. Returns { ok, items } (the updated plan with positions), or { error } if the position does not exist.',
        ].join('\n'),
        input_schema: obj(
          {
            position: { type: 'integer', description: '1-based position of the item to update.' },
            status: { type: 'string', enum: [...STATUSES] },
            title: { type: 'string', description: 'Optional new short title (keep the leading emoji).' },
            description: { type: 'string', description: 'Optional new rich Markdown detail.' },
            remove: { type: 'boolean', description: 'Set true to delete this item from the plan entirely.' },
          },
          ['position'],
        ),
      },
      run: async (input) => {
        const pos = typeof input.position === 'number' ? Math.trunc(input.position) : NaN;
        if (!Number.isFinite(pos) || pos < 1) return { error: 'position must be a positive integer.' };
        const rows = await db
          .select({ id: aiPlanItems.id })
          .from(aiPlanItems)
          .where(eq(aiPlanItems.threadId, threadId))
          .orderBy(asc(aiPlanItems.position), asc(aiPlanItems.createdAt));
        const target = rows[pos - 1];
        if (!target) return { error: `No plan item at position ${pos}. The plan has ${rows.length} item(s).` };

        if (input.remove === true) {
          await db
            .delete(aiPlanItems)
            .where(and(eq(aiPlanItems.id, target.id), eq(aiPlanItems.threadId, threadId)));
          void pingPlanChanged(threadId);
          return { ok: true, items: await snapshot() };
        }

        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (typeof input.status === 'string') set.status = normStatus(input.status);
        if (typeof input.title === 'string' && input.title.trim()) set.title = input.title.trim();
        if (typeof input.description === 'string') set.description = input.description;

        await db
          .update(aiPlanItems)
          .set(set)
          .where(and(eq(aiPlanItems.id, target.id), eq(aiPlanItems.threadId, threadId)));
        void pingPlanChanged(threadId);
        return { ok: true, items: await snapshot() };
      },
    },
  ];
}
