/**
 * Short-link slug rules — shared by the links router, the campaigns router and the
 * AI tools. Slugs live in ONE global namespace: a campaign and a plain link can
 * never claim the same slug, because the redirector resolves a bare `/:slug` with
 * no idea which kind it is (enforced by short_links_slug_lower_idx).
 */
import { sql } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { shortLinks } from '../../db/schema.js';

/** Lowercase alphanumerics and hyphens, no leading/trailing hyphen. */
export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 60;

/** Slugs we keep for our own routes, so a link can never shadow one. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'health', 'static', 'assets', 'login', 'signup',
  'auth', 'dashboard', 'settings', 'profile', 'billing', 'support',
]);

/** Why this slug is unusable, or null when its FORMAT is fine (not uniqueness). */
export function slugFormatIssue(slug: string): string | null {
  if (!SLUG_REGEX.test(slug)) return 'Invalid format';
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return `Must be ${SLUG_MIN}-${SLUG_MAX} characters`;
  }
  if (RESERVED_SLUGS.has(slug)) return 'Reserved';
  return null;
}

/** True when the slug is already taken by ANY short link or campaign. */
export async function slugTaken(db: DB, slug: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shortLinks.id })
    .from(shortLinks)
    .where(sql`lower(${shortLinks.slug}) = ${slug.toLowerCase()}`)
    .limit(1);
  return !!row;
}

// Unambiguous base32 alphabet (no look-alike chars) for auto-generated slugs.
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Generate a random 6-char slug that collides with neither the DB nor slugs
 * already claimed in the current batch. Retries a handful of times.
 */
export async function generateUniqueSlug(
  db: DB,
  claimed: Set<string> = new Set(),
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    let slug = '';
    for (let i = 0; i < 6; i++) {
      slug += SLUG_ALPHABET[Math.floor(Math.random() * SLUG_ALPHABET.length)];
    }
    if (claimed.has(slug) || RESERVED_SLUGS.has(slug)) continue;
    if (!(await slugTaken(db, slug))) return slug;
  }
  throw new Error('Could not generate a unique slug');
}
