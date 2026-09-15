import { randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { purchases, purchaseItems, pendingPurchases } from '../../db/schema.js';

type Db = typeof defaultDb;
type PurchaseValues = Omit<typeof purchases.$inferInsert, 'id'>;
/** A checkout item snapshot — minus `purchaseId` (set on promotion), WITH an id
 *  minted at checkout so it can be embedded into Stripe product metadata. */
export type PendingItem = Omit<
  typeof purchaseItems.$inferInsert,
  'purchaseId'
> & { id: string };

/**
 * Write a pending (unpaid) purchase. Returns the id reused for the eventual
 * `purchases` row. Item ids must already be set by the caller (they go into
 * Stripe product metadata, so they have to be stable through promotion).
 */
export async function createPendingPurchase(
  db: Db,
  purchase: PurchaseValues,
  items: PendingItem[],
): Promise<{ id: string; items: PendingItem[] }> {
  const id = randomUUID();
  await db.insert(pendingPurchases).values({ id, data: { purchase, items } });
  return { id, items };
}

/** Load a pending purchase's snapshot (or null if it isn't pending). */
export async function getPendingPurchase(db: Db, id: string) {
  const row = (
    await db
      .select()
      .from(pendingPurchases)
      .where(eq(pendingPurchases.id, id))
      .limit(1)
  )[0];
  return row?.data ?? null;
}

/**
 * Promote a pending purchase into the real `purchases` + `purchase_items` tables
 * under the same id, then delete the pending row. Idempotent: a second call
 * (webhook retry, redirect-vs-webhook race) is a no-op because the insert uses
 * `onConflictDoNothing` and a missing pending row just returns the existing
 * purchase. Run this BEFORE `fulfillPurchase`, which reads the purchase by id.
 */
export async function promotePendingPurchase(id: string, db: Db = defaultDb) {
  const pending = (
    await db
      .select()
      .from(pendingPurchases)
      .where(eq(pendingPurchases.id, id))
      .limit(1)
  )[0];
  if (!pending) {
    // Already promoted (or never existed) — return the real row if present.
    return (
      (
        await db.select().from(purchases).where(eq(purchases.id, id)).limit(1)
      )[0] ?? null
    );
  }
  const { purchase, items } = pending.data;
  const inserted = await db
    .insert(purchases)
    .values({ id, ...purchase })
    .onConflictDoNothing()
    .returning();
  if (inserted.length && items.length) {
    await db
      .insert(purchaseItems)
      .values(items.map((it) => ({ ...it, purchaseId: id })));
  }
  await db.delete(pendingPurchases).where(eq(pendingPurchases.id, id));
  return (
    inserted[0] ??
    (
      await db.select().from(purchases).where(eq(purchases.id, id)).limit(1)
    )[0] ??
    null
  );
}

/**
 * Delete abandoned pending purchases — checkouts that were never paid. The
 * default 48h cutoff is safely beyond Stripe's 24h checkout-session lifetime, so
 * no row that could still be promoted by a (late) webhook is removed. A fresh
 * re-checkout already overwrites the prior pending row, so this is just a
 * backstop sweep for rows that were started and then abandoned outright.
 */
export async function cleanupAbandonedPendingPurchases(
  now: Date,
  olderThanHours = 48,
  db: Db = defaultDb,
) {
  const cutoff = new Date(now.getTime() - olderThanHours * 3_600_000);
  const deleted = await db
    .delete(pendingPurchases)
    .where(lt(pendingPurchases.createdAt, cutoff))
    .returning({ id: pendingPurchases.id });
  return { deleted: deleted.length };
}
