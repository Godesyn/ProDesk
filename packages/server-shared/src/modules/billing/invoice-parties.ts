/**
 * Invoice party resolution — turns the compact party reference stored on an
 * invoice (`{ isProdesk }` / `{ agencyId }` / `{ brandId }` / `{ userId }`) into
 * the full identity block a tax invoice renders (name, email, address, ABN,
 * phone).
 *
 * This is the web port of the Flutter `InvoiceService.invoiceItemToServiceUser`:
 * the Flutter app resolves party details lazily at PDF-render time rather than
 * freezing them onto the invoice. We do the same here (at read time, in the
 * invoices router) so existing invoices — whose stored party is just an id —
 * render correctly without a backfill, and so edits to an agency/brand/user
 * profile flow through to how their invoices display.
 */
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { agencies, brands, paymentClients, users } from '../../db/schema.js';
import { PRODESK_IDENTITY } from '../../lib/prodesk-identity.js';

/**
 * In-memory party reference — a party is exactly one of Prodesk / agency / brand
 * / user. Built from the typed `from_*` / `to_*` invoice columns on read (see
 * `fromPartyRef` / `toPartyRef`) and converted back to those columns on write
 * (see `partyColumns`).
 */
export interface InvoicePartyRef {
  isProdesk?: boolean;
  agencyId?: string | null;
  userId?: string | null;
  brandId?: string | null;
  /** A CRM contact (payment_clients) — e.g. the payer on a projected charge. */
  contactId?: string | null;
}

/** The typed party columns present on every selected invoice row. */
export interface InvoicePartyColumns {
  fromIsProdesk: boolean;
  fromAgencyId: string | null;
  fromBrandId: string | null;
  fromUserId: string | null;
  fromContactId: string | null;
  toIsProdesk: boolean;
  toAgencyId: string | null;
  toBrandId: string | null;
  toUserId: string | null;
  toContactId: string | null;
}

/** Build the `from` party ref from a selected invoice row's typed columns. */
export function fromPartyRef(r: InvoicePartyColumns): InvoicePartyRef {
  if (r.fromIsProdesk) return { isProdesk: true };
  return {
    agencyId: r.fromAgencyId,
    brandId: r.fromBrandId,
    userId: r.fromUserId,
    contactId: r.fromContactId,
  };
}

/** Build the `to` party ref from a selected invoice row's typed columns. */
export function toPartyRef(r: InvoicePartyColumns): InvoicePartyRef {
  if (r.toIsProdesk) return { isProdesk: true };
  return { agencyId: r.toAgencyId, brandId: r.toBrandId, userId: r.toUserId, contactId: r.toContactId };
}

/**
 * Convert an in-memory party ref into the typed invoice columns for one side, so
 * callers can keep building plain `{ isProdesk | agencyId | brandId | userId }`
 * objects and translate them at the DB boundary. Mirrors the `*_one_party` CHECK:
 * Prodesk wins and clears the ids; otherwise exactly one id should be set.
 */
export function partyColumns(
  ref: InvoicePartyRef,
  side: 'from' | 'to',
): Record<string, unknown> {
  const isProdesk = !!ref.isProdesk;
  const agencyId = isProdesk ? null : (ref.agencyId ?? null);
  const brandId = isProdesk ? null : (ref.brandId ?? null);
  const userId = isProdesk ? null : (ref.userId ?? null);
  const contactId = isProdesk ? null : (ref.contactId ?? null);
  return side === 'from'
    ? {
        fromIsProdesk: isProdesk,
        fromAgencyId: agencyId,
        fromBrandId: brandId,
        fromUserId: userId,
        fromContactId: contactId,
      }
    : {
        toIsProdesk: isProdesk,
        toAgencyId: agencyId,
        toBrandId: brandId,
        toUserId: userId,
        toContactId: contactId,
      };
}

/** The fully-resolved party block consumed by the invoice detail view + PDF. */
export interface ResolvedParty extends InvoicePartyRef {
  name: string;
  email?: string | null;
  address?: string | null;
  abn?: string | null;
  phone?: string | null;
}

const PRODESK_PARTY: ResolvedParty = {
  isProdesk: true,
  name: PRODESK_IDENTITY.name,
  address: PRODESK_IDENTITY.address,
  abn: PRODESK_IDENTITY.abn,
};

/**
 * Party ids now live in typed `uuid` FK columns, so they are always either a
 * valid UUID or null — the historical Firebase-uid-in-JSON hazard is gone. This
 * guard is kept purely as defence in depth: should a malformed id ever reach
 * here, it is skipped rather than fed into an `inArray` (which would throw
 * `invalid input syntax for type uuid` and 500 the whole batch).
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id: string): boolean => UUID_RE.test(id);

/**
 * Resolve a batch of party refs in bulk (one query per entity type), returning a
 * resolver keyed by the original ref. Use this for lists; for a single invoice
 * call `resolveParties`.
 */
