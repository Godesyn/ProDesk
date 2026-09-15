/**
 * Payments (EziQuotes) — proposals router, ported 1:1 from the Manus export's
 * server/routers/proposals.ts (the heart of the app). Changes are limited to
 * the migration rules:
 *  - tenancy: accountId (int) → brandId (uuid); Manus getAccountForUser →
 *    brandId input (list/create/aiDraft) or entity-row resolution (id-based
 *    procedures) + requirePaymentRead/Write gates.
 *  - links: process.env.APP_ORIGIN / input.origin → emailBaseUrl(ctx.clientOrigin).
 *  - Stripe: shared singleton client (modules/stripe/client).
 *  - AI: Manus invokeLLM → anthropic() messages (modules/ai/client).
 *  - Manus notifyOwner → email to the payment account's email address.
 *  - signed-PDF storage: Manus storagePut → Supabase Storage ('brand-files').
 */
import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  paymentProposalQuestions,
  paymentProposalRevisions,
  proposals,
  purchaseItems,
  purchases,
} from '../../db/schema.js';
import { fulfillPurchase } from '../../modules/billing/fulfillment.js';
type ProposalCurrency = (typeof proposals.$inferSelect)['currency'];
import { protectedProcedure, publicProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  createProposal,
  deleteProposal,
  getBrandKit,
  getClientById,
  getPaymentAccount,
  getBrandLegalName,
  getProposalById,
  getProposalBySlug,
  listProposals,
  logActivity,
  updateProposal,
} from '../../modules/payments/db.js';
import { resolveFeeForProposal } from '../../modules/payments/fee-calc.js';
import {
  resolveMergeFields,
  resolveStructureMergeFields,
  type MergeFieldContext,
} from '../../modules/payments/merge-fields.js';
import { sendEmail, buildProposalDeliveryEmail } from '../../modules/payments/email.js';
import { sendSms, buildProposalSmsBody } from '../../modules/payments/sms.js';
import { calculateTaxBreakdown, getAudToRate } from '../../modules/payments/fx.js';
import { emailBaseUrl } from '../../modules/email/branding.js';
import { stripe, stripeEnabled } from '../../modules/stripe/client.js';
import { completeOnce } from '../../modules/ai/provider-config.js';

const lineItemSchema = z.object({
  id: z.string(),
  type: z.enum(['product', 'addon', 'custom', 'break']),
  name: z.string(),
  description: z.string().optional(),
  quantity: z.number().min(0).default(1),
  unitPriceCents: z.number().min(0).default(0),
  taxBehaviour: z.enum(['inclusive', 'exclusive', 'exempt']).default('inclusive'),
  taxRate: z.number().min(0).max(100).optional(), // per-line override, e.g. 10 for 10%
  productId: z.string().uuid().optional(),
  addonId: z.string().uuid().optional(),
  sortOrder: z.number().default(0),
  breakLabel: z.string().optional(),
  // Builder flags (PHASE2-24 to 29)
  optional: z.boolean().optional(),
  locked: z.boolean().optional(),
  categoryCode: z.string().optional(),
  categoryId: z.string().uuid().optional(),
});

const proposalStructureSchema = z.object({
  lineItems: z.array(lineItemSchema).default([]),
  sections: z
    .array(z.object({ id: z.string(), label: z.string(), sortOrder: z.number() }))
    .default([]),
  introCopy: z.string().optional(),
  nextStepsCopy: z.string().optional(),
  showTerms: z.boolean().default(false),
  termsUrl: z.string().optional(),
  heroImageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  // WYSIWYG canvas blocks — MUST be preserved so ProposalPublic can render them (ITEM-9 root cause fix)
  blocks: z.array(z.any()).optional(),
  // Content overrides for per-proposal text edits (FU-3)
  contentOverrides: z.record(z.string(), z.any()).optional(),
});

/** URL-safe random slug — replaces the export's nanoid(12) (same alphabet class). */
function makeSlug(): string {
  return randomBytes(9).toString('base64url'); // 12 chars, [A-Za-z0-9_-]
}

/** Load a proposal row by id (tenancy checked by the caller via row.brandId). */
async function getProposalRow(id: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, id), eq(proposals.kind, 'payer')))
    .limit(1);
  // Expose the payments-facing `clientId` alias (= recipientContactId) and
  // narrow the vendor `brandId` to non-null (payer proposals always set it) so
  // the ported router body reads unchanged.
  return row ? { ...row, clientId: row.recipientContactId, brandId: row.brandId as string } : undefined;
}

/** Extract a JSON payload from a model reply (tolerates ```json fences). */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

// ---- Win Score computation ----
function computeWinScore(viewCount: number, maxScrollDepth: number, status: string): number {
  // Base score from engagement signals
  let score = 0;
  // Views: 0-25 pts (diminishing returns after 3 views)
  score += Math.min(viewCount, 3) * 8 + (viewCount > 3 ? Math.min(viewCount - 3, 5) : 0);
  // Scroll depth: 0-40 pts
  score += Math.round(maxScrollDepth * 0.4);
  // Status bonuses
  if (status === 'engaged') score += 15;
  if (status === 'accepted' || status === 'paid' || status === 'active') score = 100;
  if (status === 'expired' || status === 'withdrawn' || status === 'cancelled')
    score = Math.min(score, 30);
  return Math.min(Math.max(score, 0), 100);
}

