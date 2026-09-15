/**
 * Support Tickets — platform-wide customer support ticketing.
 *
 * Every user, on every frontend, reaches support through the shared /support
 * page. `protectedProcedure` endpoints are creator-scoped (a user only ever
 * sees their own tickets); the `admin*` endpoints run on `superAdminProcedure`
 * and back the /super-admin/tickets console. Every reply is a threaded comment
 * (support_ticket_comments) that enqueues a transactional email to the other
 * party via the BullMQ worker (see jobs/worker.ts `support-ticket-*` cases).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import {
  supportTickets,
  supportTicketComments,
  users,
  brands,
  agencies,
  featureSubscriptions,
  featureSubscriptionProducts,
  type SupportTicketMetadata,
} from '../db/schema.js';
import {
  protectedProcedure,
  router,
  superAdminProcedure,
} from '../trpc/trpc.js';
import { paginationInput, page } from '../lib/pagination.js';
import { enqueueEmail } from '../lib/notify.js';
import { recordLockerFiles, fileTypeFromName, type LockerFileInput } from '../modules/locker/record.js';
import type { DB } from '../db/index.js';

/** An uploaded attachment (public storage URL + display metadata). */
const attachmentSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).max(300),
  size: z.number().int().min(0),
});
const attachmentsSchema = z.array(attachmentSchema).max(20).optional();
type SupportAttachment = z.infer<typeof attachmentSchema>;

/**
 * Document Locker: mirror a ticket's attachments into the brand's **Private
 * Documents**. Support attachments are often screenshots of the user's own
 * workspace, so they stay brand-private — never agency-owned and never a public
 * brand asset. Skipped for a user with no brand context (agency-only or
 * platform-admin tickets have nowhere to file them).
 *
 * `scopeId` is the ticket id for the opening message and the comment id for a
 * reply, so re-attaching the same file to a later reply is kept as history while
 * a retried mutation stays a no-op (§3 of docs/document-locker.md).
 */
async function recordTicketAttachments(
  db: DB,
  args: {
    brandId: string | null;
    ticketNumber: number;
    scopeId: string;
    userId: string;
    attachments: SupportAttachment[];
  },
): Promise<void> {
  if (!args.brandId || !args.attachments.length) return;
  const rows: LockerFileInput[] = args.attachments.map((a) => ({
    brandId: args.brandId!,
    url: a.url,
    name: a.name,
    uploadedBy: args.userId,
    size: a.size,
    type: fileTypeFromName(a.name),
    category: 'support',
    source: 'brand',
    note: `Attached to support ticket #${args.ticketNumber}`,
    isPrivate: true,
    sourceType: 'support' as const,
    sourceId: `${args.scopeId}:${a.url}`,
  }));
  await recordLockerFiles(db, rows);
}

/**
 * Client-captured diagnostics sent with `create` (origin URL, device info, and a
 * tail of the browser console). Enriched server-side with the trusted ip/
 * userAgent/client before being stored on the ticket. Everything is optional and
 * bounded so a malformed or oversized payload can never block ticket creation.
 */
const consoleEntrySchema = z.object({
  level: z.string().max(20),
  message: z.string().max(4000),
  at: z.string().max(40),
});
const diagnosticsSchema = z
  .object({
    pageUrl: z.string().max(2000).optional(),
    origin: z.string().max(500).optional(),
    referrer: z.string().max(2000).optional(),
    userAgent: z.string().max(1000).optional(),
    platform: z.string().max(200).optional(),
    language: z.string().max(50).optional(),
    languages: z.array(z.string().max(50)).max(20).optional(),
    timezone: z.string().max(100).optional(),
    timezoneOffsetMinutes: z.number().int().optional(),
    screen: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
    viewport: z.object({ width: z.number().int(), height: z.number().int() }).optional(),
    devicePixelRatio: z.number().optional(),
    console: z.array(consoleEntrySchema).max(100).optional(),
  })
  .optional();

