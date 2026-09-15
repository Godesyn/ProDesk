/**
 * Document Locker backfill for SATELLITE-APP uploads.
 *
 * The forward-going hooks (signatures.upload.file, payments.accounts.
 * recordAssetUpload, reviews.locations.update, support.create/reply) only fire
 * for uploads made after they shipped, so without this pass a brand's existing
 * signature logos, proposal brand assets, review-page logos and support
 * attachments stay invisible in the locker.
 *
 * It lives here rather than in a one-shot script because it runs on EVERY server
 * boot as an initialization step (scripts/initialize-core.ts) — that makes it
 * self-healing: any file a hook missed (a transient failure, a flow that shipped
 * before its hook, a restored database) is picked up on the next deploy without
 * anyone remembering to run anything.
 *
 * Sources covered (the Prodesk-core ones — chat, brand logos, deliverables, Info
 * Hub, proposals, briefs, questionnaires — have their own hooks and are not
 * re-derived here):
 *   - brand_kits                    → signature bar / powered-by logos + logo slots
 *   - signature_campaign_banners    → campaign banner images
 *   - payment_brand_kits            → proposal logos, favicon, hero image, font
 *   - review_locations.logo_url     → Verdiict review-page logos
 *   - support_tickets / _comments   → ticket attachments (Private Documents)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IDEMPOTENCY — this must be safe on every boot, twice over:
 *   1. `files_source_uniq` blocks a repeat insert of the same (sourceType, sourceId).
 *   2. The reconcile step drops any URL the brand ALREADY has a locker row for,
 *      whatever put it there. This guard is load-bearing, not belt-and-braces:
 *      the forward hooks key asset rows on the STORAGE KEY while this pass only
 *      knows the URL, so #1 alone would not catch the overlap and a boot after a
 *      live upload would produce a second tile for one file.
 * Insert-only like every locker source (see ./record.ts): a row the brand deleted
 * locally is never resurrected, and nothing here ever touches the source record.
 *
 * COST — every source table scanned here is small (one row per brand, or bounded
 * by campaign/location count). The one unbounded table, support_tickets, is
 * filtered in SQL to rows that actually carry attachments, and its comments are
 * fetched only for those tickets. Keep it that way if you add a source.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import {
  brandKits,
  files,
  paymentBrandKits,
  reviewLocations,
  signatureCampaignBanners,
  signatureCampaigns,
  supportTicketComments,
  supportTickets,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import {
  fileNameFromUrl,
  fileTypeFromName,
  recordLockerFiles,
  type LockerFileInput,
} from './record.js';

/**
 * `init_task_runs` key for this backfill. Bump the version suffix when you add a
 * source here — that makes the pass run again on the next boot to pick up the
 * newly covered files, while databases already done with the old key stay put.
 */
export const LOCKER_APP_UPLOAD_BACKFILL_KEY = 'locker:app-upload-backfill:v1';

/** Keep only real hosted URLs — `data:` URIs and blanks are not documents. */
function isHosted(url: unknown): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/** A brand-owned Public Brand Assets row (mirrors `recordBrandAsset`). */
function brandAsset(
  input: Pick<
    LockerFileInput,
    'brandId' | 'url' | 'name' | 'category' | 'note' | 'sourceType' | 'sourceId'
  >,
): LockerFileInput {
  return {
    ...input,
    type: fileTypeFromName(input.name || input.url),
    source: 'brand',
    isPublic: true,
    isPrivate: false,
  };
}

async function collectSignatureAssets(db: DB): Promise<LockerFileInput[]> {
  const out: LockerFileInput[] = [];
  const kits = await db
    .select({
      brandId: brandKits.brandId,
      barLogoUrl: brandKits.barLogoUrl,
      poweredByLogoUrl: brandKits.poweredByLogoUrl,
      logoSlots: brandKits.logoSlots,
    })
    .from(brandKits);
  for (const kit of kits) {
    const named: [string | null, string][] = [
      [kit.barLogoUrl, 'signature bar logo'],
      [kit.poweredByLogoUrl, 'signature powered-by logo'],
      ...(kit.logoSlots ?? []).map((sl) => [sl.url, `${sl.slot} logo`] as [string | null, string]),
    ];
    for (const [url, label] of named) {
      if (!isHosted(url)) continue;
      out.push(
        brandAsset({
          brandId: kit.brandId,
          url,
          name: fileNameFromUrl(url, label),
          category: 'signature',
          note: `Uploaded as a ${label}`,
          sourceType: 'signatureAsset',
          sourceId: url,
        }),
      );
    }
  }

  // Campaign banners live one join away (banner → campaign → brand).
  const banners = await db
    .select({
      brandId: signatureCampaigns.brandId,
      campaignName: signatureCampaigns.name,
      imageKey: signatureCampaignBanners.imageKey,
      imageUrl: signatureCampaignBanners.imageUrl,
    })
    .from(signatureCampaignBanners)
    .innerJoin(signatureCampaigns, eq(signatureCampaignBanners.campaignId, signatureCampaigns.id));
  for (const b of banners) {
    if (!b.brandId || !isHosted(b.imageUrl)) continue;
    out.push(
      brandAsset({
        brandId: b.brandId,
        url: b.imageUrl,
        name: fileNameFromUrl(b.imageUrl, 'Campaign banner'),
        category: 'signature',
        note: `Uploaded as a signature campaign banner${b.campaignName ? ` for ${b.campaignName}` : ''}`,
        sourceType: 'signatureAsset',
        sourceId: b.imageKey || b.imageUrl,
      }),
    );
  }
  return out;
}

