/**
 * Payments (EziQuotes) — drizzle query helpers, ported from the Manus export's
 * server/db.ts (plus its server/db/categories.ts helpers, which the categories
 * router seeds lazily). Rewritten for the monorepo:
 *
 *  - `db` is the shared always-present handle from db/index.ts — the export's
 *    null-db pattern (`const db = await getDb(); if (!db) return …`) is gone.
 *  - Tenancy is brand-scoped: every Manus `accountId: number` is `brandId: string`
 *    (uuid); all ids are uuids. Manus `accounts` → `paymentAccounts` (a 1:1 brand
 *    settings row), `clients` → `paymentClients`, `payments` → `paymentTransactions`.
 *  - User/session/team helpers are dropped — platform users + staff replace them.
 *  - Raw SQL fragments were rewritten from the export's camelCase-quoted columns
 *    to this schema's snake_case columns (via drizzle column interpolation).
 */
import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  brands,
  paymentAccounts,
  paymentActivityLog,
  paymentAddons,
  paymentBrandKits,
  paymentCategories,
  paymentClientNotes,
  paymentClientReferrals,
  paymentClients,
  paymentFeatureFlags,
  paymentPricingTables,
  paymentProducts,
  paymentQuickSets,
  paymentSmsMessages,
  paymentSupportTickets,
  paymentTemplates,
  paymentTransactions,
  proposals,
} from '../../db/schema.js';
import type {
  InsertPaymentCategory,
  PaymentAccount,
  PaymentCategory,
  PaymentSupportTicket,
} from '../../db/schema.js';
import { ensureDerivedAgency } from '../agency/derive.js';

/**
 * Payments-facing proposal insert shape: the canonical `proposals` insert minus
 * the fields the merge injects (kind/agencyId/recipientContactId), plus the
 * legacy `clientId` alias (mapped to recipientContactId). brandId stays required
 * (the vendor brand), preserving the old payment_proposals contract for callers.
 */
type PayerProposalInsert = Omit<
  typeof proposals.$inferInsert,
  'kind' | 'agencyId' | 'recipientContactId' | 'brandId'
> & { brandId: string; clientId?: string | null };
type ProposalStatus = (typeof proposals.$inferSelect)['status'];

/**
 * WS2: EziQuotes proposals now live in the canonical `proposals` table as
 * `kind='payer'` rows. These helpers translate the payments-facing shape
 * (brandId = vendor brand, clientId = recipient contact) onto the canonical
 * columns: the vendor brand acts through its derived (shadow) agency
 * (proposals.agencyId), the recipient contact is proposals.recipientContactId,
 * and brandId stays the vendor brand so the existing brand-scoped payments
 * queries/RLS keep working unchanged. Payer rows are always filtered by
 * kind='payer' so marketplace proposals never leak into payments views.
 */
const PAYER = 'payer' as const;

/** Resolve (creating if needed) the derived agency a brand acts through. */
export async function getDerivedAgencyId(brandId: string): Promise<string | null> {
  const [brand] = await db
    .select({ id: brands.id, ownerId: brands.ownerId, businessName: brands.businessName, derivedToAgencyId: brands.derivedToAgencyId })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return null;
  return ensureDerivedAgency(db, brand);
}

// ============================================================
// Payment accounts (1:1 brand settings row)
// ============================================================
export async function getPaymentAccount(brandId: string): Promise<PaymentAccount | undefined> {
  const result = await db
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.brandId, brandId))
    .limit(1);
  return result[0];
}

export async function getPaymentAccountById(id: string): Promise<PaymentAccount | undefined> {
  const result = await db.select().from(paymentAccounts).where(eq(paymentAccounts.id, id)).limit(1);
  return result[0];
}

/**
 * The brand's registered legal name (brands.legalName), when set — the name that
 * should appear on invoice/receipt documents. Returns null when unset so callers
 * can fall back to the account's business/trading name. Lives on `brands` (the
 * canonical identity); payment_accounts has no legal-name column.
 */
export async function getBrandLegalName(brandId: string): Promise<string | null> {
  const [brand] = await db
    .select({ legalName: brands.legalName })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return brand?.legalName?.trim() || null;
}

/**
 * Ensure the brand has a payment_accounts settings row, creating it with the
 * same defaults the export's accounts.ensureAccount seeded (businessName +
 * email + onboardingState 'profile'; everything else is column defaults).
 * Business name/email come from the brand row (the export used the owner's
 * profile — brand-scoped tenancy makes the brand itself the natural source).
 * NOTE: the export seeded default line-item categories lazily from the
 * categories router, not at account creation — `seedDefaultCategories` below
 * preserves that (call it from the ported categories router).
 */
export async function ensurePaymentAccount(brandId: string): Promise<PaymentAccount> {
  const existing = await getPaymentAccount(brandId);
  if (existing) return existing;

  const [brand] = await db
    .select({ businessName: brands.businessName, email: brands.email })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) throw new Error('Brand not found');

  const inserted = await db
    .insert(paymentAccounts)
    .values({
      brandId,
      businessName: brand.businessName ?? 'My Business',
      email: brand.email ?? null,
      onboardingState: 'profile',
    })
    .onConflictDoNothing({ target: paymentAccounts.brandId })
    .returning();
  if (inserted[0]) return inserted[0];
  // Row was created concurrently — read it back.
  const account = await getPaymentAccount(brandId);
  if (!account) throw new Error('Failed to ensure payment account');
  return account;
}

export async function updatePaymentAccount(
  brandId: string,
  data: Partial<typeof paymentAccounts.$inferInsert>,
) {
  await db.update(paymentAccounts).set(data).where(eq(paymentAccounts.brandId, brandId));
}

