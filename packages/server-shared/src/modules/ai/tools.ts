/**
 * Barrel for the AI tool registry. The implementation lives in ./tools/ —
 * one module per product domain, each colocating a tool's model-facing
 * definition with its server-side implementation:
 *
 *   tools/types.ts         ToolDef / PendingAction / ActionBilling / ToolEntry / ToolModuleCtx
 *   tools/helpers.ts       shared schema builders, validators, billing lookups
 *   tools/brand.ts         profile, policies, Info Hub, documents, tasks, team, support
 *   tools/agencies.ts      connected/verified agencies, marketplace, outreach drafts
 *   tools/projects.ts      projects, proposals, meetings, invoices, purchases
 *   tools/reviews.ts       review locations, stats, win-tags, public directory
 *   tools/review-embeds.ts embed widgets + collections
 *   tools/links.ts         short links, campaigns, analytics, QR styling
 *   tools/signatures.ts    signature members, settings, campaigns, analytics
 *   tools/services.ts      the brand's own services catalog
 *   tools/billing.ts       feature subscriptions + card on file
 *   tools/interaction.ts   ask_user form + settlement follow-up
 *   tools/index.ts         buildTools(): assembles the registry + dispatcher
 *
 * Adding a tool = one { def, run } entry in the matching domain module (plus
 * the client-side wiring: PendingAction kind here/ai-stream.ts, the CardSpec in
 * message-panel.tsx, and a mention in system-prompt.md if behaviour-relevant).
 */
export { buildTools } from './tools/index.js';
export type { ActionBilling, PendingAction, ToolDef, ToolEntry, ToolModuleCtx } from './tools/index.js';