async function collectPaymentsAssets(db: DB): Promise<LockerFileInput[]> {
  const out: LockerFileInput[] = [];
  const kits = await db
    .select({
      brandId: paymentBrandKits.brandId,
      logoLightUrl: paymentBrandKits.logoLightUrl,
      logoDarkUrl: paymentBrandKits.logoDarkUrl,
      brandLogoUrl: paymentBrandKits.brandLogoUrl,
      faviconUrl: paymentBrandKits.faviconUrl,
      customFontUrl: paymentBrandKits.customFontUrl,
      heroImageUrl: paymentBrandKits.heroImageUrl,
    })
    .from(paymentBrandKits);
  for (const kit of kits) {
    const named: [string | null, string][] = [
      [kit.logoLightUrl, 'light-background logo'],
      [kit.logoDarkUrl, 'dark-background logo'],
      [kit.brandLogoUrl, 'brand logo'],
      [kit.faviconUrl, 'favicon'],
      [kit.customFontUrl, 'brand font'],
      [kit.heroImageUrl, 'hero image'],
    ];
    for (const [url, label] of named) {
      if (!isHosted(url)) continue;
      out.push(
        brandAsset({
          brandId: kit.brandId,
          url,
          name: fileNameFromUrl(url, label),
          category: 'payments',
          note: `Uploaded as a proposal ${label}`,
          sourceType: 'paymentsAsset',
          sourceId: url,
        }),
      );
    }
  }
  return out;
}

async function collectReviewLogos(db: DB): Promise<LockerFileInput[]> {
  const locs = await db
    .select({
      id: reviewLocations.id,
      brandId: reviewLocations.brandId,
      name: reviewLocations.name,
      logoUrl: reviewLocations.logoUrl,
    })
    .from(reviewLocations)
    .where(isNotNull(reviewLocations.logoUrl));
  return locs
    .filter((l) => isHosted(l.logoUrl))
    .map((l) =>
      brandAsset({
        brandId: l.brandId,
        url: l.logoUrl!,
        name: fileNameFromUrl(l.logoUrl!, 'Review page logo'),
        category: 'reviews',
        note: `Uploaded as the review page logo for ${l.name}`,
        sourceType: 'reviewsLogo',
        sourceId: `${l.id}:${l.logoUrl}`,
      }),
    );
}

/** `jsonb_array_length(coalesce(col,'[]')) > 0` — old rows may hold NULL. */
function hasAttachments(col: typeof supportTickets.attachments | typeof supportTicketComments.attachments) {
  return sql`jsonb_array_length(coalesce(${col}, '[]'::jsonb)) > 0`;
}