export async function buildPartyResolver(
  db: DB,
  refs: Array<InvoicePartyRef | null | undefined>,
): Promise<(ref: InvoicePartyRef | null | undefined) => ResolvedParty | null> {
  const agencyIds = new Set<string>();
  const brandIds = new Set<string>();
  const userIds = new Set<string>();
  const contactIds = new Set<string>();
  for (const r of refs) {
    if (!r || r.isProdesk) continue;
    if (r.agencyId && isUuid(r.agencyId)) agencyIds.add(r.agencyId);
    else if (r.brandId && isUuid(r.brandId)) brandIds.add(r.brandId);
    else if (r.userId && isUuid(r.userId)) userIds.add(r.userId);
    else if (r.contactId && isUuid(r.contactId)) contactIds.add(r.contactId);
  }

  const [agencyRows, brandRows, userRows, contactRows] = await Promise.all([
    agencyIds.size
      ? db
          .select({
            id: agencies.id,
            businessName: agencies.businessName,
            legalName: agencies.legalName,
            businessEmail: agencies.businessEmail,
            address: agencies.address,
            abn: agencies.abn,
            phone: agencies.phone,
          })
          .from(agencies)
          .where(inArray(agencies.id, [...agencyIds]))
      : Promise.resolve([]),
    brandIds.size
      ? db
          .select({
            id: brands.id,
            businessName: brands.businessName,
            email: brands.email,
            address: brands.address,
            abn: brands.abn,
            phone: brands.phone,
          })
          .from(brands)
          .where(inArray(brands.id, [...brandIds]))
      : Promise.resolve([]),
    userIds.size
      ? db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
          })
          .from(users)
          .where(inArray(users.id, [...userIds]))
      : Promise.resolve([]),
    contactIds.size
      ? db
          .select({
            id: paymentClients.id,
            name: paymentClients.name,
            businessName: paymentClients.businessName,
            email: paymentClients.email,
            address: paymentClients.address,
            abn: paymentClients.abn,
            mobile: paymentClients.mobile,
          })
          .from(paymentClients)
          .where(inArray(paymentClients.id, [...contactIds]))
      : Promise.resolve([]),
  ]);

  const agencyMap = new Map(agencyRows.map((a) => [a.id, a]));
  const brandMap = new Map(brandRows.map((b) => [b.id, b]));
  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const contactMap = new Map(contactRows.map((c) => [c.id, c]));

  return (ref) => {
    if (!ref) return null;
    if (ref.isProdesk) return { ...ref, ...PRODESK_PARTY };

    if (ref.agencyId) {
      const a = agencyMap.get(ref.agencyId);
      return {
        ...ref,
        // Prefer the legal entity name on a tax invoice, fall back to the
        // trading name (parity with the Flutter agency branch).
        name: a?.legalName?.trim() || a?.businessName?.trim() || 'N/A',
        email: a?.businessEmail ?? null,
        address: a?.address ?? null,
        abn: a?.abn ?? null,
        phone: a?.phone ?? null,
      };
    }

    if (ref.brandId) {
      const b = brandMap.get(ref.brandId);
      return {
        ...ref,
        name: b?.businessName?.trim() || 'N/A',
        email: b?.email ?? null,
        address: b?.address ?? null,
        abn: b?.abn ?? null,
        phone: b?.phone ?? null,
      };
    }

    if (ref.userId) {
      const u = userMap.get(ref.userId);
      const fullName = [u?.firstName, u?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return {
        ...ref,
        name: fullName || u?.email || 'N/A',
        email: u?.email ?? null,
      };
    }

    if (ref.contactId) {
      const c = contactMap.get(ref.contactId);
      return {
        ...ref,
        // Business name leads on a tax invoice, falling back to the contact name.
        name: c?.businessName?.trim() || c?.name?.trim() || 'N/A',
        email: c?.email ?? null,
        address: c?.address ?? null,
        abn: c?.abn ?? null,
        phone: c?.mobile ?? null,
      };
    }

    // Unknown ref — the one-party CHECK makes this unreachable for stored rows.
    return { ...ref, name: 'N/A' };
  };
}

/** Resolve the `from`/`to` parties of a single invoice. */
export async function resolveParties(
  db: DB,
  fromParty: InvoicePartyRef | null | undefined,
  toParty: InvoicePartyRef | null | undefined,
): Promise<{ from: ResolvedParty | null; to: ResolvedParty | null }> {
  const resolve = await buildPartyResolver(db, [fromParty, toParty]);
  return { from: resolve(fromParty), to: resolve(toParty) };
}

/**
 * Format a numeric invoice number as the human-facing id `#INV_0001`, matching
 * the Flutter `InvoiceModel.displayId` getter (`#INV_${id.padLeft(4, '0')}`).
 */
export function formatInvoiceNumber(n: number | null | undefined): string {
  return `#INV_${String(n ?? 0).padStart(4, '0')}`;
}

/**
 * Invoice status is DERIVED from the linked payout (docs/invoices.md §7): there
 * is no stored status column. A brand charge (no payout) is always 'paid';
 * otherwise the payout status maps onto the invoice status enum. Single source of
 * truth shared by the invoices router, super-admin, and the AI invoice tool.
 */
export const PAYOUT_TO_INVOICE_STATUS: Record<string, string> = {
  upcoming: 'unpaid',
  pending: 'unpaid',
  failed: 'unpaid',
  processing: 'processing',
  paid: 'paid',
  dispatched: 'dispatched',
  processingByPaypal: 'processingByPaypal',
  processingByWire: 'processingByWire',
  processingByStripe: 'processingByStripe',
  received: 'received',
  // A payout deliberately taken out of circulation never settles, so its
  // invoice is not merely `unpaid` (awaiting money) — it is closed. Passing it
  // through keeps this map in step with `derivedStatusSql` in routers/invoices,
  // whose ELSE branch already emits the payout status verbatim.
  stopped: 'stopped',
};

export function deriveInvoiceStatus(payoutStatus: string | null | undefined): string {
  if (!payoutStatus) return 'paid'; // brand charge — no payout, always paid
  return PAYOUT_TO_INVOICE_STATUS[payoutStatus] ?? 'unpaid';
}
