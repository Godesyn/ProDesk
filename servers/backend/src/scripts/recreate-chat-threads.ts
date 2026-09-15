/**
 * Recreate chat threads from scratch using the application's own thread-creation
 * logic, instead of the (buggy) Firestore→Postgres migration.
 *
 * Why: the migrated chat_threads lost every connection_id and all but one chat
 * message (see migration-state/inconsistencies.* and the namespace-mismatch fix
 * in scripts/migrate/backfill.ts). Rather than repair half-broken rows, we wipe
 * the chat tables and let the canonical `ensure*` helpers rebuild the proper
 * topology (correct connection_id, members, system messages, AI threads).
 *
 * Genuine human messages (type != 'system' AND not AI) are preserved: in COMMIT
 * mode the current chat tables are dumped to migration-state/chat-backup/<target>
 * BEFORE the wipe, and any human message that lived in a `platformAdmin` thread
 * is re-inserted into the recreated platformAdmin thread for its original owner.
 *
 * Auto-generated types recreated here: you, platformAdmin, ai, all,
 * brandAgencyStaff, agencyContractorPersonal, agencyStaff, brandStaff.
 * User-action-only types (interAgency, agencyPersonal, brandAgencyPersonal,
 * brandPersonal) are NOT recreated — they exist only when a user starts them.
 *
 *   tsx src/scripts/recreate-chat-threads.ts              # DRY-RUN on staging
 *   tsx src/scripts/recreate-chat-threads.ts --commit     # wipe + recreate staging
 *   tsx src/scripts/recreate-chat-threads.ts --prod       # DRY-RUN on production
 *   tsx src/scripts/recreate-chat-threads.ts --prod --commit   # wipe + recreate PROD
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const commit = process.argv.includes('--commit');
const targetProd = process.argv.includes('--prod');
const targetName = targetProd ? 'prod' : 'staging';

// Point env at the chosen target BEFORE importing the db client (env is read at
// module load). The selected railway env file WINS for DATABASE_URL.
const here = dirname(fileURLToPath(import.meta.url));
const envFile = targetProd ? 'shared.production.env' : 'shared.staging.env';
loadEnv({ path: resolve(here, `../../../../.railway/envs/${envFile}`), override: true });

const { db } = await import('@prodesk/server-shared/db/index');
const s = await import('@prodesk/server-shared/db/schema');
const { eq, and, isNotNull, inArray } = await import('drizzle-orm');
const { ensurePlatformAdminThread, ensureBrandAiThread, createConnectionThreads, createContractorThread, handleStaffPermissionGranted } =
  await import('@prodesk/server-shared/modules/chat/threads');

const BACKUP_DIR = resolve(process.cwd(), 'migration-state/chat-backup', targetName);

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').host;
  } catch {
    return '<unset>';
  }
}

async function counts() {
  const threads = (await db.select({ id: s.chatThreads.id }).from(s.chatThreads)).length;
  const members = (await db.select({ id: s.chatThreadMembers.threadId }).from(s.chatThreadMembers)).length;
  const messages = (await db.select({ id: s.chatMessages.id }).from(s.chatMessages)).length;
  return { threads, members, messages };
}

async function byType() {
  const rows = await db.select().from(s.chatThreads);
  const m: Record<string, number> = {};
  for (const r of rows) m[r.type] = (m[r.type] ?? 0) + 1;
  return m;
}

/** Dump current chat tables to the backup dir; return the rows + a human-message subset. */
async function backupAndExtractHuman() {
  const threads = await db.select().from(s.chatThreads);
  const members = await db.select().from(s.chatThreadMembers);
  const messages = await db.select().from(s.chatMessages);
  const human = messages.filter((m: any) => m.type !== 'system' && !m.isAi);

  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(resolve(BACKUP_DIR, `chat_threads.${stamp}.json`), JSON.stringify(threads, null, 2));
  writeFileSync(resolve(BACKUP_DIR, `chat_thread_members.${stamp}.json`), JSON.stringify(members, null, 2));
  writeFileSync(resolve(BACKUP_DIR, `chat_messages.${stamp}.json`), JSON.stringify(messages, null, 2));
  writeFileSync(resolve(BACKUP_DIR, `human_messages.${stamp}.json`), JSON.stringify(human, null, 2));
  console.log(`[recreate-chat] backed up ${threads.length} threads / ${members.length} members / ${messages.length} messages → ${BACKUP_DIR}`);

  // old threadId → { type, owner } so platformAdmin human messages can be re-homed.
  const threadInfo = new Map<string, { type: string; owner: string | null }>();
  for (const t of threads) threadInfo.set(t.id, { type: t.type, owner: t.participantAId ?? null });
  return { human, threadInfo };
}

