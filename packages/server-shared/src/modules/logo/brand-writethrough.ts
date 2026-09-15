/**
 * Brand write-through — the suite-inheritance moat. When a brand applies its
 * finished logo, we seed the SINGLE SOURCE OF TRUTH every Prodesk tool reads:
 *   • brands.logoUrl / logoUrls      — primary identity mark (Signatures, Payments,
 *                                       Reviews, Links, Websites all render this),
 *                                       led by the MARK ALONE as a white-plated
 *                                       PNG so it survives every surface the suite
 *                                       doesn't control, at favicon size;
 *   • brands.colors                  — [primary, accent, ink, background, rule];
 *   • brands.typography              — [Heading, Body, Mono];
 *   • brand_kits.logoSlots           — the variant lockups (reversed/mark/stacked/…);
 *   • document locker "Public Brand Assets" — mirrored logo files.
 * No standalone logo tool can do this — the identity flows straight into the suite.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { brandKits, brands, logoGenerations } from '../../db/schema.js';
import { ensureBrandKit } from '../signatures/billing.js';
import { recordLockerFiles } from '../locker/record.js';
import { exportIdentityAssets } from './export.js';
import type { DerivedSystem } from './generation.js';
import type { LogoGeneration } from './types.js';

export interface AppliedIdentity {
  logoUrl: string;
  logoUrls: string[];
  colors: string[];
  typography: string[];
  slots: { slot: string; url: string | null; key: string | null }[];
}

/**
 * Apply a chosen generation + derived system to the brand. Uploads the identity
 * assets, writes brands + brand_kits, and mirrors logos into the locker. Returns
 * the written identity so the client can reflect it immediately.
 */
export async function applyBrandSystem(
  db: DB,
  brandId: string,
  gen: LogoGeneration,
  wordmark: string,
  system: DerivedSystem,
  userId: string | null,
): Promise<AppliedIdentity> {
  const assets = await exportIdentityAssets(brandId, gen, wordmark);

  // Positional arrays in the suite's token order.
  const colors = [
    system.palette.find((c) => c.role.toLowerCase() === 'primary')?.hex ?? system.palette[0]?.hex ?? '#2E9E58',
    system.palette.find((c) => c.role.toLowerCase() === 'accent')?.hex ?? system.palette[1]?.hex ?? '#14532D',
    system.palette.find((c) => c.role.toLowerCase() === 'ink')?.hex ?? '#0E0E0C',
    system.palette.find((c) => c.role.toLowerCase() === 'background')?.hex ?? '#FFFFFF',
    system.palette.find((c) => c.role.toLowerCase() === 'rule')?.hex ?? '#C9C7BD',
  ];
  const typography = [system.fonts.heading, system.fonts.body, system.fonts.mono];

  /**
   * Primary logo → brands (logoUrls[0] mirrors to logoUrl for identity rendering).
   *
   * `brands.logoUrl` is THE MARK ALONE — no wordmark — as a white-plated PNG. The
   * suite renders this row into avatars, favicons, sidebar chips, signature
   * corners, and review badges: small, usually square slots where a full lockup's
   * type is scaled to illegibility and only takes width away from the symbol. The
   * brand's name is nearly always set beside it in real type anyway, so repeating
   * it inside the image buys nothing.
   *
   * PNG rather than SVG for the same reason it is plated white: everything
   * downstream hands this to a plain `<img>` on a surface it does not own — a mail
   * client, a PDF, someone else's page — where SVG support is patchy and a
   * transparent plate lets a dark mark disappear into a dark background.
   *
   * The full lockup follows at [1] for anywhere with the width to set the name,
   * then the vectors, which stay available to anything that can use them.
   */
  const logoUrls = [
    assets.markPngUrl,
    assets.primaryPngUrl,
    assets.markSvgUrl,
    assets.primarySvgUrl,
    assets.reversedSvgUrl,
  ];
  await db
    .update(brands)
    .set({ logoUrl: assets.markPngUrl, logoUrls, colors, typography })
    .where(eq(brands.id, brandId));

  // Variant lockups → brand_kits.logoSlots (ensure the kit row exists first).
  // Targets the brand's DEFAULT kit: a brand holds one kit per signature
  // department, and only the default one is the brand kit the suite shares.
  await ensureBrandKit(db, brandId, userId);
  const slots = assets.slots.map((s) => ({ slot: s.slot, url: s.url, key: s.key }));
  await db
    .update(brandKits)
    .set({ logoSlots: slots })
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)));

  // Mirror the logo files into the document-locker Public Brand Assets.
  const lockerUrls = [...new Set(logoUrls)];
  await recordLockerFiles(
    db,
    lockerUrls.map((url) => ({
      brandId,
      url,
      name: `${gen.name} logo`,
      isPublic: true,
      type: 'image',
      category: 'logo',
      source: 'brand',
      note: 'Generated in Logo Studio',
      sourceType: 'logo' as const,
      sourceId: `${brandId}:${url}`,
    })),
  ).catch(() => {
    // Locker mirroring is best-effort — never block identity application on it.
  });

  // Mark the generation as the brand's live identity source.
  await db
    .update(logoGenerations)
    .set({ thumbUrl: assets.markPngUrl })
    .where(eq(logoGenerations.id, gen.id));

  return { logoUrl: assets.primarySvgUrl, logoUrls, colors, typography, slots };
}
