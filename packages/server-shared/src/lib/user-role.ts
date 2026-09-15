import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { users, userAgencies, userBrands, staff, contractors } from '../db/schema.js';

/**
 * Reset a user back to the role-less pre-onboarding state when they have no
 * remaining "role basis" — no owned agency/brand, no other active staff seat, and
 * no contractor profile. Called after a staff/contractor membership is removed so
 * a user whose ONLY identity was that membership lands back on role-selection
 * (role === null) instead of being stranded on a broken dashboard.
 *
 * A null role is the legitimate pre-onboarding state (App routes it to
 * role-selection, and auth.me's self-heal treats it as such), so this is the
 * correct terminal state for "no longer anything". Super-admins and users who
 * still have any other role basis are left untouched.
 */
export async function maybeResetUserRole(db: DB, userId: string): Promise<void> {
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user || user.isSuperAdmin) return;

  const [ownedAgency, ownedBrand, activeStaff, contractor] = await Promise.all([
    db.select({ id: userAgencies.agencyId }).from(userAgencies).where(eq(userAgencies.userId, userId)).limit(1),
    db.select({ id: userBrands.brandId }).from(userBrands).where(eq(userBrands.userId, userId)).limit(1),
    db.select({ id: staff.id }).from(staff).where(and(eq(staff.userId, userId), eq(staff.status, 'active'))).limit(1),
    db.select({ id: contractors.id }).from(contractors).where(eq(contractors.id, userId)).limit(1),
  ]);

  if (ownedAgency.length || ownedBrand.length || activeStaff.length || contractor.length) return;

  await db.update(users).set({ role: null, selectedAgencyId: null, selectedBrandId: null }).where(eq(users.id, userId));
}