const statusSchema = z.enum(['open', 'in_progress', 'resolved', 'closed']);
/** Which surface a ticket came from — see supportTicketSource in the schema. */
const sourceSchema = z.enum(['support', 'feedback']);
const prioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
const categorySchema = z.enum([
  'general',
  'billing',
  'technical',
  'feature_request',
  'account',
  'other',
]);

/**
 * A scannable subject for a piece of feedback, derived from its body.
 *
 * The feedback panel deliberately gives the user ONE field — asking for a subject
 * would add friction to the thing we most want them to do — but the admin console
 * lists by subject, so we synthesize one from the first line/sentence.
 */
function feedbackHeadline(body: string, max = 120): string {
  const firstLine = body.trim().split(/\r?\n/, 1)[0]?.trim() ?? '';
  const source = firstLine || body.trim();
  if (source.length <= max) return source || 'Feedback';
  // Cut on a word boundary so the headline doesn't end mid-word.
  const cut = source.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export const supportRouter = router({
  /* ── Customer surface (creator-scoped) ──────────────────────────────── */

  /**
   * The caller's own SUPPORT tickets, newest activity first.
   *
   * Scoped to `source = 'support'`: product feedback is stored in this same table
   * but belongs to the feedback panel, and must not appear on the Support screen
   * as a ticket (see supportTicketSource).
   */
  list: protectedProcedure
    .input(
      z.object({
        status: statusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(supportTickets.userId, ctx.user.id),
        eq(supportTickets.source, 'support'),
        ...(input.status ? [eq(supportTickets.status, input.status)] : []),
      );
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select()
          .from(supportTickets)
          .where(where)
          .orderBy(desc(supportTickets.updatedAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(supportTickets).where(where),
      ]);
      return page(rows, total, input);
    }),

  /** A single ticket the caller owns, with its comment thread. */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const ticket = (
        await ctx.db.select().from(supportTickets).where(eq(supportTickets.id, input.id)).limit(1)
      )[0];
      if (!ticket) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
      if (ticket.userId !== ctx.user.id && !ctx.user.isSuperAdmin) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const comments = await ctx.db
        .select()
        .from(supportTicketComments)
        .where(eq(supportTicketComments.ticketId, ticket.id))
        .orderBy(supportTicketComments.createdAt);
      // Internal notes are for admins only — never leak them to the customer.
      const visible = ctx.user.isSuperAdmin ? comments : comments.filter((c) => !c.isInternal);
      return { ticket, comments: visible };
    }),

  /** Open a new ticket. Also creates the first comment (the customer's message). */
  create: protectedProcedure
    .input(
      z.object({
        subject: z.string().trim().min(3).max(200),
        category: categorySchema.default('general'),
        priority: prioritySchema.default('medium'),
        body: z.string().trim().min(1).max(10000),
        contactEmail: z.string().trim().email().optional(),
        attachments: attachmentsSchema,
        diagnostics: diagnosticsSchema,
        // Set when the AI assistant drafted this ticket on the user's behalf.
        // Surfaces to support as an internal note; never shown to the customer.
        writtenByAi: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      // Merge the client-captured diagnostics with the trusted request signals
      // (ip / user-agent / issuing frontend). Origin URL comes from the client's
      // full pageUrl; appOrigin keeps the bare origin for link resolution.
      const metadata: SupportTicketMetadata = {
        ...input.diagnostics,
        origin: input.diagnostics?.origin ?? ctx.clientOrigin,
        userAgent: input.diagnostics?.userAgent ?? ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
        client: ctx.client ?? null,
      };
      const [ticket] = await ctx.db
        .insert(supportTickets)
        .values({
          userId: ctx.user.id,
          contactEmail: input.contactEmail ?? ctx.user.email,
          appOrigin: ctx.clientOrigin,
          brandId: ctx.user.selectedBrandId ?? null,
          agencyId: ctx.user.selectedAgencyId ?? null,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          status: 'open',
          attachments: input.attachments ?? [],
          metadata,
          lastActorRole: 'customer',
          lastReplyAt: now,
        })
        .returning();
      // Server-side breadcrumb for triage (correlates with the worker email).
      // eslint-disable-next-line no-console
      console.log(
        `[support] ticket #${ticket.ticketNumber} created by ${ctx.user.id} ` +
          `from ${metadata.pageUrl ?? ctx.clientOrigin} (ip=${metadata.ip ?? 'unknown'}, client=${metadata.client ?? 'unknown'})`,
      );
      await ctx.db.insert(supportTicketComments).values({
        ticketId: ticket.id,
        authorUserId: ctx.user.id,
        authorRole: 'customer',
        body: input.body,
        attachments: input.attachments ?? [],
      });
      if (input.writtenByAi) {
        await ctx.db.insert(supportTicketComments).values({
          ticketId: ticket.id,
          authorUserId: null,
          authorRole: 'support',
          body: 'Written by AI — this ticket was drafted by the Prodesk AI assistant and submitted after the user confirmed it in chat.',
          isInternal: true,
        });
      }
      await recordTicketAttachments(ctx.db, {
        brandId: ticket.brandId,
        ticketNumber: ticket.ticketNumber,
        scopeId: ticket.id,
        userId: ctx.user.id,
        attachments: input.attachments ?? [],
      }).catch((e) => console.error('[support] locker copy failed', (e as Error).message));
      await enqueueEmail('support-ticket-created', {
        ticketId: ticket.id,
        origin: ctx.clientOrigin,
      });
      return ticket;
    }),

  /** Add a customer reply to an existing ticket. */
  reply: protectedProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: z.string().trim().min(1).max(10000),
        attachments: attachmentsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ticket = (
        await ctx.db
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.id, input.ticketId))
          .limit(1)
      )[0];
      if (!ticket) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
      if (ticket.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
      if (ticket.status === 'closed') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This ticket is closed.' });
      }
      const now = new Date();
      const [comment] = await ctx.db
        .insert(supportTicketComments)
        .values({
          ticketId: ticket.id,
          authorUserId: ctx.user.id,
          authorRole: 'customer',
          body: input.body,
          attachments: input.attachments ?? [],
        })
        .returning();
      // A customer reply re-opens a resolved ticket so it lands back in triage.
      await ctx.db
        .update(supportTickets)
        .set({
          status: ticket.status === 'resolved' ? 'open' : ticket.status,
          lastActorRole: 'customer',
          lastReplyAt: now,
        })
        .where(eq(supportTickets.id, ticket.id));
      await recordTicketAttachments(ctx.db, {
        brandId: ticket.brandId,
        ticketNumber: ticket.ticketNumber,
        scopeId: comment.id,
        userId: ctx.user.id,
        attachments: input.attachments ?? [],
      }).catch((e) => console.error('[support] locker copy failed', (e as Error).message));
      await enqueueEmail('support-ticket-customer-reply', {
        commentId: comment.id,
        origin: ctx.clientOrigin,
      });
      return comment;
    }),

  /* ── Feedback surface (the floating panel on every frontend) ──────────────
   *
   * Product feedback is a support ticket underneath (`source = 'feedback'`), so it
   * lands in the same triage console, threads the same way, and emails the same
   * way. What differs is the CONTRACT with the user: the panel is "tell us what's
   * missing", not "raise a ticket". These procedures therefore expose no status,
   * priority or category — nothing that would leak ticket vocabulary into the UI —
   * and the reply a user sees is simply "our reply".
   *
   * Kept on this router rather than a `feedback` one because it is the same data
   * and the same permissions; a separate router would duplicate both.
   * ─────────────────────────────────────────────────────────────────────────── */

  /**
   * The caller's own feedback, newest first, each with the team's replies. The
   * panel renders this the moment it opens, so it's a single indexed query
   * (support_tickets_user_source_idx) plus one comment fetch.
   */
  feedbackList: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(supportTickets.userId, ctx.user.id),
        eq(supportTickets.source, 'feedback'),
      );
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({
            id: supportTickets.id,
            body: supportTickets.subject,
            createdAt: supportTickets.createdAt,
            // Surfaced as "we've replied" / "we've actioned this", never as a
            // ticket status. The mapping to user-facing words lives in the panel.
            status: supportTickets.status,
            lastActorRole: supportTickets.lastActorRole,
            lastReplyAt: supportTickets.lastReplyAt,
          })
          .from(supportTickets)
          .where(where)
          .orderBy(desc(supportTickets.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(supportTickets).where(where),
      ]);
      if (rows.length === 0) return { items: [], total: Number(total) };

      // The full text lives in the first comment (the subject is a trimmed
      // headline), and any team response follows it. One query for all of them.
      const comments = await ctx.db
        .select({
          ticketId: supportTicketComments.ticketId,
          authorRole: supportTicketComments.authorRole,
          body: supportTicketComments.body,
          isInternal: supportTicketComments.isInternal,
          createdAt: supportTicketComments.createdAt,
        })
        .from(supportTicketComments)
        .where(
          inArray(
            supportTicketComments.ticketId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(supportTicketComments.createdAt);

      const byTicket = new Map<string, typeof comments>();
      for (const c of comments) {
        // Internal admin notes are never shown to the person who gave the feedback.
        if (c.isInternal) continue;
        const list = byTicket.get(c.ticketId) ?? [];
        list.push(c);
        byTicket.set(c.ticketId, list);
      }

      return {
        items: rows.map((r) => {
          const thread = byTicket.get(r.id) ?? [];
          const first = thread.find((c) => c.authorRole === 'customer');
          const replies = thread.filter((c) => c.authorRole === 'support');
          return {
            id: r.id,
            /** The feedback as the user wrote it (full text, not the headline). */
            body: first?.body ?? r.body,
            createdAt: r.createdAt,
            /** Has the team responded? Drives the "Replied" marker in the panel. */
            answered: replies.length > 0,
            /** True once support marked it resolved/closed — shown as "Actioned". */
            actioned: r.status === 'resolved' || r.status === 'closed',
            replies: replies.map((c) => ({ body: c.body, createdAt: c.createdAt })),
          };
        }),
        total: Number(total),
      };
    }),

  /**
   * Submit feedback. Creates a `source = 'feedback'` ticket plus the message as its
   * first comment, exactly like `create` does, and notifies the admins through the
   * same job — so feedback is never a second-class citizen in triage.
   *
   * The subject is derived from the first line of the body: the user is given one
   * field and a submit button (that's the whole point of the panel), but support
   * still needs a scannable headline in the console.
   */
  submitFeedback: protectedProcedure
    .input(
      z.object({
        body: z.string().trim().min(1).max(10000),
        attachments: attachmentsSchema,
        diagnostics: diagnosticsSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const metadata: SupportTicketMetadata = {
        ...input.diagnostics,
        origin: input.diagnostics?.origin ?? ctx.clientOrigin,
        userAgent: input.diagnostics?.userAgent ?? ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
        client: ctx.client ?? null,
      };
      const [ticket] = await ctx.db
        .insert(supportTickets)
        .values({
          userId: ctx.user.id,
          contactEmail: ctx.user.email,
          appOrigin: ctx.clientOrigin,
          brandId: ctx.user.selectedBrandId ?? null,
          agencyId: ctx.user.selectedAgencyId ?? null,
          subject: feedbackHeadline(input.body),
          source: 'feedback',
          // Feedback is a product signal, not an incident: it enters triage as an
          // ordinary feature request rather than competing with real support load.
          category: 'feature_request',
          priority: 'low',
          status: 'open',
          attachments: input.attachments ?? [],
          metadata,
          lastActorRole: 'customer',
          lastReplyAt: now,
        })
        .returning();
      // eslint-disable-next-line no-console
      console.log(
        `[feedback] #${ticket.ticketNumber} from ${ctx.user.id} ` +
          `on ${metadata.client ?? 'unknown'} (${metadata.pageUrl ?? ctx.clientOrigin})`,
      );
      await ctx.db.insert(supportTicketComments).values({
        ticketId: ticket.id,
        authorUserId: ctx.user.id,
        authorRole: 'customer',
        body: input.body,
        attachments: input.attachments ?? [],
      });
      await recordTicketAttachments(ctx.db, {
        brandId: ticket.brandId,
        ticketNumber: ticket.ticketNumber,
        scopeId: ticket.id,
        userId: ctx.user.id,
        attachments: input.attachments ?? [],
      }).catch((e) => console.error('[feedback] locker copy failed', (e as Error).message));
      await enqueueEmail('support-ticket-created', {
        ticketId: ticket.id,
        origin: ctx.clientOrigin,
      });
      return { id: ticket.id };
    }),

  /* ── Super-admin surface ────────────────────────────────────────────── */

  /**
   * Every ticket, newest activity first, with creator identity.
   *
   * `source` filters the console to Support requests or product Feedback. It
   * defaults to UNFILTERED so nothing is hidden from triage by accident — the
   * console picks a tab explicitly.
   */
  adminList: superAdminProcedure
    .input(
      z.object({
        status: statusSchema.optional(),
        source: sourceSchema.optional(),
        ...paginationInput.shape,
      }),
    )
    .query(async ({ ctx, input }) => {
      const conds: SQL[] = [];
      if (input.status) conds.push(eq(supportTickets.status, input.status));
      if (input.source) conds.push(eq(supportTickets.source, input.source));
      if (input.search) {
        conds.push(
          or(
            ilike(supportTickets.subject, `%${input.search}%`),
            ilike(supportTickets.contactEmail, `%${input.search}%`),
          )!,
        );
      }
      const where = conds.length ? and(...conds) : undefined;
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({
            ticket: supportTickets,
            creatorFirstName: users.firstName,
            creatorLastName: users.lastName,
            creatorEmail: users.email,
            brandName: brands.businessName,
            agencyName: agencies.businessName,
          })
          .from(supportTickets)
          .leftJoin(users, eq(supportTickets.userId, users.id))
          .leftJoin(brands, eq(supportTickets.brandId, brands.id))
          .leftJoin(agencies, eq(supportTickets.agencyId, agencies.id))
          .where(where)
          .orderBy(desc(supportTickets.updatedAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(supportTickets).where(where),
      ]);
      const items = rows.map((r) => ({
        ...r.ticket,
        creatorName:
          [r.creatorFirstName, r.creatorLastName].filter(Boolean).join(' ').trim() || null,
        creatorEmail: r.creatorEmail,
        brandName: r.brandName,
        agencyName: r.agencyName,
      }));
      return page(items, total, input);
    }),

  /** Count of tickets awaiting a support reply (open + in_progress). Nav badge. */
  adminOpenCount: superAdminProcedure
    .input(z.object({ source: sourceSchema.optional() }).optional())
    .query(async ({ ctx, input }) => {
      // Feedback lives in the same table, so an unfiltered count would inflate the
      // support badge with feature requests. Callers pass the source they're
      // badging; omitting it keeps the original all-sources meaning.
      const [{ value }] = await ctx.db
        .select({ value: count() })
        .from(supportTickets)
        .where(
          and(
            or(eq(supportTickets.status, 'open'), eq(supportTickets.status, 'in_progress')),
            ...(input?.source ? [eq(supportTickets.source, input.source)] : []),
          ),
        );
      return value;
    }),

  /** Full ticket incl. internal notes (admin only). */
  adminGet: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = (
        await ctx.db
          .select({
            ticket: supportTickets,
            creatorFirstName: users.firstName,
            creatorLastName: users.lastName,
            creatorEmail: users.email,
            brandName: brands.businessName,
            agencyName: agencies.businessName,
          })
          .from(supportTickets)
          .leftJoin(users, eq(supportTickets.userId, users.id))
          .leftJoin(brands, eq(supportTickets.brandId, brands.id))
          .leftJoin(agencies, eq(supportTickets.agencyId, agencies.id))
          .where(eq(supportTickets.id, input.id))
          .limit(1)
      )[0];
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
      const comments = await ctx.db
        .select()
        .from(supportTicketComments)
        .where(eq(supportTicketComments.ticketId, input.id))
        .orderBy(supportTicketComments.createdAt);
      // The creator's feature subscriptions, resolved LIVE at view time (not
      // snapshotted onto the ticket) so the admin sees the customer's current
      // plans. Feature subscriptions are owner-scoped (userId = the subscriber).
      const subscriptions = row.ticket.userId
        ? await ctx.db
            .select({
              id: featureSubscriptions.id,
              productName: featureSubscriptionProducts.name,
              productSlug: featureSubscriptionProducts.slug,
              status: featureSubscriptions.status,
              interval: featureSubscriptions.interval,
              amount: featureSubscriptions.amount,
              currency: featureSubscriptions.currency,
              quantity: featureSubscriptions.quantity,
              currentPeriodEnd: featureSubscriptions.currentPeriodEnd,
              cancelAtPeriodEnd: featureSubscriptions.cancelAtPeriodEnd,
            })
            .from(featureSubscriptions)
            .leftJoin(
              featureSubscriptionProducts,
              eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
            )
            .where(eq(featureSubscriptions.userId, row.ticket.userId))
            .orderBy(desc(featureSubscriptions.createdAt))
        : [];
      return {
        ticket: {
          ...row.ticket,
          creatorName:
            [row.creatorFirstName, row.creatorLastName].filter(Boolean).join(' ').trim() || null,
          creatorEmail: row.creatorEmail,
          brandName: row.brandName,
          agencyName: row.agencyName,
        },
        comments,
        subscriptions,
      };
    }),

  /** Support reply. Emails the customer unless it's an internal note. */
  adminReply: superAdminProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        body: z.string().trim().min(1).max(10000),
        attachments: attachmentsSchema,
        isInternal: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ticket = (
        await ctx.db
          .select()
          .from(supportTickets)
          .where(eq(supportTickets.id, input.ticketId))
          .limit(1)
      )[0];
      if (!ticket) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
      const [comment] = await ctx.db
        .insert(supportTicketComments)
        .values({
          ticketId: ticket.id,
          authorUserId: ctx.user.id,
          authorRole: 'support',
          body: input.body,
          attachments: input.attachments ?? [],
          isInternal: input.isInternal,
        })
        .returning();
      if (!input.isInternal) {
        await ctx.db
          .update(supportTickets)
          .set({
            // A support reply moves the ticket into "in progress" (unless the
            // admin has already resolved/closed it).
            status: ticket.status === 'open' ? 'in_progress' : ticket.status,
            lastActorRole: 'support',
            lastReplyAt: new Date(),
          })
          .where(eq(supportTickets.id, ticket.id));
        await enqueueEmail('support-ticket-reply', {
          commentId: comment.id,
          origin: ticket.appOrigin ?? undefined,
        });
      }
      return comment;
    }),

  /** Change status and/or priority. Stamps resolvedAt on resolve. */
  adminUpdateStatus: superAdminProcedure
    .input(
      z.object({
        ticketId: z.string().uuid(),
        status: statusSchema.optional(),
        priority: prioritySchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.status && !input.priority) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing to update.' });
      }
      const [updated] = await ctx.db
        .update(supportTickets)
        .set({
          ...(input.status ? { status: input.status } : {}),
          ...(input.priority ? { priority: input.priority } : {}),
          ...(input.status === 'resolved' ? { resolvedAt: new Date() } : {}),
        })
        .where(eq(supportTickets.id, input.ticketId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Ticket not found' });
      return updated;
    }),
});
