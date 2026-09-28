/**
 * Idempotent stack initialization — the single source of truth for the baseline
 * rows the app cannot function without: the super-admin (Supabase Auth + `users`),
 * global settings, and the built-in Feature Subscription products (Growth Strategy,
 * URL Shortener, Reviews, Email Signatures) with an active tier + price each.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY CONTRACT — every step here MUST be safe to run on EVERY server boot.
 * This runs automatically after migrations on startup (see servers/backend/src/
 * _core/index.ts) AND on demand via `npm run init` (the CLI wrapper initialize.ts).
 * So before you add a step:
 *   • Check-then-write: look the row up (by a stable natural key — id, slug, email)
 *     and only insert when missing. NEVER blindly insert or you get duplicates on
 *     the next reboot.
 *   • Self-heal, don't recreate: if a parent exists but a required child is missing
 *     (e.g. a product with no active price), create just the child. See the tier/
 *     price blocks below for the pattern to copy.
 *   • No process.exit / no throwing for "already exists" — reserve throws for real
 *     failures (bad credentials, unreachable DB). The boot caller treats a throw as
 *     non-fatal and continues, so keep this genuinely re-runnable.
 *   • Don't overwrite user-editable data. Seed defaults only when absent; a
 *     super-admin may have changed a price/product in the UI and a reboot must not
 *     stomp it. (Amount backfills like Infin8 below fill a NULL, never replace.)
 * Keep this contract intact — new seed steps that violate it will corrupt data on
 * the very next restart.
 *
 * ONE-TIME STEPS — a data backfill has no single row to check-then-write against,
 * and re-running it would re-scan its whole source set on every restart. Wrap
 * those in `runOnce` (modules/init/once.ts), which claims a key in
 * `init_task_runs` so the work happens exactly once per database and later boots
 * cost one indexed lookup. `runOnce` is an optimisation, not a substitute for
 * idempotency: the task it guards must still be safe if it does run twice.
 *
 * CONCURRENCY — the independent seed steps run in parallel (see runInitialization).
 * The ONLY ordering constraint is the auth → `users`/`global_settings` chain, which
 * needs the super-admin's `userId`. Everything else (the feature-subscription
 * products and the Reviews industries) touches disjoint rows, so each is its own
 * self-contained check-then-write unit that can safely run alongside the others.
 * Console output therefore interleaves — that's expected; it's a boot log, not a
 * transcript. Keep new steps self-contained (no cross-step reads) to stay parallel.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { db } from '@prodesk/server-shared/db/index';
import * as s from '@prodesk/server-shared/db/schema';
import { supabaseAdmin } from '@prodesk/server-shared/lib/supabase';
import { runOnce } from '@prodesk/server-shared/modules/init/once';
import {
  backfillAppUploadLocker,
  LOCKER_APP_UPLOAD_BACKFILL_KEY,
} from '@prodesk/server-shared/modules/locker/backfill';
import {
  backfillNotesThreads,
  CHAT_NOTES_BACKFILL_KEY,
} from '@prodesk/server-shared/modules/chat/backfill';
import { REVIEW_INDUSTRIES } from '@prodesk/server-shared/modules/reviews/industries';
import { and, eq, isNull } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Infin8Stage } from '@prodesk/server-shared/lib/infin8';

const here = dirname(fileURLToPath(import.meta.url));

const INFIN8_DEFAULT: Infin8Stage[] = [
  {
    stage: '1. INCUBATE',
    substages: [
      'Strategy, Vision & Branding',
      'Project Management',
      'Legal, Structure & Shareholding',
      'IP Protection',
      'Domain Name Management',
      'Telecommunications Infrastructure',
      'Payments Infrastructure',
      'Corporate Advisory, Planning & Documentation',
    ],
  },
  {
    stage: '2. CREATE',
    substages: [
      'Copywriting',
      'Graphic Design',
      'Website Development',
      'AI, Automation & Software Setup',
      'Custom Software & App Development',
      'Audio Production',
      'Video Production',
      'AI Image & Video Generation',
    ],
  },
  {
    stage: '3. FABRICATE',
    substages: [
      'Shop Fit-out / Interior Design',
      'Industrial Design',
      'Outsource Manufacturing',
      'Packaging',
      'Print',
      'Signage',
      'Clothing',
      'Promotional Products',
    ],
  },
  {
    stage: '4. ACCELERATE',
    substages: [
      'Live Content Capture (Film & Photography)',
      'Search Engine Optimisation',
      'Social Media Management',
      'Search Engine Advertising',
      'Social Media Advertising',
      'Public Relations & News Media',
      'Direct Marketing',
      'Sales & Business Development',
      'Media Buying OOH, TV, Print',
    ],
  },
  {
    stage: '5. OPERATE',
    substages: [
      'Business Coaching',
      'Recruitment',
      'Human Resources',
      'Outsourcing & Contract Manufacturing',
      '3PL & Logistics',
      'Bookkeeping',
      'Accounts Payable & Receivable',
      'Debt Collection',
    ],
  },
  {
    stage: '6. MOTIVATE',
    substages: [
      'Affiliate Networking',
      'Rewards Programs',
      'Influencer Marketing',
      'Celebrity Endorsement',
      'Events, Activations & Sponsorships',
      'Publishing',
      'Competitions, Incentives & Giveaways',
      'Member & Group Management',
    ],
  },
  {
    stage: '7. FACILITATE',
    substages: [
      'Capital Raising',
      'Finance & Lending',
      'Franchising & Licensing',
      'Mergers & Acquisitions',
      'Property Leasing & Buyers Agency',
      'Property Development',
      'Business Sales',
      'Restructuring & Turnaround',
    ],
  },
  {
    stage: '8. EVALUATE',
    substages: [
      'Financial Reporting',
      'Analytics',
      'Surveys & Feedback',
      'Performance Analysis',
      'Accounting',
      'Market Research',
      'Risk Assessment',
      'Succession Planning',
    ],
  },
];

/**
 * Get-or-create the super-admin in Supabase Auth and return its id. THROWS only on
 * a genuine create failure (bad credentials / unreachable auth). Reused by the
 * `users` + `global_settings` seed steps, which need the id.
 */