export async function listPaymentAccounts(opts: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const conditions = [];
  if (opts.search)
    conditions.push(
      or(
        like(paymentAccounts.businessName, `%${opts.search}%`),
        like(paymentAccounts.email, `%${opts.search}%`),
      ),
    );
  if (opts.status) conditions.push(eq(paymentAccounts.reviewState, opts.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(paymentAccounts)
    .where(where)
    .orderBy(desc(paymentAccounts.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentAccounts)
    .where(where);
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

// ============================================================
// Brand Kit
// ============================================================
export async function getBrandKit(brandId: string) {
  const result = await db
    .select()
    .from(paymentBrandKits)
    .where(eq(paymentBrandKits.brandId, brandId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertBrandKit(
  brandId: string,
  data: Partial<typeof paymentBrandKits.$inferInsert>,
) {
  const existing = await getBrandKit(brandId);
  if (existing) {
    await db.update(paymentBrandKits).set(data).where(eq(paymentBrandKits.brandId, brandId));
  } else {
    await db.insert(paymentBrandKits).values({ brandId, ...data });
  }
}

// ============================================================
// Clients (the vendor's payers — not platform users)
// ============================================================
export async function listClients(
  brandId: string,
  opts: { search?: string; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const conditions = [eq(paymentClients.brandId, brandId)];
  if (opts.search) {
    const s = opts.search;
    conditions.push(
      or(
        like(paymentClients.name, `%${s}%`),
        like(paymentClients.email, `%${s}%`),
        like(paymentClients.businessName, `%${s}%`),
      )!,
    );
  }
  const where = and(...conditions);
  const rows = await db
    .select()
    .from(paymentClients)
    .where(where)
    .orderBy(desc(paymentClients.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentClients)
    .where(where);
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

export async function getClientById(id: string, brandId: string) {
  const result = await db
    .select()
    .from(paymentClients)
    .where(and(eq(paymentClients.id, id), eq(paymentClients.brandId, brandId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createClient(data: typeof paymentClients.$inferInsert) {
  const result = await db.insert(paymentClients).values(data).returning({ id: paymentClients.id });
  return result[0]!.id;
}

export async function updateClient(
  id: string,
  brandId: string,
  data: Partial<typeof paymentClients.$inferInsert>,
) {
  await db
    .update(paymentClients)
    .set(data)
    .where(and(eq(paymentClients.id, id), eq(paymentClients.brandId, brandId)));
}

export async function deleteClient(id: string, brandId: string) {
  await db
    .delete(paymentClients)
    .where(and(eq(paymentClients.id, id), eq(paymentClients.brandId, brandId)));
}

// ============================================================
// Products
// ============================================================
export async function listProducts(brandId: string) {
  return db
    .select()
    .from(paymentProducts)
    .where(and(eq(paymentProducts.brandId, brandId), eq(paymentProducts.status, 'active')))
    .orderBy(paymentProducts.name);
}

export async function getProductById(id: string, brandId: string) {
  const result = await db
    .select()
    .from(paymentProducts)
    .where(and(eq(paymentProducts.id, id), eq(paymentProducts.brandId, brandId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createProduct(data: typeof paymentProducts.$inferInsert) {
  const result = await db.insert(paymentProducts).values(data).returning({ id: paymentProducts.id });
  return result[0]!.id;
}

export async function updateProduct(
  id: string,
  brandId: string,
  data: Partial<typeof paymentProducts.$inferInsert>,
) {
  await db
    .update(paymentProducts)
    .set(data)
    .where(and(eq(paymentProducts.id, id), eq(paymentProducts.brandId, brandId)));
}

// ============================================================
// Add-ons
// ============================================================
export async function listAddons(brandId: string) {
  return db
    .select()
    .from(paymentAddons)
    .where(and(eq(paymentAddons.brandId, brandId), eq(paymentAddons.status, 'active')))
    .orderBy(paymentAddons.name);
}

export async function createAddon(data: typeof paymentAddons.$inferInsert) {
  const result = await db.insert(paymentAddons).values(data).returning({ id: paymentAddons.id });
  return result[0]!.id;
}

export async function updateAddon(
  id: string,
  brandId: string,
  data: Partial<typeof paymentAddons.$inferInsert>,
) {
  await db
    .update(paymentAddons)
    .set(data)
    .where(and(eq(paymentAddons.id, id), eq(paymentAddons.brandId, brandId)));
}

// ============================================================
// Pricing Tables
// ============================================================
export async function listPricingTables(brandId: string) {
  return db
    .select()
    .from(paymentPricingTables)
    .where(eq(paymentPricingTables.brandId, brandId))
    .orderBy(paymentPricingTables.name);
}

export async function createPricingTable(data: typeof paymentPricingTables.$inferInsert) {
  const result = await db
    .insert(paymentPricingTables)
    .values(data)
    .returning({ id: paymentPricingTables.id });
  return result[0]!.id;
}

export async function updatePricingTable(
  id: string,
  brandId: string,
  data: Partial<typeof paymentPricingTables.$inferInsert>,
) {
  await db
    .update(paymentPricingTables)
    .set(data)
    .where(and(eq(paymentPricingTables.id, id), eq(paymentPricingTables.brandId, brandId)));
}

// ============================================================
// Quick Sets
// ============================================================
export async function listQuickSets(brandId: string) {
  return db
    .select()
    .from(paymentQuickSets)
    .where(and(eq(paymentQuickSets.brandId, brandId), eq(paymentQuickSets.status, 'active')))
    .orderBy(paymentQuickSets.name);
}

export async function createQuickSet(data: typeof paymentQuickSets.$inferInsert) {
  const result = await db.insert(paymentQuickSets).values(data).returning({ id: paymentQuickSets.id });
  return result[0]!.id;
}

export async function updateQuickSet(
  id: string,
  brandId: string,
  data: Partial<typeof paymentQuickSets.$inferInsert>,
) {
  await db
    .update(paymentQuickSets)
    .set(data)
    .where(and(eq(paymentQuickSets.id, id), eq(paymentQuickSets.brandId, brandId)));
}

// ============================================================
// Templates
// ============================================================
export async function listTemplates(brandId: string) {
  return db
    .select()
    .from(paymentTemplates)
    .where(and(eq(paymentTemplates.brandId, brandId), eq(paymentTemplates.status, 'active')))
    .orderBy(desc(paymentTemplates.updatedAt));
}

export async function getTemplateById(id: string, brandId: string) {
  const result = await db
    .select()
    .from(paymentTemplates)
    .where(and(eq(paymentTemplates.id, id), eq(paymentTemplates.brandId, brandId)))
    .limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function createTemplate(data: typeof paymentTemplates.$inferInsert) {
  const result = await db.insert(paymentTemplates).values(data).returning({ id: paymentTemplates.id });
  return result[0]!.id;
}

export async function updateTemplate(
  id: string,
  brandId: string,
  data: Partial<typeof paymentTemplates.$inferInsert>,
) {
  await db
    .update(paymentTemplates)
    .set(data)
    .where(and(eq(paymentTemplates.id, id), eq(paymentTemplates.brandId, brandId)));
}

// ============================================================
// Proposals
// ============================================================
export async function listProposals(
  brandId: string,
  opts: { status?: string; search?: string; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const conditions = [eq(proposals.brandId, brandId), eq(proposals.kind, PAYER)];
  if (opts.status) conditions.push(eq(proposals.status, opts.status as ProposalStatus));
  if (opts.search) {
    const s = opts.search;
    conditions.push(
      or(like(proposals.title, `%${s}%`), like(proposals.slug, `%${s}%`))!,
    );
  }
  const where = and(...conditions);
  const rows = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      slug: proposals.slug,
      status: proposals.status,
      totalCents: proposals.totalCents,
      currency: proposals.currency,
      paymentModel: proposals.paymentModel,
      createdAt: proposals.createdAt,
      sentAt: proposals.sentAt,
      viewedAt: proposals.viewedAt,
      acceptedAt: proposals.acceptedAt,
      paidAt: proposals.paidAt,
      expiresAt: proposals.expiresAt,
      clientId: proposals.recipientContactId,
      clientName: paymentClients.name,
      clientBusinessName: paymentClients.businessName,
      winScore: proposals.winScore,
      viewCount: proposals.viewCount,
      maxScrollDepth: proposals.maxScrollDepth,
      updatedAt: proposals.updatedAt,
    })
    .from(proposals)
    .leftJoin(paymentClients, eq(proposals.recipientContactId, paymentClients.id))
    .where(where)
    .orderBy(desc(proposals.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(proposals)
    .where(where);
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

/**
 * Add the payments-facing `clientId` alias onto a canonical proposals row and
 * narrow `brandId` to non-null: payer proposals always carry the vendor brand
 * (set on create), so the ported payments code can treat it as required.
 */
export function withClientId<T extends { recipientContactId: string | null; brandId: string | null }>(
  row: T,
): Omit<T, 'brandId'> & { clientId: string | null; brandId: string } {
  return { ...row, clientId: row.recipientContactId, brandId: row.brandId as string };
}

export async function getProposalById(id: string, brandId: string) {
  const result = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.brandId, brandId), eq(proposals.kind, PAYER)))
    .limit(1);
  return result.length > 0 ? withClientId(result[0]!) : undefined;
}

export async function getProposalBySlug(slug: string) {
  const result = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.slug, slug), eq(proposals.kind, PAYER)))
    .limit(1);
  return result.length > 0 ? withClientId(result[0]!) : undefined;
}

export async function createProposal(data: PayerProposalInsert) {
  // Vendor brand acts through its derived agency; recipient = the CRM contact.
  const { clientId, ...rest } = data;
  const agencyId = await getDerivedAgencyId(data.brandId);
  const result = await db
    .insert(proposals)
    .values({ ...rest, agencyId, kind: PAYER, recipientContactId: clientId ?? null })
    .returning({ id: proposals.id });
  return result[0]!.id;
}

export async function updateProposal(
  id: string,
  brandId: string,
  data: Partial<PayerProposalInsert>,
) {
  const { clientId, ...rest } = data;
  const patch = clientId !== undefined ? { ...rest, recipientContactId: clientId } : rest;
  await db
    .update(proposals)
    .set(patch)
    .where(and(eq(proposals.id, id), eq(proposals.brandId, brandId), eq(proposals.kind, PAYER)));
}

export async function deleteProposal(id: string, brandId: string) {
  await db
    .delete(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.brandId, brandId), eq(proposals.kind, PAYER)));
}

// ============================================================
// Payments (transactions)
// ============================================================
export async function listPayments(brandId: string, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const rows = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.brandId, brandId))
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentTransactions)
    .where(eq(paymentTransactions.brandId, brandId));
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

export async function listAllPayments(
  opts: { limit?: number; offset?: number; search?: string } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const searchCond = opts.search
    ? or(
        like(paymentAccounts.businessName, `%${opts.search}%`),
        like(paymentTransactions.stripeChargeId, `%${opts.search}%`),
      )
    : undefined;
  const rows = await db
    .select({
      id: paymentTransactions.id,
      proposalId: paymentTransactions.proposalId,
      brandId: paymentTransactions.brandId,
      amountCents: paymentTransactions.amountCents,
      currency: paymentTransactions.currency,
      status: paymentTransactions.status,
      paidAt: paymentTransactions.paidAt,
      applicationFeeCents: paymentTransactions.applicationFeeCents,
      stripeChargeId: paymentTransactions.stripeChargeId,
      createdAt: paymentTransactions.createdAt,
      businessName: paymentAccounts.businessName,
    })
    .from(paymentTransactions)
    .leftJoin(paymentAccounts, eq(paymentTransactions.brandId, paymentAccounts.brandId))
    .where(searchCond)
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentTransactions)
    .leftJoin(paymentAccounts, eq(paymentTransactions.brandId, paymentAccounts.brandId))
    .where(searchCond);
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

// ============================================================
// Activity Log
// ============================================================
export async function logActivity(data: typeof paymentActivityLog.$inferInsert) {
  try {
    await db.insert(paymentActivityLog).values(data);
  } catch (e) {
    console.warn('[ActivityLog] Failed to log:', e);
  }
}

export async function getActivityForAccount(brandId: string, limit = 20) {
  return db
    .select()
    .from(paymentActivityLog)
    .where(eq(paymentActivityLog.brandId, brandId))
    .orderBy(desc(paymentActivityLog.occurredAt))
    .limit(limit);
}

// ============================================================
// Account vetting reviews (reviewState lives on paymentAccounts)
// ============================================================
export async function listPendingReviews(opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const where = or(
    eq(paymentAccounts.reviewState, 'pending'),
    eq(paymentAccounts.reviewState, 'under_review'),
  );
  const rows = await db
    .select()
    .from(paymentAccounts)
    .where(where)
    .orderBy(paymentAccounts.createdAt)
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentAccounts)
    .where(where);
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

// ============================================================
// Support Tickets
// ============================================================
export async function listSupportTickets(
  opts: { status?: string; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const conditions = [];
  if (opts.status)
    conditions.push(eq(paymentSupportTickets.status, opts.status as PaymentSupportTicket['status']));
  const where2 = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select({
      id: paymentSupportTickets.id,
      subject: paymentSupportTickets.subject,
      status: paymentSupportTickets.status,
      priority: paymentSupportTickets.priority,
      brandId: paymentSupportTickets.brandId,
      createdAt: paymentSupportTickets.createdAt,
      updatedAt: paymentSupportTickets.updatedAt,
      businessName: paymentAccounts.businessName,
    })
    .from(paymentSupportTickets)
    .leftJoin(paymentAccounts, eq(paymentSupportTickets.brandId, paymentAccounts.brandId))
    .where(where2)
    .orderBy(desc(paymentSupportTickets.createdAt))
    .limit(limit)
    .offset(offset);
  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentSupportTickets)
    .where(where2);
  return { rows, total: Number(countResult[0]?.count ?? 0) };
}

// ============================================================
// Feature Flags
// ============================================================
export async function listFeatureFlags() {
  return db.select().from(paymentFeatureFlags).orderBy(paymentFeatureFlags.key);
}

export async function updateFeatureFlag(
  key: string,
  data: Partial<typeof paymentFeatureFlags.$inferInsert>,
) {
  await db.update(paymentFeatureFlags).set(data).where(eq(paymentFeatureFlags.key, key));
}

// ============================================================
// SMS
// ============================================================
export async function createSmsMessage(data: typeof paymentSmsMessages.$inferInsert) {
  const result = await db.insert(paymentSmsMessages).values(data).returning({ id: paymentSmsMessages.id });
  return result[0]!.id;
}

// ============================================================
// Dashboard KPIs
// ============================================================
export async function getDashboardKpis(brandId: string) {
  const [revenueResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${paymentTransactions.amountCents}), 0)`,
    })
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.brandId, brandId), eq(paymentTransactions.status, 'succeeded')));
  const [proposalCounts] = await db
    .select({
      total: sql<number>`count(*)`,
      accepted: sql<number>`SUM(CASE WHEN ${proposals.status} IN ('accepted','paid','active') THEN 1 ELSE 0 END)`,
      sent: sql<number>`SUM(CASE WHEN ${proposals.status} != 'draft' THEN 1 ELSE 0 END)`,
    })
    .from(proposals)
    .where(and(eq(proposals.brandId, brandId), eq(proposals.kind, PAYER)));
  const total = Number(proposalCounts?.total ?? 0);
  const sent = Number(proposalCounts?.sent ?? 0);
  const accepted = Number(proposalCounts?.accepted ?? 0);
  return {
    totalRevenue: Number(revenueResult?.total ?? 0),
    activeProposals: total,
    acceptanceRate: sent > 0 ? Math.round((accepted / sent) * 100) : 0,
    avgDealSize: accepted > 0 ? Math.round(Number(revenueResult?.total ?? 0) / accepted) : 0,
  };
}

// ============================================================
// Admin stats
// ============================================================
export async function getAdminStats() {
  const [accountStats] = await db
    .select({
      total: sql<number>`count(*)`,
      pending: sql<number>`SUM(CASE WHEN ${paymentAccounts.reviewState} = 'pending' OR ${paymentAccounts.reviewState} = 'under_review' THEN 1 ELSE 0 END)`,
      stripeActive: sql<number>`SUM(CASE WHEN ${paymentAccounts.stripeConnectStatus} = 'active' THEN 1 ELSE 0 END)`,
    })
    .from(paymentAccounts);
  const [revenueResult] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${paymentTransactions.applicationFeeCents}), 0)`,
    })
    .from(paymentTransactions)
    .where(eq(paymentTransactions.status, 'succeeded'));
  return {
    totalAccounts: Number(accountStats?.total ?? 0),
    pendingReviews: Number(accountStats?.pending ?? 0),
    totalRevenue: Number(revenueResult?.total ?? 0),
    activeStripe: Number(accountStats?.stripeActive ?? 0),
  };
}

// ============================================================
// Chase helpers
// ============================================================
export async function getProposalByChaseToken(token: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.chaseToken, token), eq(proposals.kind, PAYER)))
    .limit(1);
  return row ? withClientId(row) : null;
}

export async function listOverdueProposals(brandId: string) {
  const rows = await db
    .select()
    .from(proposals)
    .where(
      and(
        eq(proposals.brandId, brandId),
        eq(proposals.kind, PAYER),
        sql`${proposals.status} IN ('past_due', 'active')`,
      ),
    )
    .orderBy(proposals.updatedAt);
  return rows.map(withClientId);
}

export async function getPaymentByProposalId(proposalId: string) {
  const [row] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.proposalId, proposalId))
    .orderBy(paymentTransactions.createdAt)
    .limit(1);
  return row ?? null;
}

// ============================================================
// Dashboard - full KPIs (30-day paid, avg, conversion, time-to-accept)
// ============================================================
export async function getDashboardFullKpis(brandId: string) {
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  // postgres-js requires ISO strings for timestamp params in sql template tags;
  // passing JS Date objects causes Date.toString() serialization which postgres rejects.
  const d30iso = d30.toISOString();
  const d60iso = d60.toISOString();

  const [rev30] = await db
    .select({ total: sql<number>`COALESCE(SUM(${paymentTransactions.amountCents}),0)` })
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.brandId, brandId),
        eq(paymentTransactions.status, 'succeeded'),
        sql`${paymentTransactions.paidAt} >= ${d30iso}::timestamptz`,
      ),
    );
  const [rev60] = await db
    .select({ total: sql<number>`COALESCE(SUM(${paymentTransactions.amountCents}),0)` })
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.brandId, brandId),
        eq(paymentTransactions.status, 'succeeded'),
        sql`${paymentTransactions.paidAt} >= ${d60iso}::timestamptz`,
        sql`${paymentTransactions.paidAt} < ${d30iso}::timestamptz`,
      ),
    );

  const [pc30] = await db
    .select({
      sent: sql<number>`SUM(CASE WHEN ${proposals.sentAt} >= ${d30iso}::timestamptz THEN 1 ELSE 0 END)`,
      accepted: sql<number>`SUM(CASE WHEN ${proposals.acceptedAt} >= ${d30iso}::timestamptz THEN 1 ELSE 0 END)`,
      sentPrior: sql<number>`SUM(CASE WHEN ${proposals.sentAt} >= ${d60iso}::timestamptz AND ${proposals.sentAt} < ${d30iso}::timestamptz THEN 1 ELSE 0 END)`,
      acceptedPrior: sql<number>`SUM(CASE WHEN ${proposals.acceptedAt} >= ${d60iso}::timestamptz AND ${proposals.acceptedAt} < ${d30iso}::timestamptz THEN 1 ELSE 0 END)`,
    })
    .from(proposals)
    .where(and(eq(proposals.brandId, brandId), eq(proposals.kind, PAYER)));

  const sent30 = Number(pc30?.sent ?? 0);
  const accepted30 = Number(pc30?.accepted ?? 0);
  const sentPrior = Number(pc30?.sentPrior ?? 0);
  const acceptedPrior = Number(pc30?.acceptedPrior ?? 0);

  const [avgRow] = await db
    .select({ avg: sql<number>`COALESCE(AVG(${proposals.totalCents}),0)` })
    .from(proposals)
    .where(
      and(
        eq(proposals.brandId, brandId),
        eq(proposals.kind, PAYER),
        sql`${proposals.status} IN ('accepted','paid','active')`,
        sql`${proposals.acceptedAt} >= ${d30iso}::timestamptz`,
        sql`${proposals.totalCents} > 0`,
      ),
    );
  const [avgPriorRow] = await db
    .select({ avg: sql<number>`COALESCE(AVG(${proposals.totalCents}),0)` })
    .from(proposals)
    .where(
      and(
        eq(proposals.brandId, brandId),
        eq(proposals.kind, PAYER),
        sql`${proposals.status} IN ('accepted','paid','active')`,
        sql`${proposals.acceptedAt} >= ${d60iso}::timestamptz`,
        sql`${proposals.acceptedAt} < ${d30iso}::timestamptz`,
        sql`${proposals.totalCents} > 0`,
      ),
    );

  // True median via percentile subquery. (The export aliased AS medianHours
  // unquoted — postgres folds that to lowercase, so we alias snake_case and
  // read it back the same way.)
  const [ttaRow] = (await db.execute(sql`
    SELECT COALESCE(
      AVG(sub.h), 0
    ) AS median_hours
    FROM (
      SELECT EXTRACT(EPOCH FROM (accepted_at - sent_at)) / 3600 AS h,
             ROW_NUMBER() OVER (ORDER BY EXTRACT(EPOCH FROM (accepted_at - sent_at))) AS rn,
             COUNT(*) OVER () AS cnt
      FROM proposals
      WHERE brand_id = ${brandId}
        AND kind = 'payer'
        AND accepted_at IS NOT NULL
        AND sent_at IS NOT NULL
        AND accepted_at >= ${d30iso}::timestamptz
    ) sub
    WHERE sub.rn IN (FLOOR((sub.cnt + 1) / 2), CEIL((sub.cnt + 1) / 2))
  `)) as any;
  const [ttaPriorRow] = (await db.execute(sql`
    SELECT COALESCE(
      AVG(sub.h), 0
    ) AS median_hours
    FROM (
      SELECT EXTRACT(EPOCH FROM (accepted_at - sent_at)) / 3600 AS h,
             ROW_NUMBER() OVER (ORDER BY EXTRACT(EPOCH FROM (accepted_at - sent_at))) AS rn,
             COUNT(*) OVER () AS cnt
      FROM proposals
      WHERE brand_id = ${brandId}
        AND kind = 'payer'
        AND accepted_at IS NOT NULL
        AND sent_at IS NOT NULL
        AND accepted_at >= ${d60iso}::timestamptz
        AND accepted_at < ${d30iso}::timestamptz
    ) sub
    WHERE sub.rn IN (FLOOR((sub.cnt + 1) / 2), CEIL((sub.cnt + 1) / 2))
  `)) as any;

  const [chaseRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(proposals)
    .where(
      and(
        eq(proposals.brandId, brandId),
        eq(proposals.kind, PAYER),
        sql`${proposals.status} IN ('viewed','engaged')`,
        sql`${proposals.sentAt} IS NOT NULL`,
      ),
    );
  const [declinedRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(paymentTransactions)
    .where(and(eq(paymentTransactions.brandId, brandId), eq(paymentTransactions.status, 'failed')));

  return {
    paidLast30d: Number(rev30?.total ?? 0),
    paidPrior30d: Number(rev60?.total ?? 0),
    avgProposalCents: Math.round(Number(avgRow?.avg ?? 0)),
    avgProposalPrior: Math.round(Number(avgPriorRow?.avg ?? 0)),
    conversionRate: sent30 > 0 ? Math.round((accepted30 / sent30) * 100) : 0,
    conversionPrior: sentPrior > 0 ? Math.round((acceptedPrior / sentPrior) * 100) : 0,
    sentLast30d: sent30,
    acceptedLast30d: accepted30,
    medianAcceptHours: Math.round(Number((ttaRow as any)?.median_hours ?? 0)),
    medianAcceptHoursPrior: Math.round(Number((ttaPriorRow as any)?.median_hours ?? 0)),
    chaseCount: Number(chaseRow?.count ?? 0),
    cardDeclinedCount: Number(declinedRow?.count ?? 0),
  };
}

// ============================================================
// Dashboard - action queue
// ============================================================
export async function getDashboardActionQueue(brandId: string) {
  const viewed = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      status: proposals.status,
      totalCents: proposals.totalCents,
      sentAt: proposals.sentAt,
      viewedAt: proposals.viewedAt,
      clientName: paymentClients.name,
      clientBiz: paymentClients.businessName,
    })
    .from(proposals)
    .leftJoin(paymentClients, eq(proposals.recipientContactId, paymentClients.id))
    .where(
      and(
        eq(proposals.brandId, brandId),
        eq(proposals.kind, PAYER),
        sql`${proposals.status} IN ('viewed','engaged')`,
        sql`${proposals.sentAt} IS NOT NULL`,
      ),
    )
    .orderBy(proposals.sentAt)
    .limit(5);

  const declined = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      totalCents: proposals.totalCents,
      clientName: paymentClients.name,
      clientBiz: paymentClients.businessName,
      failedAt: paymentTransactions.updatedAt,
      failureReason: paymentTransactions.failureReason,
      paymentId: paymentTransactions.id,
    })
    .from(paymentTransactions)
    .leftJoin(proposals, eq(paymentTransactions.proposalId, proposals.id))
    .leftJoin(paymentClients, eq(proposals.recipientContactId, paymentClients.id))
    .where(and(eq(paymentTransactions.brandId, brandId), eq(paymentTransactions.status, 'failed')))
    .orderBy(desc(paymentTransactions.updatedAt))
    .limit(5);

  const installments = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      totalCents: proposals.totalCents,
      paymentConfig: proposals.paymentConfig,
      status: proposals.status,
      clientName: paymentClients.name,
      clientBiz: paymentClients.businessName,
    })
    .from(proposals)
    .leftJoin(paymentClients, eq(proposals.recipientContactId, paymentClients.id))
    .where(
      and(
        eq(proposals.brandId, brandId),
        eq(proposals.kind, PAYER),
        eq(proposals.paymentModel, 'payment_plan'),
        sql`${proposals.status} IN ('active','past_due')`,
      ),
    )
    .orderBy(proposals.updatedAt)
    .limit(5);

  const ageStr = (ts: Date | null | undefined) => {
    if (!ts) return '-';
    const h = Math.floor((Date.now() - new Date(ts).getTime()) / 3600000);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    const rem = h % 24;
    return rem > 0 ? `${d}d ${rem}h ago` : `${d}d ago`;
  };

  const queue: Array<{
    type: string;
    proposalId: string;
    title: string;
    clientName: string;
    totalCents: number;
    age: string;
    meta: string;
  }> = [];

  for (const p of viewed) {
    queue.push({
      type: 'viewed',
      proposalId: p.id,
      title: p.title ?? 'Untitled',
      clientName: p.clientBiz ?? p.clientName ?? 'Unknown',
      totalCents: p.totalCents,
      age: `Viewed ${ageStr(p.viewedAt)}`,
      meta: p.status,
    });
  }
  for (const p of declined) {
    queue.push({
      type: 'card_declined',
      proposalId: p.id ?? '',
      title: p.title ?? 'Untitled',
      clientName: p.clientBiz ?? p.clientName ?? 'Unknown',
      totalCents: p.totalCents ?? 0,
      age: ageStr(p.failedAt),
      meta: p.failureReason ?? 'Card declined',
    });
  }
  for (const p of installments) {
    const cfg = p.paymentConfig as any;
    const installNum = cfg?.installmentsPaid != null ? cfg.installmentsPaid + 1 : 1;
    const total = cfg?.installments ?? 3;
    queue.push({
      type: 'installment_due',
      proposalId: p.id,
      title: p.title ?? 'Untitled',
      clientName: p.clientBiz ?? p.clientName ?? 'Unknown',
      totalCents: p.totalCents,
      age: p.status === 'past_due' ? 'Overdue' : 'Due soon',
      meta: `Installment ${installNum} of ${total}`,
    });
  }

  return queue.slice(0, 8);
}

