import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import { users } from '../db/schema.js';

/**
 * How recent the user's last presence heartbeat must be for them to count as
 * "online". The client writes `users.last_seen_at` every ~30s while the app is
 * foregrounded, so a 90s window tolerates one missed beat. Ports the Flutter
 * backend's PRESENCE_HEARTBEAT_THRESHOLD_SECONDS.
 */
export const PRESENCE_HEARTBEAT_THRESHOLD_MS = 90_000;

/**
 * Returns true if the user's most recent presence heartbeat sits inside the
 * {@link PRESENCE_HEARTBEAT_THRESHOLD_MS} window. Mirrors `isUserOnline`
 * (functions/src/modules/chat/presence.ts).
 */
export async function isUserOnline(
  userId: string,
  now = Date.now(),
  db = defaultDb,
): Promise<boolean> {
  const row = (
    await db
      .select({ lastSeenAt: users.lastSeenAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  const lastSeen = row?.lastSeenAt;
  if (!lastSeen) return false;
  return now - lastSeen.getTime() <= PRESENCE_HEARTBEAT_THRESHOLD_MS;
}
