/**
 * Payments (EziQuotes) — payer CRUD router, ported from server/routers/clients.ts.
 * "Clients" here are the vendor's payers (payment_clients rows), not platform
 * users. list/create take a brandId; id-based procedures resolve the row and
 * gate on its brandId. Portal magic-links go through the payments email module
 * and the platform's origin allow-list (emailBaseUrl).
 */
import { randomBytes } from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { paymentClientPortalTokens, paymentClients } from '../../db/schema.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  createClient,
  deleteClient,
  getClientById,
  getPaymentAccount,
  listClients,
  listProposals,
  updateClient,
} from '../../modules/payments/db.js';
import { sendEmail } from '../../modules/payments/email.js';
import { emailBaseUrl } from '../../modules/email/branding.js';

/** 48-char URL-safe token (replaces the export's nanoid(48)). */
function portalToken(): string {
  return randomBytes(24).toString('hex');
}

/** Load a payer row by id (tenancy is asserted by the caller from row.brandId). */
async function loadClient(id: string) {
  const [row] = await db.select().from(paymentClients).where(eq(paymentClients.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
  return row;
}

export const clientsRouter = router({
  list: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      search: z.string().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const { brandId, ...opts } = input;
      return listClients(brandId, opts);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await loadClient(input.id);
      await requirePaymentRead(ctx, client.brandId);
      return client;
    }),

  getWithProposals: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await loadClient(input.id);
      await requirePaymentRead(ctx, client.brandId);
      const proposals = await listProposals(client.brandId, { limit: 100 });
      const clientProposals = proposals.rows.filter((p) => p.clientId === input.id);
      return { client, proposals: clientProposals };
    }),

  create: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      name: z.string().min(1),
      businessName: z.string().optional(),
      mobile: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      abn: z.string().optional(),
      internalNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const id = await createClient(input);
      return getClientById(id, input.brandId);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      businessName: z.string().optional(),
      mobile: z.string().optional(),
      email: z.string().email().optional(),
      address: z.string().optional(),
      abn: z.string().optional(),
      internalNotes: z.string().optional(),
      doNotSms: z.boolean().optional(),
      doNotEmail: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = await loadClient(input.id);
      await requirePaymentWrite(ctx, client.brandId);
      const { id, ...data } = input;
      await updateClient(id, client.brandId, data);
      return getClientById(id, client.brandId);
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const client = await loadClient(input.id);
      await requirePaymentWrite(ctx, client.brandId);
      await deleteClient(input.id, client.brandId);
      return { success: true };
    }),

  generateSupportSession: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const client = await loadClient(input.clientId);
      await requirePaymentWrite(ctx, client.brandId);
      const token = portalToken();
      // 4-hour support session — short-lived, vendor-initiated, no email sent
      const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
      await db.insert(paymentClientPortalTokens).values({
        clientId: client.id,
        brandId: client.brandId,
        token,
        expiresAt,
      });
      return { sessionToken: token, clientId: client.id, brandId: client.brandId };
    }),

  sendPortalLink: protectedProcedure
    .input(z.object({ clientId: z.string().uuid(), origin: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const client = await loadClient(input.clientId);
      await requirePaymentWrite(ctx, client.brandId);
      if (!client.email) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Client has no email address' });
      const account = await getPaymentAccount(client.brandId);
      const token = portalToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await db.insert(paymentClientPortalTokens).values({
        clientId: client.id,
        brandId: client.brandId,
        token,
        expiresAt,
      });
      // emailBaseUrl enforces the *.prodesk.com allow-list in hosted envs, so a
      // caller-supplied origin can't be used for phishing links.
      const base = emailBaseUrl(input.origin || ctx.clientOrigin);
      const portalUrl = `${base}/client-portal/verify?token=${token}`;
      const businessName = account?.businessName ?? 'Prodesk';
      await sendEmail({
        to: client.email,
        subject: `Your ${businessName} client portal link`,
        htmlBody: `<p>Hi ${client.name},</p><p>Click the link below to access your client portal:</p><p><a href="${portalUrl}" style="display:inline-block;background:#0E0E0C;color:#D9F542;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Open my portal →</a></p><p>This link expires in 7 days.</p>`,
        textBody: `Hi ${client.name},\n\nAccess your ${businessName} client portal:\n\n${portalUrl}\n\nThis link expires in 7 days.`,
      });
      return { sent: true, portalUrl };
    }),
});