async function ensureSuperAdminAuthUser(superadmin: any): Promise<string> {
  const email: string = superadmin.email;

  // List auth users to find the admin user.
  let page = 1;
  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      console.error('Error listing Supabase Auth users:', error.message);
      break;
    }
    if (!data?.users || data.users.length === 0) {
      break;
    }
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (found) {
      return found.id;
    }
    if (data.users.length < 1000) {
      break;
    }
    page++;
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: 'Test1234@',
    email_confirm: true,
    user_metadata: {
      firstName: superadmin.firstName,
      lastName: superadmin.lastName,
      displayName: superadmin.displayName,
    },
  });

  if (error || !data?.user) {
    throw new Error(
      `Failed to create Supabase Auth user: ${error?.message || 'unknown error'}`,
    );
  }

  return data.user.id;
}

/** Ensure the super-admin profile row exists in the Postgres `users` table. */
async function ensureSuperAdminProfile(
  userId: string,
  superadmin: any,
): Promise<void> {
  const [existingDbUser] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);

  if (existingDbUser) {
    return;
  }

  await db.insert(s.users).values({
    id: userId,
    email: superadmin.email,
    role: 'superAdmin',
    firstName: superadmin.firstName,
    lastName: superadmin.lastName,
    profileUrl: null,
    isEmailVerified: true,
    isSuperAdmin: true,
    bankAccountLinked: false,
    payoutMethods: {},
    uiPreferences: {},
    customData: {},
    googleCalendarLinked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** Ensure the singleton global settings row (id 1); backfill the Infin8 taxonomy. */
async function ensureGlobalSettings(
  userId: string,
  globalSettings: any,
): Promise<void> {
  const [existingSettings] = await db
    .select()
    .from(s.globalSettings)
    .where(eq(s.globalSettings.id, 1))
    .limit(1);

  if (!existingSettings) {
    await db.insert(s.globalSettings).values({
      id: 1,
      prodeskCommission: String(globalSettings.prodeskCommission),
      affiliateCommission: String(globalSettings.affiliateCommission),
      agencyCommission: String(globalSettings.agencyCommission),
      salesAgencyCommission: String(globalSettings.salesAgencyCommission),
      defaultPaymentPlans: globalSettings.defaultPaymentPlans,
      disciplines: globalSettings.disciplines,
      infin8Stages: INFIN8_DEFAULT,
      services: [],
      updatedBy: userId,
      updatedAt: new Date(),
    });
    return;
  }

  if (!existingSettings.infin8Stages) {
    await db
      .update(s.globalSettings)
      .set({ infin8Stages: INFIN8_DEFAULT, updatedAt: new Date() })
      .where(eq(s.globalSettings.id, 1));
  }
}

/**
 * Ensure a built-in Feature Subscription product exists (idempotent by slug), with
 * a self-healed active tier + active monthly price. The four built-in products
 * (Growth Strategy, URL Shortener, Reviews, Email Signatures) differ only in their
 * product row + monthly price amount, so they share this one routine.
 *
 * Contract preserved from the original inline blocks: only creates a price when
 * NONE is active — it never resets an amount an admin later edited in the UI, and
 * per-unit grandfathering keeps existing rows on the price they were activated at.
 */
/**
 * Ensure a product exists with an active tier + monthly price.
 *
 * `unitKind` applies to perUnit products that meter more than one kind of unit:
 * it tags the tier this call creates (see feature_subscription_tiers.unit_kind).
 * Pass it so the default tier is unambiguous once a second rate exists —
 * ensurePerUnitTier then adds the extra rates.
 */
async function ensureFeatureSubscription(
  product: typeof s.featureSubscriptionProducts.$inferInsert,
  priceAmount: string,
  unitKind?: 'link' | 'campaign',
): Promise<void> {
  const [existingProduct] = await db
    .select({ id: s.featureSubscriptionProducts.id })
    .from(s.featureSubscriptionProducts)
    .where(eq(s.featureSubscriptionProducts.slug, product.slug))
    .limit(1);

  let productId = existingProduct?.id;
  if (!productId) {
    const [row] = await db
      .insert(s.featureSubscriptionProducts)
      .values(product)
      .returning({ id: s.featureSubscriptionProducts.id });
    productId = row.id;
  }

  // Self-heal — a product is useless without an active price (checkout can't start),
  // whether the product was just created or pre-existed without a price.
  let [tier] = await db
    .select({ id: s.featureSubscriptionTiers.id })
    .from(s.featureSubscriptionTiers)
    .where(
      and(
        eq(s.featureSubscriptionTiers.productId, productId),
        eq(s.featureSubscriptionTiers.active, true),
      ),
    )
    .limit(1);
  if (!tier) {
    [tier] = await db
      .insert(s.featureSubscriptionTiers)
      .values({ productId, name: 'Standard', active: true, sortOrder: 0, unitKind })
      .returning({ id: s.featureSubscriptionTiers.id });
  } else if (unitKind) {
    // Self-heal a tier seeded before unit kinds existed, so the per-unit offer
    // lookup can tell this rate apart from any additional rate.
    await db
      .update(s.featureSubscriptionTiers)
      .set({ unitKind })
      .where(
        and(
          eq(s.featureSubscriptionTiers.id, tier.id),
          isNull(s.featureSubscriptionTiers.unitKind),
        ),
      );
  }

  const [price] = await db
    .select({ id: s.featureSubscriptionPrices.id })
    .from(s.featureSubscriptionPrices)
    .where(
      and(
        eq(s.featureSubscriptionPrices.tierId, tier.id),
        eq(s.featureSubscriptionPrices.active, true),
      ),
    )
    .limit(1);
  if (!price) {
    await db.insert(s.featureSubscriptionPrices).values({
      tierId: tier.id,
      interval: 'month',
      amount: priceAmount,
      currency: 'AUD',
      active: true,
    });
  }
}

/**
 * Ensure an ADDITIONAL per-unit rate on an existing product: one tier tagged with
 * its `unitKind` plus an active monthly price. Idempotent by (product, unitKind).
 *
 * This is how the URL Shortener carries both of its rates — $1 per active plain
 * link and $3 per active campaign — under ONE product, so a brand owner holds a
 * single subscription and per-unit.ts meters each rate as its own Stripe item.
 * No-op when the product doesn't exist yet.
 */
async function ensurePerUnitTier(
  productSlug: string,
  tier: { name: string; unitKind: 'link' | 'campaign'; sortOrder: number; description?: string },
  priceAmount: string,
): Promise<void> {
  const [product] = await db
    .select({ id: s.featureSubscriptionProducts.id })
    .from(s.featureSubscriptionProducts)
    .where(eq(s.featureSubscriptionProducts.slug, productSlug))
    .limit(1);
  if (!product) return;

  let [row] = await db
    .select({ id: s.featureSubscriptionTiers.id })
    .from(s.featureSubscriptionTiers)
    .where(
      and(
        eq(s.featureSubscriptionTiers.productId, product.id),
        eq(s.featureSubscriptionTiers.unitKind, tier.unitKind),
      ),
    )
    .limit(1);
  if (!row) {
    [row] = await db
      .insert(s.featureSubscriptionTiers)
      .values({
        productId: product.id,
        name: tier.name,
        description: tier.description,
        unitKind: tier.unitKind,
        sortOrder: tier.sortOrder,
        active: true,
      })
      .returning({ id: s.featureSubscriptionTiers.id });
  }

  // Same self-heal as ensureFeatureSubscription: a tier with no active price can't
  // be checked out against, so create one whenever it's missing.
  const [price] = await db
    .select({ id: s.featureSubscriptionPrices.id })
    .from(s.featureSubscriptionPrices)
    .where(
      and(
        eq(s.featureSubscriptionPrices.tierId, row.id),
        eq(s.featureSubscriptionPrices.active, true),
      ),
    )
    .limit(1);
  if (!price) {
    await db.insert(s.featureSubscriptionPrices).values({
      tierId: row.id,
      interval: 'month',
      amount: priceAmount,
      currency: 'AUD',
      active: true,
    });
  }
}

/**
 * Seed the default Reviews industries + their tag presets (idempotent by slug).
 * These back the location-setup industry picker; the reviews router falls back to
 * the REVIEW_INDUSTRIES constant when the tables are empty, so this promotes that
 * fallback into DB rows a super-admin can then edit. Each industry is independent,
 * so they self-heal in parallel; only insert an industry when its slug is absent,
 * and only seed a slug's tag presets when it has NONE.
 */
async function ensureReviewIndustries(): Promise<void> {
  await Promise.all(
    REVIEW_INDUSTRIES.map(async (ind, i) => {
      const [existingIndustry] = await db
        .select({ id: s.reviewIndustries.id })
        .from(s.reviewIndustries)
        .where(eq(s.reviewIndustries.slug, ind.slug))
        .limit(1);
      if (!existingIndustry) {
        await db.insert(s.reviewIndustries).values({
          slug: ind.slug,
          label: ind.label,
          description: ind.description,
          isActive: true,
          sortOrder: i,
        });
      }

      // Tag presets have no unique (slug, tag) constraint, so guard on "any preset
      // for this slug" rather than per-tag to stay duplicate-free across reboots.
      const [existingPreset] = await db
        .select({ id: s.reviewTagPresets.id })
        .from(s.reviewTagPresets)
        .where(eq(s.reviewTagPresets.industrySlug, ind.slug))
        .limit(1);
      if (!existingPreset && ind.defaultTags.length > 0) {
        await db.insert(s.reviewTagPresets).values(
          ind.defaultTags.map((tag, idx) => ({
            industrySlug: ind.slug,
            tag,
            sortOrder: idx,
          })),
        );
      }
    }),
  );
}

/**
 * ONE-TIME (per database): mirror every satellite-app upload that predates its
 * locker hook — Signatures assets, Payments brand assets, Verdiict review-page
 * logos, Support attachments — into its brand's Document Locker.
 *
 * This is the one step here that is NOT check-then-write: a backfill has no
 * single row to look up, and re-running it would re-scan every source table on
 * every restart. So it goes through `runOnce`, which claims a key in
 * `init_task_runs` and skips forever after — one indexed lookup per later boot.
 * Going forward the hooks themselves keep the locker current; this only closes
 * the historical gap.
 *
 * To re-run it (say after adding a source), bump LOCKER_APP_UPLOAD_BACKFILL_KEY
 * or clear the marker — `bun run db:backfill-locker-app-uploads --force`.
 *
 * Failures are swallowed: unlike the other steps this seeds no baseline the app
 * needs, so a locker hiccup must never be what fails `npm run init`. `runOnce`
 * releases the claim on failure, so the next boot retries.
 */
async function ensureAppUploadLockerRows(): Promise<void> {
  // Nothing escapes this step. `runOnce` reports a TASK failure as a status, but
  // its own bookkeeping can still throw — e.g. `npm run init` against a database
  // that hasn't been migrated yet has no `init_task_runs` table. Boot survives a
  // throw either way, but the CLI would report a failed init over a backfill that
  // seeds nothing the app needs. It doesn't get to do that.
  try {
    const outcome = await runOnce(
      db,
      LOCKER_APP_UPLOAD_BACKFILL_KEY,
      () => backfillAppUploadLocker(db),
      (r) => ({ ...r }),
    );
    if (outcome.status === 'failed') {
      console.error(
        '[locker] app-upload backfill failed (non-fatal, will retry next boot):',
        outcome.error?.message,
      );
      return;
    }
    // Silent on every boot after the first — the marker means there's nothing to say.
    if (outcome.status === 'ran' && outcome.result) {
      const r = outcome.result;
      const per =
        Object.entries(r.bySource)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}=${n}`)
          .join(', ') || 'none';
      console.log(
        `[locker] one-time app-upload backfill: mirrored ${r.inserted} file(s) into ` +
          `${r.brands} brand locker(s); ${r.skipped} already present (by source: ${per})`,
      );
    }
  } catch (err) {
    console.error('[locker] app-upload backfill skipped (non-fatal):', (err as Error).message);
  }
}

/**
 * ONE-TIME (per database): give every existing user their personal notes thread —
 * the `you` self-thread the messenger shows as "Notes".
 *
 * New accounts get one on signup and the messenger ensures it on boot, so this
 * exists purely to close the historical gap for accounts that predate either.
 * Same shape as the locker backfill above, and for the same reasons: `runOnce` so
 * later boots cost one indexed lookup, and every failure swallowed, because a
 * missing notes row must never be what fails `npm run init`.
 *
 * Re-run with `bun run db:backfill-notes-threads --force`.
 */
async function ensureNotesThreadsForAllUsers(): Promise<void> {
  try {
    const outcome = await runOnce(
      db,
      CHAT_NOTES_BACKFILL_KEY,
      () => backfillNotesThreads(db),
      (r) => ({ ...r }),
    );
    if (outcome.status === 'failed') {
      console.error(
        '[chat] notes-thread backfill failed (non-fatal, will retry next boot):',
        outcome.error?.message,
      );
      return;
    }
    if (outcome.status === 'ran' && outcome.result) {
      const r = outcome.result;
      // Silent when there was nothing to do — the common case on an established
      // database, and a line saying "0 of 0" every first boot is noise.
      if (r.candidates > 0) {
        console.log(
          `[chat] one-time notes-thread backfill: ${r.created} created, ` +
            `${r.adopted} adopted, ${r.failed} failed (of ${r.candidates} user(s) missing one)`,
        );
      }
    }
  } catch (err) {
    console.error('[chat] notes-thread backfill skipped (non-fatal):', (err as Error).message);
  }
}

/**
 * Run the (idempotent) initialization. Returns normally on success; THROWS only on
 * genuine failure (auth/DB errors) so callers can decide fatality. Never calls
 * process.exit — that's the CLI wrapper's job (initialize.ts).
 *
 * The independent steps run concurrently: the DB-only feature-subscription and
 * Reviews-industry seeds don't need the super-admin id, so they start immediately,
 * while the auth → `users`/`global_settings` chain resolves in parallel.
 */
export async function runInitialization(): Promise<void> {
  // Read seed data LAZILY (inside the function, not at module load) so a missing
  // data file only fails this call — which the boot path catches as non-fatal —
  // rather than throwing while _core/index.ts is still importing this module.
  const globalSettings = JSON.parse(
    readFileSync(resolve(here, 'initialize_data/global_settings.json'), 'utf8'),
  );
  const superadmin = JSON.parse(
    readFileSync(resolve(here, 'initialize_data/superadmin.json'), 'utf8'),
  );

  // DB-only seeds — no dependency on the super-admin id, so kick them off now and
  // let them run alongside the auth chain below.
  const seeds = Promise.all([
    ensureFeatureSubscription(
      {
        name: 'Growth strategy',
        slug: 'growth-strategy',
        featureKey: 'ai_growth_strategy',
        featureKeys: ['ai_growth_strategy'],
        description:
          'One clear plan, built from everything in your record and how you compare to businesses like you. The moves that matter, in order.',
        active: true,
        sortOrder: 0,
        cardTitle: 'NEW • AI GROWTH STRATEGY',
        cardSubtitle: 'Get your growth strategy with AI',
        cardDescription:
          'One clear plan, built from everything in your record and how you compare to businesses like you. The moves that matter, in order.',
        cardButtonLabel: 'Generate my strategy',
      },
      '299.00',
    ),
    // The URL Shortener carries TWO per-unit rates, so its second tier is chained
    // after the product (and its 'link' tier) exists rather than run in parallel.
    ensureFeatureSubscription(
      {
        name: 'URL Shortener',
        slug: 'url-shortener',
        featureKey: 'url_shortener',
        featureKeys: ['url_shortener'],
        perUnit: true,
        description:
          'Short links and branded QR codes for your brand. Pay only for the links you keep switched on.',
        active: true,
        sortOrder: 1,
        cardTitle: 'SHORT LINKS & QR',
        cardSubtitle: 'Branded short links, $1 per active link / month',
        cardDescription:
          'Create unlimited short links and QR codes. You only pay $1 per month for each link you keep switched on.',
        cardButtonLabel: 'Start shortening',
      },
      '1.00',
      'link',
    ).then(() =>
      ensurePerUnitTier(
        'url-shortener',
        {
          name: 'Campaign',
          unitKind: 'campaign',
          sortOrder: 1,
          description:
            'A scheduled short link: one QR/URL whose destination changes on the dates you choose, with a fallback for everything in between.',
        },
        '3.00',
      ),
    ),
    ensureFeatureSubscription(
      {
        name: 'Reviews (Verdiict)',
        slug: 'reviews',
        featureKey: 'reviews',
        featureKeys: ['reviews'],
        description:
          'Capture reviews on autopilot — branded review pages, the public directory listing, and embeddable review widgets for your brand.',
        active: true,
        sortOrder: 2,
        cardTitle: 'REVIEWS • VERDIICT',
        cardSubtitle: 'Keep capturing after your free trial',
        cardDescription:
          'Unlimited review pages and locations, AI-written reviews routed to Google, Facebook and more, a public directory listing, and embeddable review widgets.',
        cardButtonLabel: 'Subscribe',
      },
      '49.00',
    ),
    ensureFeatureSubscription(
      {
        name: 'Email Signatures (SIGKITT)',
        slug: 'email-signatures',
        featureKey: 'email_signatures',
        featureKeys: ['email_signatures'],
        perUnit: true,
        description:
          'On-brand email signatures for your whole team. Billed at $1 per seat monthly.',
        active: true,
        sortOrder: 3,
        cardTitle: 'EMAIL SIGNATURES • SIGKITT',
        cardSubtitle: '$1 per seat / month',
        cardDescription:
          'Design and deploy consistent email signatures across your team. $1 per seat per month.',
        cardButtonLabel: 'Subscribe',
      },
      '1.00',
    ),
    ensureReviewIndustries(),
    ensureAppUploadLockerRows(),
    ensureNotesThreadsForAllUsers(),
  ]);

  // Auth chain — the super-admin id gates the `users` + `global_settings` rows.
  // Order matters: `global_settings.updated_by` is a FK to `users.id`, so the
  // profile row must exist first. Running them together fails on a FRESH
  // database (FK violation) — invisible on an already-seeded one, which is why
  // it survived until the first from-scratch install.
  const userId = await ensureSuperAdminAuthUser(superadmin);
  await ensureSuperAdminProfile(userId, superadmin);
  await ensureGlobalSettings(userId, globalSettings);

  // Surface any seed failure now that the auth chain is done.
  await seeds;

  console.log('Initialization complete! 🎉');
}
