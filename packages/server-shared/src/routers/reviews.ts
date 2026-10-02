/**
 * Reviews (Verdiict) tRPC router — brand-scoped review-capture tool migrated from
 * the Manus "review-request-tool" export. Ported from server/routers.ts and
 * rewired to our auth/context/tenancy: Manus `accounts` → `brands`, member roles →
 * staff `reviews`/`reviewsViewer` permissions, per-location Stripe → a brand-level
 * Feature Subscription with a free trial (modules/reviews/billing). Public capture
 * + directory procedures are unauthenticated (publicProcedure); the super-admin
 * surface is gated on superAdminProcedure.
 */
import { randomUUID } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  brands,
  featureSubscriptionProducts,
  featureSubscriptions,
  reviewAdminAudit,
  reviewDirectoryBrands,
  reviewDirectoryProfiles,
  reviewEmbedCollectionLocations,
  reviewEmbedCollections,
  reviewEmbedConfigs,
  reviewIndustries,
  reviewLocations,
  reviewLocationSlugHistory,
  reviewMilestoneRewards,
  reviewPlatforms,
  reviewReferralCodes,
  reviewReferralRedemptions,
  reviewRequests,
  reviewSubmissions,
  reviewTagPresets,
  reviewWinTags,
  staff,
  userBrands,
  users,
} from '../db/schema.js';
import {
  protectedProcedure,
  publicProcedure,
  router,
  superAdminProcedure,
} from '../trpc/trpc.js';
import {
  assertBrandAccess,
  assertBrandAccessAny,
  hasPermission,
} from '../trpc/permissions.js';
import type { Context } from '../trpc/context.js';
import { httpUrl, isHttpUrl } from '../lib/http-url.js';
import {
  DEFAULT_EMBED_THEME,
  EMBED_THEME_UNLOCK_LOCATION_REVIEWS,
  EMBED_UNLOCK_ACCOUNT_REVIEWS,
  GOLD_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS,
  PLATINUM_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS,
  REVIEWS_FREE_TRIAL,
  STICKER_PACK_THRESHOLD_LOCATION_REVIEWS,
  sanitizeTheme,
} from '../modules/reviews/embed.js';
import {
  pickPublicReviews,
  renderEmbedHtml,
} from '../modules/reviews/embed-render.js';
import { recordBrandAsset, fileNameFromUrl } from '../modules/locker/record.js';
import {
  getDefaultTagsForIndustry,
  REVIEW_INDUSTRIES,
  slugifyName,
} from '../modules/reviews/industries.js';
import { generateReviewText } from '../modules/reviews/ai.js';
import {
  sendBadReviewAlertEmail,
  sendReviewRequestEmail,
} from '../modules/reviews/email.js';
import { getReviewsOffer, reviewsEntitlement } from '../modules/reviews/billing.js';
import { settleReviewsReferralOnActivation } from '../modules/reviews/referrals.js';
import { brandOwnerId, userHasProduct } from '../modules/feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../modules/feature-subscriptions/feature-keys.js';
import { stripe } from '../modules/stripe/client.js';
import {
  logAdminAction,
  subscribedReviewsOwnerIds,
} from '../modules/reviews/admin.js';
import {
  brandLocationIds,
  countBrandReviews,
  countLocationReviews,
  directoryPath,
  ensureDirectoryBrandSlug,
  ensureDirectoryProfile,
  getDirectoryProfile,
  getIndustryLeaderboard,
  getIndustryRankForBrand,
  getIndustryRankForLocation,
  getLocationEmbedState,
  getLocationStats,
  getLocationWinTags,
  getTopWinTags,
  getWeeklyReviewCounts,
  listBrandEmbedCollections,
  listBrandLocations,
  listLocationSubmissions,
  locationBySlugOrHistory,
  locationIdOwningSlug,
  searchDirectory,
  uniqueLocationSlug,
} from '../modules/reviews/queries.js';

const PLATFORMS = ['google', 'facebook', 'trustpilot', 'yelp', 'tripadvisor'] as const;

/** Lifetime cap on review-link (slug) renames per location. */
export const MAX_SLUG_CHANGES = 5;

// ─── Access helpers ─────────────────────────────────────────────────────────

/** Load a location and assert the caller may write to its brand (`reviews`). */
async function requireLocationWrite(ctx: Context, locationId: string) {
  const [loc] = await ctx.db
    .select()
    .from(reviewLocations)
    .where(eq(reviewLocations.id, locationId))
    .limit(1);
  if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
  const { isOwner } = await assertBrandAccess(ctx, loc.brandId, 'reviews');
  return { loc, isOwner };
}

/** Load a location and assert the caller may read its brand (editor or viewer). */
async function requireLocationRead(ctx: Context, locationId: string) {
  const [loc] = await ctx.db
    .select()
    .from(reviewLocations)
    .where(eq(reviewLocations.id, locationId))
    .limit(1);
  if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
  await assertBrandAccessAny(ctx, loc.brandId, ['reviews', 'reviewsViewer']);
  return { loc };
}

/** Load a location and assert the caller may SEND review requests for its brand.
 * Sending is allowed for editors AND read-only viewers (`reviewsViewer`): a viewer
 * can invite customers to leave a review without gaining any settings-edit rights. */
async function requireLocationSend(ctx: Context, locationId: string) {
  const [loc] = await ctx.db
    .select()
    .from(reviewLocations)
    .where(eq(reviewLocations.id, locationId))
    .limit(1);
  if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
  await assertBrandAccessAny(ctx, loc.brandId, ['reviews', 'reviewsViewer']);
  return { loc };
}

/** Resolve an emailed review-request token (?rr=) to its request id, scoped to the
 *  location so a token can't tie a submission to someone else's request. */
async function resolveRequestId(
  ctx: Context,
  locationId: string,
  token?: string,
): Promise<string | null> {
  if (!token) return null;
  const [req] = await ctx.db
    .select({ id: reviewRequests.id })
    .from(reviewRequests)
    .where(and(eq(reviewRequests.token, token), eq(reviewRequests.locationId, locationId)))
    .limit(1);
  return req?.id ?? null;
}

function makeReferralCode(): string {
  const alpha = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alpha[Math.floor(Math.random() * alpha.length)];
  return out;
}

// Request-log row: the request columns (minus the capability `token`) plus the
// linked submission's rating + message, so the log can show what the customer left.
const reviewRequestWithResponse = {
  id: reviewRequests.id,
  locationId: reviewRequests.locationId,
  brandId: reviewRequests.brandId,
  customerName: reviewRequests.customerName,
  customerEmail: reviewRequests.customerEmail,
  channel: reviewRequests.channel,
  status: reviewRequests.status,
  customMessage: reviewRequests.customMessage,
  sentAt: reviewRequests.sentAt,
  completedAt: reviewRequests.completedAt,
  responseStars: reviewSubmissions.stars,
  responseReview: reviewSubmissions.generatedReview,
  responseFeedback: reviewSubmissions.privateFeedback,
  responseType: reviewSubmissions.submissionType,
};

// ─── Router ─────────────────────────────────────────────────────────────────

