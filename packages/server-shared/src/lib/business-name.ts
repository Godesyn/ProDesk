import { and, isNull, ne, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { agencies, brands } from '../db/schema.js';

export interface BusinessNameCheck {
  available: boolean;
  reason: string | null;
}

/**
 * Cross-entity business-name availability. The brand/agency business name is a
 * single shared namespace: a name is taken if ANY brand or ANY standalone
 * agency already uses it (case-insensitive exact match).
 *
 * Derived agencies (agencies.derivedFromBrandId set) are excluded from the
 * collision set — their name intentionally mirrors their parent brand, so they
 * do not stake an independent claim on the namespace.
 *
 * `excludeAgencyId` / `excludeBrandId` let an edit screen keep its own current
 * name without flagging itself as a collision.
 */
export async function checkBusinessNameAvailable(
  db: DB,
  businessName: string,
  opts: { excludeAgencyId?: string; excludeBrandId?: string } = {},
): Promise<BusinessNameCheck> {
  const name = businessName.trim();
  if (!name) return { available: true, reason: null };

  const [agencyDupe, brandDupe] = await Promise.all([
    db
      .select({ id: agencies.id })
      .from(agencies)
      .where(
        and(
          sql`lower(${agencies.businessName}) = lower(${name})`,
          isNull(agencies.derivedFromBrandId),
          opts.excludeAgencyId
            ? ne(agencies.id, opts.excludeAgencyId)
            : undefined,
        ),
      )
      .limit(1),
    db
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(
          sql`lower(${brands.businessName}) = lower(${name})`,
          opts.excludeBrandId ? ne(brands.id, opts.excludeBrandId) : undefined,
        ),
      )
      .limit(1),
  ]);

  const taken = !!agencyDupe[0] || !!brandDupe[0];
  return {
    available: !taken,
    reason: taken ? 'This business name is already taken' : null,
  };
}
