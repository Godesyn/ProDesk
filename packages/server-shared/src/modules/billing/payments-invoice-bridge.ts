/**
 * Payments → invoices bridge (WS4).
 *
 * Projects an inbound payments charge (payment_transactions) into a canonical
 * `invoices` row so EziQuotes revenue appears in the unified invoice list with
 * the standard sequential #INV_ number (invoices.number is
 * generatedByDefaultAsIdentity — Postgres assigns the next value on insert).
 *
 * Party model: from = the vendor brand (payee), to = the payer CRM contact
 * (payment_clients), reusing partyColumns() and the fulfillment insert pattern.
 * The invoice has no payout, so its derived status resolves to 'paid' (see
 * docs/invoices.md §7) — correct for a completed inbound charge.
 *
 * Idempotent: keyed on invoices.paymentTransactionId (unique column), so webhook
 * retries never create a duplicate. Code-only — no historical charges to backfill.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import type { DB } from '../../db/index.js';
import { invoiceItems, invoices, paymentTransactions } from '../../db/schema.js';
import { partyColumns } from './invoice-parties.js';

/**
 * Project a succeeded payment transaction into an invoice. Returns the invoice
 * id (the existing one on a retry). No-ops when the transaction isn't
 * succeeded/paid, has no payer contact, or has already been projected.
 */
export async function projectPaymentTransactionToInvoice(
  transactionId: string,
  db: DB = defaultDb,
): Promise<string | null> {
  const [txn] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.id, transactionId))
    .limit(1);
  if (!txn) return null;
  if (txn.status !== 'succeeded' && txn.status !== 'paid') return null;
  if (!txn.clientId) {
    console.warn(
      `[payments-invoice-bridge] transaction ${transactionId} has no payer contact — skipping invoice projection`,
    );
    return null;
  }

  // Idempotent: one invoice per transaction (also enforced by the unique column).
  const [existing] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.paymentTransactionId, transactionId))
    .limit(1);
  if (existing) return existing.id;

  const total = (txn.amountCents / 100).toFixed(2);
  const [invoice] = await db
    .insert(invoices)
    .values({
      paymentTransactionId: txn.id,
      ...partyColumns({ brandId: txn.brandId }, 'from'),
      ...partyColumns({ contactId: txn.clientId }, 'to'),
      total,
    })
    // Guard the check-then-insert race on webhook retries.
    .onConflictDoNothing({ target: invoices.paymentTransactionId })
    .returning({ id: invoices.id });

  if (!invoice) {
    const [winner] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.paymentTransactionId, transactionId))
      .limit(1);
    return winner?.id ?? null;
  }

  await db.insert(invoiceItems).values({
    invoiceId: invoice.id,
    name: 'Payment',
    qty: 1,
    totalPrice: total,
  });
  return invoice.id;
}
