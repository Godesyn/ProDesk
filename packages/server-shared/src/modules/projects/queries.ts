/**
 * Delivery & money-flow — shared BRAND-scoped read cores used by the AI chatbot
 * tools (ai/tools/projects.ts) and, where the query matches, the tRPC routers
 * (purchases.list today). Every function takes an already-authorized `brandId`
 * and performs NO permission check — the caller gates first (tRPC via
 * assertBrandAccess, the tool via the brand-bound ToolModuleCtx).
 *
 * These deliberately encode the BRAND-VISIBILITY rules the chatbot tools were
 * previously missing, so the assistant can never surface rows the dashboard
 * hides: projects `viewableToBrand`, proposals `status <> 'draft'`, purchases
 * `isInternal = false`, and invoices that include payments-sourced rows.
 */
import { and, count, desc, eq, inArray, isNotNull, isNull, ne, or, type SQL } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import {
  invoices,
  meetings,
  payouts,
  projectDeliverables,
  projectNotes,
  projectRevisions,
  projects,
  proposalComments,
  proposalDocuments,
  proposalItems,
  proposalPhases,
  proposals,
  purchaseItems,
  purchases,
} from '../../db/schema.js';

/* ── Projects ──────────────────────────────────────────────────────────── */

export async function listBrandProjects(
  db: DB,
  brandId: string,
  opts: { excludeCompleted?: boolean; viewableOnly?: boolean; limit?: number } = {},
) {
  const filters: SQL[] = [eq(projects.brandId, brandId), isNull(projects.deletedAt)];
  // Brand visibility: the dashboard only ever shows brand-viewable projects.
  if (opts.viewableOnly) filters.push(eq(projects.viewableToBrand, true));
  if (opts.excludeCompleted) filters.push(ne(projects.status, 'completed'));
  const q = db
    .select()
    .from(projects)
    .where(and(...filters))
    .orderBy(desc(projects.createdAt))
    .$dynamic();
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Count of deliverables awaiting review, per project. */
export async function pendingReviewCountsByProject(db: DB, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: projectDeliverables.projectId, value: count() })
    .from(projectDeliverables)
    .where(and(inArray(projectDeliverables.projectId, projectIds), eq(projectDeliverables.status, 'pending')))
    .groupBy(projectDeliverables.projectId);
  return new Map(rows.map((r) => [r.projectId, Number(r.value)]));
}

/** One brand-scoped project (excludes soft-deleted / other brands). */
export async function getBrandProject(db: DB, brandId: string, projectId: string) {
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.brandId, brandId), isNull(projects.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** Deliverables + notes + revisions for a project (notes/revisions newest first). */
export async function getProjectChildren(db: DB, projectId: string, opts: { limit: number }) {
  const [deliverables, notes, revisions] = await Promise.all([
    db
      .select()
      .from(projectDeliverables)
      .where(eq(projectDeliverables.projectId, projectId))
      .orderBy(projectDeliverables.sortOrder, projectDeliverables.uploadedAt)
      .limit(opts.limit),
    db
      .select()
      .from(projectNotes)
      .where(eq(projectNotes.projectId, projectId))
      .orderBy(desc(projectNotes.createdAt))
      .limit(opts.limit),
    db
      .select()
      .from(projectRevisions)
      .where(eq(projectRevisions.projectId, projectId))
      .orderBy(desc(projectRevisions.createdAt))
      .limit(opts.limit),
  ]);
  return { deliverables, notes, revisions };
}

/* ── Proposals ─────────────────────────────────────────────────────────── */

export async function listBrandProposals(
  db: DB,
  brandId: string,
  opts: { excludeDrafts?: boolean; limit?: number } = {},
) {
  const filters: SQL[] = [eq(proposals.brandId, brandId)];
  // Brands never see draft proposals (parity with the dashboard's proposals.list).
  if (opts.excludeDrafts) filters.push(ne(proposals.status, 'draft'));
  const q = db
    .select()
    .from(proposals)
    .where(and(...filters))
    .orderBy(desc(proposals.createdAt))
    .$dynamic();
  return opts.limit ? q.limit(opts.limit) : q;
}

/** One brand-scoped proposal. */
export async function getBrandProposal(db: DB, brandId: string, proposalId: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.brandId, brandId)))
    .limit(1);
  return row ?? null;
}

