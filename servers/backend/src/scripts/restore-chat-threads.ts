/**
 * Restore the chat tables from a backup produced by recreate-chat-threads.ts
 * (migration-state/chat-backup/<target>/*.json). Used to roll back when a
 * recreate run fails after the wipe. Re-inserts threads → members → messages
 * (FK order) and reconstructs brands.chatbotThreadId from the backed-up `ai`
 * threads (the cascade nulled it on delete). Idempotent (onConflictDoNothing).
 *
 *   tsx src/scripts/restore-chat-threads.ts --prod            # DRY-RUN (prod)
 *   tsx src/scripts/restore-chat-threads.ts --prod --commit   # restore prod
 */
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const commit = process.argv.includes('--commit');
const targetProd = process.argv.includes('--prod');
const targetName = targetProd ? 'prod' : 'staging';

const here = dirname(fileURLToPath(import.meta.url));
const envFile = targetProd ? 'shared.production.env' : 'shared.staging.env';
loadEnv({ path: resolve(here, `../../../../.railway/envs/${envFile}`), override: true });

const { db } = await import('@prodesk/server-shared/db/index');
const s = await import('@prodesk/server-shared/db/schema');
const { eq } = await import('drizzle-orm');

const BACKUP_DIR = resolve(process.cwd(), 'migration-state/chat-backup', targetName);

function latest(prefix: string): string {
  const files = readdirSync(BACKUP_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  if (!files.length) throw new Error(`No ${prefix}* backup in ${BACKUP_DIR}`);
  files.sort();
  return resolve(BACKUP_DIR, files[files.length - 1]);
}
const read = (prefix: string) => JSON.parse(readFileSync(latest(prefix), 'utf8')) as any[];

/** Revive ISO-string fields back to Date for timestamp columns. */
function dates<T extends Record<string, any>>(rows: T[], fields: string[]): T[] {
  return rows.map((r) => {
    const out: any = { ...r };
    for (const f of fields) if (typeof out[f] === 'string') out[f] = new Date(out[f]);
    return out;
  });
}

async function insertChunked(table: any, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    if (chunk.length) await db.insert(table).values(chunk).onConflictDoNothing();
  }
}

async function main() {
  const host = (() => { try { return new URL(process.env.DATABASE_URL ?? '').host; } catch { return '<unset>'; } })();
  console.log(`[restore-chat] target = ${targetName.toUpperCase()}  host = ${host}  (${commit ? 'COMMIT' : 'DRY-RUN'})`);

  const threads = dates(read('chat_threads.'), ['createdAt', 'updatedAt', 'lastMessageAt']);
  const members = dates(read('chat_thread_members.'), ['lastReadAt', 'joinedAt']);
  const messages = dates(read('chat_messages.'), ['timestamp']);
  const aiThreads = threads.filter((t) => t.type === 'ai' && t.brandId);

  const cur = {
    threads: (await db.select({ id: s.chatThreads.id }).from(s.chatThreads)).length,
    members: (await db.select({ id: s.chatThreadMembers.threadId }).from(s.chatThreadMembers)).length,
    messages: (await db.select({ id: s.chatMessages.id }).from(s.chatMessages)).length,
  };
  console.log(`Current DB: ${cur.threads} threads, ${cur.members} members, ${cur.messages} messages.`);
  console.log(`Backup:     ${threads.length} threads, ${members.length} members, ${messages.length} messages (+ ${aiThreads.length} brand AI links to restore).`);

  if (!commit) {
    console.log('\n[restore-chat] DRY-RUN — no changes. Re-run with --commit to restore.');
    process.exit(0);
  }

  await insertChunked(s.chatThreads, threads);
  console.log(`[restore-chat] inserted threads.`);
  await insertChunked(s.chatThreadMembers, members);
  console.log(`[restore-chat] inserted members.`);
  await insertChunked(s.chatMessages, messages);
  console.log(`[restore-chat] inserted messages.`);

  let linked = 0;
  for (const t of aiThreads) {
    await db.update(s.brands).set({ chatbotThreadId: t.id }).where(eq(s.brands.id, t.brandId));
    linked++;
  }
  console.log(`[restore-chat] reconnected ${linked} brand AI thread links.`);

  const after = {
    threads: (await db.select({ id: s.chatThreads.id }).from(s.chatThreads)).length,
    members: (await db.select({ id: s.chatThreadMembers.threadId }).from(s.chatThreadMembers)).length,
    messages: (await db.select({ id: s.chatMessages.id }).from(s.chatMessages)).length,
  };
  console.log(`\n[restore-chat] done. Now: ${after.threads} threads, ${after.members} members, ${after.messages} messages.`);
  process.exit(0);
}

main().catch((err) => { console.error('[restore-chat] failed:', err); process.exit(1); });