export const reviewsRouter = router({
  // ─── Locations ──────────────────────────────────────────────────────────
  locations: router({
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        // Shared query core (also backs the AI list_review_locations tool).
        return listBrandLocations(ctx.db, input.brandId);
      }),

    listDeleted: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'reviews');
        const graceMs = 7 * 24 * 60 * 60 * 1000;
        const rows = await ctx.db
          .select()
          .from(reviewLocations)
          .where(
            and(
              eq(reviewLocations.brandId, input.brandId),
              sql`${reviewLocations.deletedAt} is not null`,
            ),
          );
        return rows.map((r) => {
          const deletedAt = r.deletedAt ? r.deletedAt.getTime() : Date.now();
          const purgeAt = deletedAt + graceMs;
          return {
            ...r,
            purgeAt: new Date(purgeAt),
            daysRemaining: Math.max(
              0,
              Math.ceil((purgeAt - Date.now()) / (1000 * 60 * 60 * 24)),
            ),
          };
        });
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { loc } = await requireLocationRead(ctx, input.id);
        const [platforms, tags] = await Promise.all([
          ctx.db.select().from(reviewPlatforms).where(eq(reviewPlatforms.locationId, loc.id)),
          getLocationWinTags(ctx.db, loc.id),
        ]);
        return { ...loc, platforms, tags };
      }),

    create: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          name: z.string().min(1).max(255),
          industry: z.string().min(1).max(64),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'reviews');
        const slug = await uniqueLocationSlug(ctx.db, input.name);
        const [loc] = await ctx.db
          .insert(reviewLocations)
          .values({
            brandId: input.brandId,
            name: input.name,
            slug,
            industry: input.industry,
            createdByUserId: ctx.user.id,
          })
          .returning();
        const tags = getDefaultTagsForIndustry(input.industry);
        if (tags.length > 0) {
          await ctx.db.insert(reviewWinTags).values(
            tags.map((label, i) => ({ locationId: loc.id, label, sortOrder: i })),
          );
        }
        return { locationId: loc.id, slug };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().min(1).max(255).optional(),
          badReviewEmail: z.string().email().nullable().optional(),
          redirectUrl: httpUrl().nullable().optional(),
          logoUrl: z.string().nullable().optional(),
          slug: z.string().min(1).max(64).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { loc } = await requireLocationWrite(ctx, input.id);
        const { id, slug: rawSlug, ...data } = input;
        // Slug changes rename the public review URL (/r/:slug). The outgoing
        // slug is reserved in slug history so links/QR/embeds shared before the
        // rename keep resolving; renames are capped at MAX_SLUG_CHANGES for life.
        let slug: string | undefined;
        if (rawSlug !== undefined) {
          const next = slugifyName(rawSlug, 40);
          if (next !== loc.slug) {
            if (next.length < 3) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'Link must be at least 3 characters — letters, numbers and dashes.',
              });
            }
            if (loc.slugChangeCount >= MAX_SLUG_CHANGES) {
              throw new TRPCError({
                code: 'FORBIDDEN',
                message: `This location has used all ${MAX_SLUG_CHANGES} link changes.`,
              });
            }
            const owner = await locationIdOwningSlug(ctx.db, next);
            if (owner && owner !== loc.id) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'That link is already taken. Try another one.',
              });
            }
            // Reclaiming one of this location's own past slugs frees its
            // history row — the outgoing slug takes its place below.
            await ctx.db
              .delete(reviewLocationSlugHistory)
              .where(
                and(
                  eq(reviewLocationSlugHistory.locationId, loc.id),
                  sql`lower(${reviewLocationSlugHistory.slug}) = ${next.toLowerCase()}`,
                ),
              );
            await ctx.db
              .insert(reviewLocationSlugHistory)
              .values({ locationId: loc.id, slug: loc.slug })
              .onConflictDoNothing();
            slug = next;
          }
        }
        await ctx.db
          .update(reviewLocations)
          .set({
            ...data,
            ...(slug ? { slug, slugChangeCount: loc.slugChangeCount + 1 } : {}),
          })
          .where(eq(reviewLocations.id, loc.id));
        // Document Locker: a newly uploaded review-page logo is mirrored into the
        // brand's Public Brand Assets, keyed on the URL so the full logo history
        // is kept (mirrors the brand-logo hook). Clearing the logo (null) removes
        // nothing — the locker is insert-only.
        if (data.logoUrl && data.logoUrl !== loc.logoUrl) {
          await recordBrandAsset(ctx.db, {
            brandId: loc.brandId,
            url: data.logoUrl,
            name: fileNameFromUrl(data.logoUrl, 'Review page logo'),
            uploadedBy: ctx.user.id,
            type: 'image',
            category: 'reviews',
            note: `Uploaded as the review page logo for ${data.name ?? loc.name}`,
            sourceType: 'reviewsLogo',
            sourceId: `${loc.id}:${data.logoUrl}`,
          }).catch((e) =>
            console.error('[reviews] locker copy failed', (e as Error).message),
          );
        }
        return { ok: true };
      }),

    updatePlatform: protectedProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          platform: z.enum(PLATFORMS),
          // Empty clears the platform; anything else must be an http(s) link —
          // the public review page opens it for anonymous visitors.
          url: z
            .string()
            .trim()
            .refine((u) => u === '' || isHttpUrl(u), 'Must be an http(s) link'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireLocationWrite(ctx, input.locationId);
        await ctx.db
          .delete(reviewPlatforms)
          .where(
            and(
              eq(reviewPlatforms.locationId, input.locationId),
              eq(reviewPlatforms.platform, input.platform),
            ),
          );
        if (input.url.trim()) {
          await ctx.db.insert(reviewPlatforms).values({
            locationId: input.locationId,
            platform: input.platform,
            url: input.url.trim(),
          });
        }
        return { ok: true };
      }),

    updateTags: protectedProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          tags: z.array(z.string().min(1).max(120)),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireLocationWrite(ctx, input.locationId);
        await ctx.db
          .delete(reviewWinTags)
          .where(eq(reviewWinTags.locationId, input.locationId));
        if (input.tags.length > 0) {
          await ctx.db.insert(reviewWinTags).values(
            input.tags.map((label, i) => ({
              locationId: input.locationId,
              label,
              sortOrder: i,
            })),
          );
        }
        return { ok: true };
      }),

    softDelete: protectedProcedure
      .input(z.object({ id: z.string().uuid(), confirmName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { loc } = await requireLocationWrite(ctx, input.id);
        if (input.confirmName.trim().toLowerCase() !== loc.name.trim().toLowerCase()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Confirmation name does not match',
          });
        }
        await ctx.db
          .update(reviewLocations)
          .set({ deletedAt: new Date() })
          .where(eq(reviewLocations.id, loc.id));
        return { ok: true };
      }),

    restore: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { loc } = await requireLocationWrite(ctx, input.id);
        await ctx.db
          .update(reviewLocations)
          .set({ deletedAt: null })
          .where(eq(reviewLocations.id, loc.id));
        return { ok: true };
      }),
  }),

  // ─── Billing / entitlement ────────────────────────────────────────────────
  entitlement: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
      return reviewsEntitlement(ctx.db, input.brandId);
    }),

  /**
   * Past Stripe invoices for the brand owner's Reviews subscription ONLY (mirrors
   * shortLinks.invoices, which is hard-scoped to the URL-shortener sub). Card-on-file
   * management reuses the tool-agnostic shortLinks.{paymentMethod,createSetupIntent,
   * setDefaultPaymentMethod} — they operate on the brand owner's Stripe customer.
   */
  invoices: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'payments');
      if (!stripe) return [];
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId) return [];
      // Most recent Reviews feature subscription regardless of status — past
      // invoices of a cancelled sub still count. Filtering the Stripe list by
      // this subscription id keeps the table to ONLY review-tool charges.
      const [sub] = await ctx.db
        .select({
          stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
          stripeCustomerId: featureSubscriptions.stripeCustomerId,
        })
        .from(featureSubscriptions)
        .innerJoin(
          featureSubscriptionProducts,
          eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
        )
        .where(
          and(
            eq(featureSubscriptions.userId, ownerId),
            eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.REVIEWS),
          ),
        )
        .orderBy(desc(featureSubscriptions.createdAt))
        .limit(1);
      if (!sub?.stripeSubscriptionId || !sub.stripeCustomerId) return [];

      const res = await stripe.invoices.list({
        customer: sub.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        limit: 24,
      });
      return res.data.map((inv) => ({
        id: inv.id,
        number: inv.number ?? inv.id,
        created: inv.created ? new Date(inv.created * 1000) : null,
        periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
        periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
        amount: (inv.amount_paid || inv.amount_due || inv.total || 0) / 100,
        currency: (inv.currency ?? 'aud').toUpperCase(),
        status: inv.status ?? 'open',
        pdfUrl: inv.invoice_pdf ?? null,
        hostedUrl: inv.hosted_invoice_url ?? null,
      }));
    }),

  // ─── Dashboard stats + reviews log ─────────────────────────────────────────
  dashboard: router({
    stats: protectedProcedure
      .input(z.object({ locationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireLocationRead(ctx, input.locationId);
        // Shared aggregate (also backs the AI get_review_stats tool).
        return getLocationStats(ctx.db, input.locationId);
      }),

    reviews: protectedProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          limit: z.number().min(1).max(200).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        await requireLocationRead(ctx, input.locationId);
        // Shared query core (also backs the AI list_recent_reviews tool).
        return listLocationSubmissions(ctx.db, input.locationId, { limit: input.limit });
      }),
  }),

  // ─── Public review page (unauthenticated) ──────────────────────────────────
  public: router({
    /** Public pricing for marketing surfaces (landing page, directory CTA):
     * the monthly price + free-trial size. Null price when unconfigured, so
     * public pages can degrade to price-less copy. */
    offer: publicProcedure.query(async ({ ctx }) => {
      const offer = await getReviewsOffer(ctx.db);
      return {
        unitAmount: offer?.unitAmount ?? null,
        currency: offer?.currency ?? null,
        trialLimit: REVIEWS_FREE_TRIAL,
      };
    }),

    getLocation: publicProcedure
      .input(z.object({ slug: z.string(), rr: z.string().uuid().optional() }))
      .query(async ({ ctx, input }) => {
        // Falls back to slug history so links shared before a rename still work.
        const loc = await locationBySlugOrHistory(ctx.db, input.slug);
        if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
        if (loc.deletedAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'removed' });
        const ent = await reviewsEntitlement(ctx.db, loc.brandId);
        if (!ent.live) throw new TRPCError({ code: 'FORBIDDEN', message: 'inactive' });
        // Read receipt: opening the emailed link advances the request sent → opened
        // (never downgrades a completed one). Fire-and-forget; must not block render.
        if (input.rr) {
          void ctx.db
            .update(reviewRequests)
            .set({ status: 'opened' })
            .where(
              and(
                eq(reviewRequests.token, input.rr),
                eq(reviewRequests.locationId, loc.id),
                eq(reviewRequests.status, 'sent'),
              ),
            )
            .catch((err) => console.error('[reviews mark-opened]', err));
        }
        const [platforms, tags] = await Promise.all([
          ctx.db
            .select({ platform: reviewPlatforms.platform, url: reviewPlatforms.url })
            .from(reviewPlatforms)
            .where(eq(reviewPlatforms.locationId, loc.id)),
          ctx.db
            .select({ label: reviewWinTags.label })
            .from(reviewWinTags)
            .where(eq(reviewWinTags.locationId, loc.id))
            .orderBy(reviewWinTags.sortOrder, reviewWinTags.id),
        ]);
        return {
          id: loc.id,
          name: loc.name,
          industry: loc.industry,
          logoUrl: loc.logoUrl,
          redirectUrl: loc.redirectUrl,
          platforms,
          tags: tags.map((t) => t.label),
        };
      }),

    generateReview: publicProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          businessName: z.string(),
          industry: z.string(),
          selectedTags: z.array(z.string()).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [loc] = await ctx.db
          .select({ brandId: reviewLocations.brandId })
          .from(reviewLocations)
          .where(eq(reviewLocations.id, input.locationId))
          .limit(1);
        const review = await generateReviewText({
          businessName: input.businessName,
          industry: input.industry,
          selectedTags: input.selectedTags,
          db: ctx.db,
          brandId: loc?.brandId ?? null,
          client: ctx.client ?? null,
        });
        return { review };
      }),

    // Capture the star rating THE MOMENT it's tapped, before the visitor writes
    // anything — so a rating is recorded even if they abandon the page. Returns the
    // new submission's id; the visitor-facing flow later calls submitReview with it
    // to fill in the details (tags / generated review / private feedback). Passing
    // an existing `submissionId` re-rates that row instead of creating a second one
    // (the visitor changed their mind before finishing). Runs in the background —
    // the UI must not block or show loading on it.
    startSubmission: publicProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          stars: z.number().int().min(1).max(5),
          submissionType: z.enum(['public', 'private']),
          requestToken: z.string().uuid().optional(),
          submissionId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [loc] = await ctx.db
          .select({ id: reviewLocations.id, deletedAt: reviewLocations.deletedAt })
          .from(reviewLocations)
          .where(eq(reviewLocations.id, input.locationId))
          .limit(1);
        if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
        if (loc.deletedAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'removed' });

        // Re-rating an in-progress submission → just move the star count / type.
        if (input.submissionId) {
          await ctx.db
            .update(reviewSubmissions)
            .set({ stars: input.stars, submissionType: input.submissionType })
            .where(
              and(
                eq(reviewSubmissions.id, input.submissionId),
                eq(reviewSubmissions.locationId, loc.id),
              ),
            );
          return { submissionId: input.submissionId };
        }

        const requestId = await resolveRequestId(ctx, loc.id, input.requestToken);
        const [row] = await ctx.db
          .insert(reviewSubmissions)
          .values({
            locationId: loc.id,
            requestId,
            stars: input.stars,
            submissionType: input.submissionType,
          })
          .returning({ id: reviewSubmissions.id });

        // Stamp the originating request as answered right away — the rating is
        // captured even if no written feedback ever follows.
        if (requestId) {
          await ctx.db
            .update(reviewRequests)
            .set({ status: 'completed', completedAt: new Date() })
            .where(eq(reviewRequests.id, requestId));
        }
        return { submissionId: row.id };
      }),

    submitReview: publicProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          stars: z.number().int().min(1).max(5),
          selectedTags: z.array(z.string()).default([]),
          generatedReview: z.string().optional(),
          privateFeedback: z.string().optional(),
          platformClicked: z.string().optional(),
          submissionType: z.enum(['public', 'private']),
          publicConsent: z.boolean().optional(),
          origin: z.string().url().optional(),
          // Per-request token from the emailed link (?rr=<token>), when the
          // reviewer arrived via a review request rather than a walk-up capture.
          requestToken: z.string().uuid().optional(),
          // The row created by startSubmission on the first star tap. When present
          // we UPDATE it (fill in the details) rather than inserting a new row.
          submissionId: z.string().uuid().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [loc] = await ctx.db
          .select()
          .from(reviewLocations)
          .where(eq(reviewLocations.id, input.locationId))
          .limit(1);
        if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
        if (loc.deletedAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'removed' });

        // Tie the submission back to the originating request (token must belong to
        // this location) so the request log can show the rating + message.
        const requestId = await resolveRequestId(ctx, loc.id, input.requestToken);

        const fields = {
          stars: input.stars,
          selectedTags: input.selectedTags,
          generatedReview: input.generatedReview,
          privateFeedback: input.privateFeedback,
          platformClicked: input.platformClicked,
          submissionType: input.submissionType,
          publicConsent: input.publicConsent ?? false,
        };

        // Update the star-tap row when we have one; otherwise insert fresh (the
        // background create never landed, or an older client that doesn't send it).
        let updated = false;
        if (input.submissionId) {
          const rows = await ctx.db
            .update(reviewSubmissions)
            .set({ ...fields, requestId })
            .where(
              and(
                eq(reviewSubmissions.id, input.submissionId),
                eq(reviewSubmissions.locationId, loc.id),
              ),
            )
            .returning({ id: reviewSubmissions.id });
          updated = rows.length > 0;
        }
        if (!updated) {
          await ctx.db.insert(reviewSubmissions).values({ locationId: loc.id, requestId, ...fields });
        }

        // Advance the request to completed and stamp when it was answered.
        if (requestId) {
          await ctx.db
            .update(reviewRequests)
            .set({ status: 'completed', completedAt: new Date() })
            .where(eq(reviewRequests.id, requestId));
        }

        if (input.submissionType === 'private' && loc.badReviewEmail) {
          void sendBadReviewAlertEmail({
            to: loc.badReviewEmail,
            locationName: loc.name,
            stars: input.stars,
            feedback: input.privateFeedback ?? '',
            dashboardUrl: input.origin ? `${input.origin}/l/${loc.id}/reviews` : undefined,
          }).catch((err) => console.error('[reviews bad-review email]', err));
        }
        return { ok: true };
      }),
  }),

  // ─── Industries (DB-backed; falls back to seed) ────────────────────────────
  industries: router({
    list: publicProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select()
        .from(reviewIndustries)
        .where(eq(reviewIndustries.isActive, true))
        .orderBy(reviewIndustries.sortOrder, reviewIndustries.id);
      if (rows.length > 0) {
        return rows.map((r) => ({
          slug: r.slug,
          label: r.label,
          description: r.description ?? '',
        }));
      }
      return REVIEW_INDUSTRIES.map((i) => ({
        slug: i.slug,
        label: i.label,
        description: i.description,
      }));
    }),

    tags: publicProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(reviewTagPresets)
          .where(eq(reviewTagPresets.industrySlug, input.slug))
          .orderBy(reviewTagPresets.sortOrder, reviewTagPresets.id);
        if (rows.length > 0) return rows.map((r) => r.tag);
        return getDefaultTagsForIndustry(input.slug);
      }),
  }),

  // ─── Embed (per-location config) ───────────────────────────────────────────
  embed: router({
    getForLocation: protectedProcedure
      .input(z.object({ locationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { loc } = await requireLocationRead(ctx, input.locationId);
        // Shared state (also backs the AI get_review_embed tool).
        const s = await getLocationEmbedState(ctx.db, loc.brandId, loc.id);
        return {
          embedUnlocked: s.embedUnlocked,
          brandedUnlocked: s.brandedUnlocked,
          accountReviews: s.brandReviews,
          locationReviews: s.locationReviews,
          unlockThresholds: {
            embed: EMBED_UNLOCK_ACCOUNT_REVIEWS,
            branded: EMBED_THEME_UNLOCK_LOCATION_REVIEWS,
          },
          theme: s.theme,
          version: s.version,
          slug: loc.slug,
          locationName: loc.name,
        };
      }),

    preview: protectedProcedure
      .input(z.object({ locationId: z.string().uuid(), theme: z.unknown() }))
      .query(async ({ ctx, input }) => {
        const { loc } = await requireLocationRead(ctx, input.locationId);
        const locationReviews = await countLocationReviews(ctx.db, loc.id);
        const brandedUnlocked = locationReviews >= EMBED_THEME_UNLOCK_LOCATION_REVIEWS;
        // The PREVIEW always applies branded fields (font / accent / logo) so the
        // builder shows what you'd get — "preview now, persist once unlocked". The
        // real `brandedUnlocked` is still returned for the lock hint, and `save`
        // (not this) enforces the gate on what actually persists.
        const safe = sanitizeTheme(input.theme, true);
        const subs = await ctx.db
          .select({
            id: reviewSubmissions.id,
            stars: reviewSubmissions.stars,
            generatedReview: reviewSubmissions.generatedReview,
            createdAt: reviewSubmissions.createdAt,
          })
          .from(reviewSubmissions)
          .where(
            and(
              eq(reviewSubmissions.locationId, loc.id),
              eq(reviewSubmissions.submissionType, 'public'),
            ),
          )
          .orderBy(desc(reviewSubmissions.createdAt))
          .limit(50);
        const reviews = pickPublicReviews(subs);
        const seeded =
          reviews.length > 0
            ? reviews
            : [
                { id: -1, stars: 5, text: 'Honestly the best service I have had in years, friendly, fast and the result was spot on.', reviewer: 'Sample customer', createdAt: Date.now() - 2 * 86_400_000 },
                { id: -2, stars: 5, text: 'Came in for a small fix and left grinning. Will absolutely be back.', reviewer: 'Verified customer', createdAt: Date.now() - 7 * 86_400_000 },
                { id: -3, stars: 5, text: 'Pricing was clear, communication was great. Recommend without hesitation.', reviewer: 'Verified customer', createdAt: Date.now() - 14 * 86_400_000 },
              ];
        const winTags = await ctx.db
          .select({ label: reviewWinTags.label })
          .from(reviewWinTags)
          .where(eq(reviewWinTags.locationId, loc.id))
          .orderBy(reviewWinTags.sortOrder, reviewWinTags.id);
        const html = renderEmbedHtml({
          title: loc.name,
          reviews: seeded,
          theme: safe,
          brandedUnlocked,
          configUrl: `/embed/loc/${loc.slug}/config.json`,
          logoUrl: loc.logoUrl,
          winTags: winTags.map((w) => w.label),
        });
        return { html, brandedUnlocked, sampleReviews: reviews.length === 0 };
      }),

    save: protectedProcedure
      .input(z.object({ locationId: z.string().uuid(), theme: z.unknown() }))
      .mutation(async ({ ctx, input }) => {
        const { loc } = await requireLocationWrite(ctx, input.locationId);
        const brandReviews = await countBrandReviews(ctx.db, loc.brandId);
        if (brandReviews < EMBED_UNLOCK_ACCOUNT_REVIEWS) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Embed unlocks at ${EMBED_UNLOCK_ACCOUNT_REVIEWS} reviews account-wide.`,
          });
        }
        const locationReviews = await countLocationReviews(ctx.db, loc.id);
        const brandedUnlocked = locationReviews >= EMBED_THEME_UNLOCK_LOCATION_REVIEWS;
        const safe = sanitizeTheme(input.theme, brandedUnlocked);
        const [existing] = await ctx.db
          .select()
          .from(reviewEmbedConfigs)
          .where(eq(reviewEmbedConfigs.locationId, loc.id))
          .limit(1);
        if (existing) {
          await ctx.db
            .update(reviewEmbedConfigs)
            .set({ theme: safe, version: (existing.version ?? 1) + 1 })
            .where(eq(reviewEmbedConfigs.locationId, loc.id));
        } else {
          await ctx.db
            .insert(reviewEmbedConfigs)
            .values({ locationId: loc.id, theme: safe });
        }
        return { ok: true, theme: safe, brandedUnlocked };
      }),
  }),

  // ─── Embed collections (multi-location) ────────────────────────────────────
  collections: router({
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const [brandReviews, items] = await Promise.all([
          countBrandReviews(ctx.db, input.brandId),
          listBrandEmbedCollections(ctx.db, input.brandId),
        ]);
        return {
          accountReviews: brandReviews,
          items,
        };
      }),

    detail: protectedProcedure
      .input(z.object({ brandId: z.string().uuid(), id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const [col] = await ctx.db
          .select()
          .from(reviewEmbedCollections)
          .where(eq(reviewEmbedCollections.id, input.id))
          .limit(1);
        if (!col || col.brandId !== input.brandId) throw new TRPCError({ code: 'NOT_FOUND' });
        const links = await ctx.db
          .select()
          .from(reviewEmbedCollectionLocations)
          .where(eq(reviewEmbedCollectionLocations.collectionId, col.id))
          .orderBy(reviewEmbedCollectionLocations.sortOrder);
        return {
          ...col,
          locationIds: links.map((l) => l.locationId),
        };
      }),

    /** Render preview HTML for a collection draft — powers the in-app live preview. */
    preview: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          id: z.string().uuid(),
          theme: z.unknown(),
          locationIds: z.array(z.string().uuid()).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const [col] = await ctx.db
          .select()
          .from(reviewEmbedCollections)
          .where(eq(reviewEmbedCollections.id, input.id))
          .limit(1);
        if (!col || col.brandId !== input.brandId) throw new TRPCError({ code: 'NOT_FOUND' });
        const safe = sanitizeTheme(input.theme, true);
        const locIds =
          input.locationIds && input.locationIds.length > 0
            ? input.locationIds
            : (
                await ctx.db
                  .select()
                  .from(reviewEmbedCollectionLocations)
                  .where(eq(reviewEmbedCollectionLocations.collectionId, col.id))
                  .orderBy(reviewEmbedCollectionLocations.sortOrder)
              ).map((l) => l.locationId);
        const owned = await ctx.db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(eq(reviewLocations.brandId, input.brandId));
        const nameById = new Map(owned.map((l) => [l.id, l.name] as const));
        const previewIds = locIds.filter((id) => nameById.has(id));
        const subs = previewIds.length
          ? await ctx.db
              .select({
                id: reviewSubmissions.id,
                stars: reviewSubmissions.stars,
                generatedReview: reviewSubmissions.generatedReview,
                createdAt: reviewSubmissions.createdAt,
                locationId: reviewSubmissions.locationId,
              })
              .from(reviewSubmissions)
              .where(
                and(
                  inArray(reviewSubmissions.locationId, previewIds),
                  eq(reviewSubmissions.submissionType, 'public'),
                ),
              )
              .orderBy(desc(reviewSubmissions.createdAt))
              .limit(50)
          : [];
        const reviews = pickPublicReviews(
          subs.map((s) => ({ ...s, locationName: nameById.get(s.locationId) })),
        );
        const seeded =
          reviews.length > 0
            ? reviews
            : [
                { id: -1, stars: 5, text: 'Lovely team across all the branches — same standard everywhere we go.', reviewer: 'Sample customer', createdAt: Date.now() - 3 * 86_400_000, locationName: nameById.get(previewIds[0] ?? '') },
                { id: -2, stars: 5, text: 'Used the city store, then the suburb one a month later. Both excellent.', reviewer: 'Verified customer', createdAt: Date.now() - 9 * 86_400_000, locationName: nameById.get(previewIds[1] ?? previewIds[0] ?? '') },
                { id: -3, stars: 5, text: 'Honestly the most consistent service across multiple visits. Recommended.', reviewer: 'Verified customer', createdAt: Date.now() - 16 * 86_400_000, locationName: nameById.get(previewIds[0] ?? '') },
              ];
        const html = renderEmbedHtml({
          title: col.name,
          reviews: seeded,
          theme: safe,
          brandedUnlocked: true,
          configUrl: `/embed/col/${col.slug}/config.json`,
        });
        return { html, sampleReviews: reviews.length === 0 };
      }),

    create: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          name: z.string().min(1).max(255),
          locationIds: z.array(z.string().uuid()).min(1),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'reviews');
        await assertLocationsOwnedByBrand(ctx, input.brandId, input.locationIds);
        const slug = Math.random().toString(36).slice(2, 12);
        const [col] = await ctx.db
          .insert(reviewEmbedCollections)
          .values({
            brandId: input.brandId,
            name: input.name,
            slug,
            theme: DEFAULT_EMBED_THEME,
          })
          .returning();
        await setCollectionLocations(ctx, col.id, input.locationIds);
        return { id: col.id, slug };
      }),

    update: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          id: z.string().uuid(),
          name: z.string().min(1).max(255).optional(),
          locationIds: z.array(z.string().uuid()).optional(),
          theme: z.unknown().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'reviews');
        const [col] = await ctx.db
          .select()
          .from(reviewEmbedCollections)
          .where(eq(reviewEmbedCollections.id, input.id))
          .limit(1);
        if (!col || col.brandId !== input.brandId) throw new TRPCError({ code: 'NOT_FOUND' });
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = input.name;
        if (input.theme !== undefined) patch.theme = sanitizeTheme(input.theme, true);
        if (Object.keys(patch).length > 0) {
          patch.version = (col.version ?? 1) + 1;
          await ctx.db
            .update(reviewEmbedCollections)
            .set(patch)
            .where(eq(reviewEmbedCollections.id, col.id));
        }
        if (input.locationIds) {
          await assertLocationsOwnedByBrand(ctx, input.brandId, input.locationIds);
          await setCollectionLocations(ctx, col.id, input.locationIds);
        }
        return { ok: true };
      }),

    remove: protectedProcedure
      .input(z.object({ brandId: z.string().uuid(), id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { isOwner } = await assertBrandAccess(ctx, input.brandId, 'reviews');
        if (!isOwner) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the brand owner can delete collections.',
          });
        }
        const [col] = await ctx.db
          .select()
          .from(reviewEmbedCollections)
          .where(eq(reviewEmbedCollections.id, input.id))
          .limit(1);
        if (!col || col.brandId !== input.brandId) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db
          .delete(reviewEmbedCollections)
          .where(eq(reviewEmbedCollections.id, col.id));
        return { ok: true };
      }),
  }),

  // ─── Milestone rewards ──────────────────────────────────────────────────────
  rewards: router({
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const brandReviews = await countBrandReviews(ctx.db, input.brandId);
        const locs = await ctx.db
          .select({ id: reviewLocations.id })
          .from(reviewLocations)
          .where(
            and(
              eq(reviewLocations.brandId, input.brandId),
              isNull(reviewLocations.deletedAt),
            ),
          );
        let maxLocationReviews = 0;
        for (const loc of locs) {
          const n = await countLocationReviews(ctx.db, loc.id);
          if (n > maxLocationReviews) maxLocationReviews = n;
          if (n >= STICKER_PACK_THRESHOLD_LOCATION_REVIEWS) {
            await ensureReward(ctx, input.brandId, 'sticker_pack', loc.id);
          }
        }
        if (brandReviews >= GOLD_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS) {
          await ensureReward(ctx, input.brandId, 'gold_plaque');
        }
        if (brandReviews >= PLATINUM_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS) {
          await ensureReward(ctx, input.brandId, 'platinum_plaque');
        }
        const rewards = await ctx.db
          .select()
          .from(reviewMilestoneRewards)
          .where(eq(reviewMilestoneRewards.brandId, input.brandId))
          .orderBy(desc(reviewMilestoneRewards.unlockedAt));
        return {
          accountReviews: brandReviews,
          maxLocationReviews,
          thresholds: {
            stickerPack: STICKER_PACK_THRESHOLD_LOCATION_REVIEWS,
            gold: GOLD_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS,
            platinum: PLATINUM_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS,
          },
          rewards,
        };
      }),

    claim: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          rewardId: z.string().uuid(),
          address: z.object({
            name: z.string().min(1).max(255),
            houseNumber: z.string().min(1).max(32),
            line1: z.string().min(1).max(255),
            line2: z.string().max(255).optional(),
            city: z.string().min(1).max(120),
            state: z.string().max(120).optional(),
            postcode: z.string().min(1).max(32),
            country: z.string().min(2).max(64),
            phone: z.string().max(40).optional(),
          }),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'reviews');
        const [reward] = await ctx.db
          .select()
          .from(reviewMilestoneRewards)
          .where(eq(reviewMilestoneRewards.id, input.rewardId))
          .limit(1);
        if (!reward || reward.brandId !== input.brandId) throw new TRPCError({ code: 'NOT_FOUND' });
        if (reward.status !== 'unlocked') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reward already claimed.' });
        }
        await ctx.db
          .update(reviewMilestoneRewards)
          .set({ status: 'claimed', shippingAddress: input.address, claimedAt: new Date() })
          .where(eq(reviewMilestoneRewards.id, reward.id));
        return { ok: true };
      }),
  }),

  // ─── Referrals ──────────────────────────────────────────────────────────────
  // "Give a month, get a month" — see modules/reviews/referrals.ts for the
  // settlement mechanics (Stripe customer-balance credit for both sides).
  referrals: router({
    mine: protectedProcedure.query(async ({ ctx }) => {
      const code = await getOrCreateReferralCode(ctx, ctx.user.id);
      const redemptions = await ctx.db
        .select({
          id: reviewReferralRedemptions.id,
          redeemedAt: reviewReferralRedemptions.redeemedAt,
          creditedAt: reviewReferralRedemptions.creditedAt,
        })
        .from(reviewReferralRedemptions)
        .where(eq(reviewReferralRedemptions.code, code.code))
        .orderBy(desc(reviewReferralRedemptions.redeemedAt));

      // The code I redeemed myself (one per user, ever) — drives the redeem UI.
      const [myRedemption] = await ctx.db
        .select({
          code: reviewReferralRedemptions.code,
          creditedAt: reviewReferralRedemptions.creditedAt,
        })
        .from(reviewReferralRedemptions)
        .where(eq(reviewReferralRedemptions.redeemedByUserId, ctx.user.id))
        .limit(1);

      // Live Stripe credit balance (negative customer balance = credit). Cosmetic
      // — settlement doesn't depend on it — so failures degrade to null quietly.
      let creditCents: number | null = null;
      if (stripe) {
        const [me] = await ctx.db
          .select({ stripeCustomerId: users.stripeCustomerId })
          .from(users)
          .where(eq(users.id, ctx.user.id))
          .limit(1);
        if (me?.stripeCustomerId) {
          try {
            const customer = await stripe.customers.retrieve(me.stripeCustomerId);
            if (!customer.deleted) creditCents = Math.max(0, -(customer.balance ?? 0));
          } catch {
            /* balance display only */
          }
        }
      }

      return {
        code: code.code,
        monthsEarned: code.monthsEarned,
        monthsPending: redemptions.filter((r) => !r.creditedAt).length,
        redemptions,
        myRedemption: myRedemption ?? null,
        creditCents,
      };
    }),

    redeem: protectedProcedure
      .input(z.object({ code: z.string().min(4).max(32) }))
      .mutation(async ({ ctx, input }) => {
        // Only brand owners can redeem: the free month settles against the
        // redeemer's OWN reviews subscription, which staff never hold.
        const [ownedBrand] = await ctx.db
          .select({ id: brands.id })
          .from(brands)
          .where(eq(brands.ownerId, ctx.user.id))
          .limit(1);
        if (!ownedBrand) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only brand owners can redeem a referral code.',
          });
        }

        const [code] = await ctx.db
          .select()
          .from(reviewReferralCodes)
          .where(eq(reviewReferralCodes.code, input.code.trim().toUpperCase()))
          .limit(1);
        if (!code) throw new TRPCError({ code: 'NOT_FOUND', message: 'Code not found.' });
        if (code.ownerUserId === ctx.user.id) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: "You can't redeem your own code." });
        }

        const [already] = await ctx.db
          .select({ id: reviewReferralRedemptions.id })
          .from(reviewReferralRedemptions)
          .where(eq(reviewReferralRedemptions.redeemedByUserId, ctx.user.id))
          .limit(1);
        if (already) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You’ve already redeemed a referral code.',
          });
        }

        try {
          await ctx.db
            .insert(reviewReferralRedemptions)
            .values({ code: code.code, redeemedByUserId: ctx.user.id });
        } catch {
          // Unique-index backstop for a concurrent double-redeem.
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'You’ve already redeemed a referral code.',
          });
        }

        // Already a paying reviews subscriber → both free months settle right
        // now; otherwise they settle when the subscription first activates.
        let settled = false;
        const offer = await getReviewsOffer(ctx.db);
        if (offer && (await userHasProduct(ctx.db, ctx.user.id, offer.productId))) {
          await settleReviewsReferralOnActivation(ctx.db, ctx.user.id);
          settled = true;
        }
        return { ok: true, settled };
      }),
  }),

  // ─── Insights ─────────────────────────────────────────────────────────────
  insights: router({
    streak: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const weeks = await getWeeklyReviewCounts(ctx.db, input.brandId, 12);
        // The last bucket is the CURRENT (still in-progress) week — count the streak
        // over COMPLETED weeks only, otherwise an empty current week zeroes a real
        // run every Monday until a review happens to land.
        const current = weeks[weeks.length - 1];
        const prior = weeks.slice(0, -1);
        let completedStreak = 0;
        for (let i = prior.length - 1; i >= 0; i--) {
          if (prior[i].count > 0) completedStreak++;
          else break;
        }
        const capturedThisWeek = (current?.count ?? 0) > 0;
        // Once you've captured this week it counts toward the visible streak.
        const streak = completedStreak + (capturedThisWeek ? 1 : 0);
        // "At risk" = you have a run going but haven't kept it up THIS week yet —
        // matches the banner copy ("capture a review this week to keep it").
        const atRisk = completedStreak > 0 && !capturedThisWeek;
        return { weeks, streak, atRisk };
      }),

    topTags: protectedProcedure
      .input(z.object({ locationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireLocationRead(ctx, input.locationId);
        return getTopWinTags(ctx.db, input.locationId, 8);
      }),

    industryRank: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const locs = await ctx.db
          .select({ industry: reviewLocations.industry })
          .from(reviewLocations)
          .where(
            and(
              eq(reviewLocations.brandId, input.brandId),
              isNull(reviewLocations.deletedAt),
            ),
          );
        const counts = new Map<string, number>();
        for (const l of locs) counts.set(l.industry, (counts.get(l.industry) ?? 0) + 1);
        const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
        return { industry: top, ...(await getIndustryRankForBrand(ctx.db, input.brandId, top)) };
      }),
  }),

  // ─── Review requests ────────────────────────────────────────────────────────
  reviewRequests: router({
    send: protectedProcedure
      .input(
        z.object({
          locationId: z.string().uuid(),
          customerName: z.string().min(1).max(255),
          customerEmail: z.string().email().max(320),
          customMessage: z.string().max(500).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Viewers (`reviewsViewer`) may send review requests too — see
        // requireLocationSend. Everything else here stays editor-only.
        const { loc } = await requireLocationSend(ctx, input.locationId);
        // Rate limit: 50 / location / day.
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const [{ c } = { c: 0 }] = await ctx.db
          .select({ c: sql<number>`count(*)` })
          .from(reviewRequests)
          .where(
            and(
              eq(reviewRequests.locationId, loc.id),
              gte(reviewRequests.sentAt, since),
            ),
          );
        if (Number(c) >= 50) {
          throw new TRPCError({
            code: 'TOO_MANY_REQUESTS',
            message: 'Daily limit of 50 review requests per location reached. Try again tomorrow.',
          });
        }
        const [brand] = await ctx.db
          .select({
            businessName: brands.businessName,
            website: brands.website,
            phone: brands.phone,
            address: brands.address,
            logoUrl: brands.logoUrl,
          })
          .from(brands)
          .where(eq(brands.id, loc.brandId))
          .limit(1);
        const origin = ctx.clientOrigin?.replace(/\/$/, '') ?? '';
        // Per-request token so the resulting submission can be tied back to this
        // exact request (status → completed, rating + message shown in the log).
        const token = randomUUID();
        const reviewLink = `${origin}/r/${loc.slug}?rr=${token}`;
        await sendReviewRequestEmail({
          to: input.customerEmail,
          customerName: input.customerName,
          businessName: brand?.businessName ?? loc.name,
          locationName: loc.name,
          reviewLink,
          customMessage: input.customMessage,
          logoUrl: loc.logoUrl ?? brand?.logoUrl,
          businessWebsite: brand?.website,
          businessPhone: brand?.phone,
          businessAddress: brand?.address,
        }).catch((err) => console.error('[reviews request email]', err));
        const [row] = await ctx.db
          .insert(reviewRequests)
          .values({
            locationId: loc.id,
            brandId: loc.brandId,
            sentByUserId: ctx.user.id,
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            channel: 'email',
            status: 'sent',
            token,
            reviewLink,
            customMessage: input.customMessage ?? null,
          })
          .returning();
        return { ok: true, requestId: row.id };
      }),

    listForLocation: protectedProcedure
      .input(z.object({ locationId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await requireLocationRead(ctx, input.locationId);
        return ctx.db
          .select(reviewRequestWithResponse)
          .from(reviewRequests)
          .leftJoin(reviewSubmissions, eq(reviewSubmissions.requestId, reviewRequests.id))
          .where(eq(reviewRequests.locationId, input.locationId))
          .orderBy(desc(reviewRequests.sentAt))
          .limit(100);
      }),

    listForBrand: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        return ctx.db
          .select(reviewRequestWithResponse)
          .from(reviewRequests)
          .leftJoin(reviewSubmissions, eq(reviewSubmissions.requestId, reviewRequests.id))
          .where(eq(reviewRequests.brandId, input.brandId))
          .orderBy(desc(reviewRequests.sentAt))
          .limit(200);
      }),
  }),

  // ─── Public directory (unauthenticated reads + brand-scoped settings) ───────
  directory: router({
    search: publicProcedure
      .input(z.object({ query: z.string().max(120) }))
      .query(async ({ ctx, input }) => {
        if (!input.query.trim()) return [];
        return searchDirectory(ctx.db, input.query.trim());
      }),

    // Every brand the caller can reach (owns, or is active staff of with a
    // reviews permission) that has at least one review location — powers the
    // signatures "Sync from Verdiict" picker, which is brand-level. Each row
    // carries the brand's directory slug (for the brand-level "See our Reviews"
    // /directory/:slug link) plus a representative location slug (for the
    // "Get a Review" /r/:slug link — reviews are captured per location, so the
    // CTA is anchored to the brand's primary location).
    listMine: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.user.id;
      const [owned, staffed] = await Promise.all([
        ctx.db
          .select({ brandId: userBrands.brandId })
          .from(userBrands)
          .where(eq(userBrands.userId, userId)),
        ctx.db
          .select({ brandId: staff.brandId, permissions: staff.permissions })
          .from(staff)
          .where(and(eq(staff.userId, userId), eq(staff.status, 'active'))),
      ]);
      const brandIds = new Set(owned.map((b) => b.brandId));
      for (const s of staffed) {
        if (!s.brandId) continue; // agency staff rows carry no brand
        const perms = s.permissions ?? [];
        if (
          hasPermission(perms, 'reviews') ||
          hasPermission(perms, 'reviewsViewer')
        )
          brandIds.add(s.brandId);
      }
      if (brandIds.size === 0) return [];

      // Return location entries with review and directory profile details.
      const rows = await ctx.db
        .select({
          locationId: reviewLocations.id,
          locationName: reviewLocations.name,
          locationSlug: reviewLocations.slug,
          brandId: reviewLocations.brandId,
          brandName: brands.businessName,
          reviewSlug: reviewLocations.slug,
          logoUrl: reviewLocations.logoUrl,
          brandSlug: reviewDirectoryBrands.slug,
          listed: reviewDirectoryProfiles.optIn,
        })
        .from(reviewLocations)
        .innerJoin(brands, eq(reviewLocations.brandId, brands.id))
        .leftJoin(
          reviewDirectoryProfiles,
          eq(reviewDirectoryProfiles.locationId, reviewLocations.id),
        )
        .leftJoin(
          reviewDirectoryBrands,
          eq(reviewDirectoryBrands.brandId, reviewLocations.brandId),
        )
        .where(
          and(
            inArray(reviewLocations.brandId, [...brandIds]),
            isNull(reviewLocations.deletedAt),
          ),
        )
        .orderBy(brands.businessName, reviewLocations.name);

      return rows.map((r) => ({
        locationId: r.locationId,
        locationName: r.locationName,
        brandId: r.brandId,
        brandName: r.brandName,
        reviewSlug: r.reviewSlug,
        // The canonical public path, or null while this location isn't listed —
        // consumers link to it directly instead of rebuilding a slug.
        directoryPath:
          r.brandSlug && r.listed ? directoryPath(r.brandSlug, r.locationSlug) : null,
        logoUrl: r.logoUrl,
      }));
    }),

    profile: publicProcedure
      .input(z.object({ slug: z.string(), locationSlug: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const profile = await getDirectoryProfile(ctx.db, input.slug, input.locationSlug);
        if (!profile) {
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: 'Business location not found or not listed in the directory.',
          });
        }
        const rank = profile.primaryIndustry
          ? await getIndustryRankForLocation(ctx.db, profile.locationId, profile.primaryIndustry)
          : null;
        return { ...profile, industryRank: rank };
      }),

    leaderboard: publicProcedure
      .input(z.object({ industry: z.string() }))
      .query(async ({ ctx, input }) => {
        return getIndustryLeaderboard(ctx.db, input.industry, 20);
      }),

    badgeData: publicProcedure
      .input(z.object({ slug: z.string(), locationSlug: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        const profile = await getDirectoryProfile(ctx.db, input.slug, input.locationSlug);
        if (!profile) throw new TRPCError({ code: 'NOT_FOUND', message: 'Business not found.' });
        const rank = profile.primaryIndustry
          ? await getIndustryRankForLocation(ctx.db, profile.locationId, profile.primaryIndustry)
          : null;
        return {
          name: profile.name,
          avgRating: profile.avgRating,
          reviewCount: profile.totalReviews,
          primaryIndustry: profile.primaryIndustry,
          profilePath: profile.path,
          isBestInIndustry: rank?.rank != null && rank.rank <= 3,
        };
      }),

    myProfiles: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        const [brand] = await ctx.db
          .select({ businessName: brands.businessName, logoUrl: brands.logoUrl })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1);

        let locations = await ctx.db
          .select({
            id: reviewLocations.id,
            name: reviewLocations.name,
            logoUrl: reviewLocations.logoUrl,
            slug: reviewLocations.slug,
          })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.brandId, input.brandId), isNull(reviewLocations.deletedAt)))
          .orderBy(reviewLocations.createdAt);

        if (locations.length === 0) {
          const locName = brand?.businessName?.trim() || 'Main Location';
          const slug = await uniqueLocationSlug(ctx.db, locName);
          const [newLoc] = await ctx.db
            .insert(reviewLocations)
            .values({
              brandId: input.brandId,
              name: locName,
              slug,
              industry: 'General',
              createdByUserId: ctx.user.id,
            })
            .returning({
              id: reviewLocations.id,
              name: reviewLocations.name,
              logoUrl: reviewLocations.logoUrl,
              slug: reviewLocations.slug,
            });
          if (newLoc) {
            locations = [newLoc];
          }
        }

        // One brand slug for the whole set — every location's public URL is
        // `/directory/<brandSlug>/<its own slug>`, so this must NOT be resolved
        // per location (that is how the first location ended up showing the
        // brand-level path while the rest showed combined slugs).
        const brandSlug = await ensureDirectoryBrandSlug(
          ctx.db,
          input.brandId,
          brand?.businessName ?? 'business',
        );

        const profiles = await Promise.all(
          locations.map(async (loc) => {
            await ensureDirectoryProfile(ctx.db, loc.id, input.brandId);
            const [row] = await ctx.db
              .select()
              .from(reviewDirectoryProfiles)
              .where(eq(reviewDirectoryProfiles.locationId, loc.id))
              .limit(1);

            return {
              locationId: loc.id,
              locationName: loc.name,
              brandName: brand?.businessName ?? '',
              brandSlug,
              locationSlug: loc.slug,
              profileUrl: directoryPath(brandSlug, loc.slug),
              directoryOptIn: row?.optIn ?? true,
              websiteUrl: row?.websiteUrl ?? null,
              description: row?.description ?? null,
              city: row?.city ?? null,
              logoUrl: loc.logoUrl ?? brand?.logoUrl ?? null,
            };
          }),
        );

        return profiles;
      }),

    myProfile: protectedProcedure
      .input(z.object({ brandId: z.string().uuid(), locationId: z.string().uuid().optional() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccessAny(ctx, input.brandId, ['reviews', 'reviewsViewer']);
        let locations = await ctx.db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.brandId, input.brandId), isNull(reviewLocations.deletedAt)))
          .orderBy(reviewLocations.createdAt)
          .limit(1);

        if (locations.length === 0) {
          const [brand] = await ctx.db
            .select({ businessName: brands.businessName })
            .from(brands)
            .where(eq(brands.id, input.brandId))
            .limit(1);
          const locName = brand?.businessName?.trim() || 'Main Location';
          const slug = await uniqueLocationSlug(ctx.db, locName);
          const [newLoc] = await ctx.db
            .insert(reviewLocations)
            .values({
              brandId: input.brandId,
              name: locName,
              slug,
              industry: 'General',
              createdByUserId: ctx.user.id,
            })
            .returning({ id: reviewLocations.id, name: reviewLocations.name });
          if (newLoc) {
            locations = [newLoc];
          }
        }

        const targetLocationId = input.locationId ?? locations[0]?.id;
        if (!targetLocationId) return null;

        const [brand] = await ctx.db
          .select({ businessName: brands.businessName, logoUrl: brands.logoUrl })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1);

        const [loc] = await ctx.db
          .select({ name: reviewLocations.name, logoUrl: reviewLocations.logoUrl, slug: reviewLocations.slug })
          .from(reviewLocations)
          .where(eq(reviewLocations.id, targetLocationId))
          .limit(1);

        const brandSlug = await ensureDirectoryBrandSlug(
          ctx.db,
          input.brandId,
          brand?.businessName ?? 'business',
        );
        await ensureDirectoryProfile(ctx.db, targetLocationId, input.brandId);

        const [row] = await ctx.db
          .select()
          .from(reviewDirectoryProfiles)
          .where(eq(reviewDirectoryProfiles.locationId, targetLocationId))
          .limit(1);

        return {
          locationId: targetLocationId,
          locationName: loc?.name ?? '',
          brandName: brand?.businessName ?? '',
          brandSlug,
          locationSlug: loc?.slug ?? '',
          profileUrl: loc?.slug ? directoryPath(brandSlug, loc.slug) : '/directory',
          directoryOptIn: row?.optIn ?? true,
          websiteUrl: row?.websiteUrl ?? null,
          description: row?.description ?? null,
          city: row?.city ?? null,
          logoUrl: loc?.logoUrl ?? brand?.logoUrl ?? null,
        };
      }),

    updateProfile: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          locationId: z.string().uuid().optional(),
          directoryOptIn: z.boolean().optional(),
          websiteUrl: httpUrl(500).nullable().optional(),
          description: z.string().max(1000).nullable().optional(),
          city: z.string().max(120).nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'reviews');

        let targetLocationId = input.locationId;
        if (!targetLocationId) {
          const [firstLoc] = await ctx.db
            .select({ id: reviewLocations.id })
            .from(reviewLocations)
            .where(and(eq(reviewLocations.brandId, input.brandId), isNull(reviewLocations.deletedAt)))
            .orderBy(reviewLocations.createdAt)
            .limit(1);
          targetLocationId = firstLoc?.id;
        }
        if (!targetLocationId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'No location found for this brand.' });
        }

        await ensureDirectoryProfile(ctx.db, targetLocationId, input.brandId);

        const { brandId, locationId, ...patch } = input;
        const data: Record<string, unknown> = {};
        if (patch.directoryOptIn !== undefined) data.optIn = patch.directoryOptIn;
        if (patch.websiteUrl !== undefined) data.websiteUrl = patch.websiteUrl;
        if (patch.description !== undefined) data.description = patch.description;
        if (patch.city !== undefined) data.city = patch.city;
        if (Object.keys(data).length > 0) {
          await ctx.db
            .update(reviewDirectoryProfiles)
            .set(data)
            .where(eq(reviewDirectoryProfiles.locationId, targetLocationId));
        }
        return { ok: true };
      }),
  }),

  // ─── Super-admin ────────────────────────────────────────────────────────────
  admin: router({
    overview: superAdminProcedure.query(async ({ ctx }) => {
      const [[{ totalLocations }], [{ totalReviews }], perBrand, subscribedOwners] =
        await Promise.all([
          ctx.db
            .select({ totalLocations: sql<number>`count(*)` })
            .from(reviewLocations)
            .where(isNull(reviewLocations.deletedAt)),
          ctx.db.select({ totalReviews: sql<number>`count(*)` }).from(reviewSubmissions),
          // Trial usage counts ALL locations (incl. trashed) — countBrandReviews does.
          ctx.db
            .select({
              brandId: reviewLocations.brandId,
              brandName: brands.businessName,
              ownerId: brands.ownerId,
              ownerEmail: users.email,
              isBeta: users.isBetaUser,
              reviewCount: sql<number>`count(${reviewSubmissions.id})`,
            })
            .from(reviewLocations)
            .leftJoin(brands, eq(brands.id, reviewLocations.brandId))
            .leftJoin(users, eq(users.id, brands.ownerId))
            .leftJoin(reviewSubmissions, eq(reviewSubmissions.locationId, reviewLocations.id))
            .groupBy(
              reviewLocations.brandId,
              brands.businessName,
              brands.ownerId,
              users.email,
              users.isBetaUser,
            ),
          subscribedReviewsOwnerIds(ctx.db),
        ]);

      const nearEndFrom = Math.max(0, REVIEWS_FREE_TRIAL - 2); // 8+/10 used
      const rows = perBrand.map((b) => ({
        ...b,
        reviewCount: Number(b.reviewCount ?? 0),
        subscribed: !!b.ownerId && subscribedOwners.has(b.ownerId),
        entitled: (!!b.ownerId && subscribedOwners.has(b.ownerId)) || !!b.isBeta,
      }));
      const trialNearEnd = rows
        .filter(
          (b) =>
            !b.entitled &&
            b.reviewCount >= nearEndFrom &&
            b.reviewCount < REVIEWS_FREE_TRIAL,
        )
        .sort((a, b) => b.reviewCount - a.reviewCount)
        .map((b) => ({
          brandId: b.brandId,
          brandName: b.brandName ?? '(unknown)',
          ownerEmail: b.ownerEmail,
          trialUsed: b.reviewCount,
          trialLimit: REVIEWS_FREE_TRIAL,
        }));
      return {
        totalBrands: rows.length,
        totalLocations: Number(totalLocations ?? 0),
        totalReviews: Number(totalReviews ?? 0),
        subscribedBrands: rows.filter((b) => b.subscribed).length,
        trialBrands: rows.filter((b) => !b.entitled && b.reviewCount < REVIEWS_FREE_TRIAL)
          .length,
        trialNearlyExhausted: trialNearEnd.length,
        trialNearEnd,
      };
    }),

    brands: superAdminProcedure.query(async ({ ctx }) => {
      const [rows, subscribedOwners] = await Promise.all([
        ctx.db
          .select({
            brandId: reviewLocations.brandId,
            brandName: brands.businessName,
            ownerId: brands.ownerId,
            ownerEmail: users.email,
            ownerFirstName: users.firstName,
            ownerLastName: users.lastName,
            isBeta: users.isBetaUser,
            locationCount: sql<number>`count(distinct ${reviewLocations.id})`,
            reviewCount: sql<number>`count(${reviewSubmissions.id})`,
          })
          .from(reviewLocations)
          .leftJoin(brands, eq(brands.id, reviewLocations.brandId))
          .leftJoin(users, eq(users.id, brands.ownerId))
          .leftJoin(reviewSubmissions, eq(reviewSubmissions.locationId, reviewLocations.id))
          .where(isNull(reviewLocations.deletedAt))
          .groupBy(
            reviewLocations.brandId,
            brands.businessName,
            brands.ownerId,
            users.email,
            users.firstName,
            users.lastName,
            users.isBetaUser,
          )
          .orderBy(desc(sql`count(${reviewSubmissions.id})`)),
        subscribedReviewsOwnerIds(ctx.db),
      ]);
      return rows.map((r) => {
        const reviewCount = Number(r.reviewCount ?? 0);
        const subscribed = !!r.ownerId && subscribedOwners.has(r.ownerId);
        const status: 'subscribed' | 'beta' | 'trial' | 'trial_exhausted' = subscribed
          ? 'subscribed'
          : r.isBeta
            ? 'beta'
            : reviewCount < REVIEWS_FREE_TRIAL
              ? 'trial'
              : 'trial_exhausted';
        return {
          brandId: r.brandId,
          brandName: r.brandName ?? '(unknown)',
          ownerEmail: r.ownerEmail,
          ownerName:
            [r.ownerFirstName, r.ownerLastName].filter(Boolean).join(' ') || null,
          locationCount: Number(r.locationCount ?? 0),
          reviewCount,
          status,
        };
      });
    }),

    brandDetail: superAdminProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [brand] = await ctx.db
          .select({
            id: brands.id,
            businessName: brands.businessName,
            ownerId: brands.ownerId,
            createdAt: brands.createdAt,
            ownerEmail: users.email,
            ownerFirstName: users.firstName,
            ownerLastName: users.lastName,
          })
          .from(brands)
          .leftJoin(users, eq(users.id, brands.ownerId))
          .where(eq(brands.id, input.brandId))
          .limit(1);
        if (!brand) throw new TRPCError({ code: 'NOT_FOUND' });

        const [staffRows, locationRows, entitlement] = await Promise.all([
          ctx.db
            .select({
              id: staff.id,
              email: staff.email,
              displayName: staff.displayName,
              status: staff.status,
              permissions: staff.permissions,
              userEmail: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
            })
            .from(staff)
            .leftJoin(users, eq(users.id, staff.userId))
            .where(eq(staff.brandId, input.brandId))
            .orderBy(staff.createdAt),
          ctx.db
            .select({
              id: reviewLocations.id,
              name: reviewLocations.name,
              slug: reviewLocations.slug,
              industry: reviewLocations.industry,
              deletedAt: reviewLocations.deletedAt,
              createdAt: reviewLocations.createdAt,
              reviewCount: sql<number>`count(${reviewSubmissions.id})`,
            })
            .from(reviewLocations)
            .leftJoin(reviewSubmissions, eq(reviewSubmissions.locationId, reviewLocations.id))
            .where(eq(reviewLocations.brandId, input.brandId))
            .groupBy(reviewLocations.id)
            .orderBy(desc(reviewLocations.createdAt)),
          reviewsEntitlement(ctx.db, input.brandId),
        ]);

        const ownerName =
          [brand.ownerFirstName, brand.ownerLastName].filter(Boolean).join(' ') || null;
        const members = [
          {
            key: `owner-${brand.ownerId}`,
            name: ownerName,
            email: brand.ownerEmail,
            role: 'owner' as const,
            status: 'accepted' as string,
          },
          ...staffRows.map((s) => ({
            key: s.id,
            name:
              [s.firstName, s.lastName].filter(Boolean).join(' ') ||
              s.displayName ||
              null,
            email: s.userEmail ?? s.email,
            role: s.permissions.includes('reviews')
              ? ('editor' as const)
              : s.permissions.includes('reviewsViewer')
                ? ('viewer' as const)
                : ('staff' as const),
            status: s.status as string,
          })),
        ];
        const locations = locationRows.map((l) => ({
          ...l,
          reviewCount: Number(l.reviewCount ?? 0),
        }));
        return {
          brand: {
            id: brand.id,
            businessName: brand.businessName,
            ownerEmail: brand.ownerEmail,
            ownerName,
            createdAt: brand.createdAt,
          },
          members,
          locations,
          totalReviews: locations.reduce((n, l) => n + l.reviewCount, 0),
          entitlement,
        };
      }),

    brandActivity: superAdminProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      )
      .query(async ({ ctx, input }) => {
        const [reviewRows, auditRows] = await Promise.all([
          ctx.db
            .select({
              id: reviewSubmissions.id,
              stars: reviewSubmissions.stars,
              submissionType: reviewSubmissions.submissionType,
              platform: reviewSubmissions.platformClicked,
              createdAt: reviewSubmissions.createdAt,
              locationName: reviewLocations.name,
            })
            .from(reviewSubmissions)
            .innerJoin(reviewLocations, eq(reviewSubmissions.locationId, reviewLocations.id))
            .where(eq(reviewLocations.brandId, input.brandId))
            .orderBy(desc(reviewSubmissions.createdAt))
            .limit(input.limit),
          ctx.db
            .select({
              id: reviewAdminAudit.id,
              action: reviewAdminAudit.action,
              targetType: reviewAdminAudit.targetType,
              targetId: reviewAdminAudit.targetId,
              meta: reviewAdminAudit.meta,
              createdAt: reviewAdminAudit.createdAt,
              actorEmail: users.email,
              actorFirstName: users.firstName,
              actorLastName: users.lastName,
            })
            .from(reviewAdminAudit)
            .leftJoin(users, eq(users.id, reviewAdminAudit.actorUserId))
            .where(
              or(
                and(
                  eq(reviewAdminAudit.targetType, 'brand'),
                  eq(reviewAdminAudit.targetId, input.brandId),
                ),
                sql`${reviewAdminAudit.meta} ->> 'brandId' = ${input.brandId}`,
              ),
            )
            .orderBy(desc(reviewAdminAudit.createdAt))
            .limit(input.limit),
        ]);
        const events = [
          ...reviewRows.map((r) => ({
            type: 'review' as const,
            id: r.id,
            createdAt: r.createdAt,
            stars: r.stars,
            submissionType: r.submissionType,
            platform: r.platform,
            locationName: r.locationName,
          })),
          ...auditRows.map((a) => ({
            type: 'admin' as const,
            id: a.id,
            createdAt: a.createdAt,
            action: a.action,
            targetType: a.targetType,
            targetId: a.targetId,
            meta: a.meta,
            actorName:
              [a.actorFirstName, a.actorLastName].filter(Boolean).join(' ') || null,
            actorEmail: a.actorEmail,
          })),
        ];
        events.sort(
          (x, y) => (y.createdAt?.getTime() ?? 0) - (x.createdAt?.getTime() ?? 0),
        );
        return events.slice(0, input.limit);
      }),

    recentReviews: superAdminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
      .query(async ({ ctx, input }) => {
        return ctx.db
          .select({
            id: reviewSubmissions.id,
            stars: reviewSubmissions.stars,
            submissionType: reviewSubmissions.submissionType,
            platform: reviewSubmissions.platformClicked,
            createdAt: reviewSubmissions.createdAt,
            locationName: reviewLocations.name,
            brandId: reviewLocations.brandId,
            brandName: brands.businessName,
          })
          .from(reviewSubmissions)
          .innerJoin(reviewLocations, eq(reviewSubmissions.locationId, reviewLocations.id))
          .leftJoin(brands, eq(reviewLocations.brandId, brands.id))
          .orderBy(desc(reviewSubmissions.createdAt))
          .limit(input?.limit ?? 25);
      }),

    listIndustries: superAdminProcedure.query(async ({ ctx }) => {
      return ctx.db
        .select()
        .from(reviewIndustries)
        .orderBy(reviewIndustries.sortOrder, reviewIndustries.id);
    }),

    upsertIndustry: superAdminProcedure
      .input(
        z.object({
          slug: z.string().min(1).max(64),
          label: z.string().min(1).max(120),
          description: z.string().max(500).optional(),
          isActive: z.boolean().optional(),
          sortOrder: z.number().int().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .insert(reviewIndustries)
          .values({
            slug: input.slug,
            label: input.label,
            description: input.description ?? null,
            isActive: input.isActive ?? true,
            sortOrder: input.sortOrder ?? 0,
          })
          .onConflictDoUpdate({
            target: reviewIndustries.slug,
            set: {
              label: input.label,
              description: input.description ?? null,
              isActive: input.isActive ?? true,
              sortOrder: input.sortOrder ?? 0,
            },
          });
        await logAdminAction(ctx.db, {
          actorUserId: ctx.user.id,
          action: 'upsert_industry',
          targetType: 'industry',
          targetId: input.slug,
          meta: { label: input.label },
        });
        return { ok: true };
      }),

    archiveIndustry: superAdminProcedure
      .input(z.object({ slug: z.string(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .update(reviewIndustries)
          .set({ isActive: input.isActive })
          .where(eq(reviewIndustries.slug, input.slug));
        await logAdminAction(ctx.db, {
          actorUserId: ctx.user.id,
          action: input.isActive ? 'unarchive_industry' : 'archive_industry',
          targetType: 'industry',
          targetId: input.slug,
        });
        return { ok: true };
      }),

    getTagPresets: superAdminProcedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select()
          .from(reviewTagPresets)
          .where(eq(reviewTagPresets.industrySlug, input.slug))
          .orderBy(reviewTagPresets.sortOrder, reviewTagPresets.id);
        return rows.map((r) => r.tag);
      }),

    setTagPresets: superAdminProcedure
      .input(z.object({ slug: z.string(), tags: z.array(z.string().min(1).max(120)) }))
      .mutation(async ({ ctx, input }) => {
        await ctx.db
          .delete(reviewTagPresets)
          .where(eq(reviewTagPresets.industrySlug, input.slug));
        if (input.tags.length > 0) {
          await ctx.db.insert(reviewTagPresets).values(
            input.tags.map((tag, i) => ({ industrySlug: input.slug, tag, sortOrder: i })),
          );
        }
        await logAdminAction(ctx.db, {
          actorUserId: ctx.user.id,
          action: 'set_tag_presets',
          targetType: 'industry',
          targetId: input.slug,
          meta: { count: input.tags.length },
        });
        return { ok: true };
      }),

    forceDeleteLocation: superAdminProcedure
      .input(z.object({ locationId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [loc] = await ctx.db
          .select({
            id: reviewLocations.id,
            name: reviewLocations.name,
            brandId: reviewLocations.brandId,
          })
          .from(reviewLocations)
          .where(eq(reviewLocations.id, input.locationId))
          .limit(1);
        if (!loc) throw new TRPCError({ code: 'NOT_FOUND' });
        await ctx.db.delete(reviewLocations).where(eq(reviewLocations.id, input.locationId));
        await logAdminAction(ctx.db, {
          actorUserId: ctx.user.id,
          action: 'force_delete_location',
          targetType: 'location',
          targetId: loc.id,
          meta: { brandId: loc.brandId, name: loc.name },
        });
        return { ok: true };
      }),

    listClaimedRewards: superAdminProcedure.query(async ({ ctx }) => {
      const rows = await ctx.db
        .select({
          id: reviewMilestoneRewards.id,
          brandId: reviewMilestoneRewards.brandId,
          brandName: brands.businessName,
          kind: reviewMilestoneRewards.kind,
          status: reviewMilestoneRewards.status,
          address: reviewMilestoneRewards.shippingAddress,
          claimedAt: reviewMilestoneRewards.claimedAt,
          shippedAt: reviewMilestoneRewards.shippedAt,
          deliveredAt: reviewMilestoneRewards.deliveredAt,
          trackingNumber: reviewMilestoneRewards.trackingNumber,
        })
        .from(reviewMilestoneRewards)
        .innerJoin(brands, eq(reviewMilestoneRewards.brandId, brands.id))
        .where(inArray(reviewMilestoneRewards.status, ['claimed', 'shipped', 'delivered']))
        .orderBy(desc(reviewMilestoneRewards.claimedAt))
        .limit(100);

      // Attach each brand's review volume + average rating, for context when
      // fulfilling (a gold plaque is a 1,000-review milestone — worth seeing).
      return Promise.all(
        rows.map(async (r) => {
          const locIds = await brandLocationIds(ctx.db, r.brandId);
          let reviewCount = 0;
          let avgRating: number | null = null;
          if (locIds.length > 0) {
            const [agg] = await ctx.db
              .select({
                c: sql<number>`count(*)`,
                avg: sql<number | null>`avg(${reviewSubmissions.stars})`,
              })
              .from(reviewSubmissions)
              .where(inArray(reviewSubmissions.locationId, locIds));
            reviewCount = Number(agg?.c ?? 0);
            avgRating = agg?.avg != null ? Number(agg.avg) : null;
          }
          return { ...r, reviewCount, avgRating };
        }),
      );
    }),

    markRewardShipped: superAdminProcedure
      .input(
        z.object({
          rewardId: z.string().uuid(),
          trackingNumber: z.string().max(255).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [reward] = await ctx.db
          .select()
          .from(reviewMilestoneRewards)
          .where(eq(reviewMilestoneRewards.id, input.rewardId))
          .limit(1);
        if (!reward) throw new TRPCError({ code: 'NOT_FOUND' });
        if (reward.status !== 'claimed') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Reward must be in 'claimed' state to ship.",
          });
        }
        await ctx.db
          .update(reviewMilestoneRewards)
          .set({
            status: 'shipped',
            shippedAt: new Date(),
            trackingNumber: input.trackingNumber ?? null,
          })
          .where(eq(reviewMilestoneRewards.id, reward.id));
        await logAdminAction(ctx.db, {
          actorUserId: ctx.user.id,
          action: 'mark_reward_shipped',
          targetType: 'reward',
          targetId: reward.id,
          meta: {
            brandId: reward.brandId,
            kind: reward.kind,
            trackingNumber: input.trackingNumber ?? null,
          },
        });
        return { ok: true };
      }),

    markRewardDelivered: superAdminProcedure
      .input(z.object({ rewardId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [reward] = await ctx.db
          .select()
          .from(reviewMilestoneRewards)
          .where(eq(reviewMilestoneRewards.id, input.rewardId))
          .limit(1);
        if (!reward) throw new TRPCError({ code: 'NOT_FOUND' });
        if (reward.status !== 'shipped') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: "Reward must be in 'shipped' state to mark delivered.",
          });
        }
        await ctx.db
          .update(reviewMilestoneRewards)
          .set({ status: 'delivered', deliveredAt: new Date() })
          .where(eq(reviewMilestoneRewards.id, reward.id));
        await logAdminAction(ctx.db, {
          actorUserId: ctx.user.id,
          action: 'mark_reward_delivered',
          targetType: 'reward',
          targetId: reward.id,
          meta: { brandId: reward.brandId, kind: reward.kind },
        });
        return { ok: true };
      }),

    auditLog: superAdminProcedure
      .input(
        z.object({ limit: z.number().int().min(1).max(500).default(200) }).optional(),
      )
      .query(async ({ ctx, input }) => {
        const rows = await ctx.db
          .select({
            id: reviewAdminAudit.id,
            action: reviewAdminAudit.action,
            targetType: reviewAdminAudit.targetType,
            targetId: reviewAdminAudit.targetId,
            meta: reviewAdminAudit.meta,
            createdAt: reviewAdminAudit.createdAt,
            actorEmail: users.email,
            actorFirstName: users.firstName,
            actorLastName: users.lastName,
          })
          .from(reviewAdminAudit)
          .leftJoin(users, eq(users.id, reviewAdminAudit.actorUserId))
          .orderBy(desc(reviewAdminAudit.createdAt))
          .limit(input?.limit ?? 200);
        return rows.map((r) => ({
          ...r,
          actorName:
            [r.actorFirstName, r.actorLastName].filter(Boolean).join(' ') || null,
        }));
      }),
  }),
});

// ─── Internal helpers (kept below the router for readability) ────────────────

async function assertLocationsOwnedByBrand(
  ctx: Context,
  brandId: string,
  locationIds: string[],
) {
  const owned = await ctx.db
    .select({ id: reviewLocations.id })
    .from(reviewLocations)
    .where(eq(reviewLocations.brandId, brandId));
  const ownedIds = new Set(owned.map((l) => l.id));
  for (const id of locationIds) {
    if (!ownedIds.has(id)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Location does not belong to this brand.',
      });
    }
  }
}

async function setCollectionLocations(
  ctx: Context,
  collectionId: string,
  locationIds: string[],
) {
  await ctx.db
    .delete(reviewEmbedCollectionLocations)
    .where(eq(reviewEmbedCollectionLocations.collectionId, collectionId));
  if (locationIds.length > 0) {
    await ctx.db.insert(reviewEmbedCollectionLocations).values(
      locationIds.map((locationId, i) => ({ collectionId, locationId, sortOrder: i })),
    );
  }
}

async function ensureReward(
  ctx: Context,
  brandId: string,
  kind: 'sticker_pack' | 'gold_plaque' | 'platinum_plaque',
  locationId?: string,
) {
  const conds = [
    eq(reviewMilestoneRewards.brandId, brandId),
    eq(reviewMilestoneRewards.kind, kind),
  ];
  if (locationId) conds.push(eq(reviewMilestoneRewards.locationId, locationId));
  const [existing] = await ctx.db
    .select({ id: reviewMilestoneRewards.id })
    .from(reviewMilestoneRewards)
    .where(and(...conds))
    .limit(1);
  if (existing) return;
  await ctx.db
    .insert(reviewMilestoneRewards)
    .values({ brandId, kind, locationId: locationId ?? null, status: 'unlocked' });
}

async function getOrCreateReferralCode(ctx: Context, userId: string) {
  const [existing] = await ctx.db
    .select()
    .from(reviewReferralCodes)
    .where(eq(reviewReferralCodes.ownerUserId, userId))
    .limit(1);
  if (existing) return existing;
  for (let i = 0; i < 5; i++) {
    try {
      const [row] = await ctx.db
        .insert(reviewReferralCodes)
        .values({ ownerUserId: userId, code: makeReferralCode() })
        .returning();
      if (row) return row;
    } catch {
      // collision → retry
    }
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not allocate referral code' });
}
