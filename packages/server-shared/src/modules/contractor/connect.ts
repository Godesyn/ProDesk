import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { agencyContractorConnections } from '../../db/schema.js';
import { createContractorThread } from '../chat/threads.js';
import { completeTasksByEntity } from '../../routers/tasks.js';

/**
 * Establish (or re-activate) an active contractor↔agency connection from a
 * redeemed contractor-invite token. Shared by contractor.create (new contractor
 * just built their profile) and auth.redeemInvite (the redeemer is *already* a
 * contractor, so there's no profile step to consume the token).
 *
 * The signed token is enough — whoever redeems it is connected, regardless of
 * the email it was originally addressed to. Idempotent: re-activates an existing
 * connection row, drops the email-only placeholder row the invite created, opens
 * the 1:1 chat thread, and clears the open connection task.
 */
export async function connectContractorViaInvite(
  db: DB,
  userId: string,
  userEmail: string,
  agencyId: string,
  note: string | null,
): Promise<void> {
  const [conn] = await db
    .insert(agencyContractorConnections)
    .values({
      agencyId,
      contractorId: userId,
      status: 'active',
      initiatedByUserId: userId,
      note,
      respondedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [agencyContractorConnections.agencyId, agencyContractorConnections.contractorId],
      targetWhere: sql`${agencyContractorConnections.contractorId} is not null`,
      set: { status: 'active', respondedAt: new Date() },
    })
    .returning();
  if (!conn) return;
  // Drop the email-only placeholder row this user was invited through (now
  // superseded by the real, contractor-keyed connection above).
  await db
    .delete(agencyContractorConnections)
    .where(and(eq(agencyContractorConnections.agencyId, agencyId), eq(agencyContractorConnections.pendingEmail, userEmail)));
  await createContractorThread(conn.agencyId, userId, db);
  await completeTasksByEntity(conn.id, db);
}
