/**
 * Dev-only seed: add random, relevant 3–5★ reviews to every review location of
 * the Prodesk brand. Public submissions with AI-style review text, win-tags and
 * reviewer names, spread across the last several weeks (so streak / weekly-count
 * insights and embeds have something to show).
 *
 * Dry-run by default (prints the plan). Pass --commit to write.
 *
 * Usage:
 *   npx tsx src/scripts/seed-prodesk-reviews.ts                    # dry-run, dev
 *   npx tsx src/scripts/seed-prodesk-reviews.ts --commit           # write, dev
 *   npx tsx src/scripts/seed-prodesk-reviews.ts --brand "Prodesk" --per 12 --commit
 *
 * Flags:
 *   --commit          Actually insert the reviews (otherwise dry-run).
 *   --brand <name>    Brand name to match (case-insensitive, default "Prodesk").
 *   --per <n>         Approx reviews per location (default random 8–14).
 *   --env <file>      Env file to load (default: .env), relative to repo root.
 *
 * NOTE: additive — re-running adds MORE reviews. Intended for dev only.
 */

/* ── 1. Load environment BEFORE any app import ─────────────────────────── */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const commit = process.argv.includes('--commit');

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && process.argv[idx + 1]
    ? process.argv[idx + 1]
    : undefined;
}

const brandName = argValue('--brand') ?? 'Prodesk';
const perOverride = argValue('--per') ? Number(argValue('--per')) : undefined;
const envFile = argValue('--env') ?? '.env';

const candidates = [
  resolve(process.cwd(), envFile),
  resolve(here, '../../../..', envFile),
];
const envPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
loadEnv({ path: envPath, override: true });
console.log(
  `[seed-prodesk-reviews] env: ${envPath} | brand: "${brandName}" | mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`,
);

/* ── 2. Dynamic imports (AFTER env is loaded) ─────────────────────────── */
const { and, eq, ilike, isNull } = await import('drizzle-orm');
const { db } = await import('@prodesk/server-shared/db/index');
const { brands, reviewLocations, reviewSubmissions, reviewWinTags } =
  await import('@prodesk/server-shared/db/schema');

/* ── 3. Seed content ──────────────────────────────────────────────────── */
// Relevant review text by star tier. 5★ = glowing, 4★ = happy w/ a nit, 3★ = fine.
const TEXT: Record<number, string[]> = {
  5: [
    'Absolutely brilliant from start to finish. The team was friendly, fast, and the result exceeded what I expected.',
    'Honestly the best experience I have had in years. Clear communication, fair pricing, and spotless work.',
    'Could not be happier. They went above and beyond and I have already recommended them to friends.',
    'Top-notch service. Everything was explained, done on time, and the quality speaks for itself.',
    'Five stars without hesitation — professional, tidy, and genuinely lovely people to deal with.',
    'They nailed it. Booking was easy, the work was flawless, and they followed up to make sure I was happy.',
  ],
  4: [
    'Really good overall. Great result and friendly staff — took slightly longer than quoted but worth it.',
    'Happy with the work. Communication was solid and the finish was clean. Would use again.',
    'Very good experience. Only small thing was the wait to get booked in, but the quality made up for it.',
    'Solid job and fair price. A couple of minor details I would tweak, but I would recommend them.',
    'Pleased with the outcome. Professional team, easy to deal with, just a touch pricey.',
  ],
  3: [
    'Decent job overall. It did the job and staff were polite, though a few things could have been smoother.',
    'Fine experience. The result was okay and met my basic expectations — nothing amazing, nothing bad.',
    'Reasonable service. Got what I paid for; communication could have been a little clearer.',
    'It was alright. The work was acceptable but took longer than I hoped.',
  ],
};

const FALLBACK_TAGS = [
  'Friendly staff',
  'Great value',
  'Fast service',
  'Professional',
  'Clean work',
  'Good communication',
  'On time',
  'Would recommend',
];

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) =>
  min + Math.floor(Math.random() * (max - min + 1));
const DAY = 86_400_000;

/** Weighted star pick: skew toward 5★ (like a real capture funnel), min 3★. */
function pickStars(): number {
  const r = Math.random();
  if (r < 0.6) return 5;
  if (r < 0.85) return 4;
  return 3;
}

/* ── 4. Seed ──────────────────────────────────────────────────────────── */
async function run(): Promise<void> {
  const brandRows = await db
    .select({ id: brands.id, businessName: brands.businessName })
    .from(brands)
    .where(ilike(brands.businessName, `%${brandName}%`));

  if (brandRows.length === 0) {
    console.error(
      `[seed-prodesk-reviews] no brand matching "${brandName}". Aborting.`,
    );
    return;
  }
  if (brandRows.length > 1) {
    console.log(
      `[seed-prodesk-reviews] ${brandRows.length} brands match "${brandName}": ` +
        brandRows.map((b) => `"${b.businessName}"`).join(', ') +
        ' — seeding all.',
    );
  }

  let totalPlanned = 0;
  for (const brand of brandRows) {
    const allLocs = await db
      .select({ id: reviewLocations.id, name: reviewLocations.name })
      .from(reviewLocations)
      .where(
        and(
          eq(reviewLocations.brandId, brand.id),
          isNull(reviewLocations.deletedAt),
        ),
      );
    // Skip obvious throwaway/test locations (e.g. one literally named "To be deleted").
    const locs = allLocs.filter((l) => !/to be deleted/i.test(l.name));
    const skipped = allLocs.filter((l) => /to be deleted/i.test(l.name));

    console.log(
      `\n"${brand.businessName}" (${brand.id}) — ${locs.length} location(s)` +
        (skipped.length
          ? ` (skipping ${skipped.map((l) => `"${l.name}"`).join(', ')})`
          : ''),
    );
    if (locs.length === 0) continue;

    for (const loc of locs) {
      // Prefer the location's own win-tags for realism; fall back to a generic set.
      const tagRows = await db
        .select({ label: reviewWinTags.label })
        .from(reviewWinTags)
        .where(eq(reviewWinTags.locationId, loc.id));
      const tagPool =
        tagRows.length > 0 ? tagRows.map((t) => t.label) : FALLBACK_TAGS;

      const count = perOverride ?? randInt(8, 14);
      const values = Array.from({ length: count }, () => {
        const stars = pickStars();
        // Spread over the last ~8 weeks, with a bias toward recent weeks so the
        // streak insight lights up. Random time within the chosen day.
        const daysAgo = randInt(0, 56);
        const createdAt = new Date(
          Date.now() - daysAgo * DAY - randInt(0, DAY),
        );
        const tagCount = randInt(1, Math.min(3, tagPool.length));
        const selectedTags = [...tagPool]
          .sort(() => Math.random() - 0.5)
          .slice(0, tagCount);
        return {
          locationId: loc.id,
          stars,
          selectedTags,
          generatedReview: rand(TEXT[stars]),
          submissionType: 'public' as const,
          publicConsent: true,
          createdAt,
        };
      });

      totalPlanned += values.length;
      const dist = [3, 4, 5]
        .map((s) => `${values.filter((v) => v.stars === s).length}×${s}★`)
        .join(' ');
      console.log(`  ${loc.name}: ${values.length} reviews (${dist})`);

      if (commit) {
        await db.insert(reviewSubmissions).values(values);
      }
    }
  }

  console.log(
    commit
      ? `\n[seed-prodesk-reviews] done — inserted ${totalPlanned} reviews.`
      : `\n[seed-prodesk-reviews] DRY-RUN — would insert ${totalPlanned} reviews. Re-run with --commit.`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed-prodesk-reviews] fatal', err);
    process.exit(1);
  });
