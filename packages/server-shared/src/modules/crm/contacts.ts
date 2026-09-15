/**
 * Shared CRM contacts façade (WS3).
 *
 * `payment_clients` is the physical store — originally the EziQuotes customer
 * table, promoted here to a neutral, platform-wide contact entity that ANY
 * Prodesk surface (invoice bill-to, brand dashboard, proposals recipient) can
 * read/write through `trpc.contacts.*` without depending on the payments module.
 *
 * Tenancy is the CALLER's responsibility — every function takes a brandId and
 * scopes to it, but the membership check lives in routers/contacts.ts
 * (assertBrandAccess). The opt-in `payment_clients.userId` link ties a contact
 * to a platform account when one exists.
 */
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentClients } from '../../db/schema.js';
import type { PaymentClient } from '../../db/schema.js';

export type Contact = PaymentClient;

export interface ContactInput {
  name: string;
  email?: string | null;
  mobile?: string | null;
  businessName?: string | null;
  address?: string | null;
  abn?: string | null;
  internalNotes?: string | null;
  tags?: string | null;
  /** Opt-in link to a platform user. */
  userId?: string | null;
}

export async function listContacts(
  brandId: string,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: Contact[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const conditions = [eq(paymentClients.brandId, brandId)];
  if (opts.search) {
    const s = `%${opts.search}%`;
    conditions.push(
      or(ilike(paymentClients.name, s), ilike(paymentClients.email, s), ilike(paymentClients.businessName, s))!,
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
  const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(paymentClients).where(where);
  return { rows, total: Number(countRow?.count ?? 0) };
}

export async function getContactById(brandId: string, id: string): Promise<Contact | undefined> {
  const [row] = await db
    .select()
    .from(paymentClients)
    .where(and(eq(paymentClients.id, id), eq(paymentClients.brandId, brandId)))
    .limit(1);
  return row;
}

export async function upsertContact(brandId: string, data: ContactInput & { id?: string }): Promise<string> {
  const { id, ...fields } = data;
  if (id) {
    const existing = await getContactById(brandId, id);
    if (!existing) throw new Error('Contact not found');
    await db
      .update(paymentClients)
      .set(fields)
      .where(and(eq(paymentClients.id, id), eq(paymentClients.brandId, brandId)));
    return id;
  }
  const [inserted] = await db
    .insert(paymentClients)
    .values({ ...fields, brandId })
    .returning({ id: paymentClients.id });
  return inserted!.id;
}

/** Set/clear the opt-in platform-user link on a contact. */
export async function linkContactToUser(brandId: string, id: string, userId: string | null): Promise<void> {
  await db
    .update(paymentClients)
    .set({ userId })
    .where(and(eq(paymentClients.id, id), eq(paymentClients.brandId, brandId)));
}