// ============================================================
// Dashboard - revenue chart (monthly totals, last N months)
// ============================================================
export async function getDashboardRevenueChart(brandId: string, months = 7) {
  const rows = await db
    .select({
      month: sql<string>`TO_CHAR(${paymentTransactions.paidAt}, 'YYYY-MM')`,
      total: sql<number>`COALESCE(SUM(${paymentTransactions.amountCents}), 0)`,
    })
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.brandId, brandId),
        eq(paymentTransactions.status, 'succeeded'),
        sql`${paymentTransactions.paidAt} >= NOW() - (${months} || ' months')::interval`,
      ),
    )
    .groupBy(sql`TO_CHAR(${paymentTransactions.paidAt}, 'YYYY-MM')`)
    .orderBy(sql`TO_CHAR(${paymentTransactions.paidAt}, 'YYYY-MM')`);
  return rows.map((r) => ({ month: r.month, totalCents: Number(r.total) }));
}

// ============================================================
// Dashboard - rich activity feed
// ============================================================
export async function getDashboardActivity(brandId: string, limit = 10) {
  const recentProposals = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      status: proposals.status,
      totalCents: proposals.totalCents,
      viewedAt: proposals.viewedAt,
      acceptedAt: proposals.acceptedAt,
      paidAt: proposals.paidAt,
      sentAt: proposals.sentAt,
      clientName: paymentClients.name,
      clientBiz: paymentClients.businessName,
    })
    .from(proposals)
    .leftJoin(paymentClients, eq(proposals.recipientContactId, paymentClients.id))
    .where(and(eq(proposals.brandId, brandId), eq(proposals.kind, PAYER), sql`${proposals.status} != 'draft'`))
    .orderBy(desc(proposals.updatedAt))
    .limit(20);

  const events: Array<{ time: Date; who: string; what: string; volt: boolean; amountCents?: number }> = [];

  for (const p of recentProposals) {
    const name = p.clientBiz ?? p.clientName ?? 'Client';
    const title = p.title ?? 'proposal';
    if (p.paidAt) events.push({ time: new Date(p.paidAt), who: name, what: `paid · ${title}`, volt: true, amountCents: p.totalCents });
    else if (p.acceptedAt) events.push({ time: new Date(p.acceptedAt), who: name, what: `accepted ${title}`, volt: true, amountCents: p.totalCents });
    else if (p.viewedAt) events.push({ time: new Date(p.viewedAt), who: name, what: `opened ${title}`, volt: false });
    else if (p.sentAt) events.push({ time: new Date(p.sentAt), who: 'You', what: `sent ${title} to ${name}`, volt: false });
  }

  const failedPmts = await db
    .select({
      updatedAt: paymentTransactions.updatedAt,
      amountCents: paymentTransactions.amountCents,
      failureReason: paymentTransactions.failureReason,
      clientName: paymentClients.name,
      clientBiz: paymentClients.businessName,
    })
    .from(paymentTransactions)
    .leftJoin(proposals, eq(paymentTransactions.proposalId, proposals.id))
    .leftJoin(paymentClients, eq(proposals.recipientContactId, paymentClients.id))
    .where(and(eq(paymentTransactions.brandId, brandId), eq(paymentTransactions.status, 'failed')))
    .orderBy(desc(paymentTransactions.updatedAt))
    .limit(5);

  for (const f of failedPmts) {
    const name = f.clientBiz ?? f.clientName ?? 'Client';
    events.push({ time: new Date(f.updatedAt), who: name, what: `payment failed - ${f.failureReason ?? 'card declined'}`, volt: false, amountCents: f.amountCents });
  }

  events.sort((a, b) => b.time.getTime() - a.time.getTime());
  return events.slice(0, limit).map((e) => ({ time: e.time, who: e.who, what: e.what, volt: e.volt, amountCents: e.amountCents }));
}

