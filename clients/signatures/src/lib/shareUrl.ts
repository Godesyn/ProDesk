/**
 * Public share-link helpers for the hosted signature directory.
 *
 * A brand runs several signature DEPARTMENTS, so the link has two segments:
 *
 *   /team/<brand>/<department>   one specific department
 *   /team/<brand>                whichever department is currently the default
 *   /share/<brandKitId>          the original id link, kept working forever
 *
 * Only the BRAND segment is derived from a name. The department segment is a
 * persisted column (`brand_kits.slug`, migration 0089), so renaming a department
 * never breaks a signature already sitting in someone's inbox.
 *
 * `slugifyBrandKitName` MUST stay in lockstep with the identically-named server
 * helper in packages/server-shared/src/routers/signatures.ts: the client builds
 * the link from the kit name and the server matches the slug back to the kit, so
 * any divergence breaks resolution.
 */

/** Slugify a brand-kit display name for the `/team/:slug` share URL. */
export function slugifyBrandKitName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics (é -> e)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> single hyphen
    .replace(/^-+|-+$/g, ''); // trim leading/trailing hyphens
}

/**
 * Build a department's public share URL: `/team/<brand>/<department>`.
 *
 * Both segments come from the server (`departments.list` returns `brandSlug` and
 * `departmentSlug`) — the department half is a PERSISTED column, so it survives a
 * rename. Falls back to the legacy id link `/share/:id` when the brand segment
 * slugifies to nothing (a kit name with no alphanumerics), which the server
 * cannot resolve by slug.
 *
 * The brand's default department is ALSO reachable at the bare `/team/<brand>`,
 * but this still returns its explicit two-segment path: promoting a different
 * default should not change a link somebody already pasted into their signature.
 */
export function buildShareUrl(
  brandKitId: string,
  brandSlug: string,
  departmentSlug: string,
): string {
  const brand = slugifyBrandKitName(brandSlug);
  if (!brand) return `${window.location.origin}/share/${brandKitId}`;
  const dept = slugifyBrandKitName(departmentSlug);
  const path = dept ? `/team/${brand}/${dept}` : `/team/${brand}`;
  return `${window.location.origin}${path}`;
}
