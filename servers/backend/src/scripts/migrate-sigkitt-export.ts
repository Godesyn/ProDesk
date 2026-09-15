/**
 * One-time migration: legacy SIGKITT (Manus email-signature-builder) `db-export/`
 * → the Prodesk signatures domain (signature_brands / signature_members) with
 * images re-hosted in Supabase Storage under the NEW key convention
 * (`brand-files` bucket, `signatures/<brandId>/…` — see modules/signatures/storage).
 *
 * Mapping model
 *  - Each legacy signature "brand" (a per-office kit) becomes / merges into a
 *    Prodesk `brands` row matched CASE-INSENSITIVELY by business name
 *    (signature_brands is a 1:1 satellite of a Prodesk brand). Where two legacy
 *    kits share a name, KIT_TARGET_BRAND_OVERRIDES disambiguates.
 *  - Legacy users are matched to Prodesk users by email; missing ones are
 *    created in Supabase Auth (random password, email confirmed) + `users` with
 *    requiresPasswordReset=true so their first password login runs the
 *    recovery-code flow. Google OAuth logins auto-link by verified email.
 *  - zacch.b@noize.com.au owns every CREATED brand (he already owns the prod
 *    brands the two merge kits match); every other legacy user gets userBrands
 *    + an active `staff` row with the `signatures` permission on each brand.
 *  - LEGACY URLS: every exported image is ALSO mirrored to the deterministic
 *    key `signatures/legacy/<legacy key>` (exact filename, upsert) so the
 *    signatures client can 301 `/manus-storage/<key>` — embedded in
 *    already-sent emails — to Supabase (packages/shared/vite/legacy-storage.ts).
 *  - Members keep their legacy timestamps; photos/logos are uploaded first and
 *    rows reference the new public URLs. Legacy renderedIconUrls point at
 *    /manus-storage/icons/* (not exported) so icons are RE-RENDERED via
 *    getColoredIconUrl (skip with --skip-icons; falls back to inline SVG).
 *
 * Safety
 *  - DRY RUN by default: zero writes, prints + saves a full report
 *    (db-export/migration-report.md). Pass --apply to execute.
 *  - Idempotent: users matched by email, brands by name, satellite by brandId,
 *    members by (satellite, fullName, email) — re-runs skip existing rows.
 *  - Merging into a brand owned by someone OUTSIDE the migrated user set is a
 *    BLOCKER unless --allow-foreign-merge.
 *  - An existing satellite's design is kept unless --overwrite-design.
 *
 * Run (from servers/backend):
 *   npx tsx src/scripts/migrate-sigkitt-export.ts --prod              # dry run + report
 *   npx tsx src/scripts/migrate-sigkitt-export.ts --prod --apply      # execute
 */
import './env-setup.js';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@prodesk/server-shared/db/index';
import {
  agencies,
  brands,
  featureSubscriptionProducts,
  brandKits,
  signatureMembers,
  staff,
  userBrands,
  users,
} from '@prodesk/server-shared/db/schema';
import { supabaseAdmin } from '@prodesk/server-shared/lib/supabase';
import {
  DEFAULT_DEPARTMENT_NAME,
  DEFAULT_DEPARTMENT_SLUG,
} from '@prodesk/server-shared/modules/signatures/billing';
import { storagePut } from '@prodesk/server-shared/modules/signatures/storage';
import {
  ICON_KEYS,
  getColoredIconUrl,
} from '@prodesk/server-shared/modules/signatures/iconColorizer';
import { ensureDerivedAgency } from '@prodesk/server-shared/modules/agency/derive';
import { applyDefaultFormsToBrand } from '@prodesk/server-shared/modules/spot/provision';
import { ensureBrandAiThread } from '@prodesk/server-shared/modules/chat/threads';

// ─── CLI flags ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const OVERWRITE_DESIGN = process.argv.includes('--overwrite-design');
const ALLOW_FOREIGN_MERGE = process.argv.includes('--allow-foreign-merge');
const SKIP_ICONS = process.argv.includes('--skip-icons');

// Owns every brand this migration CREATES (also the current owner of the prod
// "Avenue Property" / "iKeep" brands the merge kits match). The legacy tenant
// login (team@noize.com.au) is still migrated, but as staff only.
const OWNER_EMAIL = 'zacch.b@noize.com.au';

// Where legacy files are mirrored so /manus-storage/<key> URLs keep working.
const LEGACY_KEY_PREFIX = 'signatures/legacy';

/**
 * Legacy kit id → target Prodesk business name, where the kit's own name would
 * collide (brand names are unique across the brand+agency namespace and the
 * signature satellite is 1:1 per brand). Kits absent here use their legacy name.
 * Kit 1 and 90001 are BOTH "Avenue Property" (Gold Coast vs Browns Plains
 * offices) — the older one keeps the plain name so it can merge with any
 * existing prod brand; Browns Plains is suffixed from its collectionName.
 */