// ── Delete helpers ────────────────────────────────────────────────────────────
export async function deleteProduct(id: string, brandId: string) {
  await db
    .delete(paymentProducts)
    .where(and(eq(paymentProducts.id, id), eq(paymentProducts.brandId, brandId)));
}

export async function deleteAddon(id: string, brandId: string) {
  await db
    .delete(paymentAddons)
    .where(and(eq(paymentAddons.id, id), eq(paymentAddons.brandId, brandId)));
}

export async function deleteQuickSet(id: string, brandId: string) {
  await db
    .delete(paymentQuickSets)
    .where(and(eq(paymentQuickSets.id, id), eq(paymentQuickSets.brandId, brandId)));
}

export async function deleteTemplate(id: string, brandId: string) {
  await db
    .delete(paymentTemplates)
    .where(and(eq(paymentTemplates.id, id), eq(paymentTemplates.brandId, brandId)));
}

// ============================================================
// Client Notes / Timeline
// ============================================================
export async function listClientNotes(brandId: string, clientId: string) {
  return db
    .select()
    .from(paymentClientNotes)
    .where(and(eq(paymentClientNotes.brandId, brandId), eq(paymentClientNotes.clientId, clientId)))
    .orderBy(desc(paymentClientNotes.occurredAt));
}

export async function createClientNote(data: typeof paymentClientNotes.$inferInsert) {
  const result = await db.insert(paymentClientNotes).values(data).returning({ id: paymentClientNotes.id });
  return result[0]!.id;
}

