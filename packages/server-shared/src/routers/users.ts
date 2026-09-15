import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { users, emailUnsubscribes } from '../db/schema.js';
import { createWiseRecipient } from '../modules/billing/wise.js';
import { stripe } from '../modules/stripe/client.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { env } from '../lib/env.js';

const payoutMethodEnum = z.enum(['stripe', 'paypal', 'wire']);

/** A Wise recipient bank account surfaced to the client after OAuth. */
export interface WiseAccount {
  id: number;
  accountHolderName: string;
  currency: string;
  country: string;
  type: string;
  bankName: string;
  accountNumber: string;
  routingNumber: string;
  swiftCode: string;
}

export const usersRouter = router({
  byId: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return (await ctx.db.select().from(users).where(eq(users.id, input.id)).limit(1))[0] ?? null;
  }),

  /**
   * Presence heartbeat — stamps `last_seen_at` to now. The client calls this
   * every ~30s while the app is foregrounded; the chat-digest worker treats a
   * recent value as "online" and suppresses the email (ports Flutter
   * PresenceService). Best-effort and cheap; never throws to the caller.
   */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, ctx.user.id));
    return { ok: true };
  }),

  /* ── Email preferences (NotificationChannel unsubscribe state) ──────────── */

  /** The channels the current user has unsubscribed from (getUnsubscribedChannels). */
  unsubscribedChannels: protectedProcedure.query(async ({ ctx }) => {
    const row = (await ctx.db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.email, ctx.user.email)).limit(1))[0];
    return { channels: row?.channels ?? [] };
  }),

  /** Subscribe/unsubscribe the current user's email from a channel (toggleUnsubscribeChannel). */
  toggleUnsubscribeChannel: protectedProcedure
    .input(z.object({ channel: z.enum(['task', 'chat']), unsubscribe: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const email = ctx.user.email;
      const existing = (await ctx.db.select().from(emailUnsubscribes).where(eq(emailUnsubscribes.email, email)).limit(1))[0];
      const current = new Set(existing?.channels ?? []);
      if (input.unsubscribe) current.add(input.channel);
      else current.delete(input.channel);
      const channels = [...current];
      await ctx.db
        .insert(emailUnsubscribes)
        .values({ email, channels })
        .onConflictDoUpdate({ target: emailUnsubscribes.email, set: { channels, updatedAt: new Date() } });
      return { channels };
    }),

  updateProfile: protectedProcedure
    .input(
      z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        profileUrl: z.string().url().optional(),
        uiPreferences: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /**
   * Merge a single UI preference key (updateUiPreference). Unlike updateProfile,
   * which replaces the whole `uiPreferences` object, this preserves sibling keys
   * — mirroring Flutter's nested-merge `set({ uiPreferences: { key: value } })`.
   * Used for per-user UI state like hiddenKanbanColumns and cacheImages.
   */
  updateUiPreference: protectedProcedure
    .input(z.object({ key: z.string().min(1), value: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (ctx.user.uiPreferences ?? {}) as Record<string, unknown>;
      const [updated] = await ctx.db
        .update(users)
        .set({ uiPreferences: { ...existing, [input.key]: input.value } })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  setActiveContext: protectedProcedure
    .input(z.object({ selectedAgencyId: z.string().uuid().nullable(), selectedBrandId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ selectedAgencyId: input.selectedAgencyId, selectedBrandId: input.selectedBrandId })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /**
   * Change the current user's password. Reauthentication-then-update on Firebase
   * maps to a Supabase secret-key admin update on the GoTrue user. The client
   * is expected to have just re-verified the current password via a fresh
   * sign-in (matching the Flutter reauthenticate step).
   */
  changePassword: protectedProcedure
    .input(z.object({ newPassword: z.string().min(8, 'Password must be at least 8 characters') }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(ctx.user.id, { password: input.newPassword });
      if (error) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
      return { ok: true };
    }),

  /** Payout settings (profile → withdrawal methods). Saves details + active method. */
  updatePayout: protectedProcedure
    .input(
      z.object({
        activePayoutMethod: payoutMethodEnum.optional(),
        payoutMethods: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ activePayoutMethod: input.activePayoutMethod, payoutMethods: input.payoutMethods })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /** Save details for a single payout method (merge into payoutMethods jsonb). */
  savePayoutMethodDetails: protectedProcedure
    .input(z.object({ method: payoutMethodEnum, details: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ ctx, input }) => {
      const existing = (ctx.user.payoutMethods ?? {}) as Record<string, unknown>;
      const [updated] = await ctx.db
        .update(users)
        .set({ payoutMethods: { ...existing, [input.method]: input.details } })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /** Set (or clear) the active payout method. Mirrors setActivePayoutMethod. */
  setActivePayoutMethod: protectedProcedure
    .input(z.object({ method: payoutMethodEnum.nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ activePayoutMethod: input.method })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /**
   * Remove/disconnect a payout method's details. If it was the active method,
   * the active flag is demoted to null. Wire removal also clears bankAccountLinked.
   * Mirrors removePayoutMethod + unlinkBankAccount.
   */
  removePayoutMethod: protectedProcedure
    .input(z.object({ method: payoutMethodEnum }))
    .mutation(async ({ ctx, input }) => {
      const existing = { ...((ctx.user.payoutMethods ?? {}) as Record<string, unknown>) };
      delete existing[input.method];
      const wasActive = ctx.user.activePayoutMethod === input.method;
      const patch: Record<string, unknown> = { payoutMethods: existing };
      if (wasActive) patch.activePayoutMethod = null;
      if (input.method === 'wire' || input.method === 'stripe') patch.bankAccountLinked = false;
      if (input.method === 'stripe') patch.stripeAccountId = null;
      const [updated] = await ctx.db.update(users).set(patch).where(eq(users.id, ctx.user.id)).returning();
      return updated;
    }),

  /**
   * Link a bank account for Wise (wire) payouts: creates a Wise recipient,
   * stores its id, and marks the user payout-ready. Ports the link-Wise-recipient
   * flow from main. Works in dev without Wise (stores details, recipientId null).
   */
  linkWiseRecipient: protectedProcedure
    .input(
      z.object({
        accountHolderName: z.string().min(1),
        currency: z.string().nullable().optional(),
        bankName: z.string().optional(),
        accountNumber: z.string().optional(),
        routingNumber: z.string().nullable().optional(),
        swiftCode: z.string().nullable().optional(),
        country: z.string().optional(),
        accountType: z.string().nullable().optional(),
        address: z.object({
          firstLine: z.string().nullable().optional(),
          city: z.string().nullable().optional(),
          state: z.string().nullable().optional(),
          postCode: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
        }).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // createWiseRecipient throws precise, human-readable reasons (unsupported
      // currency, missing fields Wise requires, the exact field error from Wise's
      // API). Surface them as BAD_REQUEST so the message reaches the user instead
      // of being masked behind a generic 500 "Something went wrong".
      let recipientId: string | null;
      try {
        recipientId = await createWiseRecipient(input);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'Could not link this bank account.',
          cause: err,
        });
      }
      const existing = (ctx.user.payoutMethods ?? {}) as Record<string, unknown>;
      const [updated] = await ctx.db
        .update(users)
        .set({
          activePayoutMethod: 'wire',
          bankAccountLinked: true,
          payoutMethods: { ...existing, wire: { ...input, recipientId } },
        })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),

  /**
   * Validate wire/bank details against Wise before saving (validateWiseRecipient).
   * Returns { ok, error } — `error` is a human-readable message when invalid.
   * In dev (Wise unconfigured) this passes through.
   */
  validateWireDetails: protectedProcedure
    .input(
      z.object({
        accountHolderName: z.string().min(1),
        currency: z.string().nullable().optional(),
        bankName: z.string().optional(),
        accountNumber: z.string().optional(),
        routingNumber: z.string().nullable().optional(),
        swiftCode: z.string().nullable().optional(),
        country: z.string().optional(),
        accountType: z.string().nullable().optional(),
        address: z.object({
          firstLine: z.string().nullable().optional(),
          city: z.string().nullable().optional(),
          state: z.string().nullable().optional(),
          postCode: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
        }).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        // createWiseRecipient validates the shape against Wise; in dev it returns
        // null without a network call. A thrown error means invalid details.
        await createWiseRecipient(input);
        return { ok: true as const, error: null };
      } catch (err) {
        return { ok: false as const, error: (err as Error).message };
      }
    }),

  /**
   * Create (or reuse) a Stripe Connect account and return an onboarding
   * account-link URL for the external redirect. Ports
   * createStripeConnectAccount + createStripeAccountLink.
   */
  createStripeConnectLink: protectedProcedure
    .input(z.object({ country: z.string().length(2).default('AU') }))
    .mutation(async ({ ctx, input }) => {
      if (!stripe) {
        // TODO(by ai): Stripe not configured in this env. Return null so the UI
        // can show a "connect unavailable in dev" message instead of redirecting.
        return { url: null as string | null, accountId: null as string | null };
      }
      let accountId = ctx.user.stripeAccountId ?? null;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          email: ctx.user.email,
          country: input.country,
          capabilities: { transfers: { requested: true } },
        });
        accountId = account.id;
        await ctx.db.update(users).set({ stripeAccountId: accountId }).where(eq(users.id, ctx.user.id));
      }
      const origin = ctx.clientOrigin;
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${origin}/profile`,
        return_url: `${origin}/profile`,
        type: 'account_onboarding',
      });
      return { url: link.url, accountId };
    }),

  /** Fetch a Stripe Connect account's onboarding/payout status. */
  stripeAccountStatus: protectedProcedure.query(async ({ ctx }) => {
    const accountId = ctx.user.stripeAccountId;
    if (!accountId || !stripe) return null;
    try {
      const acct = await stripe.accounts.retrieve(accountId);
      return {
        accountId,
        chargesEnabled: acct.charges_enabled,
        payoutsEnabled: acct.payouts_enabled,
        detailsSubmitted: acct.details_submitted,
      };
    } catch {
      return null;
    }
  }),

  /**
   * Wise OAuth: return the authorization URL the user is redirected to
   * (getWiseAuthUrl). Stubbed when Wise OAuth isn't configured.
   */
  getWiseAuthUrl: protectedProcedure
    .input(z.object({ redirectUri: z.string().url() }).optional())
    .mutation(async ({ ctx, input }) => {
      const clientId = env.WISE_CLIENT_ID;
      if (!clientId) return { url: null as string | null };
      const redirect = input?.redirectUri ?? `${ctx.clientOrigin}/profile?wise_callback=true`;
      const url = `https://api.transferwise.com/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}`;
      return { url };
    }),

  /**
   * Exchange a Wise OAuth code for the user's candidate recipient accounts
   * (exchangeWiseCode). Stubbed: returns an empty candidate list until Wise
   * OAuth is configured.
   */
  exchangeWiseCode: protectedProcedure
    .input(z.object({ code: z.string(), redirectUri: z.string().url().optional() }))
    .mutation(async ({ ctx, input }) => {
      const clientId = env.WISE_CLIENT_ID;
      const clientSecret = env.WISE_CLIENT_SECRET;
      if (!clientId || !clientSecret) return { accounts: [] as WiseAccount[] };
      const base = env.NODE_ENV === 'production' ? 'https://api.wise.com' : 'https://api.sandbox.transferwise.tech';
      const redirectUri = input.redirectUri ?? `${ctx.clientOrigin}/profile?wise_callback=true`;

      // 1. Exchange the auth code for an access token.
      const tokenRes = await fetch(`${base}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: input.code, redirect_uri: redirectUri }).toString(),
      });
      if (!tokenRes.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Wise token exchange failed (${tokenRes.status})` });
      const accessToken = ((await tokenRes.json()) as { access_token?: string }).access_token;
      if (!accessToken) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Wise returned no access token' });
      const auth = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

      // 2. Resolve the first profile, then 3. list its recipient accounts.
      const profiles = (await (await fetch(`${base}/v1/profiles`, { headers: auth })).json()) as Array<{ id: number }>;
      if (!profiles?.length) return { accounts: [] as WiseAccount[] };
      const accounts = (await (await fetch(`${base}/v1/accounts?profileId=${profiles[0].id}`, { headers: auth })).json()) as Array<Record<string, any>>;
      const sanitized: WiseAccount[] = (accounts ?? []).map((a) => {
        const d = a.details ?? {};
        return {
          id: a.id,
          accountHolderName: a.accountHolderName ?? '',
          currency: a.currency ?? '',
          country: a.country ?? '',
          type: a.type ?? '',
          bankName: d.bankName ?? '',
          accountNumber: d.accountNumber ?? d.iban ?? '',
          routingNumber: d.routingNumber ?? d.bsb ?? d.sortCode ?? '',
          swiftCode: d.swiftCode ?? d.bic ?? '',
        };
      });
      return { accounts: sanitized };
    }),

  /** Link/unlink the user's Google Calendar (googleCalendarLinked column). */
  setCalendarLinked: protectedProcedure
    .input(z.object({ linked: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      // TODO(by ai): when linking, run the Google OAuth consent flow and store
      // the refresh token; when unlinking, revoke it. The flag is the source of
      // truth the UI reads (ProfileCalendarIntegrationCard).
      const [updated] = await ctx.db
        .update(users)
        .set({ googleCalendarLinked: input.linked })
        .where(eq(users.id, ctx.user.id))
        .returning();
      return updated;
    }),
});
