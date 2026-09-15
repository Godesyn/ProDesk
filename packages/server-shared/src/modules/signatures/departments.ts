/**
 * Signature departments — the copy rules.
 *
 * A department is one complete signature design for a brand (Sales, Support,
 * Execs). Creating one almost always means copying an existing one, because the
 * design form is long; this module owns what "copy" includes.
 *
 * Lives outside routers/signatures.ts so it can be unit-tested directly — the
 * copy is exactly the kind of thing that silently rots as columns are added.
 */
import type { brandKits } from '../../db/schema.js';
import type { CombinedBrandKit } from './brand-kit-view.js';

type BrandKitRow = typeof brandKits.$inferSelect;

/* ── Share slugs ──────────────────────────────────────────────────────────────
 *
 * A department's public URL is `/team/<brand>/<department>`, and the brand's
 * default department also answers on the bare `/team/<brand>`.
 *
 * The department segment is PERSISTED (brand_kits.slug), never derived at
 * request time. Email signatures sit in real inboxes for years, so a link that
 * dies when someone renames a department is the worst property this scheme could
 * have. Renaming therefore leaves the slug alone.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Lowercase, alphanumeric-and-hyphens. Deterministic and side-effect free. */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    // eslint-disable-next-line no-misleading-character-class -- combining marks
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '') // strip diacritics (é -> e)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> single hyphen
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

/** Fallback when a name slugifies to nothing (e.g. "!!!" or a blank name). */
export const FALLBACK_DEPARTMENT_SLUG = 'department';

/**
 * A department slug that is free within its brand. `taken` is every slug already
 * used by the brand, compared case-insensitively to match the unique index
 * (brand_id, lower(slug)). Collisions get a numeric suffix, mirroring the
 * backfill in migration 0089 so minted and backfilled slugs look alike.
 */
export function mintDepartmentSlug(
  desired: string,
  taken: Iterable<string>,
): string {
  const base = slugify(desired) || FALLBACK_DEPARTMENT_SLUG;
  const used = new Set([...taken].map((s) => s.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * The only columns a copy does NOT take. Everything else on the row copies.
 *
 * Stated as an exclusion list on purpose: a copy that enumerated what to INCLUDE
 * would silently go stale the moment a column is added to brand_kits, and the
 * user would be left hunting for which field didn't come across. Adding a column
 * now means it copies by default — opt it out here if it genuinely must not.
 *
 *   • id / brandId / createdByUserId / timestamps — identify the ROW, not the design.
 *   • departmentName / isDefault / sortOrder — the new department's own placement,
 *     set explicitly by the caller.
 *   • renderedIconUrls — a cache keyed by the colours the icons were baked in. It
 *     MUST regenerate, or a recoloured copy renders its social icons in the
 *     source's colours.
 */
export const DEPARTMENT_COPY_EXCLUDED = new Set([
  'id',
  'brandId',
  'createdByUserId',
  'createdAt',
  'updatedAt',
  'departmentName',
  'isDefault',
  'sortOrder',
  'renderedIconUrls',
]);

/**
 * A full copy of a kit row, ready to seed a new department. "Copy from" means
 * copy — name, logos, address, colours, links, disclaimer, voice, the lot. The
 * new department is then edited or renamed like any other.
 *
 * `resolved` is the source's COMBINED view and is passed for a CROSS-BRAND copy
 * only. It matters because inheritance is per-brand: a source department that
 * stores NULL for its palette or logo is showing its OWN brand's, and copying the
 * raw NULL would silently re-inherit the DESTINATION brand's instead — you'd
 * copy a design and watch it come out in different colours. Resolving first
 * writes those inherited values down as explicit overrides, so the copy looks
 * like what you copied. A same-brand copy passes null and keeps NULLs as NULLs,
 * so a duplicate that was tracking its brand keeps tracking it, live.
 */
export function cloneDepartmentDesign(
  source: BrandKitRow,
  resolved: CombinedBrandKit | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (DEPARTMENT_COPY_EXCLUDED.has(key)) continue;
    out[key] = value ?? null;
  }
  if (!resolved) return out;
  // Cross-brand: pin down whatever the source was inheriting from its own brand.
  out.website = resolved.website;
  out.address = resolved.address;
  out.logoUrl = resolved.logoUrl;
  out.logoKey = resolved.logoKey;
  out.primaryColor = resolved.primaryColor;
  out.secondaryColor = resolved.secondaryColor;
  out.fontFamily = resolved.fontFamily;
  return out;
}