export async function deleteClientNote(id: string, brandId: string) {
  await db
    .delete(paymentClientNotes)
    .where(and(eq(paymentClientNotes.id, id), eq(paymentClientNotes.brandId, brandId)));
}

// ============================================================
// Client Referrals
// ============================================================
export async function listClientReferrals(brandId: string, clientId: string) {
  // Get referrals where this client is the referrer
  return db
    .select()
    .from(paymentClientReferrals)
    .where(
      and(
        eq(paymentClientReferrals.brandId, brandId),
        eq(paymentClientReferrals.referrerClientId, clientId),
      ),
    )
    .orderBy(desc(paymentClientReferrals.createdAt));
}

export async function createClientReferral(data: typeof paymentClientReferrals.$inferInsert) {
  const result = await db
    .insert(paymentClientReferrals)
    .values(data)
    .returning({ id: paymentClientReferrals.id });
  return result[0]!.id;
}

export async function getClientReferredBy(brandId: string, clientId: string) {
  const result = await db
    .select()
    .from(paymentClientReferrals)
    .where(
      and(
        eq(paymentClientReferrals.brandId, brandId),
        eq(paymentClientReferrals.referredClientId, clientId),
      ),
    )
    .limit(1);
  return result[0] ?? null;
}

// ============================================================
// Line-item categories (from the export's server/db/categories.ts).
// Each brand has its own category list. 6 defaults are seeded lazily by the
// categories router. Defaults can be renamed/recoloured but not deleted
// (archivedAt is set instead). Custom categories can be archived too.
// ============================================================
export const DEFAULT_CATEGORIES: Omit<InsertPaymentCategory, 'id' | 'brandId' | 'createdAt'>[] = [
  { code: 'labour', label: 'Labour', colourHex: '#3B82F6', displayOrder: 0, isDefault: true },
  { code: 'materials', label: 'Materials', colourHex: '#10B981', displayOrder: 1, isDefault: true },
  { code: 'software', label: 'Software', colourHex: '#8B5CF6', displayOrder: 2, isDefault: true },
  { code: 'travel', label: 'Travel', colourHex: '#F59E0B', displayOrder: 3, isDefault: true },
  { code: 'other', label: 'Other', colourHex: '#6B7280', displayOrder: 4, isDefault: true },
  { code: 'custom', label: 'Custom', colourHex: '#EC4899', displayOrder: 5, isDefault: true },
];

