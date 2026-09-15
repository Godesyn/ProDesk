/**
 * One-off repair: clear the role of any brand/agency *owner* who has no actual
 * organization membership. These rows are the residue of the old auth.me limbo
 * healing that converted freshly-verified (null-role) users into org-less
 * brandOwners, dropping them on a brand dashboard instead of role-selection.
 * Resetting role → null sends them back through the proper onboarding flow.
 *
 * Run (all org-less owners):  npx tsx --env-file=../.env src/scripts/reset-orgless-roles.ts
 * Run (single account only):  npx tsx --env-file=../.env src/scripts/reset-orgless-roles.ts you@example.com
 */
import { eq, inArray, and } from 'drizzle-orm';
import { db } from '@prodesk/server-shared/db/index';
import { users, userBrands, userAgencies } from '@prodesk/server-shared/db/schema';

async function main() {
  const onlyEmail = process.argv[2]?.trim().toLowerCase();
  const roleFilter = inArray(users.role, ['brandOwner', 'agencyOwner']);
  const owners = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(onlyEmail ? and(roleFilter, eq(users.email, onlyEmail)) : roleFilter);

  const orgless: { id: string; email: string; role: string | null }[] = [];
  for (const u of owners) {
    const [b, a] = await Promise.all([
      db.select({ id: userBrands.brandId }).from(userBrands).where(eq(userBrands.userId, u.id)).limit(1),
      db.select({ id: userAgencies.agencyId }).from(userAgencies).where(eq(userAgencies.userId, u.id)).limit(1),
    ]);
    if (b.length === 0 && a.length === 0) orgless.push(u);
  }

  if (orgless.length === 0) {
    console.log('No org-less owner rows found — nothing to reset.');
    process.exit(0);
  }

  console.log(`Resetting role → null for ${orgless.length} org-less owner(s):`);
  for (const u of orgless) console.log(`  • ${u.email} (was ${u.role})`);

  await db
    .update(users)
    .set({ role: null, selectedBrandId: null, selectedAgencyId: null })
    .where(inArray(users.id, orgless.map((u) => u.id)));

  console.log('Done. Affected users will now route to /role-selection on next load.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
