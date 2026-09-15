import { and, eq } from 'drizzle-orm';
import { brandAgencyConnections } from '../../db/schema.js';
import { db as defaultDb, type DB } from '../../db/index.js';
import { ensureChatConnection } from '../chat/threads.js';
import { applyDefaultFormsToBrand } from '../spot/provision.js';

/**
 * The single chokepoint for linking a brand to an agency. Every path that
 * connects them — the brand accepting an agency's request (connections router OR
 * the task action), a brand self-connecting, a contractor being allocated to a
 * brand's project, and a marketplace/proposal purchase — funnels through here so
 * they all behave identically:
 *
 *   1. Ensure the `brand_agency_connections` row exists (idempotent).
 *   2. Open the brand↔agency chat threads on first creation (via ensureChatConnection).
 *   3. Provision the agency's default Info Hub (SPOT) sections onto the brand.
 *
 * Step 3 runs on EVERY call, not just when the row is newly inserted, because a
 * connection row can already exist (e.g. created earlier by a contractor
 * allocation) before the brand formally "connects" — and the defaults must still
 * land. `applyDefaultFormsToBrand` is idempotent, so re-applying is a no-op.
 *
 * Returns `{ connection, created }` so callers that only want side effects on a
 * genuinely new link (e.g. the agency-notification email) can gate on `created`.
 */
export async function connectBrandToAgency(
  brandId: string,
  agencyId: string,
  db: DB = defaultDb,
): Promise<{ connection: Awaited<ReturnType<typeof ensureChatConnection>>; created: boolean }> {
  const existing = await db
    .select({ id: brandAgencyConnections.id })
    .from(brandAgencyConnections)
    .where(and(eq(brandAgencyConnections.brandId, brandId), eq(brandAgencyConnections.agencyId, agencyId)))
    .limit(1);
  const created = existing.length === 0;
  const connection = await ensureChatConnection(brandId, agencyId, db);
  await applyDefaultFormsToBrand({ brandId, agencyId }, db);
  return { connection, created };
}