async function collectSupportAttachments(db: DB): Promise<LockerFileInput[]> {
  const out: LockerFileInput[] = [];

  // Customer replies that carry files. Fetched FIRST because a ticket may have
  // been opened with no attachment and only picked one up on a later reply — so
  // the ticket set below cannot be derived from ticket-level attachments alone.
  // Only the customer's own uploads belong in their locker; support-side
  // attachments are the platform's, not the brand's.
  const comments = await db
    .select({
      id: supportTicketComments.id,
      ticketId: supportTicketComments.ticketId,
      authorUserId: supportTicketComments.authorUserId,
      attachments: supportTicketComments.attachments,
    })
    .from(supportTicketComments)
    .where(
      and(
        eq(supportTicketComments.authorRole, 'customer'),
        hasAttachments(supportTicketComments.attachments),
      ),
    );
  const commentTicketIds = [...new Set(comments.map((c) => c.ticketId))];

  // Their parent tickets, plus every brand-scoped ticket whose OPENING message
  // carried files. These are the two unbounded source tables, so both filters
  // stay in SQL rather than scanning everything into JS.
  const tickets = await db
    .select({
      id: supportTickets.id,
      brandId: supportTickets.brandId,
      ticketNumber: supportTickets.ticketNumber,
      userId: supportTickets.userId,
      attachments: supportTickets.attachments,
    })
    .from(supportTickets)
    .where(
      and(
        isNotNull(supportTickets.brandId),
        commentTicketIds.length
          ? or(
              hasAttachments(supportTickets.attachments),
              inArray(supportTickets.id, commentTicketIds),
            )
          : hasAttachments(supportTickets.attachments),
      ),
    );

  type Ticket = (typeof tickets)[number];
  const byTicket = new Map<string, Ticket>(tickets.map((t) => [t.id, t]));

  const push = (
    ticket: Ticket,
    scopeId: string,
    authorUserId: string | null,
    attachments: unknown,
  ) => {
    for (const a of Array.isArray(attachments) ? attachments : []) {
      const att = a as { url?: unknown; name?: unknown; size?: unknown };
      if (!isHosted(att.url)) continue;
      const name =
        typeof att.name === 'string' && att.name ? att.name : fileNameFromUrl(att.url, 'Attachment');
      out.push({
        brandId: ticket.brandId!,
        url: att.url,
        name,
        uploadedBy: authorUserId ?? ticket.userId,
        size: typeof att.size === 'number' ? att.size : null,
        type: fileTypeFromName(name),
        category: 'support',
        source: 'brand',
        note: `Attached to support ticket #${ticket.ticketNumber}`,
        isPrivate: true,
        sourceType: 'support',
        sourceId: `${scopeId}:${att.url}`,
      });
    }
  };

  for (const t of tickets) push(t, t.id, t.userId, t.attachments);
  for (const c of comments) {
    // A comment whose ticket isn't in the map has no brand — nothing to file.
    const ticket = byTicket.get(c.ticketId);
    if (ticket) push(ticket, c.id, c.authorUserId, c.attachments);
  }
  return out;
}

export interface LockerBackfillResult {
  /** Every mirrorable file found across the satellite sources. */
  candidates: number;
  /** Rows handed to `recordLockerFiles` (already-present URLs excluded). */
  inserted: number;
  /** Candidates the brand already had a locker row for. */
  skipped: number;
  /** Distinct brands touched. */
  brands: number;
  /** Per-source candidate counts, for the log line. */
  bySource: Record<string, number>;
}

/**
 * Mirror every existing satellite-app upload into its brand's locker. Idempotent
 * and insert-only — see the header. Returns a summary; callers decide whether to
 * log it (the boot path stays quiet when there is nothing to do).
 */
export async function backfillAppUploadLocker(db: DB): Promise<LockerBackfillResult> {
  const [signature, payments, reviews, support] = await Promise.all([
    collectSignatureAssets(db),
    collectPaymentsAssets(db),
    collectReviewLogos(db),
    collectSupportAttachments(db),
  ]);
  const bySource = {
    signatures: signature.length,
    payments: payments.length,
    reviews: reviews.length,
    support: support.length,
  };
  const candidates = [...signature, ...payments, ...reviews, ...support];
  const brandIds = [...new Set(candidates.map((c) => c.brandId))];
  const empty: LockerBackfillResult = {
    candidates: candidates.length,
    inserted: 0,
    skipped: 0,
    brands: brandIds.length,
    bySource,
  };
  if (!candidates.length) return empty;

  // Reconcile against what the locker already holds for these brands (guard #2
  // in the header — the key-vs-URL mismatch means the unique index isn't enough).
  //
  // DO NOT add `isNull(files.deletedAt)` here. Every other files query filters
  // soft-deleted rows, so this looks like an oversight — it is not. A file the
  // brand DELETED must still count as present, or this pass would resurrect it on
  // the very next boot. Deleted stays deleted: that is the locker's contract.
  const existing = new Set<string>();
  for (let i = 0; i < brandIds.length; i += 500) {
    const rows = await db
      .select({ brandId: files.brandId, url: files.url })
      .from(files)
      .where(inArray(files.brandId, brandIds.slice(i, i + 500)));
    for (const r of rows) existing.add(`${r.brandId} ${r.url}`);
  }

  const fresh = candidates.filter((c) => !existing.has(`${c.brandId} ${c.url}`));
  if (fresh.length) await recordLockerFiles(db, fresh);
  return {
    ...empty,
    inserted: fresh.length,
    skipped: candidates.length - fresh.length,
    brands: new Set(fresh.map((f) => f.brandId)).size,
  };
}
