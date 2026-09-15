/**
 * Payments (EziQuotes) outbound webhooks router — lets vendors manage their
 * webhook endpoint registrations and inspect delivery history. Ported from
 * the Manus export's routers/outboundWebhooks.ts: list/create/deliveries take
 * a brandId input; entity-scoped procedures (update/rotateSecret/delete/
 * retryDelivery) resolve the brand from the target row.
 */
import crypto from 'crypto';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  paymentOutboundWebhookDeliveries,
  paymentWebhookEndpoints,
} from '../../db/schema.js';
import {
  requirePaymentRead,
  requirePaymentWrite,
} from '../../modules/payments/access.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

// All 14 lifecycle event types supported for filtering
export const LIFECYCLE_EVENT_TYPES = [
  'catch_up',
  'card_update',
  'skip_requested',
  'skip_applied',
  'pause_started',
  'pause_ended',
  'payout_full',
  'cancel_requested',
  'cancel_confirmed',
  'defer_requested',
  'defer_approved',
  'defer_rejected',
  'vendor_override',
  'plan_resumed',
] as const;

/** Load an endpoint row (any brand) — the caller gates on its brandId. */
async function getEndpointById(id: string) {
  const [endpoint] = await db
    .select()
    .from(paymentWebhookEndpoints)
    .where(eq(paymentWebhookEndpoints.id, id))
    .limit(1);
  if (!endpoint) throw new TRPCError({ code: 'NOT_FOUND' });
  return endpoint;
}

export const outboundWebhooksRouter = router({
  // ── List endpoints ──────────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);

      return db
        .select()
        .from(paymentWebhookEndpoints)
        .where(eq(paymentWebhookEndpoints.brandId, input.brandId))
        .orderBy(desc(paymentWebhookEndpoints.createdAt));
    }),

  // ── Create endpoint ─────────────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        url: z
          .string()
          .url('Must be a valid HTTPS URL')
          .refine((u) => u.startsWith('https://'), 'Webhook URL must use HTTPS'),
        description: z.string().max(200).optional(),
        eventFilter: z
          .array(z.enum(LIFECYCLE_EVENT_TYPES))
          .optional()
          .describe('Empty array or omitted = subscribe to all events'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);

      // Generate a random signing secret
      const secret = 'whs_' + crypto.randomBytes(24).toString('hex');

      const [endpoint] = await db
        .insert(paymentWebhookEndpoints)
        .values({
          brandId: input.brandId,
          url: input.url,
          secret,
          description: input.description ?? null,
          enabled: true,
          eventFilter:
            input.eventFilter && input.eventFilter.length > 0
              ? input.eventFilter.join(',')
              : null,
        })
        .returning();

      return endpoint;
    }),

  // ── Update endpoint ─────────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        url: z
          .string()
          .url()
          .refine((u) => u.startsWith('https://'), 'Must use HTTPS')
          .optional(),
        description: z.string().max(200).optional(),
        enabled: z.boolean().optional(),
        eventFilter: z.array(z.enum(LIFECYCLE_EVENT_TYPES)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getEndpointById(input.id);
      await requirePaymentWrite(ctx, existing.brandId);

      const updates: Partial<typeof paymentWebhookEndpoints.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (input.url !== undefined) updates.url = input.url;
      if (input.description !== undefined) updates.description = input.description;
      if (input.enabled !== undefined) updates.enabled = input.enabled;
      if (input.eventFilter !== undefined) {
        updates.eventFilter = input.eventFilter.length > 0 ? input.eventFilter.join(',') : null;
      }

      const [updated] = await db
        .update(paymentWebhookEndpoints)
        .set(updates)
        .where(eq(paymentWebhookEndpoints.id, input.id))
        .returning();

      return updated;
    }),

  // ── Rotate secret ───────────────────────────────────────────────────────
  rotateSecret: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getEndpointById(input.id);
      await requirePaymentWrite(ctx, existing.brandId);

      const newSecret = 'whs_' + crypto.randomBytes(24).toString('hex');

      const [updated] = await db
        .update(paymentWebhookEndpoints)
        .set({ secret: newSecret, updatedAt: new Date() })
        .where(eq(paymentWebhookEndpoints.id, input.id))
        .returning();

      return { secret: updated.secret };
    }),

  // ── Delete endpoint ─────────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getEndpointById(input.id);
      await requirePaymentWrite(ctx, existing.brandId);

      await db.delete(paymentWebhookEndpoints).where(eq(paymentWebhookEndpoints.id, input.id));

      return { success: true };
    }),

  // ── Delivery log ────────────────────────────────────────────────────────
  deliveries: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        endpointId: z.string().uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);

      const conditions = [eq(paymentOutboundWebhookDeliveries.brandId, input.brandId)];
      if (input.endpointId) {
        conditions.push(eq(paymentOutboundWebhookDeliveries.endpointId, input.endpointId));
      }

      return db
        .select()
        .from(paymentOutboundWebhookDeliveries)
        .where(and(...conditions))
        .orderBy(desc(paymentOutboundWebhookDeliveries.createdAt))
        .limit(input.limit);
    }),

  // ── Manual retry ────────────────────────────────────────────────────────
  retryDelivery: protectedProcedure
    .input(z.object({ deliveryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [delivery] = await db
        .select()
        .from(paymentOutboundWebhookDeliveries)
        .where(eq(paymentOutboundWebhookDeliveries.id, input.deliveryId))
        .limit(1);

      if (!delivery) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, delivery.brandId);

      // Reset to pending so the scheduled retry sweep picks it up
      await db
        .update(paymentOutboundWebhookDeliveries)
        .set({
          status: 'pending',
          nextRetryAt: new Date(),
          errorMessage: null,
        })
        .where(eq(paymentOutboundWebhookDeliveries.id, input.deliveryId));

      return { queued: true };
    }),

  // ── Event type catalogue ────────────────────────────────────────────────
  eventTypes: protectedProcedure.query(() => LIFECYCLE_EVENT_TYPES),
});
