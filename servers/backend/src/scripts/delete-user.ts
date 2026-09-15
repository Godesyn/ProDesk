/**
 * Delete a user by email — purge ALL user-owned data from Postgres and
 * remove the user from Supabase Auth.
 *
 * Features:
 *   • Dry-run mode (default): prints what WOULD be deleted/nullified.
 *   • Actual mode (`--yes`): executes the deletion inside a single transaction.
 *   • Environment selection (`--env <file>`): load any .env file (relative to
 *     monorepo root). Defaults to `.env` (development).
 *
 * Usage:
 *   # Dry run (dev)
 *   npx tsx src/scripts/delete-user.ts --email user@example.com
 *
 *   # Actual delete (dev)
 *   npx tsx src/scripts/delete-user.ts --email user@example.com --yes
 *
 *   # Against staging
 *   npx tsx src/scripts/delete-user.ts --email user@example.com --env .env.stage --yes
 *
 *   # Against production
 *   npx tsx src/scripts/delete-user.ts --email user@example.com --env .env.prod --yes
 */

/* ── 1. Load environment BEFORE any app import ─────────────────────────── */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..'); // monorepo root

// Parse --env <file> from argv (default: .env)
function getEnvFile(): string {
  const idx = process.argv.indexOf('--env');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return '.env';
}

const envFile = getEnvFile();
const envPath = resolve(root, envFile);
// Load the chosen env FIRST with override so it wins over everything.
loadEnv({ path: envPath, override: true });
// Also load the base .env as a fallback for any vars not in the chosen file.
if (envFile !== '.env') loadEnv({ path: resolve(root, '.env') });

/* ── 2. Dynamic imports (AFTER env is loaded) ──────────────────────────
 * ESM static `import` statements are hoisted and execute before any
 * top-level code. lib/env.ts initializes the DB connection at import
 * time, so it must run AFTER loadEnv() has set the correct DATABASE_URL.
 * Using dynamic `await import()` guarantees the correct ordering.
 * ─────────────────────────────────────────────────────────────────────── */
const { eq, sql, inArray, or } = await import('drizzle-orm');
const { db } = await import('@prodesk/server-shared/db/index');
const {
  users,
  contractors,
  agencies,
  brands,
  userAgencies,
  userBrands,
  staff,
  brandAgencyConnectionRequests,
  agencyContractorConnections,
  proposals,
  proposalComments,
  purchases,
  projects,
  projectDeliverables,
  projectRevisions,
  projectNotes,
  payouts,
  deposits,
  invoices,
  chatThreads,
  chatThreadMembers,
  chatMessages,
  tasks,
  meetings,
  files,
  folders,
  resources,
  spotComponents,
  emailUnsubscribes,
} = await import('@prodesk/server-shared/db/schema');
const { createClient } = await import('@supabase/supabase-js');

/* ── Helpers ───────────────────────────────────────────────────────────── */

async function countWhere(table: any, condition: any): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table)
    .where(condition);
  return count;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let email = '';
  const confirmed = args.some((a) => a === '--yes' || a === '--confirm');

  const emailIdx = args.indexOf('--email');
  if (emailIdx !== -1 && args[emailIdx + 1]) {
    email = args[emailIdx + 1];
  }

  return { email, confirmed };
}

/* ── Main ──────────────────────────────────────────────────────────────── */