export const proposalsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        status: z.string().optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      return listProposals(input.brandId, input);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.id);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentRead(ctx, proposal.brandId);
      return proposal;
    }),

  create: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        title: z.string().optional(),
        templateId: z.string().uuid().optional(),
        builderMode: z.enum(['standard', 'quick']).default('standard'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const client = await getClientById(input.clientId, input.brandId);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Payer not found' });
      const slug = makeSlug();
      const feeResolution = await resolveFeeForProposal(input.brandId);
      const id = await createProposal({
        brandId: input.brandId,
        clientId: input.clientId,
        title: input.title ?? `Proposal for ${client.name}`,
        templateId: input.templateId,
        builderMode: input.builderMode,
        slug,
        structure: { lineItems: [], sections: [], introCopy: '', nextStepsCopy: '' },
        createdByUserId: ctx.user.id,
        appliedFeePercentage: String(feeResolution.ratePercent),
        appliedTier: feeResolution.tier,
      });
      await logActivity({
        action: 'proposal.created',
        brandId: input.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: 'proposal.created',
        entityType: 'proposal',
        entityId: id,
      });
      return getProposalById(id, input.brandId);
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().optional(),
        structure: proposalStructureSchema.optional(),
        paymentModel: z.enum(['one_off', 'subscription', 'payment_plan', 'dual_option']).optional(),
        paymentConfig: z.any().optional(),
        personalisedIntro: z.string().optional(),
        internalNote: z.string().optional(),
        expiresAt: z.date().optional(),
        currency: z.string().length(3).optional(),
        // Lifecycle fields
        commercialIntent: z.enum(['ongoing_service', 'fixed_engagement', 'hybrid']).optional(),
        allowPayerCancel: z.boolean().optional(),
        allowPayerPause: z.boolean().optional(),
        allowPayerPayoutFull: z.boolean().optional(),
        allowPayerSkip: z.boolean().optional(),
        allowPayerCardUpdate: z.boolean().optional(),
        commitmentPeriodMonths: z.number().nullable().optional(),
        maxSkipsPerYear: z.number().optional(),
        maxPauseDaysPerYear: z.number().optional(),
        maxDeferralsPerPlan: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existingRow = await getProposalRow(input.id);
      if (!existingRow) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, existingRow.brandId);
      const account = await getPaymentAccount(existingRow.brandId);
      if (!account)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Vendor account not found' });
      const { id, structure, currency, ...rest } = input;
      // Log all save attempts for audit
      const saveStart = Date.now();
      // Recalculate totals with tax breakdown
      let totalCents = 0;
      let subtotalCents = 0;
      let taxCents = 0;
      if (structure?.lineItems) {
        const defaultTaxRate = parseFloat(String(account.defaultTaxRate ?? '10'));
        const breakdown = calculateTaxBreakdown(
          structure.lineItems.map((li) => ({
            type: li.type,
            quantity: li.quantity,
            unitPriceCents: li.unitPriceCents,
            taxBehaviour: li.taxBehaviour as 'inclusive' | 'exclusive' | 'exempt',
            taxRate: li.taxRate,
          })),
          defaultTaxRate,
        );
        subtotalCents = breakdown.subtotalCents;
        taxCents = breakdown.taxCents;
        totalCents = breakdown.totalCents;
      }
      try {
        await updateProposal(id, existingRow.brandId, {
          ...rest,
          ...(currency ? { currency: currency as ProposalCurrency } : {}),
          ...(structure ? { structure, totalCents, subtotalCents, taxCents } : {}),
        });
      } catch (dbErr: unknown) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        console.error(
          `[Proposal.update] DB error | proposalId=${id} brandId=${existingRow.brandId} userId=${ctx.user.id} ms=${Date.now() - saveStart} | ${msg}`,
        );
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Save failed: ${msg}` });
      }
      console.log(
        `[Proposal.update] OK | proposalId=${id} brandId=${existingRow.brandId} ms=${Date.now() - saveStart}`,
      );
      // Auto-snapshot: save revision after every meaningful update
      try {
        if (structure) {
          const existing = await db
            .select({ version: paymentProposalRevisions.version })
            .from(paymentProposalRevisions)
            .where(eq(paymentProposalRevisions.proposalId, id))
            .orderBy(desc(paymentProposalRevisions.version))
            .limit(1);
          const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;
          await db.insert(paymentProposalRevisions).values({
            proposalId: id,
            version: nextVersion,
            title: rest.title ?? undefined,
            structure: structure as Record<string, unknown>,
            totalCents,
            createdByUserId: ctx.user.id,
          });
        }
      } catch (_) {
        /* non-critical, ignore */
      }
      return getProposalById(id, existingRow.brandId);
    }),

  send: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        sendViaSms: z.boolean().default(true),
        sendViaEmail: z.boolean().default(false),
        customMessage: z.string().optional(),
        // Kept for input-shape parity with the export; links are now built from
        // emailBaseUrl(ctx.clientOrigin) (allow-listed), never from this value.
        origin: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      console.log('[proposals.send] ▶ START', {
        proposalId: input.id,
        sendViaSms: input.sendViaSms,
        sendViaEmail: input.sendViaEmail,
        hasCustomMessage: !!input.customMessage,
        origin: input.origin ?? '(not provided)',
        userId: ctx.user.id,
      });

      const proposal = await getProposalRow(input.id);
      if (!proposal) {
        console.error('[proposals.send] ✗ Proposal not found:', { proposalId: input.id });
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await requirePaymentWrite(ctx, proposal.brandId);

      const account = await getPaymentAccount(proposal.brandId);
      if (!account) {
        console.error('[proposals.send] ✗ Account not found for brandId:', proposal.brandId);
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      console.log('[proposals.send] Account resolved:', {
        brandId: account.brandId,
        businessName: account.businessName,
        email: account.email,
      });
      console.log('[proposals.send] Proposal resolved:', {
        proposalId: proposal.id,
        slug: proposal.slug,
        title: proposal.title,
        clientId: proposal.clientId,
        currentStatus: proposal.status,
        currency: proposal.currency ?? 'AUD',
      });

      // Lock FX rate at send time for non-AUD proposals
      let fxRateAtSend: number | undefined;
      const proposalCurrency = proposal.currency ?? 'AUD';
      if (proposalCurrency !== 'AUD') {
        console.log(
          '[proposals.send] Non-AUD currency detected, fetching FX rate for:',
          proposalCurrency,
        );
        try {
          fxRateAtSend = await getAudToRate(proposalCurrency);
          console.log('[proposals.send] FX rate fetched:', fxRateAtSend);
        } catch (fxErr) {
          console.warn('[proposals.send] FX rate fetch failed (non-critical):', fxErr);
        }
      }

      console.log("[proposals.send] Updating proposal status to 'sent'…");
      await updateProposal(input.id, proposal.brandId, {
        status: 'sent',
        sentAt: new Date(),
        ...(fxRateAtSend !== undefined ? { fxRateAtSend: String(fxRateAtSend) } : {}),
      });
      console.log("[proposals.send] Proposal status updated to 'sent'");

      // Resolve client details for delivery
      console.log('[proposals.send] Fetching client with id:', proposal.clientId);
      const client = proposal.clientId
        ? await getClientById(proposal.clientId, proposal.brandId)
        : undefined;
      console.log('[proposals.send] Client resolved:', {
        found: !!client,
        clientId: client?.id,
        name: client?.name,
        email: client?.email ?? '(no email)',
        mobile: client?.mobile ? `${String(client.mobile).slice(0, 4)}…` : '(no mobile)',
      });

      // Build proposal URL from the requesting frontend's origin (allow-listed)
      const origin = emailBaseUrl(ctx.clientOrigin);
      const proposalUrl = `${origin}/p/${proposal.slug}`;
      const expiresAt = proposal.expiresAt ?? null;
      console.log('[proposals.send] Delivery config:', { origin, proposalUrl, expiresAt });

      // Deliver via email — fire-and-forget so we don't block the HTTP response
      if (!input.sendViaEmail) {
        console.log('[proposals.send] Email skipped — sendViaEmail=false');
      } else if (!client?.email) {
        console.warn('[proposals.send] Email skipped — client has no email address');
      } else {
        console.log('[proposals.send] Building email payload for:', client.email);
        const emailPayload = buildProposalDeliveryEmail({
          clientName: client.name,
          businessName: account.businessName ?? 'Your service provider',
          proposalTitle: proposal.title ?? 'Proposal',
          proposalUrl,
          customMessage: input.customMessage,
          // The export passed the raw Date into the string-typed field (via
          // `as any`), rendering Date.toString() — format it readably instead.
          expiresAt: expiresAt
            ? new Date(expiresAt).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })
            : null,
        });
        console.log('[proposals.send] Email payload built:', {
          subject: emailPayload.subject,
          to: client.email,
        });
        console.log('[proposals.send] Firing email (fire-and-forget)…');
        sendEmail({ to: client.email, ...emailPayload })
          .then((ok) => {
            console.log(`[proposals.send] Email fire-and-forget resolved: success=${ok}`);
          })
          .catch((err) => {
            console.error('[proposals.send] Email delivery failed (fire-and-forget catch):', {
              message: err?.message,
              code: err?.code,
              stack: err?.stack?.split('\n').slice(0, 4).join(' | '),
            });
          });
      }

      // Deliver via SMS — fire-and-forget so we don't block the HTTP response
      if (!input.sendViaSms) {
        console.log('[proposals.send] SMS skipped — sendViaSms=false');
      } else if (!client?.mobile) {
        console.warn('[proposals.send] SMS skipped — client has no mobile number');
      } else {
        console.log(
          '[proposals.send] Building SMS body for mobile:',
          `${String(client.mobile).slice(0, 4)}…`,
        );
        const smsBody = buildProposalSmsBody({
          clientName: client.name,
          businessName: account.businessName ?? 'Your service provider',
          proposalTitle: proposal.title ?? 'Proposal',
          proposalUrl,
          customMessage: input.customMessage,
        });
        console.log('[proposals.send] SMS body built, length:', smsBody.length, 'chars');
        console.log('[proposals.send] Firing SMS (fire-and-forget)…');
        sendSms({ to: client.mobile, body: smsBody, brandId: proposal.brandId })
          .then((result) => {
            console.log('[proposals.send] SMS fire-and-forget resolved:', result);
          })
          .catch((err) => {
            console.error('[proposals.send] SMS delivery failed (fire-and-forget catch):', {
              message: err?.message,
              code: err?.code,
            });
          });
      }

      console.log('[proposals.send] Logging activity…');
      await logActivity({
        action: 'proposal.sent',
        brandId: proposal.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: 'proposal.sent',
        entityType: 'proposal',
        entityId: input.id,
        metadata: { sendViaSms: input.sendViaSms, sendViaEmail: input.sendViaEmail },
      });

      // Schedule cold outreach sequence
      console.log('[proposals.send] Scheduling cold outreach sequence…');
      try {
        const { scheduleColdSequence } = await import('../../modules/payments/sequence-worker.js');
        await scheduleColdSequence({ proposalId: input.id, brandId: proposal.brandId });
        console.log('[proposals.send] Cold sequence scheduled');
      } catch (seqErr) {
        console.warn(
          '[proposals.send] Cold sequence scheduling failed (non-critical):',
          (seqErr as Error)?.message,
        );
      }

      console.log('[proposals.send] ✓ DONE — returning success');
      return { success: true, slug: proposal.slug ?? '' };
    }),

  // Quick proposal — single POST submission
  createQuick: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid(),
        quickSetId: z.string().uuid().optional(),
        lineItems: z.array(lineItemSchema),
        paymentModel: z.enum(['one_off', 'subscription', 'payment_plan']).default('one_off'),
        paymentConfig: z.any().optional(),
        sendViaSms: z.boolean().default(true),
        currency: z.string().length(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const client = await getClientById(input.clientId, input.brandId);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      const account = await getPaymentAccount(input.brandId);
      const slug = makeSlug();
      const totalCents = input.lineItems.reduce((sum, li) => {
        if (li.type === 'break') return sum;
        return sum + li.quantity * li.unitPriceCents;
      }, 0);
      const quickFeeResolution = await resolveFeeForProposal(input.brandId);
      const id = await createProposal({
        brandId: input.brandId,
        clientId: input.clientId,
        title: `Quick Proposal — ${client.name}`,
        builderMode: 'quick',
        quickSetId: input.quickSetId,
        slug,
        status: 'sent',
        sentAt: new Date(),
        paymentModel: input.paymentModel,
        paymentConfig: input.paymentConfig,
        totalCents,
        currency: (input.currency ??
          account?.defaultCurrency ??
          'AUD') as ProposalCurrency,
        structure: { lineItems: input.lineItems, sections: [] },
        createdByUserId: ctx.user.id,
        appliedFeePercentage: String(quickFeeResolution.ratePercent),
        appliedTier: quickFeeResolution.tier,
      });
      await logActivity({
        action: 'proposal.quick_sent',
        brandId: input.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: 'proposal.quick_sent',
        entityType: 'proposal',
        entityId: id,
      });
      return { success: true, proposalId: id, slug };
    }),

  // Public — client views proposal (enriched)
  getPublic: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      // Track view — advance status from sent → viewed
      if (proposal.status === 'sent') {
        await updateProposal(proposal.id, proposal.brandId, {
          status: 'viewed',
          viewedAt: new Date(),
        });
        await logActivity({
          action: 'proposal.viewed',
          brandId: proposal.brandId,
          actorType: 'payer',
          actorId: proposal.clientId,
          eventType: 'proposal.viewed',
          entityType: 'proposal',
          entityId: proposal.id,
        });
      }
      // Enrich with client, account, brand kit
      const [client, account, brandKit] = await Promise.all([
        proposal.clientId
          ? getClientById(proposal.clientId, proposal.brandId)
          : Promise.resolve(undefined),
        getPaymentAccount(proposal.brandId),
        getBrandKit(proposal.brandId),
      ]);

      // Resolve merge fields in proposal structure (text blocks, intro, next steps)
      const mergeCtxPublic: MergeFieldContext = {
        clientName: client?.name,
        clientEmail: client?.email,
        businessName: account?.businessName,
        proposalTitle: proposal.title,
        totalCents: proposal.totalCents,
        subtotalCents: proposal.subtotalCents,
        taxCents: proposal.taxCents,
        currency: proposal.currency ?? 'AUD',
        proposalDate: proposal.createdAt,
        expiryDate: proposal.expiresAt,
        // ids are uuids now — padStart is a no-op kept for source parity
        proposalNumber: `A-${String(proposal.id).padStart(4, '0')}`,
        senderName: account?.businessName,
        senderEmail: account?.email,
      };
      const resolvedStructure = proposal.structure
        ? resolveStructureMergeFields(proposal.structure, mergeCtxPublic)
        : proposal.structure;
      const resolvedPersonalisedIntro = proposal.personalisedIntro
        ? resolveMergeFields(proposal.personalisedIntro, mergeCtxPublic)
        : proposal.personalisedIntro;

      return {
        ...proposal,
        structure: resolvedStructure,
        personalisedIntro: resolvedPersonalisedIntro,
        client: client
          ? {
              name: client.name,
              businessName: client.businessName,
              email: client.email,
            }
          : null,
        account: account
          ? {
              businessName: account.businessName,
              tradingName: account.tradingName,
              abn: account.abn,
              email: account.email,
              taxLabel: account.taxLabel ?? 'GST',
              defaultTaxRate: account.defaultTaxRate ?? '10',
              taxBehaviourDefault: account.taxBehaviourDefault ?? 'inclusive',
              thankYouConfig: account.thankYouConfig ?? null,
            }
          : null,
        brandKit: brandKit
          ? {
              primaryColor: brandKit.primaryColor,
              accentColor: brandKit.accentColor,
              accentColor2: brandKit.accentColor2,
              backgroundColor: brandKit.backgroundColor,
              textColor: brandKit.textColor,
              darkColor: brandKit.darkColor,
              lightColor: brandKit.lightColor,
              headingFont: brandKit.headingFont,
              bodyFont: brandKit.bodyFont,
              logoLightUrl: brandKit.logoLightUrl,
              logoDarkUrl: brandKit.logoDarkUrl,
              heroImageUrl: brandKit.heroImageUrl,
              defaultIntroCopy: brandKit.defaultIntroCopy,
              defaultNextStepsCopy: brandKit.defaultNextStepsCopy,
              defaultTermsUrl: brandKit.defaultTermsUrl,
            }
          : null,
      };
    }),

  // Public — track each view (view count + re-open alert)
  trackView: publicProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) return { success: false };
      const prevViewCount = proposal.viewCount ?? 0;
      const isReopen =
        prevViewCount > 0 && ['sent', 'viewed', 'engaged'].includes(proposal.status);
      const newViewCount = prevViewCount + 1;
      const scrollDepth = proposal.maxScrollDepth ?? 0;
      const newWinScore = computeWinScore(newViewCount, scrollDepth, proposal.status);
      await updateProposal(proposal.id, proposal.brandId, {
        viewCount: newViewCount,
        lastViewedAt: new Date(),
        winScore: newWinScore,
      });
      // Notify the vendor: email on first view; re-open alert on 2nd+ view.
      // (The export's Manus notifyOwner is replaced by an email to the account.)
      try {
        const { sendEmail: _sendEmail, buildProposalViewedEmail } = await import(
          '../../modules/payments/email.js'
        );
        const client = proposal.clientId
          ? await getClientById(proposal.clientId, proposal.brandId)
          : undefined;
        const account = await getPaymentAccount(proposal.brandId);
        const ownerEmail = account?.email;
        if (ownerEmail && prevViewCount === 0) {
          // First view — email the owner
          const emailContent = buildProposalViewedEmail({
            ownerName: account?.businessName ?? 'there',
            clientName: client?.name ?? 'Your client',
            proposalTitle: proposal.title ?? 'Untitled',
            proposalUrl: `${emailBaseUrl(ctx.clientOrigin)}/proposals/${proposal.slug}`,
          });
          await _sendEmail({ to: ownerEmail, ...emailContent });
        } else if (ownerEmail && isReopen) {
          const title = `🔁 Proposal re-opened: ${proposal.title ?? 'Untitled'}`;
          const content = `${client?.name ?? 'Your client'} just re-opened your proposal "${proposal.title ?? 'Untitled'}" (view #${prevViewCount + 1}).`;
          await _sendEmail({
            to: ownerEmail,
            subject: title,
            htmlBody: `<p>${content}</p>`,
            textBody: content,
          });
        }
      } catch (_) {
        /* non-critical */
      }
      // Dispatch engagement sequence trigger
      try {
        const { evaluateEngagement } = await import('../../modules/payments/sequence-worker.js');
        await evaluateEngagement({
          proposalId: proposal.id,
          brandId: proposal.brandId,
          viewCount: newViewCount,
        });
      } catch (_) {
        /* non-critical */
      }
      return { success: true, viewCount: prevViewCount + 1, isReopen };
    }),

  // Public — track scroll depth
  trackScrollDepth: publicProcedure
    .input(z.object({ slug: z.string(), depth: z.number().int().min(0).max(100) }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) return { success: false };
      const prevDepth = proposal.maxScrollDepth ?? 0;
      if (input.depth > prevDepth) {
        const viewCount = proposal.viewCount ?? 0;
        const newWinScore = computeWinScore(viewCount, input.depth, proposal.status);
        await updateProposal(proposal.id, proposal.brandId, {
          maxScrollDepth: input.depth,
          winScore: newWinScore,
        });
      }
      return { success: true };
    }),

  // Public — client engaged (scrolled past 50%)
  engage: publicProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) return { success: false };
      // Only advance from viewed → engaged
      if (proposal.status === 'viewed' || proposal.status === 'sent') {
        await updateProposal(proposal.id, proposal.brandId, {
          status: 'engaged',
          engagedAt: new Date(),
        });
        await logActivity({
          action: 'proposal.engaged',
          brandId: proposal.brandId,
          actorType: 'payer',
          actorId: proposal.clientId,
          eventType: 'proposal.engaged',
          entityType: 'proposal',
          entityId: proposal.id,
        });
      }
      return { success: true };
    }),

  // Public — client accepts proposal
  accept: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        signatureDataUrl: z.string().optional(),
        signerName: z.string().optional(),
        signerEmail: z.string().email().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      // Enforce expiry — cannot accept an expired proposal
      if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'This proposal has expired and can no longer be accepted.',
        });
      }
      const signedAt = new Date();
      // TODO(payments): tRPC Context does not expose the request, so the
      // signer's IP (source: x-forwarded-for) is not captured yet.
      const signerIp: string | undefined = undefined;
      await updateProposal(proposal.id, proposal.brandId, {
        status: 'accepted',
        acceptedAt: signedAt,
        ...(input.signatureDataUrl
          ? { signatureData: input.signatureDataUrl, signatureIp: signerIp ?? null }
          : {}),
      });
      await logActivity({
        action: 'proposal.accepted',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId,
        eventType: 'proposal.accepted',
        entityType: 'proposal',
        entityId: proposal.id,
      });
      // Generate signed PDF asynchronously (non-blocking)
      if (input.signatureDataUrl) {
        setImmediate(async () => {
          try {
            const [client, account, legalName] = await Promise.all([
              proposal.clientId
                ? getClientById(proposal.clientId, proposal.brandId)
                : Promise.resolve(undefined),
              getPaymentAccount(proposal.brandId),
              getBrandLegalName(proposal.brandId),
            ]);
            const structure = (proposal.structure ?? {}) as Record<string, unknown>;
            const rawItems = (structure.lineItems ?? []) as Array<Record<string, unknown>>;
            const lineItems = rawItems.map((item) => ({
              name: String(item.name ?? ''),
              description: item.description ? String(item.description) : undefined,
              qty:
                typeof item.qty === 'number'
                  ? item.qty
                  : typeof item.quantity === 'number'
                    ? item.quantity
                    : 1,
              unitPriceCents:
                typeof item.unitPriceCents === 'number'
                  ? item.unitPriceCents
                  : typeof item.priceCents === 'number'
                    ? item.priceCents
                    : 0,
              totalCents:
                typeof item.totalCents === 'number'
                  ? item.totalCents
                  : typeof item.priceCents === 'number'
                    ? item.priceCents
                    : 0,
            }));
            const sections = (structure.sections ?? []) as Array<{
              type: string;
              title?: string;
              content?: string;
            }>;
            const { generateProposalPdf } = await import('../../modules/payments/pdf.js');
            const pdfBuffer = await generateProposalPdf({
              title: proposal.title ?? 'Proposal',
              clientName: input.signerName ?? client?.name ?? 'Client',
              businessName: legalName ?? account?.businessName ?? 'Business',
              abn: account?.abn ?? undefined,
              totalCents: proposal.totalCents ?? 0,
              subtotalCents: proposal.subtotalCents ?? proposal.totalCents ?? 0,
              taxCents: proposal.taxCents ?? 0,
              taxLabel: account?.taxLabel ?? 'GST',
              taxRate: account?.defaultTaxRate ? parseFloat(account.defaultTaxRate) : 10,
              taxBehaviour: account?.taxBehaviourDefault ?? 'inclusive',
              currency: proposal.currency ?? 'AUD',
              paymentModel: proposal.paymentModel ?? 'one_off',
              lineItems,
              sections,
              createdAt: proposal.createdAt,
              expiresAt: proposal.expiresAt,
              slug: proposal.slug ?? '',
              signatureDataUrl: input.signatureDataUrl,
              signerName: input.signerName ?? client?.name ?? undefined,
              signerEmail: input.signerEmail ?? client?.email ?? undefined,
              signedAt,
              signatureIp: signerIp,
            });
            // Store the signed PDF in Supabase Storage (replaces Manus storagePut)
            const { supabaseAdmin } = await import('../../lib/supabase.js');
            const key = `payments/signed-proposals/${proposal.slug}-signed.pdf`;
            const bucket = 'brand-files';
            const uploadRes = await supabaseAdmin.storage
              .from(bucket)
              .upload(key, pdfBuffer, { contentType: 'application/pdf', upsert: true });
            if (uploadRes.error) throw uploadRes.error;
            const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(key);
            const url = pub.publicUrl;
            await updateProposal(proposal.id, proposal.brandId, {
              signedPdfUrl: url,
              signedPdfKey: key,
            });
            const pdfBase64 = pdfBuffer.toString('base64');
            const pdfAttachment = [
              {
                name: `proposal-${proposal.slug}-signed.pdf`,
                content: pdfBase64,
                contentType: 'application/pdf',
              },
            ];
            const recipientEmail = input.signerEmail ?? client?.email;
            if (recipientEmail) {
              await sendEmail({
                to: recipientEmail,
                subject: `Signed proposal — ${proposal.title ?? proposal.slug}`,
                htmlBody: `<p>Hi ${input.signerName ?? client?.name ?? 'there'},</p><p>Your signed copy of the proposal <strong>${proposal.title ?? proposal.slug}</strong> from <strong>${account?.businessName ?? ''}</strong> is attached.</p><p>Thank you for accepting!</p>`,
                textBody: `Hi ${input.signerName ?? client?.name ?? 'there'},\n\nYour signed copy of the proposal is attached.\n\nThank you for accepting!`,
                attachments: pdfAttachment,
              });
            }
            if (account?.email) {
              await sendEmail({
                to: account.email,
                subject: `Proposal accepted & signed — ${proposal.title ?? proposal.slug}`,
                htmlBody: `<p>Hi ${account.businessName},</p><p><strong>${input.signerName ?? client?.name ?? 'Your client'}</strong> has accepted and signed the proposal <strong>${proposal.title ?? proposal.slug}</strong>. The signed PDF is attached.</p>`,
                textBody: `${input.signerName ?? client?.name ?? 'Your client'} accepted and signed "${proposal.title ?? proposal.slug}". Signed PDF attached.`,
                attachments: pdfAttachment,
              });
            }
            console.log(`[PDF] Signed PDF stored at ${url} for proposal ${proposal.id}`);
          } catch (err) {
            console.error('[PDF] Signed PDF generation failed:', err);
          }
        });
      }
      return { success: true };
    }),

  // AI: Draft proposal from natural language
  aiDraft: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        prompt: z.string().min(10).max(1000),
        currency: z.string().length(3).default('AUD'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const content = await completeOnce({
        db,
        source: 'proposal_draft',
        system: `You are a proposal drafting assistant for trade and service businesses.
Generate a structured proposal from the user's description.
Return JSON with: title (string), introCopy (string, 2-3 sentences), lineItems (array), nextStepsCopy (string).
Each line item: { id (uuid string), type ("product"|"custom"), name, description, quantity (number), unitPriceCents (integer in cents, e.g. 150000 for $1500), taxBehaviour ("inclusive") }.
Keep prices realistic for Australian trade services. Currency: ${input.currency}.
Respond with ONLY the JSON object — no prose, no markdown fences.`,
        prompt: input.prompt,
        maxTokens: 4000,
        brandId: input.brandId,
        userId: ctx.user.id,
        client: ctx.client ?? null,
      });
      if (!content) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI draft failed' });
      try {
        return JSON.parse(extractJson(content));
      } catch {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI response parse error' });
      }
    }),

  // AI: Rewrite text inline
  aiRewrite: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(2000),
        tone: z.enum(['shorter', 'confident', 'friendlier', 'formal']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const toneInstructions: Record<string, string> = {
        shorter:
          'Make this text significantly shorter while keeping the key message. Remove filler words.',
        confident:
          'Rewrite this text to sound more confident and authoritative. Use active voice.',
        friendlier:
          'Rewrite this text to sound warmer and more approachable. Keep it professional.',
        formal: 'Rewrite this text to sound more formal and professional.',
      };
      let rewritten = input.text;
      try {
        const text = await completeOnce({
          db,
          source: 'proposal_rewrite',
          system: `You are a professional copywriter. ${toneInstructions[input.tone]} Return only the rewritten text, no explanations.`,
          prompt: input.text,
          maxTokens: 2000,
          userId: ctx.user.id,
          client: ctx.client ?? null,
        });
        if (text) rewritten = text;
      } catch {
        /* fall back to the original text, matching the export's behavior */
      }
      return { rewritten };
    }),

  // AI: Suggest improvements on save
  aiSuggest: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        structure: proposalStructureSchema,
        title: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.proposalId);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, proposal.brandId);
      const lineItemSummary = (input.structure.lineItems ?? [])
        .filter((li) => li.type !== 'break')
        .map((li) => `${li.name}: $${(li.unitPriceCents / 100).toFixed(2)} x ${li.quantity}`)
        .join(', ');
      const content = await completeOnce({
        db,
        source: 'proposal_suggest',
        system: `You are a proposal optimisation expert. Analyse this proposal and return exactly 3 actionable improvement suggestions as JSON.
Return a JSON object: { "suggestions": [...] }.
Each suggestion: { id (string), type ("content"|"pricing"|"structure"|"conversion"), title (string, max 8 words), description (string, 1-2 sentences), impact ("high"|"medium"|"low") }.
Respond with ONLY the JSON object — no prose, no markdown fences.`,
        prompt: `Title: ${input.title ?? 'Untitled'}
Intro: ${input.structure.introCopy ?? 'None'}
Line items: ${lineItemSummary || 'None'}
Next steps: ${input.structure.nextStepsCopy ?? 'None'}`,
        maxTokens: 2000,
        brandId: proposal.brandId,
        userId: ctx.user.id,
        client: ctx.client ?? null,
      });
      if (!content) return { suggestions: [] };
      try {
        return JSON.parse(extractJson(content));
      } catch {
        return { suggestions: [] };
      }
    }),

  /**
   * Mark a proposal as disputed (called from Stripe webhook or manually).
   */
  markDisputed: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().optional(),
        evidenceDueDate: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.id);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, proposal.brandId);
      await updateProposal(input.id, proposal.brandId, { status: 'disputed' });
      await logActivity({
        action: 'proposal.disputed',
        brandId: proposal.brandId,
        actorType: 'system',
        actorId: null /* stripe */,
        eventType: 'proposal.disputed',
        entityType: 'proposal',
        entityId: input.id,
        metadata: { reason: input.reason, evidenceDueDate: input.evidenceDueDate },
      });
      return { success: true };
    }),

  /**
   * Issue a full or partial refund on a paid proposal.
   */
  refund: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        amountCents: z.number().min(1),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.id);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, proposal.brandId);
      if (!proposal.stripePaymentIntentId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No payment intent on this proposal' });
      }
      if (!stripeEnabled || !stripe) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe is not configured' });
      }
      const pi = await stripe.paymentIntents.retrieve(proposal.stripePaymentIntentId);
      const chargeId =
        typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
      if (!chargeId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No charge found' });
      const refund = await stripe.refunds.create({
        charge: chargeId,
        amount: input.amountCents,
        reason: (input.reason as 'duplicate' | 'fraudulent' | 'requested_by_customer' | undefined) ??
          'requested_by_customer',
      });
      const isPartial = input.amountCents < (proposal.totalCents ?? 0);
      await updateProposal(input.id, proposal.brandId, {
        status: isPartial ? 'partially_refunded' : 'refunded',
      });
      await logActivity({
        action: isPartial ? 'proposal.partially_refunded' : 'proposal.refunded',
        brandId: proposal.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: isPartial ? 'proposal.partially_refunded' : 'proposal.refunded',
        entityType: 'proposal',
        entityId: input.id,
        metadata: { refundId: refund.id, amountCents: input.amountCents, reason: input.reason },
      });
      return { success: true, refundId: refund.id };
    }),

  // Duplicate a proposal (creates a draft copy)
  duplicate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const original = await getProposalRow(input.id);
      if (!original) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, original.brandId);
      const newSlug = makeSlug();
      const newId = await createProposal({
        brandId: original.brandId,
        clientId: original.clientId,
        templateId: original.templateId,
        builderMode: original.builderMode,
        status: 'draft',
        totalCents: original.totalCents,
        subtotalCents: original.subtotalCents,
        taxCents: original.taxCents,
        currency: original.currency,
        paymentModel: original.paymentModel,
        paymentConfig: original.paymentConfig,
        structure: original.structure,
        slug: newSlug,
        personalisedIntro: original.personalisedIntro,
        title: `${original.title ?? 'Untitled'} (copy)`,
        createdByUserId: ctx.user.id,
        assignedUserId: original.assignedUserId,
      });
      await logActivity({
        action: 'proposal.duplicated',
        brandId: original.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: 'proposal.duplicated',
        entityType: 'proposal',
        entityId: newId,
        metadata: { originalId: input.id },
      });
      return { success: true, proposalId: newId, slug: newSlug };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.id);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, proposal.brandId);
      await deleteProposal(input.id, proposal.brandId);
      await logActivity({
        action: 'proposal.deleted',
        brandId: proposal.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: 'proposal.deleted',
        entityType: 'proposal',
        entityId: input.id,
      });
      return { success: true };
    }),

  // ── Q&A ────────────────────────────────────────────────────────────────────
  askQuestion: publicProcedure
    .input(
      z.object({
        slug: z.string(),
        clientName: z.string().optional(),
        clientEmail: z.string().email().optional(),
        question: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await db.insert(paymentProposalQuestions).values({
        proposalId: proposal.id,
        brandId: proposal.brandId,
        clientName: input.clientName ?? null,
        clientEmail: input.clientEmail ?? null,
        question: input.question,
      });
      // Manus notifyOwner → email the vendor's account address
      try {
        const account = await getPaymentAccount(proposal.brandId);
        if (account?.email) {
          const title = `New question on proposal ${proposal.title ?? proposal.slug}`;
          const content = `${input.clientName ?? 'A client'} asked: "${input.question.slice(0, 200)}"`;
          await sendEmail({
            to: account.email,
            subject: title,
            htmlBody: `<p>${content}</p>`,
            textBody: content,
          });
        }
      } catch (_) {
        /* non-critical */
      }
      return { success: true };
    }),

  getQuestions: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.proposalId);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentRead(ctx, proposal.brandId);
      return db
        .select()
        .from(paymentProposalQuestions)
        .where(
          and(
            eq(paymentProposalQuestions.proposalId, input.proposalId),
            eq(paymentProposalQuestions.brandId, proposal.brandId),
          ),
        )
        .orderBy(desc(paymentProposalQuestions.createdAt));
    }),

  getQuestionsPublic: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) return [];
      const rows = await db
        .select()
        .from(paymentProposalQuestions)
        .where(eq(paymentProposalQuestions.proposalId, proposal.id));
      return rows.filter((q) => q.answer); // only show answered questions publicly
    }),

  answerQuestion: protectedProcedure
    .input(z.object({ questionId: z.string().uuid(), answer: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [question] = await db
        .select()
        .from(paymentProposalQuestions)
        .where(eq(paymentProposalQuestions.id, input.questionId))
        .limit(1);
      if (!question) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, question.brandId);
      await db
        .update(paymentProposalQuestions)
        .set({ answer: input.answer, answeredAt: new Date(), answeredByUserId: ctx.user.id })
        .where(
          and(
            eq(paymentProposalQuestions.id, input.questionId),
            eq(paymentProposalQuestions.brandId, question.brandId),
          ),
        );
      return { success: true };
    }),

  /**
   * WS6 — manual "Convert to Prodesk order". Turns a PAID payer proposal into a
   * canonical `purchase` + `purchase_items` (mapped from the block-canvas
   * `structure` line items) and runs the standard fulfillment (spawns a project
   * per item + commissions) with the brand's derived agency as the selling
   * agency. Idempotent: re-invoking returns the existing order rather than
   * spawning duplicate projects.
   */
  convertToOrder: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalRow(input.id);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, proposal.brandId);
      // Only a paid/active payer proposal can become an order.
      if (proposal.status !== 'paid' && proposal.status !== 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only a paid proposal can be converted to a Prodesk order.' });
      }
      if (!proposal.agencyId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposal has no selling (derived) agency to fulfil the order.' });
      }
      // Idempotent: one order per proposal.
      const [existing] = await ctx.db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.proposalId, proposal.id))
        .limit(1);
      if (existing) return { purchaseId: existing.id, alreadyConverted: true };

      const structure = (proposal.structure ?? {}) as {
        lineItems?: Array<{ name?: string; description?: string; quantity?: number; unitPriceCents?: number; type?: string }>;
      };
      const lineItems = (structure.lineItems ?? []).filter((li) => li.type !== 'break');

      const [purchase] = await ctx.db
        .insert(purchases)
        .values({
          brandId: proposal.brandId,
          userId: ctx.user.id,
          type: 'proposal',
          status: 'paid',
          proposalId: proposal.id,
          proposalSentByAgencyId: proposal.agencyId,
          totalAmount: ((proposal.totalCents ?? 0) / 100).toFixed(2),
          paidAt: new Date(),
        })
        .returning();

      for (const [i, li] of lineItems.entries()) {
        const lineTotal = (((li.unitPriceCents ?? 0) * (li.quantity ?? 1)) / 100).toFixed(2);
        await ctx.db.insert(purchaseItems).values({
          purchaseId: purchase!.id,
          // Derived agency = the seller; a set agencyId is what lets fulfilment
          // spawn a project for this line (serviceId stays null — free-form item).
          agencyId: proposal.agencyId,
          serviceName: li.name ?? 'Item',
          description: li.description,
          lineTotal,
          quantity: li.quantity ?? 1,
          sortOrder: i,
        });
      }

      // Standard fulfilment: spawn a project per item + commissions. Idempotent.
      await fulfillPurchase(purchase!.id);
      return { purchaseId: purchase!.id, alreadyConverted: false };
    }),
});