/**
 * Seed the 6 default categories for a brand.
 * Safe to call multiple times — checks existing default codes first
 * (no unique constraint on code+brandId in the schema).
 */
export async function seedDefaultCategories(brandId: string): Promise<void> {
  const existing = await db
    .select({ code: paymentCategories.code })
    .from(paymentCategories)
    .where(and(eq(paymentCategories.brandId, brandId), eq(paymentCategories.isDefault, true)));

  const existingCodes = new Set(existing.map((r) => r.code));
  const toInsert = DEFAULT_CATEGORIES.filter((c) => !existingCodes.has(c.code));

  if (toInsert.length === 0) return;

  await db.insert(paymentCategories).values(toInsert.map((c) => ({ ...c, brandId })));
}

/** List all active (non-archived) categories for a brand, ordered by displayOrder. */
export async function listCategories(brandId: string): Promise<PaymentCategory[]> {
  return db
    .select()
    .from(paymentCategories)
    .where(and(eq(paymentCategories.brandId, brandId), isNull(paymentCategories.archivedAt)))
    .orderBy(asc(paymentCategories.displayOrder));
}

/** Get a single category by id, scoped to the brand. */
export async function getCategoryById(id: string, brandId: string): Promise<PaymentCategory | null> {
  const [row] = await db
    .select()
    .from(paymentCategories)
    .where(and(eq(paymentCategories.id, id), eq(paymentCategories.brandId, brandId)))
    .limit(1);
  return row ?? null;
}

