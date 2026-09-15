/**
 * Short Links Cleanup Service
 *
 * Automatically purges short links that have been disabled/parked for more than 30 days.
 * When a short link is disabled, it is parked for up to 30 days. After 30 days of inactivity,
 * this background task permanently deletes the row, releasing the short slug for others to claim.
 */
import { and, eq, lte, or, sql } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { shortLinks } from '../../db/schema.js';

export const PARKING_DURATION_DAYS = 30;
export const PARKING_DURATION_MS = PARKING_DURATION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Calculates the deletion date for a disabled link given its disabledAt (or createdAt) timestamp.
 */
export function getLinkDeletionDate(disabledAt: Date | string | null, createdAt?: Date | string | null): Date {
  const baseDate = disabledAt ? new Date(disabledAt) : createdAt ? new Date(createdAt) : new Date();
  return new Date(baseDate.getTime() + PARKING_DURATION_MS);
}

/**
 * Calculates the number of days remaining until deletion for a disabled link.
 * Returns 0 if already expired.
 */
export function getLinkDaysRemaining(disabledAt: Date | string | null, createdAt?: Date | string | null): number {
  const deleteDate = getLinkDeletionDate(disabledAt, createdAt);
  const diffMs = deleteDate.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Sweeps the database and purges short links that have been inactive for >= 30 days.
 */
export async function purgeExpiredDisabledLinks(db: DB): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - PARKING_DURATION_MS);

  // Find inactive links where disabledAt <= cutoff, OR disabledAt IS NULL and createdAt <= cutoff
  const deletedRows = await db
    .delete(shortLinks)
    .where(
      and(
        eq(shortLinks.isActive, false),
        or(
          lte(shortLinks.disabledAt, cutoff),
          and(sql`${shortLinks.disabledAt} IS NULL`, lte(shortLinks.createdAt, cutoff))
        )
      )
    )
    .returning({ id: shortLinks.id, slug: shortLinks.slug });

  if (deletedRows.length > 0) {
    console.log(`[short-links-cleanup] Purged ${deletedRows.length} expired parked short links:`, deletedRows.map((r) => r.slug).join(', '));
  }

  return { deletedCount: deletedRows.length };
}
