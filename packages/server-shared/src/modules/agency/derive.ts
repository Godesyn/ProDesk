import { eq } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { agencies, brands, userAgencies } from '../../db/schema.js';

export interface DeriveBrandInput {
  id: string;
  ownerId: string;
  businessName: string;
  derivedToAgencyId: string | null;
}

/**
 * Create (idempotently) the "shadow" agency derived from a brand: one agency per
 * brand, owned by the brand owner, whose businessName mirrors the brand. The
 * agency is linked back via brands.derivedToAgencyId and the owner is added to
 * userAgencies so it resolves through ownership/membership checks. It is hidden
 * from the context selector (auth.contextOptions skips derivedFromBrandId rows).
 *
 * A derived agency is an implementation detail of the brand, not a real agency,
 * so it is NOT filed into the super-admin approval queue (unlike a standalone
 * agency created via the agencies router).
 *
 * Does NOT touch users.role / selectedAgencyId — the caller's active context
 * (e.g. the brand just created) must be preserved.
 *
 * Returns the derived agency id (existing one if the brand already has it).
 */
export async function ensureDerivedAgency(
  db: DB,
  brand: DeriveBrandInput,
): Promise<string> {
  if (brand.derivedToAgencyId) {
    // Already derived — make sure the back-link/membership are intact.
    const existing = (
      await db
        .select({ id: agencies.id })
        .from(agencies)
        .where(eq(agencies.id, brand.derivedToAgencyId))
        .limit(1)
    )[0];
    if (existing) {
      await db
        .insert(userAgencies)
        .values({ userId: brand.ownerId, agencyId: existing.id })
        .onConflictDoNothing();
      return existing.id;
    }
    // Dangling pointer (agency was deleted) — fall through and recreate.
  }

  const [agency] = await db
    .insert(agencies)
    .values({
      ownerId: brand.ownerId,
      businessName: brand.businessName,
      derivedFromBrandId: brand.id,
    })
    .returning({ id: agencies.id, businessName: agencies.businessName });

  await db
    .insert(userAgencies)
    .values({ userId: brand.ownerId, agencyId: agency.id })
    .onConflictDoNothing();

  await db
    .update(brands)
    .set({ derivedToAgencyId: agency.id })
    .where(eq(brands.id, brand.id));

  return agency.id;
}