/** Phases + items + documents + comments for a proposal (comments oldest first). */
export async function getProposalChildren(
  db: DB,
  proposalId: string,
  opts: { itemsLimit: number; commentsLimit: number },
) {
  const [phases, items, documents, comments] = await Promise.all([
    db.select().from(proposalPhases).where(eq(proposalPhases.proposalId, proposalId)).orderBy(proposalPhases.sortOrder),
    db
      .select()
      .from(proposalItems)
      .where(eq(proposalItems.proposalId, proposalId))
      .orderBy(proposalItems.sortOrder)
      .limit(opts.itemsLimit),
    db.select().from(proposalDocuments).where(eq(proposalDocuments.proposalId, proposalId)),
    db
      .select()
      .from(proposalComments)
      .where(eq(proposalComments.proposalId, proposalId))
      .orderBy(proposalComments.createdAt)
      .limit(opts.commentsLimit),
  ]);
  return { phases, items, documents, comments };
}

/* ── Meetings ──────────────────────────────────────────────────────────── */

export async function listBrandMeetings(db: DB, brandId: string, opts: { limit?: number; offset?: number } = {}) {
  let q = db
    .select()
    .from(meetings)
    .where(eq(meetings.brandId, brandId))
    .orderBy(desc(meetings.startTime))
    .$dynamic();
  if (opts.limit !== undefined) q = q.limit(opts.limit);
  if (opts.offset !== undefined) q = q.offset(opts.offset);
  return q;
}

/* ── Purchases ─────────────────────────────────────────────────────────── */

export async function listBrandPurchases(
  db: DB,
  brandId: string,
  opts: { excludeInternal?: boolean; limit?: number; offset?: number } = {},
) {
  const filters: SQL[] = [eq(purchases.brandId, brandId), eq(purchases.viewableToBrand, true)];
  // Internal/complimentary purchases are surfaced via projects, not order history.
  if (opts.excludeInternal) filters.push(eq(purchases.isInternal, false));
  let q = db
    .select()
    .from(purchases)
    .where(and(...filters))
    .orderBy(desc(purchases.createdAt))
    .$dynamic();
  if (opts.limit !== undefined) q = q.limit(opts.limit);
  if (opts.offset !== undefined) q = q.offset(opts.offset);
  return q;
}

/** Purchase-item rows grouped by purchase id. */
export async function purchaseItemsByPurchase(
  db: DB,
  purchaseIds: string[],
): Promise<Map<string, (typeof purchaseItems.$inferSelect)[]>> {
  const byPurchase = new Map<string, (typeof purchaseItems.$inferSelect)[]>();
  if (purchaseIds.length === 0) return byPurchase;
  const items = await db.select().from(purchaseItems).where(inArray(purchaseItems.purchaseId, purchaseIds));
  for (const it of items) {
    const list = byPurchase.get(it.purchaseId) ?? [];
    list.push(it);
    byPurchase.set(it.purchaseId, list);
  }
  return byPurchase;
}

/* ── Invoices ──────────────────────────────────────────────────────────── */

/**
 * Invoices billed TO a brand: purchase-scoped (marketplace) OR payments-sourced
 * (an inbound charge where the brand is the `from` party — no purchaseId). LEFT
 * JOINs purchases so payments-sourced rows still surface, and LEFT JOINs payouts
 * so the caller can derive status. Mirrors the brand branch of invoices.list.
 */
export async function listBrandInvoices(db: DB, brandId: string, opts: { limit?: number } = {}) {
  const q = db
    .select({
      id: invoices.id,
      number: invoices.number,
      total: invoices.total,
      payoutStatus: payouts.status,
      issuedAt: invoices.createdAt,
    })
    .from(invoices)
    .leftJoin(purchases, eq(invoices.purchaseId, purchases.id))
    .leftJoin(payouts, eq(invoices.payoutId, payouts.id))
    .where(
      or(
        eq(purchases.brandId, brandId),
        and(isNotNull(invoices.paymentTransactionId), eq(invoices.fromBrandId, brandId)),
      )!,
    )
    .orderBy(desc(invoices.createdAt))
    .$dynamic();
  return opts.limit ? q.limit(opts.limit) : q;
}
