/**
 * Brand-kit ↔ brands consolidation helpers.
 *
 * `brands` is the single source of truth for the overlapping identity/design
 * fields; the brand_kits row only holds signature-render + brand-kit-only data.
 * These helpers present a COMBINED view (so the Signatures frontend, generator
 * and AI tools keep the old `signatureBrands` shape) and SPLIT an incoming
 * update back into a `brands` patch and a `brand_kits` patch.
 *
 * Positional conventions on `brands`:
 *   colors     = [primary, accent, ink, background, rule]
 *   typography = [Heading, Body, Mono]  (signatures use the Body font)
 *
 * Signature design ↔ palette token mapping (signatures only have two colours):
 *   signature primaryColor   ↔ colors[0] (primary)
 *   signature secondaryColor ↔ colors[2] (INK — the dark text token, NOT accent)
 * The accent token (colors[1]) is owned solely by the Brand Kit palette editor;
 * signatures never touch it, so editing a signature can't clobber the accent.
 *
 * DEPARTMENTS (migration 0087). A brand now holds one kit per signature
 * department, and a non-default department is allowed to diverge from the brand's
 * identity. That's expressed as OVERRIDES: the kit's own website/address/logo/
 * colours/font columns are NULL by default and the combined view falls through to
 * `brands`. Which means the split direction depends on the department:
 *   • the DEFAULT department writes those fields to `brands` (unchanged — it IS
 *     the brand kit, so editing it edits the brand);
 *   • any other department writes them to its own override columns, so re-skinning
 *     the Sales signature can never repaint the brand or the other departments.
 */
