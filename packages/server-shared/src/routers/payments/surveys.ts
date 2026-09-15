/**
 * Payments (EziQuotes) surveys router — post-completion NPS surveys and
 * renewal reminders, ported from the export's server/routers/surveys.ts.
 * getByToken/submit are public token surfaces. Survey links are built from
 * emailBaseUrl(ctx.clientOrigin) (the export used input.origin / the raw
 * Origin header). The email goes through modules/payments/email.ts
 * (per-account Postmark with platform-mailer fallback). Note: the export
 * inserted clientEmail/sentAt into client_surveys, but those columns never
 * existed in its schema (drizzle silently ignored them) — the ported schema
 * matches, so the insert carries only real columns; createdAt is the sent time.
 */
import { randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte } from 'drizzle-orm';
import { z } from 'zod';
import {
  paymentClientSurveys,
  paymentClients,
  proposals,
  paymentRenewalReminders,
} from '../../db/schema.js';
import { emailBaseUrl } from '../../modules/email/branding.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { getPaymentAccount } from '../../modules/payments/db.js';
import { sendEmail } from '../../modules/payments/email.js';
import { protectedProcedure, publicProcedure, router } from '../../trpc/trpc.js';

export const surveysRouter = router({
  // -- Send survey to a client after proposal completion ---------------------
  sendSurvey: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        clientEmail: z.string().email(),
        clientId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [proposal] = await ctx.db
        .select({ id: proposals.id, brandId: proposals.brandId })
        .from(proposals)
        .where(eq(proposals.id, input.proposalId))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, proposal.brandId!);
      const account = await getPaymentAccount(proposal.brandId!);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      const token = randomBytes(32).toString('hex');
      await ctx.db.insert(paymentClientSurveys).values({
        brandId: proposal.brandId!,
        proposalId: input.proposalId,
        clientId: input.clientId,
        token,
      });

      const surveyUrl = `${emailBaseUrl(ctx.clientOrigin)}/survey/${token}`;

      try {
        await sendEmail({
          to: input.clientEmail,
          subject: `How did we do? Quick feedback for ${account.businessName ?? 'us'}`,
          htmlBody: `
            <p>Hi there,</p>
            <p>Thank you for working with <strong>${account.businessName ?? 'us'}</strong>. We'd love to hear how your experience was — it only takes 30 seconds.</p>
            <p><a href="${surveyUrl}" style="background:#0F766E;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;margin:16px 0;">Share your feedback</a></p>
            <p style="color:#666;font-size:12px;">This link is personal to you and expires in 30 days.</p>
          `,
          textBody: `Thank you for working with ${account.businessName ?? 'us'}. Share your feedback here: ${surveyUrl}`,
        });
      } catch (err) {
        console.error('[Surveys] Failed to send survey email:', err);
      }

      return { ok: true, token };
    }),

  // -- List surveys for this brand --------------------------------------------
  list: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        proposalId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);

      const conditions = [eq(paymentClientSurveys.brandId, input.brandId)];
      if (input.proposalId) conditions.push(eq(paymentClientSurveys.proposalId, input.proposalId));

      return ctx.db
        .select()
        .from(paymentClientSurveys)
        .where(and(...conditions))
        .orderBy(desc(paymentClientSurveys.createdAt))
        .limit(100);
    }),

  // -- Public: get survey by token (client opens the link) -------------------
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ ctx, input }) => {
      const [survey] = await ctx.db
        .select()
        .from(paymentClientSurveys)
        .where(eq(paymentClientSurveys.token, input.token))
        .limit(1);

      if (!survey) throw new TRPCError({ code: 'NOT_FOUND', message: 'Survey not found or expired' });

      // Mark as opened if not already
      if (!survey.openedAt) {
        await ctx.db
          .update(paymentClientSurveys)
          .set({ openedAt: new Date() })
          .where(eq(paymentClientSurveys.id, survey.id));
      }

      return { proposalId: survey.proposalId, completedAt: survey.completedAt };
    }),

  // -- Public: submit survey response ----------------------------------------
  submit: publicProcedure
    .input(
      z.object({
        token: z.string(),
        npsScore: z.number().min(0).max(10),
        rating: z.number().min(1).max(5),
        feedback: z.string().max(2000).optional(),
        wouldRefer: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [survey] = await ctx.db
        .select()
        .from(paymentClientSurveys)
        .where(eq(paymentClientSurveys.token, input.token))
        .limit(1);

      if (!survey) throw new TRPCError({ code: 'NOT_FOUND' });
      if (survey.completedAt) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Survey already submitted' });

      await ctx.db
        .update(paymentClientSurveys)
        .set({
          npsScore: input.npsScore,
          rating: input.rating,
          feedback: input.feedback,
          wouldRefer: input.wouldRefer,
          completedAt: new Date(),
        })
        .where(eq(paymentClientSurveys.id, survey.id));

      return { ok: true };
    }),

  // -- Renewal Reminders ------------------------------------------------------
  createReminder: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        proposalId: z.string().uuid().optional(),
        type: z.enum(['renewal', 'anniversary', 'check_in']).default('renewal'),
        dueAt: z.number(), // unix ms
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [client] = await ctx.db
        .select({ brandId: paymentClients.brandId })
        .from(paymentClients)
        .where(eq(paymentClients.id, input.clientId))
        .limit(1);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, client.brandId);

      await ctx.db.insert(paymentRenewalReminders).values({
        brandId: client.brandId,
        clientId: input.clientId,
        proposalId: input.proposalId,
        type: input.type,
        dueAt: new Date(input.dueAt),
        notes: input.notes,
        status: 'pending',
      });

      return { ok: true };
    }),

  listReminders: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        clientId: z.string().uuid().optional(),
        upcoming: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);

      const conditions = [eq(paymentRenewalReminders.brandId, input.brandId)];
      if (input.clientId) conditions.push(eq(paymentRenewalReminders.clientId, input.clientId));
      if (input.upcoming) conditions.push(gte(paymentRenewalReminders.dueAt, new Date()));

      return ctx.db
        .select()
        .from(paymentRenewalReminders)
        .where(and(...conditions))
        .orderBy(paymentRenewalReminders.dueAt)
        .limit(100);
    }),

  dismissReminder: protectedProcedure
    .input(z.object({ reminderId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [reminder] = await ctx.db
        .select({ brandId: paymentRenewalReminders.brandId })
        .from(paymentRenewalReminders)
        .where(eq(paymentRenewalReminders.id, input.reminderId))
        .limit(1);
      if (!reminder) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, reminder.brandId);

      await ctx.db
        .update(paymentRenewalReminders)
        .set({ status: 'dismissed' })
        .where(
          and(
            eq(paymentRenewalReminders.id, input.reminderId),
            eq(paymentRenewalReminders.brandId, reminder.brandId),
          ),
        );

      return { ok: true };
    }),
});
