/**
 * Report — and optionally grant — a staff member's BRAND permissions across
 * every brand they hold a seat on, checked against the full BrandPermission
 * vocabulary (packages/server-shared/src/trpc/permissions.ts).
 *
 * The grant set is every EDITOR permission; the read-only `*Viewer` keys are
 * excluded (each is a strict subset of its editor counterpart, so granting
 * both is redundant). Already-held viewer keys are left in place.
 *
 * Grants mirror staff.updatePermissions: when a chat permission is newly
 * granted to an active member, handleStaffPermissionGranted wires the chat
 * threads. Pending seats get the permissions too (they apply on acceptance);
 * removed seats are never touched.
 *
 * Run (from repo root, point DATABASE_URL at the target env first):
 *   report: bun servers/backend/src/scripts/grant-brand-perms.ts zacch.b
 *   grant:  bun servers/backend/src/scripts/grant-brand-perms.ts zacch.b --grant
 * The identifier matches user/seat emails by prefix (`zacch.b` → `zacch.b@…`).
 */
import { and, eq, isNotNull, ilike, or, inArray } from 'drizzle-orm';
import { db } from '@prodesk/server-shared/db/index';
import { staff, brands, agencies, users } from '@prodesk/server-shared/db/schema';
import { handleStaffPermissionGranted } from '@prodesk/server-shared/modules/chat/threads';

/** Every BrandPermission, in staff-editor display order. */
const ALL_BRAND_PERMISSIONS = [
  'brandDashboard', 'brandProjects', 'infin8',
  'brandBusinessInfo', 'brandGuidelines', 'documents', 'resources',
  'links', 'linksViewer',
  'reviews', 'reviewsViewer',
  'payments', 'paymentsViewer',
  'signatures',
  'subscriptions',
  'staffManagement', 'proposals', 'chatWithStaffs',
] as const;

/** Every AgencyPermission (reported only — --grant targets brand seats). */
const ALL_AGENCY_PERMISSIONS = [
  'agencyDashboard',
  'agencyProjects', 'addBrief', 'allocatePeople', 'approveDeliverable',
  'catalog', 'clients', 'proposals',
  'manageResources', 'manageContractors', 'staffManagement', 'documents', 'resources',
  'chatWithContractors', 'chatWithStaffs', 'chatWithBrands',
  'rolesAndCommissions', 'invoice', 'subscriptions', 'bankAccount',
  'agencyInfo', 'agencyBusinessInfo', 'infin8',
] as const;

const VIEWER_PERMISSIONS = ['linksViewer', 'reviewsViewer', 'paymentsViewer'] as const;
const GRANT_SET = ALL_BRAND_PERMISSIONS.filter(
  (p) => !(VIEWER_PERMISSIONS as readonly string[]).includes(p),
);

async function run(): Promise<void> {
  const [identifier, ...flags] = process.argv.slice(2);
  if (!identifier) {
    console.error('Usage: grant-brand-perms.ts <email-or-prefix> [--grant]');
    process.exit(1);
  }
  const grant = flags.includes('--grant');
  const emailPattern = identifier.includes('@') ? identifier : `${identifier}@%`;

  const matchedUsers = await db
    .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName })
    .from(users)
    .where(ilike(users.email, emailPattern));
  for (const u of matchedUsers) {
    console.log(`user: ${u.email} (${[u.firstName, u.lastName].filter(Boolean).join(' ') || 'no name'}) ${u.id}`);
  }
  if (!matchedUsers.length) console.log(`no users match ${emailPattern}; checking seat emails only.`);

  const userIds = matchedUsers.map((u) => u.id);
  // Seats are matched by linked user OR by invite email, so pending invites
  // (no userId yet) are included.
  const seatFilter = userIds.length
    ? or(inArray(staff.userId, userIds), ilike(staff.email, emailPattern))
    : ilike(staff.email, emailPattern);
  const seats = await db
    .select({
      id: staff.id,
      brandId: staff.brandId,
      agencyId: staff.agencyId,
      userId: staff.userId,
      email: staff.email,
      status: staff.status,
      permissions: staff.permissions,
      brandName: brands.businessName,
    })
    .from(staff)
    .leftJoin(brands, eq(staff.brandId, brands.id))
    .where(and(seatFilter, isNotNull(staff.brandId)));

  if (!seats.length) {
    console.log('No brand staff seats found.');
    process.exit(0);
  }

  console.log(`\n${seats.length} brand seat(s):\n`);
  for (const s of seats) {
    const held = new Set(s.permissions);
    const missing = GRANT_SET.filter((p) => !held.has(p));
    console.log(`brand: ${s.brandName} (${s.brandId})  seat ${s.id}  status=${s.status}`);
    console.log(`  held:    ${s.permissions.join(', ') || '(none)'}`);
    console.log(`  missing: ${missing.join(', ') || '(none — full editor set)'}\n`);

    if (!grant || !missing.length || s.status === 'removed') continue;

    const next = [...new Set([...s.permissions, ...GRANT_SET])];
    await db.update(staff).set({ permissions: next as typeof s.permissions }).where(eq(staff.id, s.id));
    console.log(`  GRANTED → ${next.join(', ')}`);
    // Same condition as staff.updatePermissions: wire chat threads only for
    // active linked members whose chat permission is newly granted.
    if (s.userId && s.status === 'active' && missing.includes('chatWithStaffs')) {
      await handleStaffPermissionGranted(s.userId, { agencyId: s.agencyId, brandId: s.brandId }, next, db);
      console.log('  chat threads wired (handleStaffPermissionGranted)');
    }
  }
  // Agency seats — report only. Owners aren't staff rows: owning an agency
  // grants everything implicitly, so also flag agencies the user owns.
  const ownedAgencies = userIds.length
    ? await db
        .select({ id: agencies.id, name: agencies.businessName, derivedFromBrandId: agencies.derivedFromBrandId })
        .from(agencies)
        .where(inArray(agencies.ownerId, userIds))
    : [];
  for (const a of ownedAgencies) {
    console.log(`OWNS agency: ${a.name} (${a.id})${a.derivedFromBrandId ? ' [derived shadow agency]' : ''} — all permissions implicit`);
  }

  const agencySeats = await db
    .select({
      id: staff.id,
      agencyId: staff.agencyId,
      status: staff.status,
      permissions: staff.permissions,
      agencyName: agencies.businessName,
      derivedFromBrandId: agencies.derivedFromBrandId,
    })
    .from(staff)
    .leftJoin(agencies, eq(staff.agencyId, agencies.id))
    .where(and(seatFilter, isNotNull(staff.agencyId)));

  console.log(`\n${agencySeats.length} agency seat(s):\n`);
  for (const s of agencySeats) {
    const held = new Set(s.permissions);
    const missing = ALL_AGENCY_PERMISSIONS.filter((p) => !held.has(p));
    console.log(
      `agency: ${s.agencyName} (${s.agencyId})${s.derivedFromBrandId ? ' [derived shadow agency]' : ''}  seat ${s.id}  status=${s.status}`,
    );
    console.log(`  held:    ${s.permissions.join(', ') || '(none)'}`);
    console.log(`  missing: ${missing.join(', ') || '(none — full set)'}\n`);
  }

  if (!grant) console.log('Dry run (report only) — re-run with --grant to apply brand grants.');
  process.exit(0);
}

run().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
