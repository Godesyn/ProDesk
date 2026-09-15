/**
 * Signatures (SIGKITT) — shared read/query helpers used by BOTH the tRPC
 * `signaturesRouter` and the AI chatbot's signature tools (ai/tools/signatures.ts).
 *
 * Brand ↔ signature-brand ("kit") is 1:1, so callers may scope by either the
 * Prodesk `brandId` or the satellite `signatureBrandId` — the helpers accept
 * whichever the caller holds. No auth here: the caller gates first (tRPC via
 * assertBrandAccess / requireBrandKitRead, the tool via the brand-bound ctx).
 */
import { and, count, eq, type SQL } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { signatureAnalyticsEvents, signatureMembers } from '../../db/schema.js';

/**
 * A brand's signature members (seats), alphabetical. Scope by brandId or the
 * 1:1 signatureBrandId. `includeInactive` defaults false (active seats only —
 * a parked/unpaid seat is hidden until its checkout completes).
 */
export async function listSignatureMembers(
  db: DB,
  opts: { brandId?: string; signatureBrandId?: string; includeInactive?: boolean; limit?: number },
) {
  const filters: SQL[] = [];
  if (opts.signatureBrandId) filters.push(eq(signatureMembers.signatureBrandId, opts.signatureBrandId));
  if (opts.brandId) filters.push(eq(signatureMembers.brandId, opts.brandId));
  if (!opts.includeInactive) filters.push(eq(signatureMembers.isActive, true));
  const q = db
    .select()
    .from(signatureMembers)
    .where(and(...filters))
    .orderBy(signatureMembers.fullName)
    .$dynamic();
  return opts.limit ? q.limit(opts.limit) : q;
}

/**
 * Total signature-analytics events + a per-type breakdown (busiest first).
 * Shared by tRPC `analytics.summary` and the AI `get_signature_analytics` tool.
 */
export async function signatureEventTotals(
  db: DB,
  opts: { brandId: string; signatureBrandId?: string },
): Promise<{ total: number; byType: Array<{ eventType: string; count: number }> }> {
  const conds = [eq(signatureAnalyticsEvents.brandId, opts.brandId)];
  if (opts.signatureBrandId) conds.push(eq(signatureAnalyticsEvents.signatureBrandId, opts.signatureBrandId));
  const rows = await db
    .select({ eventType: signatureAnalyticsEvents.eventType, count: count() })
    .from(signatureAnalyticsEvents)
    .where(and(...conds))
    .groupBy(signatureAnalyticsEvents.eventType);
  const byType = rows
    .map((r) => ({ eventType: r.eventType, count: Number(r.count) }))
    .sort((a, b) => b.count - a.count);
  return { total: byType.reduce((s, r) => s + r.count, 0), byType };
}

/**
 * Signature engagement grouped by member (most-clicked first). Left-joins the
 * member so events whose member was later deleted still count (as "Unknown"),
 * matching the dashboard. Shared by tRPC `analytics.byMember` and the AI
 * `get_signature_analytics` tool (which caps to the top N).
 */
export async function signatureEventsByMember(
  db: DB,
  opts: { brandId: string; limit?: number },
): Promise<Array<{ memberId: string; memberName: string; total: number }>> {
  const rows = await db
    .select({
      memberId: signatureAnalyticsEvents.memberId,
      memberName: signatureMembers.fullName,
      count: count(),
    })
    .from(signatureAnalyticsEvents)
    .leftJoin(signatureMembers, eq(signatureAnalyticsEvents.memberId, signatureMembers.id))
    .where(eq(signatureAnalyticsEvents.brandId, opts.brandId))
    .groupBy(signatureAnalyticsEvents.memberId, signatureMembers.fullName);
  const ranked = rows
    .map((r) => ({ memberId: r.memberId ?? '', memberName: r.memberName ?? 'Unknown', total: Number(r.count) }))
    .sort((a, b) => b.total - a.total);
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}