async function main() {
  console.log(`[recreate-chat] target = ${targetName.toUpperCase()}  host = ${dbHost()}  (${commit ? 'COMMIT' : 'DRY-RUN'})`);

  const users = await db.select({ id: s.users.id }).from(s.users);
  const brandRows = await db.select({ id: s.brands.id }).from(s.brands);
  const conns = await db.select().from(s.brandAgencyConnections);
  const contractorConns = await db
    .select({ agencyId: s.agencyContractorConnections.agencyId, contractorId: s.agencyContractorConnections.contractorId })
    .from(s.agencyContractorConnections)
    .where(eq(s.agencyContractorConnections.status, 'active'));
  const staffRows = await db
    .select({ userId: s.staff.userId, agencyId: s.staff.agencyId, brandId: s.staff.brandId, permissions: s.staff.permissions })
    .from(s.staff)
    .where(and(eq(s.staff.status, 'active'), isNotNull(s.staff.userId)));

  // GUARD — refuse to run once the consumer messenger has any data.
  //
  // This script was a one-off repair for the Firestore→Postgres migration and its
  // wipe is an UNQUALIFIED `delete(chatThreads)`. It recreates only the
  // auto-generated org types listed in the header; nothing here can recreate a
  // `direct` or `group` thread, because those exist only because two people
  // decided to talk. Running it after chat.prodesk.com launched would delete
  // every DM and group in the product — recoverable only from the backup file,
  // by hand, if anyone thought to look.
  const consumerThreads = await db
    .select({ id: s.chatThreads.id })
    .from(s.chatThreads)
    .where(inArray(s.chatThreads.type, ['direct', 'group']))
    .limit(1);
  if (consumerThreads.length > 0) {
    console.error(
      '\n[recreate-chat] ABORTED: this database has consumer messenger threads ' +
        "('direct' / 'group').\n" +
        'This script wipes chat_threads unqualified and cannot recreate them, so ' +
        'running it would destroy every DM and group.\n' +
        'If you genuinely need to rebuild the org-derived topology, write a ' +
        'targeted script that deletes only the auto-generated types.',
    );
    process.exit(1);
  }

  const before = await counts();
  const humanPreview = (await db.select().from(s.chatMessages)).filter((m: any) => m.type !== 'system' && !m.isAi);
  console.log(`\nWould delete: ${before.threads} threads, ${before.members} members, ${before.messages} messages (cascade).`);
  console.log('Would recreate from:');
  console.log(`  users                          ${users.length}  → you + platformAdmin`);
  console.log(`  brands                         ${brandRows.length}  → ai`);
  console.log(`  brand_agency_connections       ${conns.length}  → all + brandAgencyStaff`);
  console.log(`  agency_contractor_connections  ${contractorConns.length}  → agencyContractorPersonal`);
  console.log(`  active staff (with user)       ${staffRows.length}  → agencyStaff / brandStaff (per permissions)`);
  console.log(`  human messages to preserve     ${humanPreview.length}`);
  for (const m of humanPreview) console.log(`    - ${m.senderName}: ${JSON.stringify((m.content ?? '').slice(0, 50))}`);

  if (!commit) {
    console.log('\n[recreate-chat] DRY-RUN — no changes. Re-run with --commit to execute.');
    process.exit(0);
  }

  // 0. Backup (atomic with the wipe) + extract the human messages to preserve.
  const { human, threadInfo } = await backupAndExtractHuman();

  // 1. Wipe (children cascade; brands.chatbot_thread_id auto-nulls).
  await db.delete(s.chatThreads);
  console.log('[recreate-chat] chat tables cleared.');

  // 2. Per-user: you + platformAdmin.
  let n = 0;
  for (const u of users) { await ensurePlatformAdminThread(u.id); n++; }
  console.log(`[recreate-chat] platformAdmin/you threads for ${n} users.`);

  // 3. Per-brand: AI assistant thread.
  n = 0;
  for (const b of brandRows) { if (await ensureBrandAiThread(b.id)) n++; }
  console.log(`[recreate-chat] AI threads for ${n} brands.`);

  // 4. Per brand↔agency connection: all + brandAgencyStaff.
  n = 0;
  for (const c of conns) { await createConnectionThreads(c.id, c.brandId, c.agencyId); n++; }
  console.log(`[recreate-chat] connection threads for ${n} connections.`);

  // 5. Per agency↔contractor connection.
  n = 0;
  for (const c of contractorConns) { if (c.agencyId && c.contractorId && await createContractorThread(c.agencyId, c.contractorId)) n++; }
  console.log(`[recreate-chat] contractor threads for ${n} connections.`);

  // 6. Staff internal threads, driven by each member's chat permissions.
  n = 0;
  for (const st of staffRows) {
    if (!st.userId) continue;
    await handleStaffPermissionGranted(st.userId, { agencyId: st.agencyId, brandId: st.brandId }, st.permissions ?? []);
    n++;
  }
  console.log(`[recreate-chat] staff permission threads processed for ${n} staff.`);

  // 7. Restore preserved human messages that lived in a platformAdmin thread.
  let restored = 0;
  for (const m of human) {
    const info = threadInfo.get(m.threadId);
    if (!info || info.type !== 'platformAdmin' || !info.owner) {
      console.warn(`[recreate-chat] message ${m.id} (thread type ${info?.type ?? '?'}) not auto-restored — kept in backup.`);
      continue;
    }
    const target = (
      await db
        .select({ id: s.chatThreads.id })
        .from(s.chatThreads)
        .where(and(eq(s.chatThreads.type, 'platformAdmin'), eq(s.chatThreads.participantAId, info.owner)))
        .limit(1)
    )[0];
    if (!target) {
      console.warn(`[recreate-chat] no recreated platformAdmin thread for ${info.owner} — message ${m.id} kept in backup.`);
      continue;
    }
    await db
      .insert(s.chatMessages)
      .values({
        id: m.id,
        threadId: target.id,
        senderId: m.senderId,
        senderName: m.senderName,
        senderAvatar: m.senderAvatar,
        senderRole: m.senderRole,
        senderBusinessName: m.senderBusinessName,
        content: m.content,
        type: m.type ?? 'text',
        timestamp: m.timestamp,
      })
      .onConflictDoNothing();
    await db.update(s.chatThreads).set({ lastMessage: m.content, lastMessageAt: m.timestamp }).where(eq(s.chatThreads.id, target.id));
    restored++;
  }
  console.log(`[recreate-chat] restored ${restored} human message(s).`);

  const after = await counts();
  console.log(`\n[recreate-chat] done. Now: ${after.threads} threads, ${after.members} members, ${after.messages} messages.`);
  console.log('By type:', JSON.stringify(await byType()));
  process.exit(0);
}

main().catch((err) => {
  console.error('[recreate-chat] failed:', err);
  process.exit(1);
});