import { and, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { brands, brandKits } from '../../db/schema.js';
import { ensureBrandKit } from './billing.js';

type Db = typeof defaultDb;
type Brand = typeof brands.$inferSelect;
type BrandKit = typeof brandKits.$inferSelect;

// Defaults preserved from the old signature_brands column defaults.
export const DEFAULT_PRIMARY = '#4A7C59';
export const DEFAULT_SECONDARY = '#2D3748';
export const DEFAULT_ACCENT = '#8a8a82';
export const DEFAULT_FONT = 'Arial, sans-serif';

type BrandIdentity = Pick<
  Brand,
  'businessName' | 'website' | 'address' | 'logoUrl' | 'colors' | 'typography'
>;

/**
 * The combined brand-kit view: the kit row, with the identity / palette / font
 * fields resolved as `kit override ?? brands ?? built-in default`. Shape matches
 * what previously came straight off the `signatureBrands` row, so downstream
 * consumers need no changes.
 *
 * A department that has never diverged carries NULL overrides and therefore
 * tracks the brand live — rename the brand's website and every inheriting
 * department follows.
 */
export function combineBrandKit(kit: BrandKit, brand: BrandIdentity) {
  const colors = brand.colors ?? [];
  const typography = brand.typography ?? [];
  return {
    ...kit,
    // name comes from the kit row itself (its own business name) — NOT brands.
    website: kit.website ?? brand.website ?? null,
    address: kit.address ?? brand.address ?? null,
    logoUrl: kit.logoUrl ?? brand.logoUrl ?? null,
    // The brand's primary logo is a bare URL on `brands` (no storage key); only a
    // department that uploaded its OWN logo has a key to report.
    logoKey: kit.logoUrl ? kit.logoKey : null,
    primaryColor: kit.primaryColor ?? colors[0] ?? DEFAULT_PRIMARY,
    secondaryColor: kit.secondaryColor ?? colors[2] ?? DEFAULT_SECONDARY, // ink token
    fontFamily:
      kit.fontFamily ?? typography[1] ?? typography[0] ?? DEFAULT_FONT,
    /** True when this kit is the brand's own kit (the rest of the suite's view). */
    isDefault: kit.isDefault,
  };
}

export type CombinedBrandKit = ReturnType<typeof combineBrandKit>;

/** The `brands` columns the combined view sources — one place, one shape. */
const BRAND_IDENTITY_COLUMNS = {
  businessName: brands.businessName,
  website: brands.website,
  address: brands.address,
  logoUrl: brands.logoUrl,
  colors: brands.colors,
  typography: brands.typography,
} as const;

/**
 * Read-only: load the combined view for ONE specific kit (department) by id.
 * Signature departments are many-per-brand, so anything editing or rendering a
 * particular department resolves it here; `loadCombinedBrandKit*` below resolve
 * the brand's DEFAULT department, which is what the rest of the suite means by
 * "the brand kit".
 */
export async function loadCombinedBrandKitById(
  db: Db,
  brandKitId: string,
): Promise<CombinedBrandKit | null> {
  const [kit] = await db
    .select()
    .from(brandKits)
    .where(eq(brandKits.id, brandKitId))
    .limit(1);
  if (!kit) return null;
  const [brand] = await db
    .select(BRAND_IDENTITY_COLUMNS)
    .from(brands)
    .where(eq(brands.id, kit.brandId))
    .limit(1);
  if (!brand) return null;
  return combineBrandKit(kit, brand);
}

/**
 * Read-only: load the combined DEFAULT brand-kit view WITHOUT provisioning.
 * Returns null if the brand kit hasn't been created yet (use for informational
 * reads that must not write, e.g. the AI get_signature_settings tool).
 */
export async function loadCombinedBrandKitReadOnly(
  db: Db,
  brandId: string,
): Promise<CombinedBrandKit | null> {
  const [kit] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)))
    .limit(1);
  if (!kit) return null;
  const [brand] = await db
    .select({
      businessName: brands.businessName,
      website: brands.website,
      address: brands.address,
      logoUrl: brands.logoUrl,
      colors: brands.colors,
      typography: brands.typography,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return null;
  return combineBrandKit(kit, brand);
}

/**
 * Ensure + load the combined DEFAULT brand-kit view for a brand (kit row merged
 * with the `brands` identity/palette/font). Returns null only if the brand is
 * missing.
 */
export async function loadCombinedBrandKit(
  db: Db,
  brandId: string,
  createdByUserId?: string | null,
): Promise<CombinedBrandKit | null> {
  await ensureBrandKit(db, brandId, createdByUserId);
  const [kit] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)))
    .limit(1);
  if (!kit) return null;
  const [brand] = await db
    .select({
      businessName: brands.businessName,
      website: brands.website,
      address: brands.address,
      logoUrl: brands.logoUrl,
      colors: brands.colors,
      typography: brands.typography,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return null;
  return combineBrandKit(kit, brand);
}

function mergeColors(
  existing: string[] | null,
  data: { primaryColor?: unknown; secondaryColor?: unknown; colors?: unknown },
): string[] | undefined {
  // A full colours array (from the Brand Kit palette editor) wins outright.
  if (Array.isArray(data.colors)) return data.colors as string[];
  if (data.primaryColor === undefined && data.secondaryColor === undefined) {
    return undefined;
  }
  const out = Array.isArray(existing) ? [...existing] : [];
  // Fill up to the ink slot (index 2) without disturbing the accent (index 1),
  // which is owned by the Brand Kit palette editor.
  if (out[0] == null) out[0] = DEFAULT_PRIMARY; // primary
  if (out[1] == null) out[1] = DEFAULT_ACCENT; // accent (untouched by signatures)
  if (out[2] == null) out[2] = DEFAULT_SECONDARY; // ink (signature secondary/text)
  if (data.primaryColor !== undefined) out[0] = String(data.primaryColor);
  if (data.secondaryColor !== undefined) out[2] = String(data.secondaryColor);
  return out;
}

function mergeTypography(
  existing: string[] | null,
  data: { fontFamily?: unknown; typography?: unknown },
): string[] | undefined {
  // A full typography array (from the Brand Kit type editor) wins outright.
  if (Array.isArray(data.typography)) return data.typography as string[];
  if (data.fontFamily === undefined) return undefined;
  const font = String(data.fontFamily);
  const out = Array.isArray(existing) ? [...existing] : [];
  if (out[0] == null) out[0] = font; // heading defaults to the one known font
  out[1] = font; // signatures use the Body slot
  return out;
}

const CONSOLIDATED_KEYS = new Set([
  // NOTE: `name` is deliberately NOT here — the signature keeps its own business
  // name on the kit row, so editing it can't rename the tenant brand.
  'website',
  'address',
  'logoUrl',
  'logoKey',
  'primaryColor',
  'secondaryColor',
  'fontFamily',
  // full-array forms coming from the Brand Kit editors:
  'colors',
  'typography',
]);

/**
 * Split a combined update into a `brands` patch (single source of truth) and a
 * `brand_kits` patch. `current` supplies the existing colours/typography so a
 * partial colour/font edit doesn't wipe its siblings.
 *
 * `isDefaultDepartment` decides where the consolidated fields land. The default
 * department IS the brand kit, so its identity/palette/font edits flow through to
 * `brands`. A secondary department writes the same fields to its own override
 * columns instead — an empty brandPatch — so it can look nothing like the brand
 * without touching it. Pass `false` for anything that isn't the default kit.
 */
export function splitBrandKitUpdate(
  data: Record<string, unknown>,
  current: Pick<Brand, 'colors' | 'typography'>,
  isDefaultDepartment = true,
): { brandPatch: Partial<Brand>; kitPatch: Record<string, unknown> } {
  const brandPatch: Partial<Brand> = {};
  const kitPatch: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(data)) {
    if (!CONSOLIDATED_KEYS.has(k)) kitPatch[k] = v;
  }

  // A secondary department keeps every consolidated field on its own row. The
  // full-array `colors`/`typography` forms are Brand-Kit-editor-only and have no
  // per-department meaning, so they're dropped rather than mapped.
  if (!isDefaultDepartment) {
    if (data.website !== undefined)
      kitPatch.website = (data.website as string) || null;
    if (data.address !== undefined)
      kitPatch.address = (data.address as string) || null;
    if (data.logoUrl !== undefined)
      kitPatch.logoUrl = (data.logoUrl as string) || null;
    if (data.logoKey !== undefined)
      kitPatch.logoKey = (data.logoKey as string) || null;
    if (data.primaryColor !== undefined)
      kitPatch.primaryColor = (data.primaryColor as string) || null;
    if (data.secondaryColor !== undefined)
      kitPatch.secondaryColor = (data.secondaryColor as string) || null;
    if (data.fontFamily !== undefined)
      kitPatch.fontFamily = (data.fontFamily as string) || null;
    return { brandPatch, kitPatch };
  }

  // `name` falls through to kitPatch (brand_kits.name) — never brands.businessName.
  if (data.website !== undefined)
    brandPatch.website = (data.website as string) || null;
  if (data.address !== undefined)
    brandPatch.address = (data.address as string) || null;
  if (data.logoUrl !== undefined)
    brandPatch.logoUrl = (data.logoUrl as string) || null;
  // logoKey has no brands equivalent (the primary logo is brands.logoUrl) — drop.

  const colors = mergeColors(current.colors, data);
  if (colors) brandPatch.colors = colors;
  const typography = mergeTypography(current.typography, data);
  if (typography) brandPatch.typography = typography;

  return { brandPatch, kitPatch };
}
