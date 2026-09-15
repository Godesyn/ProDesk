/**
 * Destructive maintenance: wipe the commerce ledger — delete EVERY purchase
 * (marketplace AND internal), pending purchase, proposal, project, payout and
 * invoice from the database.
 *
 * Deletion runs in a single transaction, ordered to satisfy the foreign-key
 * rules declared on the schema:
 *   1. invoices         → cascades to invoice_items
 *   2. payouts          → cascades to payout_breakdowns
 *   3. projects         → cascades to deliverables / revisions / notes / tasks;
 *                         files / chat_messages / payout_breakdowns are set null
 *   4. purchases        → cascades to purchase_items (covers internal purchases too)
 *   5. proposals        → cascades to proposal_items / _phases / _documents /
 *                         _comments and any proposal tasks
 *   6. pending_purchases → standalone (unpaid checkout snapshots; no FKs)
 * (invoices, payouts and projects each restrict-reference purchases, so they must
 *  go before purchases; and purchases restrict-reference proposals — a paid
 *  proposal's purchase carries its proposalId — so purchases go before proposals.)
 *
 * Guarded two ways so it can't be run by accident or against production:
 *   • refuses to run unless NODE_ENV === 'development'
 *   • requires an explicit --yes / --confirm flag to actually delete
 *
 * Dry run (count only):  npx tsx --env-file=../.env src/scripts/delete-purchases.ts
 * Execute:               npx tsx --env-file=../.env src/scripts/delete-purchases.ts --yes
 */
import { sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { db } from '@prodesk/server-shared/db/index';
import { invoices, payouts, projects, purchases, proposals, pendingPurchases } from '@prodesk/server-shared/db/schema';
import { isDev } from '@prodesk/server-shared/lib/env';

async function count(table: PgTable) {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(table);
  return count;
}

async function main() {
  // Production guard: never let this run against a non-development environment.
  if (!isDev) {
    console.error(
      `✖ Refusing to run: NODE_ENV must be "development" (got "${process.env.NODE_ENV ?? 'unset'}").`,
    );
    console.error('   This script is for local/dev data resets only — it will not touch production.');
    process.exit(1);
  }

  const confirmed = process.argv.slice(2).some((a) => a === '--yes' || a === '--confirm');

  const counts = {
    invoices: await count(invoices),
    payouts: await count(payouts),
    projects: await count(projects),
    purchases: await count(purchases),
    proposals: await count(proposals),
    pendingPurchases: await count(pendingPurchases),
  };
  const total =
    counts.invoices +
    counts.payouts +
    counts.projects +
    counts.purchases +
    counts.proposals +
    counts.pendingPurchases;

  if (total === 0) {
    console.log('No purchases, proposals, projects, payouts or invoices found — nothing to delete.');
    process.exit(0);
  }

  if (!confirmed) {
    console.log('⚠️  The following would be deleted (with all cascaded records):');
    console.log(`   • ${counts.invoices} invoice(s)          → invoice_items`);
    console.log(`   • ${counts.payouts} payout(s)           → payout_breakdowns`);
    console.log(`   • ${counts.projects} project(s)          → deliverables, revisions, notes, tasks`);
    console.log(`   • ${counts.purchases} purchase(s)         → purchase_items (includes internal purchases)`);
    console.log(`   • ${counts.proposals} proposal(s)         → proposal_items, _phases, _documents, _comments, tasks`);
    console.log(`   • ${counts.pendingPurchases} pending purchase(s) → unpaid checkout snapshots`);
    console.log('   Re-run with --yes to actually delete them.');
    process.exit(0);
  }

  console.log('Deleting purchases, proposals, pending purchases, projects, payouts and invoices (and all cascaded records)...');
  const deleted = await db.transaction(async (tx) => {
    // Order matters: invoices, payouts and projects all restrict-reference
    // purchases, so they must be removed before the purchases themselves; and
    // purchases restrict-reference proposals, so purchases go before proposals.
    const inv = await tx.delete(invoices).returning({ id: invoices.id });
    const pay = await tx.delete(payouts).returning({ id: payouts.id });
    const proj = await tx.delete(projects).returning({ id: projects.id });
    const pur = await tx.delete(purchases).returning({ id: purchases.id });
    const prop = await tx.delete(proposals).returning({ id: proposals.id });
    const pend = await tx.delete(pendingPurchases).returning({ id: pendingPurchases.id });
    return {
      inv: inv.length,
      pay: pay.length,
      proj: proj.length,
      pur: pur.length,
      prop: prop.length,
      pend: pend.length,
    };
  });

  console.log(
    `✔ Deleted ${deleted.inv} invoice(s), ${deleted.pay} payout(s), ` +
      `${deleted.proj} project(s), ${deleted.pur} purchase(s), ` +
      `${deleted.prop} proposal(s) and ${deleted.pend} pending purchase(s). 🎉`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('✖ Failed to delete purchases:', e);
  process.exit(1);
});
