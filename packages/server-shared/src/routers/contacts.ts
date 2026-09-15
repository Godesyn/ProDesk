/**
 * Shared CRM contacts router (WS3) — a neutral `trpc.contacts.*` façade over the
 * payment_clients store (see modules/crm/contacts.ts). Any Prodesk surface can
 * read/write contacts through it without depending on the payments module.
 * Tenancy is enforced here via assertBrandAccess on the brandId.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { assertBrandAccess } from '../trpc/permissions.js';
import {
  getContactById,
  linkContactToUser,
  listContacts,
  upsertContact,
} from '../modules/crm/contacts.js';

export const contactsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        search: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      return listContacts(input.brandId, input);
    }),

  get: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const contact = await getContactById(input.brandId, input.id);
      if (!contact) throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      return contact;
    }),

  upsert: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        id: z.string().uuid().optional(),
        name: z.string().min(1),
        email: z.string().email().nullable().optional(),
        mobile: z.string().nullable().optional(),
        businessName: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        abn: z.string().nullable().optional(),
        internalNotes: z.string().nullable().optional(),
        tags: z.string().nullable().optional(),
        userId: z.string().uuid().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const { brandId, ...data } = input;
      const id = await upsertContact(brandId, data);
      return getContactById(brandId, id);
    }),

  linkUser: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), id: z.string().uuid(), userId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      await linkContactToUser(input.brandId, input.id, input.userId);
      return getContactById(input.brandId, input.id);
    }),
});
