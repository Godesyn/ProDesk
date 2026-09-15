/**
 * Role-aware party chips for payout/invoice LIST views (tables). The earnings and
 * invoice tables show the viewer the *other* side of the deal: a brand sees the
 * agency, an agency sees the brand, the super-admin sees both. These helpers attach
 * the normalised `{ id, name, logoUrl }` chips each row needs so the client can pick
 * which column(s) to render by viewer role — without N per-row lookups.
 */
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import {
  agencies,
  brands,
  payoutBreakdowns,
  purchases,
  purchaseItems,
} from '../../db/schema.js';

export interface PartyChip {
  id: string;
  name: string;
  logoUrl: string | null;
}

function agencyChip(
  a?: { id: string; businessName: string | null; legalName?: string | null; logoUrl: string | null },
): PartyChip | null {
  if (!a) return null;
  // Prefer the legal entity name, fall back to the trading name (tax-invoice parity).
  return { id: a.id, name: (a.legalName?.trim() || a.businessName?.trim()) || 'N/A', logoUrl: a.logoUrl ?? null };
}

function brandChip(
  b?: { id: string; businessName: string | null; logoUrl: string | null },
): PartyChip | null {
  if (!b) return null;
  return { id: b.id, name: b.businessName?.trim() || 'N/A', logoUrl: b.logoUrl ?? null };
}

/**
 * Attach `sourceAgency` (whose work generated the payout), `beneficiaryAgency` (the
 * agency that RECEIVES it, when the payee is an agency rather than a user), and
 * `sourceBrand` (the buyer) to payout rows. The brand is read from the payout's
 * breakdown rows (`payout_breakdowns.brandId`), since payouts store only the brand
 * name, not its id/logo.
 */
export async function withPayoutParties<
  T extends { id: string; agencyId: string | null; beneficiaryAgencyId: string | null },
>(
  db: DB,
  rows: T[],
): Promise<(T & { sourceAgency: PartyChip | null; beneficiaryAgency: PartyChip | null; sourceBrand: PartyChip | null })[]> {
  if (!rows.length) return [];
  const agencyIds = new Set<string>();
  for (const r of rows) {
    if (r.agencyId) agencyIds.add(r.agencyId);
    if (r.beneficiaryAgencyId) agencyIds.add(r.beneficiaryAgencyId);
  }
  const payoutIds = rows.map((r) => r.id);
  const bdRows = await db
    .select({ payoutId: payoutBreakdowns.payoutId, brandId: payoutBreakdowns.brandId })
    .from(payoutBreakdowns)
    .where(inArray(payoutBreakdowns.payoutId, payoutIds));
  const brandByPayout = new Map<string, string>();
  for (const b of bdRows) if (b.brandId && !brandByPayout.has(b.payoutId)) brandByPayout.set(b.payoutId, b.brandId);
  const brandIds = new Set(brandByPayout.values());

  const [agencyRows, brandRows] = await Promise.all([
    agencyIds.size
      ? db.select({ id: agencies.id, businessName: agencies.businessName, legalName: agencies.legalName, logoUrl: agencies.logoUrl }).from(agencies).where(inArray(agencies.id, [...agencyIds]))
      : Promise.resolve([]),
    brandIds.size
      ? db.select({ id: brands.id, businessName: brands.businessName, logoUrl: brands.logoUrl }).from(brands).where(inArray(brands.id, [...brandIds]))
      : Promise.resolve([]),
  ]);
  const aMap = new Map(agencyRows.map((a) => [a.id, a]));
  const bMap = new Map(brandRows.map((b) => [b.id, b]));

  return rows.map((r) => {
    const brandId = brandByPayout.get(r.id);
    return {
      ...r,
      sourceAgency: agencyChip(r.agencyId ? aMap.get(r.agencyId) : undefined),
      beneficiaryAgency: agencyChip(r.beneficiaryAgencyId ? aMap.get(r.beneficiaryAgencyId) : undefined),
      sourceBrand: brandChip(brandId ? bMap.get(brandId) : undefined),
    };
  });
}

/**
 * Attach the `brand` (buyer) and the producing `agency` (the service owner) to
 * invoice rows, resolved through the invoice's purchase. The producing agency is the
 * purchase's first line-item agency — stable across every commission leg of the
 * purchase, unlike the invoice's own from/to parties (which vary per leg).
 */
export async function withInvoiceParties<T extends { id: string; purchaseId: string | null }>(
  db: DB,
  rows: T[],
): Promise<(T & { brand: PartyChip | null; agency: PartyChip | null })[]> {
  const purchaseIds = [...new Set(rows.map((r) => r.purchaseId).filter(Boolean) as string[])];
  if (!purchaseIds.length) return rows.map((r) => ({ ...r, brand: null, agency: null }));

  const [purRows, itemRows] = await Promise.all([
    db.select({ id: purchases.id, brandId: purchases.brandId }).from(purchases).where(inArray(purchases.id, purchaseIds)),
    db.select({ purchaseId: purchaseItems.purchaseId, agencyId: purchaseItems.agencyId }).from(purchaseItems).where(inArray(purchaseItems.purchaseId, purchaseIds)),
  ]);
  const brandByPurchase = new Map(purRows.map((p) => [p.id, p.brandId]));
  const agencyByPurchase = new Map<string, string>();
  for (const it of itemRows) if (it.agencyId && !agencyByPurchase.has(it.purchaseId)) agencyByPurchase.set(it.purchaseId, it.agencyId);

  const brandIds = new Set([...brandByPurchase.values()].filter(Boolean) as string[]);
  const agencyIds = new Set(agencyByPurchase.values());
  const [brandRows, agencyRows] = await Promise.all([
    brandIds.size
      ? db.select({ id: brands.id, businessName: brands.businessName, logoUrl: brands.logoUrl }).from(brands).where(inArray(brands.id, [...brandIds]))
      : Promise.resolve([]),
    agencyIds.size
      ? db.select({ id: agencies.id, businessName: agencies.businessName, legalName: agencies.legalName, logoUrl: agencies.logoUrl }).from(agencies).where(inArray(agencies.id, [...agencyIds]))
      : Promise.resolve([]),
  ]);
  const bMap = new Map(brandRows.map((b) => [b.id, b]));
  const aMap = new Map(agencyRows.map((a) => [a.id, a]));

  return rows.map((r) => {
    const brandId = r.purchaseId ? brandByPurchase.get(r.purchaseId) : null;
    const agencyId = r.purchaseId ? agencyByPurchase.get(r.purchaseId) : null;
    return {
      ...r,
      brand: brandChip(brandId ? bMap.get(brandId) : undefined),
      agency: agencyChip(agencyId ? aMap.get(agencyId) : undefined),
    };
  });
}