const KIT_TARGET_BRAND_OVERRIDES: Record<number, string> = {
  90001: 'Avenue Property | Browns Plains',
};

// ─── Legacy export shapes ─────────────────────────────────────────────────────
type LegacyUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  createdAt: string;
  lastSignedIn: string;
};
type LegacyBrand = {
  id: number;
  userId: number;
  name: string;
  website: string;
  address: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  barColor: string;
  barTextColor: string;
  brandDisplayName: string;
  brandTagline: string;
  logoKey: string;
  logoUrl: string;
  logoWidth: number;
  poweredByLogoKey: string;
  poweredByLogoUrl: string;
  poweredByLabel: string;
  proofmaticUrl: string;
  proofmaticReviewsUrl: string;
  disclaimer: string;
  defaultTemplate: string;
  createdAt: string;
  updatedAt: string;
  barLogoKey: string;
  barLogoUrl: string;
  logoLinkUrl: string;
  barLogoLinkUrl: string;
  poweredByLinkUrl: string;
  collectionName: string | null;
};
type LegacyMember = Record<string, unknown> & {
  id: number;
  brandId: number;
  fullName: string;
  email?: string;
  photoUrl?: string;
  photoKey?: string;
  createdAt: string;
  updatedAt: string;
};

// Member columns copied 1:1 (legacy '' → null). proofmatic* → verdiict* below.
const MEMBER_COPY_FIELDS = [
  'jobTitle', 'department', 'email', 'phone', 'mobile', 'photoLinkUrl',
  'linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'github',
  'spotify', 'pinterest', 'tiktok', 'googleMaps', 'googleReviews',
  'trustpilot', 'tripadvisor', 'uberEats', 'deliveroo', 'expedia', 'rss',
  'amazon', 'websiteLink',
] as const;

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};

const nn = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

// ─── Report accumulator ───────────────────────────────────────────────────────
const report: string[] = [];
const blockers: string[] = [];
const warnings: string[] = [];
function line(msg = ''): void {
  report.push(msg);
  console.log(msg);
}
function warn(msg: string): void {
  warnings.push(msg);
  line(`  ⚠️  ${msg}`);
}
function block(msg: string): void {
  blockers.push(msg);
  line(`  ⛔ BLOCKER: ${msg}`);
}

// ─── Locate + load the export ─────────────────────────────────────────────────
function findExportDir(): string {
  const candidates = [
    resolve(process.cwd(), 'db-export/db-export'),
    resolve(process.cwd(), '../../db-export/db-export'),
  ];
  const hit = candidates.find((c) => existsSync(join(c, 'brands.json')));
  if (!hit) {
    throw new Error(
      `Could not find db-export/db-export (looked in: ${candidates.join(', ')})`,
    );
  }
  return hit;
}

