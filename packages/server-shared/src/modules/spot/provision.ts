import { and, eq, isNull, inArray } from 'drizzle-orm';
import { spotForms, spotComponents, brandAgencyConnections, brands } from '../../db/schema.js';
import type { DB } from '../../db/index.js';

/**
 * SPOT default-template provisioning (Firestore on_form_written / on_brand_written
 * trigger parity). Kept in its own module — depending only on the schema — so the
 * connection-establishment chokepoint can apply defaults without dragging in the
 * spot router's task/locker imports (which would create an import cycle).
 *
 * A template marked `isDefault` is automatically materialised as an (initially
 * empty) component on every brand it applies to:
 *   - agency template (agencyId set) → every brand CONNECTED to that agency
 *   - global template  (agencyId & brandId null) → EVERY brand on the platform
 * Brand-owned templates (brandId set) are never defaults and never fan out.
 */

/** True when an answer value is "empty" (used to decide if a component is safe to drop). */
export function isEmptyAnswer(v: unknown): boolean {
  if (v == null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

/** A component has no real data when every stored answer is empty. */
function componentIsEmpty(answers: Record<string, unknown> | null | undefined): boolean {
  const a = answers ?? {};
  return Object.values(a).every(isEmptyAnswer);
}

/** Create a component for `brandId` from `form` unless one already exists. */
async function ensureComponentForBrand(
  form: { id: string; name: string; agencyId: string | null; isSecret: boolean },
  brandId: string,
  db: DB,
): Promise<void> {
  const existing = await db
    .select({ id: spotComponents.id })
    .from(spotComponents)
    .where(and(eq(spotComponents.brandId, brandId), eq(spotComponents.templateId, form.id)))
    .limit(1);
  if (existing.length) return;
  const rows = await db.select({ order: spotComponents.order }).from(spotComponents).where(eq(spotComponents.brandId, brandId));
  const nextOrder = rows.reduce((m, r) => Math.max(m, r.order + 1), 0);
  await db.insert(spotComponents).values({
    brandId,
    templateId: form.id,
    templateName: form.name,
    agencyId: form.agencyId,
    answers: {},
    isSecret: form.isSecret,
    order: nextOrder,
  });
}

/** Brands that a default `form` should be applied to (global → all, agency → connected). */
async function brandsForDefaultForm(form: { agencyId: string | null }, db: DB): Promise<string[]> {
  if (form.agencyId) {
    const conns = await db
      .select({ brandId: brandAgencyConnections.brandId })
      .from(brandAgencyConnections)
      .where(eq(brandAgencyConnections.agencyId, form.agencyId));
    return conns.map((c) => c.brandId);
  }
  const all = await db.select({ id: brands.id }).from(brands);
  return all.map((b) => b.id);
}

/** on_form_written: a template flipped to isDefault → fan out components. */
export async function provisionDefaultForm(form: { id: string; name: string; agencyId: string | null; isSecret: boolean }, db: DB): Promise<void> {
  const brandIds = await brandsForDefaultForm(form, db);
  for (const brandId of brandIds) await ensureComponentForBrand(form, brandId, db);
}

/** on_form_written: a template flipped off isDefault → drop the auto-created, still-empty components. */
export async function deprovisionDefaultForm(templateId: string, db: DB): Promise<void> {
  const comps = await db.select().from(spotComponents).where(eq(spotComponents.templateId, templateId));
  const emptyIds = comps.filter((c) => componentIsEmpty(c.answers as Record<string, unknown>)).map((c) => c.id);
  if (emptyIds.length) await db.delete(spotComponents).where(inArray(spotComponents.id, emptyIds));
}

/**
 * on_brand_written / connection accepted: apply the relevant default templates
 * to a brand. `agencyId` set → just that agency's defaults; omitted → the global
 * admin defaults (used when a brand is first created). Idempotent —
 * `ensureComponentForBrand` skips templates the brand already has, so it is safe
 * to call on every connection event regardless of whether the link is new.
 */
export async function applyDefaultFormsToBrand(args: { brandId: string; agencyId?: string | null }, db: DB): Promise<void> {
  const scope = args.agencyId
    ? and(eq(spotForms.agencyId, args.agencyId), eq(spotForms.isDefault, true))
    : and(isNull(spotForms.agencyId), isNull(spotForms.brandId), eq(spotForms.isDefault, true));
  const defaults = await db.select().from(spotForms).where(scope);
  for (const form of defaults) await ensureComponentForBrand(form, args.brandId, db);
}
