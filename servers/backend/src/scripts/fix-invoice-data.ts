/**
 * Fix legacy invoice data — idempotent, safe to run multiple times.
 *
 * Fixes:
 *   1. Invoice totals stuck at $0.00 (backfill from invoice_items.total_price)
 *   2. Orphaned contractor invoices missing payout_id and commission_type
 *
 * Usage:
 *   npx tsx src/scripts/fix-invoice-data.ts --stage          # dry run
 *   npx tsx src/scripts/fix-invoice-data.ts --stage --yes    # apply
 *   npx tsx src/scripts/fix-invoice-data.ts --prod           # dry run
 *   npx tsx src/scripts/fix-invoice-data.ts --prod --yes     # apply
 */
import './env-setup.js';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL!;
const confirmed = process.argv.includes('--yes');

console.log('Connecting to:', DATABASE_URL.replace(/:[^@]+@/, ':***@'));
console.log(confirmed ? '⚡ LIVE MODE — changes will be committed\n' : '🔍 DRY RUN — pass --yes to apply\n');

const sql = postgres(DATABASE_URL, { prepare: false });

async function main() {
  // Detect schema version: does the table have `from_user_id` (post-0011) or `from_party` (pre-0011)?
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'invoices'`;
  const colNames = new Set(cols.map((c: any) => c.column_name));
  const hasTypedParties = colNames.has('from_user_id');
  console.log(`Schema: ${hasTypedParties ? 'typed FK columns (post-0011)' : 'JSON from_party/to_party (pre-0011)'}\n`);

  // ── FIX 1: Invoice totals stuck at $0.00 ──────────────────────────────────
  // Older contractor-fee code didn't set `invoices.total`; the correct amount
  // was written to `invoice_items.total_price`. Backfill from the line item sum.
  const zeroTotals = await sql`
    SELECT i.id, i.total, SUM(ii.total_price::numeric) AS item_total
    FROM invoices i
    INNER JOIN invoice_items ii ON ii.invoice_id = i.id
    WHERE i.total = '0.00'
    GROUP BY i.id, i.total
    HAVING SUM(ii.total_price::numeric) > 0
  `;

  console.log(`FIX 1: Found ${zeroTotals.length} invoice(s) with $0.00 total but non-zero items`);
  for (const row of zeroTotals) {
    console.log(`  • Invoice ${row.id}: total $0.00 → $${row.item_total}`);
  }

  if (confirmed && zeroTotals.length > 0) {
    const result = await sql`
      UPDATE invoices SET total = sub.item_total
      FROM (
        SELECT ii.invoice_id, SUM(ii.total_price::numeric)::numeric AS item_total
        FROM invoice_items ii
        INNER JOIN invoices i ON i.id = ii.invoice_id
        WHERE i.total = '0.00'
        GROUP BY ii.invoice_id
        HAVING SUM(ii.total_price::numeric) > 0
      ) sub
      WHERE invoices.id = sub.invoice_id
    `;
    console.log(`  ✔ Updated ${result.count} invoice(s)\n`);
  } else {
    console.log('  (skipped — dry run)\n');
  }

  // ── FIX 2: Orphaned contractor invoices missing payout_id ─────────────────
  // Older code created the invoice without linking it to the contractor payout.
  // Match by purchase_id + the invoice's "from" user = the payout's beneficiary.
  // Supports both pre-0011 (JSON from_party) and post-0011 (from_user_id) schemas.
  let orphans: any[];
  if (hasTypedParties) {
    orphans = await sql`
      SELECT
        i.id AS invoice_id,
        i.purchase_id,
        i.from_user_id,
        p.id AS payout_id,
        p.amount AS payout_amount,
        p.status AS payout_status
      FROM invoices i
      INNER JOIN payouts p
        ON p.purchase_id = i.purchase_id
        AND p.as = 'contractor'
        AND p.beneficiary_id = i.from_user_id
      WHERE i.payout_id IS NULL
        AND i.commission_type IS NULL
    `;
  } else {
    orphans = await sql`
      SELECT
        i.id AS invoice_id,
        i.purchase_id,
        i.from_party->>'userId' AS from_user_id,
        p.id AS payout_id,
        p.amount AS payout_amount,
        p.status AS payout_status
      FROM invoices i
      INNER JOIN payouts p
        ON p.purchase_id = i.purchase_id
        AND p.as = 'contractor'
        AND p.beneficiary_id = (i.from_party->>'userId')::uuid
      WHERE i.payout_id IS NULL
        AND i.commission_type IS NULL
    `;
  }

  console.log(`FIX 2: Found ${orphans.length} orphaned invoice(s) missing payout link`);
  for (const row of orphans) {
    console.log(`  • Invoice ${row.invoice_id} → Payout ${row.payout_id} ($${row.payout_amount}, ${row.payout_status})`);
  }

  if (confirmed && orphans.length > 0) {
    if (hasTypedParties) {
      const result = await sql`
        UPDATE invoices SET
          payout_id = p.id,
          commission_type = 'contractorCommission'
        FROM payouts p
        WHERE invoices.payout_id IS NULL
          AND invoices.commission_type IS NULL
          AND p.purchase_id = invoices.purchase_id
          AND p.as = 'contractor'
          AND p.beneficiary_id = invoices.from_user_id
      `;
      console.log(`  ✔ Updated ${result.count} invoice(s)\n`);
    } else {
      const result = await sql`
        UPDATE invoices SET
          payout_id = p.id,
          commission_type = 'contractorCommission'
        FROM payouts p
        WHERE invoices.payout_id IS NULL
          AND invoices.commission_type IS NULL
          AND p.purchase_id = invoices.purchase_id
          AND p.as = 'contractor'
          AND p.beneficiary_id = (invoices.from_party->>'userId')::uuid
      `;
      console.log(`  ✔ Updated ${result.count} invoice(s)\n`);
    }
  } else {
    console.log('  (skipped — dry run)\n');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  if (!confirmed && (zeroTotals.length > 0 || orphans.length > 0)) {
    console.log('Re-run with --yes to apply these fixes.');
  } else if (confirmed) {
    console.log('✔ All fixes applied.');
  } else {
    console.log('✔ No issues found.');
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
