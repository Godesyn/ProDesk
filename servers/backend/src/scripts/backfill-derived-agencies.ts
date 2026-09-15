/**
 * One-time backfill: give every existing brand its derived "shadow" agency
 * (agencies.derived_from_brand_id) and stamp brands.derived_to_agency_id. Legacy
 * brands created before the shadow-agency feature (or whose best-effort creation
 * at brand-creation time silently failed) never got one, which leaves the brand
 * dashboard's Services tab stuck on "This brand's service catalogue isn't ready
 * yet" — the derived agency is where brand-published services live.
 *
 * Idempotent — brands that already have a live derived agency are skipped by
 * ensureDerivedAgency, so it's safe to re-run. It also repairs dangling pointers
 * (derived_to_agency_id set but the agency row was deleted).
 *
 * Run: `tsx --env-file=../.env src/scripts/backfill-derived-agencies.ts`
 *   (from the server/ workspace; or `bun run --filter server -- tsx src/scripts/backfill-derived-agencies.ts`)
 */
import { isNull } from 'drizzle-orm';
import { db } from '@prodesk/server-shared/db/index';
import { brands } from '@prodesk/server-shared/db/schema';
import { ensureDerivedAgency } from '@prodesk/server-shared/modules/agency/derive';

async function run(): Promise<void> {
  const rows = await db
    .select({
      id: brands.id,
      ownerId: brands.ownerId,
      businessName: brands.businessName,
      derivedToAgencyId: brands.derivedToAgencyId,
    })
    .from(brands)
    .where(isNull(brands.derivedToAgencyId));
  console.log(`[backfill-derived-agencies] ${rows.length} brand(s) without a derived agency.`);
  let created = 0;
  let failed = 0;
  for (const b of rows) {
    try {
      const id = await ensureDerivedAgency(db, b);
      created += 1;
      console.log(`[backfill-derived-agencies] ${b.businessName} → agency ${id}`);
    } catch (err) {
      failed += 1;
      console.error(`[backfill-derived-agencies] FAILED for ${b.businessName} (${b.id}):`, (err as Error).message);
    }
  }
  console.log(`[backfill-derived-agencies] done — created ${created}, failed ${failed}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-derived-agencies] fatal', err);
    process.exit(1);
  });