async function main() {
  const { email, confirmed } = parseArgs();

  if (!email) {
    console.error('✖ Missing --email flag. Usage:');
    console.error('  npx tsx src/scripts/delete-user.ts --email user@example.com [--env .env.stage] [--yes]');
    process.exit(1);
  }

  const envLabel = envFile === '.env' ? 'development (.env)' : envFile;
  console.log(`\n🔌 Environment: ${envLabel}`);
  console.log(`🔍 Looking up user: ${email}\n`);

  // ── Find the user ──────────────────────────────────────────────────────
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      isSuperAdmin: users.isSuperAdmin,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    console.error(`✖ No user found with email "${email}".`);
    process.exit(1);
  }

  const userId = user.id;
  console.log(`Found user:`);
  console.log(`  ID:    ${userId}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Name:  ${user.firstName ?? ''} ${user.lastName ?? ''}`.trim());
  console.log(`  Role:  ${user.role ?? 'none'}`);
  console.log(`  Super: ${user.isSuperAdmin ? 'YES' : 'no'}`);
  console.log('');

  // ── Block if user owns agencies or brands ──────────────────────────────
  const ownedAgencies = await db
    .select({ id: agencies.id, name: agencies.businessName })
    .from(agencies)
    .where(eq(agencies.ownerId, userId));

  const ownedBrands = await db
    .select({ id: brands.id, name: brands.businessName })
    .from(brands)
    .where(eq(brands.ownerId, userId));

  if (ownedAgencies.length > 0 || ownedBrands.length > 0) {
    console.error('✖ Cannot delete this user — they OWN the following organizations:');
    for (const a of ownedAgencies) console.error(`  🏢 Agency: "${a.name}" (${a.id})`);
    for (const b of ownedBrands) console.error(`  🏷️  Brand:  "${b.name}" (${b.id})`);
    console.error('\nTransfer ownership or delete these organizations first.');
    process.exit(1);
  }

  // ── Gather counts ──────────────────────────────────────────────────────

  // --- Rows that will be DELETED ---
  const deleteCounts = {
    // Invoices linked to this user's payouts
    invoicesViaPayouts: await (async () => {
      const userPayoutIds = await db
        .select({ id: payouts.id })
        .from(payouts)
        .where(eq(payouts.beneficiaryId, userId));
      if (userPayoutIds.length === 0) return 0;
      return countWhere(
        invoices,
        inArray(invoices.payoutId, userPayoutIds.map((p) => p.id)),
      );
    })(),
    // Invoices linked to this user's purchases
    invoicesViaPurchases: await (async () => {
      const userPurchaseIds = await db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.userId, userId));
      if (userPurchaseIds.length === 0) return 0;
      return countWhere(
        invoices,
        inArray(invoices.purchaseId, userPurchaseIds.map((p) => p.id)),
      );
    })(),
    // Invoices where the user is a party (from/to user) — the typed party FK
    // columns are ON DELETE RESTRICT, so these must be removed before the user.
    invoicesAsParty: await countWhere(
      invoices,
      or(eq(invoices.fromUserId, userId), eq(invoices.toUserId, userId)),
    ),
    deposits: await countWhere(deposits, eq(deposits.beneficiaryId, userId)),
    payouts: await countWhere(payouts, eq(payouts.beneficiaryId, userId)),
    purchases: await countWhere(purchases, eq(purchases.userId, userId)),
    tasks: await countWhere(tasks, eq(tasks.assigneeId, userId)),
    chatMessages: await countWhere(chatMessages, eq(chatMessages.senderId, userId)),
    chatThreadMembers: await countWhere(chatThreadMembers, eq(chatThreadMembers.userId, userId)),
    staff: await countWhere(staff, eq(staff.userId, userId)),
    agencyContractorConnections: await countWhere(
      agencyContractorConnections,
      eq(agencyContractorConnections.contractorId, userId),
    ),
    brandAgencyConnectionRequests: await countWhere(
      brandAgencyConnectionRequests,
      eq(brandAgencyConnectionRequests.createdBy, userId),
    ),
    contractors: await countWhere(contractors, eq(contractors.id, userId)),
    userAgencies: await countWhere(userAgencies, eq(userAgencies.userId, userId)),
    userBrands: await countWhere(userBrands, eq(userBrands.userId, userId)),
    emailUnsubscribes: await countWhere(emailUnsubscribes, eq(emailUnsubscribes.email, email)),
  };

  // --- Rows that will be NULLIFIED (user references cleared) ---
  const nullifyCounts = {
    chatThreads_participantAId: await countWhere(chatThreads, eq(chatThreads.participantAId, userId)),
    chatThreads_participantBId: await countWhere(chatThreads, eq(chatThreads.participantBId, userId)),
    chatThreads_contractorId: await countWhere(chatThreads, eq(chatThreads.contractorId, userId)),
    chatThreads_createdBy: await countWhere(chatThreads, eq(chatThreads.createdBy, userId)),
    meetings_brandUserId: await countWhere(meetings, eq(meetings.brandUserId, userId)),
    meetings_assigneeUserId: await countWhere(meetings, eq(meetings.assigneeUserId, userId)),
    staff_invitedBy: await countWhere(staff, eq(staff.invitedBy, userId)),
    agencyContractorConnections_initiatedBy: await countWhere(
      agencyContractorConnections,
      eq(agencyContractorConnections.initiatedByUserId, userId),
    ),
    proposals_sentById: await countWhere(proposals, eq(proposals.proposalSentById, userId)),
    proposalComments_authorId: await countWhere(proposalComments, eq(proposalComments.authorId, userId)),
    purchases_proposalSentById: await countWhere(purchases, eq(purchases.proposalSentById, userId)),
    projects_proposalSentById: await countWhere(projects, eq(projects.proposalSentById, userId)),
    projects_productionAssigneeId: await countWhere(projects, eq(projects.productionAssigneeId, userId)),
    projectDeliverables_uploadedBy: await countWhere(projectDeliverables, eq(projectDeliverables.uploadedBy, userId)),
    projectDeliverables_reviewedBy: await countWhere(projectDeliverables, eq(projectDeliverables.reviewedBy, userId)),
    projectRevisions_authorId: await countWhere(projectRevisions, eq(projectRevisions.authorId, userId)),
    projectNotes_authorId: await countWhere(projectNotes, eq(projectNotes.authorId, userId)),
    files_uploadedBy: await countWhere(files, eq(files.uploadedBy, userId)),
    folders_createdBy: await countWhere(folders, eq(folders.createdBy, userId)),
    resources_uploadedBy: await countWhere(resources, eq(resources.uploadedBy, userId)),
    spotComponents_createdByUserId: await countWhere(spotComponents, eq(spotComponents.createdByUserId, userId)),
    users_referredByUserId: await countWhere(users, eq(users.referredByUserId, userId)),
  };

  // ── Check Supabase Auth ────────────────────────────────────────────────
  let supabaseAuthExists = false;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (supabaseUrl && supabaseSecretKey) {
    const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      supabaseAuthExists = !!data?.user;
    } catch {
      supabaseAuthExists = false;
    }
  } else {
    console.warn('⚠️  SUPABASE_URL / SUPABASE_SECRET_KEY not set — cannot check Supabase Auth.');
  }

  // ── Print summary ──────────────────────────────────────────────────────

  const totalDeletes = Object.values(deleteCounts).reduce((a, b) => a + b, 0) + 1; // +1 for the user row
  const totalNullifies = Object.values(nullifyCounts).reduce((a, b) => a + b, 0);

  console.log('─── ROWS TO DELETE ───────────────────────────────────────');
  for (const [key, val] of Object.entries(deleteCounts)) {
    if (val > 0) console.log(`  🗑  ${key}: ${val}`);
  }
  console.log(`  🗑  users: 1 (the user row itself)`);
  if (supabaseAuthExists) console.log(`  🗑  Supabase auth.users: 1`);
  console.log(`  Total: ${totalDeletes} row(s) + ${supabaseAuthExists ? '1 auth user' : '0 auth users'}`);

  console.log('');
  console.log('─── ROWS TO NULLIFY (clear user reference) ──────────────');
  let hasNullifies = false;
  for (const [key, val] of Object.entries(nullifyCounts)) {
    if (val > 0) {
      console.log(`  ✏️  ${key}: ${val}`);
      hasNullifies = true;
    }
  }
  if (!hasNullifies) console.log('  (none)');
  else console.log(`  Total: ${totalNullifies} field(s) nullified`);

  console.log('');

  if (totalDeletes + totalNullifies === 1 && !supabaseAuthExists) {
    console.log('ℹ️  User has no related data — only the user row would be deleted.');
  }

  // ── Dry run: stop here ─────────────────────────────────────────────────
  if (!confirmed) {
    console.log('⚠️  DRY RUN — no changes made. Re-run with --yes to execute.\n');
    process.exit(0);
  }

  // ── Execute deletion ───────────────────────────────────────────────────
  console.log('🚀 Executing deletion...\n');

  await db.transaction(async (tx) => {
    // ── Phase 1: Delete invoices linked to this user's payouts ──────────
    const userPayoutIds = await tx
      .select({ id: payouts.id })
      .from(payouts)
      .where(eq(payouts.beneficiaryId, userId));

    if (userPayoutIds.length > 0) {
      const payoutIdList = userPayoutIds.map((p) => p.id);
      await tx.delete(invoices).where(inArray(invoices.payoutId, payoutIdList));
    }

    // ── Phase 1b: Delete invoices linked to this user's purchases ──────
    const userPurchaseIds = await tx
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.userId, userId));

    if (userPurchaseIds.length > 0) {
      const purchaseIdList = userPurchaseIds.map((p) => p.id);
      await tx.delete(invoices).where(inArray(invoices.purchaseId, purchaseIdList));
    }

    // ── Phase 1c: Delete invoices where the user is a party ─────────────
    // The from/to user FK columns are ON DELETE RESTRICT, so any remaining
    // party invoice (not already removed via payout/purchase above) would
    // otherwise block the user delete.
    await tx
      .delete(invoices)
      .where(or(eq(invoices.fromUserId, userId), eq(invoices.toUserId, userId)));

    // ── Phase 2: Delete deposits ────────────────────────────────────────
    await tx.delete(deposits).where(eq(deposits.beneficiaryId, userId));

    // ── Phase 3: Delete payouts (cascades payout_breakdowns) ────────────
    await tx.delete(payouts).where(eq(payouts.beneficiaryId, userId));

    // ── Phase 4: Delete purchases (cascades purchase_items) ─────────────
    await tx.delete(purchases).where(eq(purchases.userId, userId));

    // ── Phase 5: Delete chat messages sent by this user ─────────────────
    // senderId is NOT NULL, so we delete instead of nullifying.
    await tx.delete(chatMessages).where(eq(chatMessages.senderId, userId));

    // ── Phase 6: Nullify user references in shared tables ───────────────

    // Chat threads — nullify participant/contractor/createdBy refs
    await tx.update(chatThreads).set({ participantAId: null }).where(eq(chatThreads.participantAId, userId));
    await tx.update(chatThreads).set({ participantBId: null }).where(eq(chatThreads.participantBId, userId));
    await tx.update(chatThreads).set({ contractorId: null }).where(eq(chatThreads.contractorId, userId));
    await tx.update(chatThreads).set({ createdBy: null }).where(eq(chatThreads.createdBy, userId));

    // Meetings — nullify user refs
    await tx.update(meetings).set({ brandUserId: null }).where(eq(meetings.brandUserId, userId));
    await tx.update(meetings).set({ assigneeUserId: null }).where(eq(meetings.assigneeUserId, userId));

    // Staff — nullify invitedBy (staff records with userId will be deleted below)
    await tx.update(staff).set({ invitedBy: null }).where(eq(staff.invitedBy, userId));

    // Agency contractor connections — nullify initiatedByUserId
    await tx
      .update(agencyContractorConnections)
      .set({ initiatedByUserId: null })
      .where(eq(agencyContractorConnections.initiatedByUserId, userId));

    // Brand agency connection requests — createdBy is NOT NULL, so delete instead
    await tx
      .delete(brandAgencyConnectionRequests)
      .where(eq(brandAgencyConnectionRequests.createdBy, userId));

    // Proposals — nullify proposalSentById
    await tx.update(proposals).set({ proposalSentById: null }).where(eq(proposals.proposalSentById, userId));

    // Proposal comments — nullify authorId
    await tx.update(proposalComments).set({ authorId: null }).where(eq(proposalComments.authorId, userId));

    // Purchases — nullify proposalSentById (purchases owned by user are already deleted above)
    await tx.update(purchases).set({ proposalSentById: null }).where(eq(purchases.proposalSentById, userId));

    // Projects — nullify user refs
    await tx.update(projects).set({ proposalSentById: null }).where(eq(projects.proposalSentById, userId));
    await tx.update(projects).set({ productionAssigneeId: null }).where(eq(projects.productionAssigneeId, userId));

    // Project deliverables — nullify user refs
    await tx.update(projectDeliverables).set({ uploadedBy: null }).where(eq(projectDeliverables.uploadedBy, userId));
    await tx.update(projectDeliverables).set({ reviewedBy: null }).where(eq(projectDeliverables.reviewedBy, userId));

    // Project revisions — nullify authorId
    await tx.update(projectRevisions).set({ authorId: null }).where(eq(projectRevisions.authorId, userId));

    // Project notes — nullify authorId
    await tx.update(projectNotes).set({ authorId: null }).where(eq(projectNotes.authorId, userId));

    // Files — nullify uploadedBy
    await tx.update(files).set({ uploadedBy: null }).where(eq(files.uploadedBy, userId));

    // Folders — nullify createdBy
    await tx.update(folders).set({ createdBy: null }).where(eq(folders.createdBy, userId));

    // Resources — nullify uploadedBy
    await tx.update(resources).set({ uploadedBy: null }).where(eq(resources.uploadedBy, userId));

    // Spot components — nullify createdByUserId
    await tx.update(spotComponents).set({ createdByUserId: null }).where(eq(spotComponents.createdByUserId, userId));

    // Users — nullify referredByUserId on other users
    await tx.update(users).set({ referredByUserId: null }).where(eq(users.referredByUserId, userId));

    // ── Phase 6: Delete staff records for this user ─────────────────────
    await tx.delete(staff).where(eq(staff.userId, userId));

    // ── Phase 7: Delete email unsubscribes ──────────────────────────────
    await tx.delete(emailUnsubscribes).where(eq(emailUnsubscribes.email, email));

    // ── Phase 8: Delete the user row ────────────────────────────────────
    // This cascades: contractors, userAgencies, userBrands, chatThreadMembers,
    // tasks (assigneeId), agencyContractorConnections (contractorId).
    await tx.delete(users).where(eq(users.id, userId));
  });

  console.log('✔ Postgres deletion complete.\n');

  // ── Phase 9: Delete from Supabase Auth (outside transaction) ──────────
  if (supabaseAuthExists && supabaseUrl && supabaseSecretKey) {
    const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (error) {
        console.error(`⚠️  Supabase Auth deletion failed: ${error.message}`);
        console.error('   The user has been removed from the app database but remains in Supabase Auth.');
        console.error(`   Manually delete auth user ${userId} from the Supabase dashboard.`);
      } else {
        console.log('✔ Supabase Auth user deleted.');
      }
    } catch (e: any) {
      console.error(`⚠️  Supabase Auth deletion error: ${e.message}`);
    }
  } else if (!supabaseAuthExists) {
    console.log('ℹ️  No Supabase Auth user found (already deleted or never existed).');
  }

  console.log(`\n🎉 User "${email}" has been completely deleted.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error('✖ Failed to delete user:', e);
  process.exit(1);
});