/** Create a new custom category for a brand. */
export async function createCategory(
  brandId: string,
  data: { code: string; label: string; colourHex: string; displayOrder?: number },
): Promise<PaymentCategory> {
  const existing = await listCategories(brandId);
  const order = data.displayOrder ?? existing.length;
  const [row] = await db
    .insert(paymentCategories)
    .values({ brandId, ...data, displayOrder: order, isDefault: false })
    .returning();
  return row;
}

/** Update label, colourHex, or displayOrder for a category. */
export async function updateCategory(
  id: string,
  brandId: string,
  data: Partial<{ label: string; colourHex: string; displayOrder: number }>,
): Promise<PaymentCategory | null> {
  const [row] = await db
    .update(paymentCategories)
    .set(data)
    .where(and(eq(paymentCategories.id, id), eq(paymentCategories.brandId, brandId)))
    .returning();
  return row ?? null;
}

/**
 * Archive a category (sets archivedAt).
 * Default categories can be archived but not deleted.
 * Custom categories can also be archived via this function.
 */
export async function archiveCategory(id: string, brandId: string): Promise<boolean> {
  const result = await db
    .update(paymentCategories)
    .set({ archivedAt: new Date() })
    .where(and(eq(paymentCategories.id, id), eq(paymentCategories.brandId, brandId)));
  return Array.isArray(result) ? result.length > 0 : true;
}

/**
 * Reorder categories by providing an ordered array of ids.
 * Sets displayOrder = index for each id.
 */
export async function reorderCategories(brandId: string, orderedIds: string[]): Promise<void> {
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(paymentCategories)
      .set({ displayOrder: i })
      .where(and(eq(paymentCategories.id, orderedIds[i]), eq(paymentCategories.brandId, brandId)));
  }
}