function loadJson<T>(dir: string, file: string): T {
  return JSON.parse(readFileSync(join(dir, file), 'utf8')) as T;
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const exportDir = findExportDir();
  const imagesDir = join(exportDir, 'images');

  const legacyUsers = loadJson<LegacyUser[]>(exportDir, 'users.json');
  const legacyBrands = loadJson<LegacyBrand[]>(exportDir, 'brands.json');
  const legacyMembers = loadJson<LegacyMember[]>(exportDir, 'teamMembers.json');
  const empties = ['savedSignatures', 'campaigns', 'campaignBanners', 'analyticsEvents']
    .map((f) => ({ f, n: loadJson<unknown[]>(exportDir, `${f}.json`).length }))
    .filter((e) => e.n > 0);

  line(`# SIGKITT → Prodesk migration ${APPLY ? 'RUN' : 'DRY-RUN REPORT'}`);
  line(`Generated ${startedAt.toISOString()} · export: ${exportDir}`);
  line(`Mode: ${APPLY ? '**APPLY (writing to DB + storage)**' : 'dry run (zero writes)'}`);
  line();

  if (empties.length) {
    for (const e of empties) {
      block(`${e.f}.json has ${e.n} rows but this script does not migrate that table`);
    }
  } else {
    line('savedSignatures / campaigns / campaignBanners / analyticsEvents are all empty — nothing to migrate there.');
  }

  // ── 0. Environment sanity ──────────────────────────────────────────────────
  line();
  line('## 0. Environment');
  const dbUrl = process.env.DATABASE_URL ?? '';
  line(`- DATABASE_URL host: \`${dbUrl.replace(/^.*@/, '').replace(/\/.*$/, '') || '(unset)'}\``);
  line(`- SUPABASE_URL: \`${process.env.SUPABASE_URL ?? '(unset)'}\``);
  const { data: bucket, error: bucketErr } = await supabaseAdmin.storage.getBucket('brand-files');
  if (bucketErr || !bucket) block(`Supabase bucket "brand-files" not reachable: ${bucketErr?.message}`);
  else line(`- Storage bucket \`brand-files\` OK (public: ${bucket.public})`);

  // ── 1. Users ───────────────────────────────────────────────────────────────
  line();
  line('## 1. Users (matched by email)');
  // Dedupe legacy rows by email (the export has duplicate Google accounts for
  // the same inbox); keep the most recently signed-in row for the display name.
  const byEmail = new Map<string, LegacyUser>();
  for (const u of legacyUsers) {
    const key = u.email.trim().toLowerCase();
    const prev = byEmail.get(key);
    if (!prev || new Date(u.lastSignedIn) > new Date(prev.lastSignedIn)) byEmail.set(key, u);
  }
  const dupCount = legacyUsers.length - byEmail.size;
  if (dupCount > 0) line(`- ${legacyUsers.length} legacy rows → ${byEmail.size} unique emails (${dupCount} duplicate legacy accounts collapsed)`);

  if (!byEmail.has(OWNER_EMAIL)) block(`Legacy tenant owner ${OWNER_EMAIL} not present in users.json`);

  type UserPlan = {
    email: string;
    legacy: LegacyUser;
    existing: { id: string; isBetaUser: boolean; role: string | null } | null;
    firstName: string;
    lastName: string | null;
    userId?: string; // resolved during apply
  };
  const userPlans: UserPlan[] = [];
  for (const [email, legacy] of byEmail) {
    const [existing] = await db
      .select({ id: users.id, isBetaUser: users.isBetaUser, role: users.role })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    const nameParts = legacy.name.trim().split(/\s+/);
    const plan: UserPlan = {
      email,
      legacy,
      existing: existing ?? null,
      firstName: nameParts[0] ?? email,
      lastName: nameParts.slice(1).join(' ') || null,
      userId: existing?.id,
    };
    userPlans.push(plan);
    line(
      existing
        ? `- ✅ \`${email}\` → existing user \`${existing.id}\` (role: ${existing.role ?? 'none'}${existing.isBetaUser ? ', beta' : ''}) — will link relations only`
        : `- 🆕 \`${email}\` → CREATE Supabase auth user + users row ("${plan.firstName}${plan.lastName ? ' ' + plan.lastName : ''}", requiresPasswordReset=true, email confirmed)`,
    );
  }
  const ownerPlan = userPlans.find((p) => p.email === OWNER_EMAIL)!;
  line(`- Brand owner for CREATED brands: \`${OWNER_EMAIL}\`; all other migrated users get staff('signatures') + userBrands on every migrated brand.`);
  if (userPlans.some((p) => !p.existing)) {
    line('  - New users sign in later via Google (auto-links by verified email) or password reset (recovery-code flow).');
  }

  // ── 2. Brand kits → Prodesk brands ─────────────────────────────────────────
  line();
  line('## 2. Signature brand kits → Prodesk brands');

  // Detect target-name collisions among the kits themselves.
  const targetNameOf = (b: LegacyBrand): string =>
    (KIT_TARGET_BRAND_OVERRIDES[b.id] ?? b.name).trim();
  const seenNames = new Map<string, number>();
  for (const b of legacyBrands) {
    const k = targetNameOf(b).toLowerCase();
    if (seenNames.has(k)) {
      block(
        `Legacy kits ${seenNames.get(k)} and ${b.id} both target brand name "${targetNameOf(b)}" — add a KIT_TARGET_BRAND_OVERRIDES entry`,
      );
    } else seenNames.set(k, b.id);
  }

  const memberCountByKit = new Map<number, number>();
  for (const m of legacyMembers) {
    memberCountByKit.set(m.brandId, (memberCountByKit.get(m.brandId) ?? 0) + 1);
  }

  type KitPlan = {
    kit: LegacyBrand;
    targetName: string;
    existingBrand: { id: string; ownerId: string; ownerEmail: string | null } | null;
    existingSatelliteId: string | null;
    action: 'create-brand' | 'merge';
    memberCount: number;
    brandId?: string; // resolved during apply
    satelliteId?: string;
  };
  const kitPlans: KitPlan[] = [];
  const migratedUserIds = new Set(userPlans.map((p) => p.existing?.id).filter(Boolean) as string[]);

  for (const kit of legacyBrands) {
    const targetName = targetNameOf(kit);
    const [existingBrand] = await db
      .select({ id: brands.id, ownerId: brands.ownerId, ownerEmail: users.email })
      .from(brands)
      .leftJoin(users, eq(users.id, brands.ownerId))
      .where(sql`lower(${brands.businessName}) = ${targetName.toLowerCase()}`)
      .limit(1);
    // Brand + (non-derived) agency names share one namespace — a standalone
    // agency squatting the name blocks brand creation.
    const [agencyClash] = existingBrand
      ? [undefined]
      : await db
          .select({ id: agencies.id })
          .from(agencies)
          .where(
            and(
              sql`lower(${agencies.businessName}) = ${targetName.toLowerCase()}`,
              sql`${agencies.derivedFromBrandId} is null`,
            ),
          )
          .limit(1);

    let existingSatelliteId: string | null = null;
    if (existingBrand) {
      const [sat] = await db
        .select({ id: brandKits.id })
        .from(brandKits)
        .where(eq(brandKits.brandId, existingBrand.id))
        .limit(1);
      existingSatelliteId = sat?.id ?? null;
    }

    const plan: KitPlan = {
      kit,
      targetName,
      existingBrand: existingBrand ?? null,
      existingSatelliteId,
      action: existingBrand ? 'merge' : 'create-brand',
      memberCount: memberCountByKit.get(kit.id) ?? 0,
      brandId: existingBrand?.id,
      satelliteId: existingSatelliteId ?? undefined,
    };
    kitPlans.push(plan);

    const renamed = targetName !== kit.name ? ` (renamed from "${kit.name}")` : '';
    if (existingBrand) {
      line(`- 🔗 kit ${kit.id} "${targetName}"${renamed} → MERGE into existing brand \`${existingBrand.id}\` (owner: ${existingBrand.ownerEmail ?? existingBrand.ownerId}) · ${plan.memberCount} members`);
      if (!migratedUserIds.has(existingBrand.ownerId)) {
        const msg = `Existing brand "${targetName}" is owned by ${existingBrand.ownerEmail ?? existingBrand.ownerId}, who is NOT one of the migrated users — merging would add members/staff to a foreign brand`;
        if (ALLOW_FOREIGN_MERGE) warn(`${msg} (proceeding: --allow-foreign-merge)`);
        else block(`${msg}. Re-run with --allow-foreign-merge to accept, or rename via KIT_TARGET_BRAND_OVERRIDES.`);
      }
      if (existingSatelliteId) {
        if (OVERWRITE_DESIGN) warn(`Brand "${targetName}" already has a signature design — legacy kit design WILL overwrite it (--overwrite-design)`);
        else warn(`Brand "${targetName}" already has a signature design — keeping it; legacy kit ${kit.id} design will be IGNORED (use --overwrite-design to replace)`);
      }
    } else if (agencyClash) {
      block(`"${targetName}" is taken by a standalone AGENCY (${agencyClash.id}) — brand creation would violate the shared name namespace; rename via KIT_TARGET_BRAND_OVERRIDES`);
    } else {
      line(`- 🆕 kit ${kit.id} "${targetName}"${renamed} → CREATE brand (owner ${OWNER_EMAIL}) + shadow agency + AI thread + default forms · ${plan.memberCount} members`);
    }
    if (plan.memberCount === 0) warn(`Kit ${kit.id} "${targetName}" has no members — an empty brand/workspace will still be ${existingBrand ? 'merged' : 'created'}`);
  }

  // ── 3. Images ──────────────────────────────────────────────────────────────
  line();
  line('## 3. Images → Supabase storage (`brand-files` / signatures/<brandId>/…)');
  // Every image referenced by a kit or member must exist locally; map by the
  // URL basename (the legacy `key` fields lack the stored hash suffix).
  const localFileFor = (legacyUrl: string | null | undefined): string | null => {
    if (!legacyUrl) return null;
    const file = join(imagesDir, 'team-111', basename(legacyUrl));
    return existsSync(file) ? file : null;
  };
  let refCount = 0;
  let missingCount = 0;
  const checkRef = (owner: string, field: string, url: string | null) => {
    if (!url) return;
    refCount += 1;
    if (!localFileFor(url)) {
      missingCount += 1;
      warn(`${owner}.${field} references "${basename(url)}" which is NOT in the export — field will be left empty`);
    }
  };
  for (const k of legacyBrands) {
    checkRef(`kit ${k.id}`, 'barLogoUrl', nn(k.barLogoUrl));
    checkRef(`kit ${k.id}`, 'logoUrl', nn(k.logoUrl));
    checkRef(`kit ${k.id}`, 'poweredByLogoUrl', nn(k.poweredByLogoUrl));
  }
  for (const m of legacyMembers) checkRef(`member ${m.id} (${m.fullName})`, 'photoUrl', nn(m.photoUrl as string));
  line(`- ${refCount} image references across kits + members; ${missingCount} missing locally.`);
  line(`- Upload path: \`signatures/<newBrandId>/<originalFilename>\` (storagePut appends an 8-hex suffix; DB rows get the returned key + public URL).`);
  const photoless = legacyMembers.filter((m) => !nn(m.photoUrl as string)).length;
  if (photoless) line(`- ${photoless} members have no photo (left empty, same as legacy).`);
  // Legacy-URL mirror: every exported file, at its EXACT legacy key, so
  // /manus-storage/<key> in already-sent emails can 301 to it (see
  // packages/shared/vite/legacy-storage.ts on the signatures client).
  const walkFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walkFiles(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : [],
    );
  const legacyFiles = walkFiles(imagesDir).map((file) => ({
    file,
    key: file.slice(imagesDir.length + 1).replace(/\\/g, '/'),
  }));
  line(
    `- Legacy-URL mirror: ALL ${legacyFiles.length} exported files also uploaded to \`${LEGACY_KEY_PREFIX}/<legacy key>\` (exact names, upsert) — e.g. ` +
      `\`/manus-storage/${legacyFiles[0]?.key}\` → \`…/object/public/brand-files/${LEGACY_KEY_PREFIX}/${legacyFiles[0]?.key}\`.`,
  );
  warn('Legacy /manus-storage/icons/*.png (social-icon PNGs in already-sent emails) were NOT exported and cannot be mirrored — those images 404 in old emails; new/re-copied signatures get freshly rendered icons.');
  if (SKIP_ICONS) line('- Icon re-render SKIPPED (--skip-icons): renderedIconUrls left null → app falls back to inline SVG / regenerates via public colorize endpoint.');
  else line('- Member social icons will be RE-RENDERED per brand colour via getColoredIconUrl (legacy /manus-storage/icons/* were not exported).');

  // ── 4. Members ─────────────────────────────────────────────────────────────
  line();
  line('## 4. Members');
  const memberKey = (fullName: string, email: string | null) =>
    `${fullName.trim().toLowerCase()}|${(email ?? '').trim().toLowerCase()}`;
  let toInsert = 0;
  let toSkip = 0;
  for (const plan of kitPlans) {
    const kitMembers = legacyMembers.filter((m) => m.brandId === plan.kit.id);
    if (plan.existingSatelliteId) {
      const existing = await db
        .select({ fullName: signatureMembers.fullName, email: signatureMembers.email })
        .from(signatureMembers)
        .where(eq(signatureMembers.signatureBrandId, plan.existingSatelliteId));
      const existingKeys = new Set(existing.map((e) => memberKey(e.fullName, e.email)));
      const dupes = kitMembers.filter((m) => existingKeys.has(memberKey(m.fullName, nn(m.email as string))));
      toSkip += dupes.length;
      toInsert += kitMembers.length - dupes.length;
      if (dupes.length) line(`- kit ${plan.kit.id} "${plan.targetName}": ${dupes.length}/${kitMembers.length} members already exist in the satellite — skipped`);
    } else {
      toInsert += kitMembers.length;
    }
  }
  line(`- ${toInsert} members to insert, ${toSkip} skipped as already present. All inserted ACTIVE (isActive=true) with legacy timestamps preserved.`);

  // ── 5. Billing impact ──────────────────────────────────────────────────────
  line();
  line('## 5. Billing impact (per-seat, first seat free)');
  const [sigProduct] = await db
    .select({ id: featureSubscriptionProducts.id, active: featureSubscriptionProducts.active })
    .from(featureSubscriptionProducts)
    .where(eq(featureSubscriptionProducts.featureKey, 'email_signatures'))
    .limit(1);
  line(`- Signatures product in prod: ${sigProduct ? `yes (active: ${sigProduct.active})` : 'NO'}`);
  const ownerBeta = ownerPlan.existing?.isBetaUser ?? false;
  const createdBrandSeats = kitPlans
    .filter((p) => p.action === 'create-brand')
    .reduce((n, p) => n + p.memberCount, 0);
  if (ownerBeta) {
    line(`- Owner ${OWNER_EMAIL} is a BETA user → all seats are free.`);
  } else {
    warn(
      `Owner ${OWNER_EMAIL} is ${ownerPlan.existing ? 'NOT a beta user' : 'a NEW user (no beta flag, no subscription)'} — ~${createdBrandSeats} active seats land on their account. ` +
        `Seats past the free allowance (1) surface as billable in the UI (no charge occurs without a Stripe subscription, but the paywall/billing badge will show). ` +
        `Consider flagging them beta in the super-admin panel before/after migration.`,
    );
  }
  const mergedSeatsByOwner = new Map<string, number>();
  for (const p of kitPlans.filter((p) => p.action === 'merge' && p.existingBrand)) {
    const o = p.existingBrand!.ownerEmail ?? p.existingBrand!.ownerId;
    mergedSeatsByOwner.set(o, (mergedSeatsByOwner.get(o) ?? 0) + p.memberCount);
  }
  for (const [owner, seats] of mergedSeatsByOwner) {
    if (owner !== OWNER_EMAIL) warn(`Merging adds ${seats} active seats to brands owned by ${owner} — their seat count (and billing exposure) increases`);
  }

  // ── Summary / gate ─────────────────────────────────────────────────────────
  line();
  line('## Summary');
  line(`- Users: ${userPlans.filter((p) => p.existing).length} matched, ${userPlans.filter((p) => !p.existing).length} to create`);
  line(`- Brands: ${kitPlans.filter((p) => p.action === 'create-brand').length} to create, ${kitPlans.filter((p) => p.action === 'merge').length} to merge`);
  line(`- Members: ${toInsert} to insert (${toSkip} already present)`);
  line(`- Warnings: ${warnings.length} · Blockers: ${blockers.length}`);

  if (!APPLY) {
    const out = resolve(exportDir, '..', 'migration-report.md');
    writeFileSync(out, report.join('\n') + '\n');
    line();
    line(`Dry run only — nothing was written. Report saved to ${out}`);
    line(blockers.length
      ? '⛔ Resolve the blockers above before running with --apply.'
      : '✅ No blockers. Re-run with --apply to execute.');
    return;
  }
  if (blockers.length) {
    console.error(`\n⛔ ${blockers.length} blocker(s) — refusing to apply. Run without --apply to see the report.`);
    process.exit(1);
  }

  // ═══════════════════════════════ APPLY ══════════════════════════════════════
  line();
  line('## Applying…');

  // A. Users
  for (const plan of userPlans) {
    if (plan.userId) continue;
    const password = randomBytes(24).toString('base64url');
    let authId: string | null = null;
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: plan.email,
      password,
      email_confirm: true,
      user_metadata: { first_name: plan.firstName, last_name: plan.lastName ?? undefined },
    });
    if (created?.user) {
      authId = created.user.id;
    } else if (createErr) {
      // Auth user may already exist without a `users` row — find it by email.
      for (let page = 1; page <= 20 && !authId; page += 1) {
        const { data: pageData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
        if (listErr) throw new Error(`listUsers failed while resolving ${plan.email}: ${listErr.message}`);
        authId = pageData.users.find((u) => u.email?.toLowerCase() === plan.email)?.id ?? null;
        if (pageData.users.length < 200) break;
      }
      if (!authId) throw new Error(`createUser failed for ${plan.email} (${createErr.message}) and no existing auth user found`);
      line(`- auth user for ${plan.email} already existed (${authId}) — reusing`);
    }
    await db
      .insert(users)
      .values({
        id: authId!,
        email: plan.email,
        firstName: plan.firstName,
        lastName: plan.lastName,
        isEmailVerified: true, // they authenticated via Google on the legacy app
        requiresPasswordReset: true,
        createdAt: new Date(plan.legacy.createdAt),
      })
      .onConflictDoNothing({ target: users.id });
    plan.userId = authId!;
    line(`- 🆕 created user ${plan.email} → ${authId}`);
  }
  const ownerId = ownerPlan.userId!;

  // B. Legacy-URL mirror — exact legacy keys, upsert (idempotent), done first so
  // even a partially-failed run revives the URLs embedded in old emails.
  let mirrored = 0;
  for (const { file, key } of legacyFiles) {
    const ext = (file.split('.').pop() ?? '').toLowerCase();
    const { error } = await supabaseAdmin.storage
      .from('brand-files')
      .upload(`${LEGACY_KEY_PREFIX}/${key}`, readFileSync(file), {
        contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
        upsert: true,
      });
    if (error) throw new Error(`legacy mirror upload failed for ${key}: ${error.message}`);
    mirrored += 1;
  }
  line(`- 🔁 mirrored ${mirrored} legacy files under ${LEGACY_KEY_PREFIX}/`);

  // C. Brands (+ satellite) per kit
  const uploadCache = new Map<string, { key: string; url: string }>();
  async function uploadFor(brandId: string, legacyUrl: string | null): Promise<{ key: string; url: string } | null> {
    if (!legacyUrl) return null;
    const file = localFileFor(legacyUrl);
    if (!file) return null;
    const cacheKey = `${brandId}:${basename(file)}`;
    const cached = uploadCache.get(cacheKey);
    if (cached) return cached;
    const ext = (file.split('.').pop() ?? '').toLowerCase();
    const res = await storagePut(brandId, basename(file), readFileSync(file), CONTENT_TYPES[ext] ?? 'application/octet-stream');
    uploadCache.set(cacheKey, res);
    return res;
  }

  for (const plan of kitPlans) {
    const { kit } = plan;
    // C1. Brand row
    if (!plan.brandId) {
      const [brand] = await db
        .insert(brands)
        .values({
          ownerId,
          businessName: plan.targetName,
          website: nn(kit.website),
          address: nn(kit.address),
          createdAt: new Date(kit.createdAt),
        })
        .returning();
      plan.brandId = brand.id;
      await db.insert(userBrands).values({ userId: ownerId, brandId: brand.id }).onConflictDoNothing();
      // Mirror brands.create: owner becomes brandOwner unless they already have a role.
      await db
        .update(users)
        .set({ role: 'brandOwner', selectedBrandId: brand.id })
        .where(and(eq(users.id, ownerId), sql`${users.role} is null`));
      // Same best-effort provisioning as brands.create.
      await applyDefaultFormsToBrand({ brandId: brand.id }, db).catch((e) =>
        console.error(`[migrate] default forms failed for ${plan.targetName}:`, (e as Error).message));
      await ensureDerivedAgency(db, brand).catch((e) =>
        console.error(`[migrate] derived agency failed for ${plan.targetName}:`, (e as Error).message));
      await ensureBrandAiThread(brand.id, db).catch((e) =>
        console.error(`[migrate] AI thread failed for ${plan.targetName}:`, (e as Error).message));
      line(`- 🆕 brand "${plan.targetName}" → ${brand.id}`);
    }
    const brandId = plan.brandId!;

    // C2. Satellite (signature design)
    const writeDesign = !plan.satelliteId || OVERWRITE_DESIGN;
    if (writeDesign) {
      const barLogo = await uploadFor(brandId, nn(kit.barLogoUrl));
      const logo = await uploadFor(brandId, nn(kit.logoUrl));
      const poweredBy = await uploadFor(brandId, nn(kit.poweredByLogoUrl));
      // Identity / palette / font / primary-logo now live on `brands` (single
      // source of truth). Only PROMOTE into empty brand fields — never clobber a
      // palette/identity the brand already set in the dashboard (matches the
      // "only if empty" guard in migration 0061; safe on re-import / OVERWRITE_DESIGN).
      const [curBrand] = await db
        .select({
          website: brands.website,
          address: brands.address,
          logoUrl: brands.logoUrl,
          colors: brands.colors,
          typography: brands.typography,
        })
        .from(brands)
        .where(eq(brands.id, brandId))
        .limit(1);
      const brandPatch: Record<string, unknown> = {};
      const w = nn(kit.website);
      if (w && !nn(curBrand?.website)) brandPatch.website = w;
      const a = nn(kit.address);
      if (a && !nn(curBrand?.address)) brandPatch.address = a;
      if (logo?.url && !nn(curBrand?.logoUrl)) brandPatch.logoUrl = logo.url;
      const pc = nn(kit.primaryColor);
      const sc = nn(kit.secondaryColor);
      if ((pc || sc) && !curBrand?.colors?.length) {
        // [primary, accent(default), ink] — signature secondary maps to the ink slot.
        brandPatch.colors = [pc ?? '#4A7C59', '#8a8a82', sc ?? '#2D3748'];
      }
      const ff = nn(kit.fontFamily);
      if (ff && !curBrand?.typography?.length) brandPatch.typography = [ff, ff];
      if (Object.keys(brandPatch).length) {
        await db.update(brands).set(brandPatch).where(eq(brands.id, brandId));
      }
      const design = {
        createdByUserId: ownerId,
        name: kit.name, // the signature's own business name (kept separate from brands.businessName)
        collectionName: nn(kit.collectionName),
        barColor: nn(kit.barColor) ?? undefined,
        barTextColor: nn(kit.barTextColor) ?? undefined,
        barLogoKey: barLogo?.key ?? null,
        barLogoUrl: barLogo?.url ?? null,
        brandDisplayName: nn(kit.brandDisplayName),
        brandTagline: nn(kit.brandTagline),
        logoWidth: kit.logoWidth ?? 120,
        poweredByLogoKey: poweredBy?.key ?? null,
        poweredByLogoUrl: poweredBy?.url ?? null,
        poweredByLabel: nn(kit.poweredByLabel),
        logoLinkUrl: nn(kit.logoLinkUrl),
        barLogoLinkUrl: nn(kit.barLogoLinkUrl),
        poweredByLinkUrl: nn(kit.poweredByLinkUrl),
        verdiictUrl: nn(kit.proofmaticUrl),
        verdiictReviewsUrl: nn(kit.proofmaticReviewsUrl),
        disclaimer: nn(kit.disclaimer),
        defaultTemplate: nn(kit.defaultTemplate) ?? undefined,
      };
      if (plan.satelliteId) {
        await db.update(brandKits).set(design).where(eq(brandKits.id, plan.satelliteId));
        line(`  - design overwritten on existing satellite ${plan.satelliteId}`);
      } else {
        // An imported kit is the brand's FIRST, so it becomes the default
        // department (migration 0087). The conflict target must name the partial
        // unique index that replaced the old 1:1 `brand_kits_brand_unique` —
        // (brand_id) WHERE is_default — or Postgres can't infer an index.
        const [sat] = await db
          .insert(brandKits)
          .values({
            brandId,
            ...design,
            departmentName: DEFAULT_DEPARTMENT_NAME,
            slug: DEFAULT_DEPARTMENT_SLUG,
            isDefault: true,
            createdAt: new Date(kit.createdAt),
            updatedAt: new Date(kit.updatedAt),
          })
          .onConflictDoNothing({
            target: brandKits.brandId,
            where: eq(brandKits.isDefault, true),
          })
          .returning({ id: brandKits.id });
        if (sat) plan.satelliteId = sat.id;
        else {
          const [row] = await db
            .select({ id: brandKits.id })
            .from(brandKits)
            .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)))
            .limit(1);
          plan.satelliteId = row!.id;
        }
        line(`  - satellite ${plan.satelliteId} created`);
      }
    }
    if (!plan.satelliteId) {
      // A brand now has MANY kits (one per department); the import always means
      // the default one.
      const [row] = await db
        .select({ id: brandKits.id })
        .from(brandKits)
        .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)))
        .limit(1);
      plan.satelliteId = row?.id;
      if (!plan.satelliteId) throw new Error(`No satellite for brand ${brandId} ("${plan.targetName}") — unexpected`);
    }

    // C3. Relations for every migrated user (owner included via userBrands only)
    for (const up of userPlans) {
      const uid = up.userId!;
      // userBrands means OWNERSHIP (brands.mine / claimBrand read it that way) —
      // only the actual owner gets a row; everyone else is staff below.
      const [isOwnerRow] = await db.select({ ownerId: brands.ownerId }).from(brands).where(eq(brands.id, brandId)).limit(1);
      if (isOwnerRow?.ownerId === uid) {
        await db.insert(userBrands).values({ userId: uid, brandId }).onConflictDoNothing();
        continue; // owners don't need a staff row
      }
      const [existingStaff] = await db
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.brandId, brandId), sql`(${staff.userId} = ${uid} or lower(${staff.email}) = ${up.email})`))
        .limit(1);
      if (existingStaff) continue;
      await db.insert(staff).values({
        email: up.email,
        type: 'brand',
        brandId,
        userId: uid,
        displayName: `${up.firstName}${up.lastName ? ' ' + up.lastName : ''}`,
        permissions: ['signatures'],
        status: 'active',
        invitedBy: ownerId,
        invitedAt: new Date(),
        acceptedAt: new Date(),
      });
    }

    // C4. Members
    const satelliteId = plan.satelliteId!;
    const existing = await db
      .select({ fullName: signatureMembers.fullName, email: signatureMembers.email })
      .from(signatureMembers)
      .where(eq(signatureMembers.signatureBrandId, satelliteId));
    const existingKeys = new Set(existing.map((e) => memberKey(e.fullName, e.email)));
    const kitMembers = legacyMembers.filter((m) => m.brandId === kit.id);
    let inserted = 0;
    for (const m of kitMembers) {
      if (existingKeys.has(memberKey(m.fullName, nn(m.email as string)))) continue;
      const photo = await uploadFor(brandId, nn(m.photoUrl as string));
      const row: Record<string, unknown> = {
        signatureBrandId: satelliteId,
        brandId,
        fullName: m.fullName,
        photoKey: photo?.key ?? null,
        photoUrl: photo?.url ?? null,
        verdiictUrl: nn(m.proofmaticUrl as string),
        verdiictReviewsUrl: nn(m.proofmaticReviewsUrl as string),
        isActive: true,
        createdAt: new Date(m.createdAt),
        updatedAt: new Date(m.updatedAt),
      };
      for (const f of MEMBER_COPY_FIELDS) row[f] = nn(m[f] as string);
      // Re-render social icon PNGs for the kit's colours (legacy icon files
      // weren't exported). Non-fatal: null → inline-SVG fallback in the app.
      if (!SKIP_ICONS) {
        try {
          const colors = Array.from(new Set([nn(kit.barTextColor) ?? '#1a1a2e', nn(kit.primaryColor) ?? '#4A7C59']));
          const urlMap: Record<string, string> = {};
          await Promise.all(
            ICON_KEYS.filter((k) => row[k]).flatMap((key) =>
              colors.map(async (color) => {
                try {
                  urlMap[`${key}_${color.replace(/^#/, '').toLowerCase()}`] = await getColoredIconUrl(brandId, key, color);
                } catch { /* skip icon */ }
              }),
            ),
          );
          row.renderedIconUrls = JSON.stringify(urlMap);
        } catch { /* leave null */ }
      }
      await db.insert(signatureMembers).values(row as typeof signatureMembers.$inferInsert);
      inserted += 1;
    }
    line(`  - members: ${inserted} inserted, ${kitMembers.length - inserted} skipped ("${plan.targetName}")`);
  }

  line();
  line(`✅ Done in ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s. Uploaded ${uploadCache.size} images.`);
  const out = resolve(exportDir, '..', 'migration-report.md');
  writeFileSync(out, report.join('\n') + '\n');
  line(`Run log saved to ${out}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[migrate-sigkitt-export] FATAL:', err);
    process.exit(1);
  });
