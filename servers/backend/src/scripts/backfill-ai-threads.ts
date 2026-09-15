/**
 * Backfill: give every existing brand a dedicated AI assistant thread
 * (chat_threads.type = 'ai'), stamp brands.chatbot_thread_id, and reconcile the
 * thread's membership with the brand's current roster (owner + active brand
 * staff). Idempotent — an existing thread is reused and membership is an upsert,
 * so it's safe to re-run.
 *
 * Membership matters as much as the thread: it's otherwise only written when the
 * thread is created or a staff invite is accepted, so anyone who joined a brand
 * by another route (seeded/imported staff, ownership transfer) hits "Not an AI
 * thread you can access." in Growth Strategy.
 *
 * Run: `tsx --env-file=../.env src/scripts/backfill-ai-threads.ts`
 *   (from the server/ workspace; or `bun run --filter server -- tsx src/scripts/backfill-ai-threads.ts`)
 */
import { db } from '@prodesk/server-shared/db/index';
import { brands } from '@prodesk/server-shared/db/schema';
import { ensureBrandAiThread } from '@prodesk/server-shared/modules/chat/threads';

async function run(): Promise<void> {
  const rows = await db
    .select({ id: brands.id, name: brands.businessName, threadId: brands.chatbotThreadId })
    .from(brands);
  const missing = rows.filter((b) => !b.threadId).length;
  console.log(`[backfill-ai-threads] ${rows.length} brand(s); ${missing} without an AI thread.`);
  let created = 0;
  let synced = 0;
  let failed = 0;
  for (const b of rows) {
    try {
      const id = await ensureBrandAiThread(b.id, db);
      if (!id) continue;
      if (b.threadId) {
        synced += 1;
      } else {
        created += 1;
        console.log(`[backfill-ai-threads] ${b.name} → thread ${id}`);
      }
    } catch (err) {
      failed += 1;
      console.error(`[backfill-ai-threads] FAILED for ${b.name} (${b.id}):`, (err as Error).message);
    }
  }
  console.log(`[backfill-ai-threads] done — created ${created}, membership-synced ${synced}, failed ${failed}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-ai-threads] fatal', err);
    process.exit(1);
  });
