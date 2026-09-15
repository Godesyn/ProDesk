/**
 * Utility script to change a super-admin's email address in both Supabase Auth
 * and the Postgres database (including `users`, `staff`, and email preference tables).
 *
 * Usage:
 *   npx tsx src/scripts/change-admin-email.ts <current_email> <new_email> [--stage | --prod]
 */
import './env-setup.js';
import { eq } from 'drizzle-orm';
import { db } from '@prodesk/server-shared/db/index';
import { users, staff, emailUnsubscribes } from '@prodesk/server-shared/db/schema';
import { supabaseAdmin } from '@prodesk/server-shared/lib/supabase';

async function main() {
  const oldEmail = process.argv[2]?.trim().toLowerCase();
  const newEmail = process.argv[3]?.trim().toLowerCase();

  if (!oldEmail || !newEmail) {
    console.error('\n❌ Missing arguments!');
    console.error('Usage:');
    console.error('  npx tsx src/scripts/change-admin-email.ts <current_email> <new_email> [--stage | --prod]\n');
    process.exit(1);
  }

  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(oldEmail) || !emailRegex.test(newEmail)) {
    console.error('\n❌ Invalid email format! Please provide valid email addresses.');
    process.exit(1);
  }

  console.log(`\n🔍 Looking up user "${oldEmail}" in the database...`);
  const user = (
    await db
      .select()
      .from(users)
      .where(eq(users.email, oldEmail))
      .limit(1)
  )[0];

  if (!user) {
    console.error(`❌ User with email "${oldEmail}" not found in the database.`);
    process.exit(1);
  }

  // Safety gate: verify they are a superAdmin
  if (!user.isSuperAdmin) {
    console.error(`❌ Error: User "${oldEmail}" (ID: ${user.id}) is not a super-admin.`);
    console.error('   This script is restricted to changing emails of super-admins.');
    process.exit(1);
  }

  // Check if the new email is already taken in the database
  const existingNewUser = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, newEmail))
      .limit(1)
  )[0];

  if (existingNewUser) {
    console.error(`❌ Error: New email "${newEmail}" is already in use by user ID: ${existingNewUser.id}`);
    process.exit(1);
  }

  console.log(`👉 Found Super Admin: ${user.firstName} ${user.lastName} (ID: ${user.id})`);
  console.log(`   Changing email from: "${oldEmail}" ➔ "${newEmail}"\n`);

  // 1. Update in Supabase Auth
  console.log('⚡ Updating Supabase Auth (skipping verification)...');
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
    user.id,
    {
      email: newEmail,
      email_confirm: true, // Confirm the new email address immediately
    }
  );

  if (authError) {
    console.error('❌ Failed to update email in Supabase Auth:', authError.message);
    process.exit(1);
  }
  console.log('✅ Supabase Auth updated successfully.');

  // 2. Update Database Tables in a Transaction
  console.log('⚡ Updating Postgres database tables...');
  try {
    await db.transaction(async (tx) => {
      // Update users table
      await tx
        .update(users)
        .set({ email: newEmail })
        .where(eq(users.id, user.id));
      console.log('   • Updated "users" table.');

      // Update staff table (if they are a staff member anywhere)
      const updatedStaff = await tx
        .update(staff)
        .set({ email: newEmail })
        .where(eq(staff.userId, user.id))
        .returning();
      if (updatedStaff.length > 0) {
        console.log(`   • Updated ${updatedStaff.length} row(s) in "staff" table.`);
      }

      // Update email_unsubscribes table (if they have unsubscribed channels)
      const unsub = (
        await tx
          .select()
          .from(emailUnsubscribes)
          .where(eq(emailUnsubscribes.email, oldEmail))
          .limit(1)
      )[0];

      if (unsub) {
        await tx.insert(emailUnsubscribes).values({
          email: newEmail,
          channels: unsub.channels,
          updatedAt: new Date(),
        });
        await tx.delete(emailUnsubscribes).where(eq(emailUnsubscribes.email, oldEmail));
        console.log('   • Updated "email_unsubscribes" preferences.');
      }
    });

    console.log('\n🎉 Successfully updated all database tables!');
    console.log(`\n👉 Remember to update the email in:`);
    console.log('   servers/backend/src/scripts/initialize_data/superadmin.json');
    console.log('   to match your new email, otherwise the startup seed will re-create the default admin on reboot.\n');
    process.exit(0);
  } catch (dbError) {
    console.error('\n❌ Transaction failed. Database changes rolled back.');
    console.error(dbError);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('\n❌ Unhandled script error:');
  console.error(e);
  process.exit(1);
});
