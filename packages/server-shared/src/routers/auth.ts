import { z } from 'zod';
import { createHash, randomInt } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  router,
  publicProcedure,
  protectedProcedure,
  sessionProcedure,
} from '../trpc/trpc.js';
import type { DB } from '../db/index.js';
import {
  users,
  userAgencies,
  userBrands,
  staff,
  agencies,
  brands,
  contractors,
  proposals,
} from '../db/schema.js';
import {
  ensurePlatformAdminThread,
  handleStaffPermissionGranted,
} from '../modules/chat/threads.js';
import { expandAgencyPermissions } from '../trpc/permissions.js';
import { verifyInviteToken } from '../lib/invite-token.js';
import { connectContractorViaInvite } from '../modules/contractor/connect.js';
import { completeSystemTask } from './tasks.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { sendEmail } from '../modules/email/mailer.js';
import { emailBaseUrl } from '../modules/email/branding.js';
import {
  buildVerificationEmail,
  buildPasswordResetEmail,
  buildPasswordResetOtpEmail,
} from '../modules/email/auth-emails.js';
import { enqueueEmail } from '../lib/notify.js';
import { joinBetaOnProvisioning, resolveBetaJoin } from '../modules/beta/versions.js';

/* ── Migrated-account password recovery (app-owned 4-digit OTP) ──────────────
 * A 4-digit code is only 10k combinations, so it's guarded by a short TTL and a
 * hard attempt cap; only the SHA-256 hash is ever stored. */
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;

function hashResetOtp(code: string, userId: string): string {
  return createHash('sha256').update(`${code.trim()}:${userId}`).digest('hex');
}

/**
 * Validate the pending reset OTP for an email. Returns the user id on success;
 * throws (and increments the attempt counter on a wrong code) otherwise. Does
 * NOT consume the code — the caller decides whether to clear it.
 */
async function assertValidResetOtp(db: DB, email: string, code: string): Promise<string> {
  const row = (
    await db
      .select({
        id: users.id,
        requiresPasswordReset: users.requiresPasswordReset,
        resetOtpHash: users.resetOtpHash,
        resetOtpExpiresAt: users.resetOtpExpiresAt,
        resetOtpAttempts: users.resetOtpAttempts,
      })
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1)
  )[0];
  if (!row?.requiresPasswordReset || !row.resetOtpHash || !row.resetOtpExpiresAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'No active reset code. Request a new one.' });
  }
  if (row.resetOtpExpiresAt.getTime() < Date.now()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'This code has expired. Request a new one.' });
  }
  if (row.resetOtpAttempts >= OTP_MAX_ATTEMPTS) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts. Request a new code.' });
  }
  if (hashResetOtp(code, row.id) !== row.resetOtpHash) {
    await db
      .update(users)
      .set({ resetOtpAttempts: row.resetOtpAttempts + 1 })
      .where(eq(users.id, row.id));
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Incorrect code.' });
  }
  return row.id;
}

/** Inviter display name from a user row (first+last, else "Someone"). */
function inviterNameOf(user: {
  firstName: string | null;
  lastName: string | null;
}): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    'Someone'
  );
}

/** A switchable context (ports the Flutter ContextOption model). */
export type ContextOptionType = 'admin' | 'agency' | 'brand' | 'contractor';
export interface ContextOption {
  id: string;
  label: string;
  role:
    | 'superAdmin'
    | 'agencyOwner'
    | 'agencyStaff'
    | 'brandOwner'
    | 'brandStaff'
    | 'individualContractor';
  entityId: string | null;
  type: ContextOptionType;
  logoUrl: string | null;
  isDisabled: boolean;
  status: 'pending' | 'deleted' | null;
  /**
   * The caller's granular staff permissions for this context. Present for STAFF
   * options only (owner/admin/contractor bypass permission checks → omitted). A
   * brand-only frontend uses this to hide brand options where the staffer holds
   * none of that tool's permissions — see ContextSelector `appPermissions`.
   */
  permissions?: string[];
}

type DbUser = typeof users.$inferSelect;

/**
 * Self-healing edge-case role reassignment (Flutter AuthEdgeCaseService +
 * auth_controller.dart:55-79). When a user's selected agency/brand was deleted
 * or their active staff record was removed, the user is left pointing at a dead
 * org. This walks the same fallback ladder as Flutter's `navigateSomewhere` and
 * persists a still-valid state so the client never lands on a broken dashboard:
 *   valid agency membership → agencyOwner
 *   else any active staff   → agency/brand staff (with the matching selected id)
 *   else any brand          → brandOwner
 *   else                    → brandOwner with no org (clean new-owner state)
 * Super-admins with no org are promoted to the superAdmin role. Contractors and
 * users already in a valid state are left untouched. Returns the (possibly
 * updated) user row.
 */
async function healUserEdgeCases(
  db: DB,
  user: DbUser,
  agencyIds: string[],
  brandIds: string[],
  activeStaffRows: (typeof staff.$inferSelect)[],
): Promise<DbUser> {
  // Contractors never have an org context; nothing to heal.
  if (user.role === 'individualContractor') return user;

  const selectedAgencyId = user.selectedAgencyId;
  const selectedBrandId = user.selectedBrandId;

  // Determine whether the user is currently in a dead state.
  let dead = false;
  if (user.role === 'agencyOwner') {
    // onDelete:'set null' on selected_agency_id means a deleted agency already
    // cleared the pointer; a still-set id that is no longer a membership is dead.
    dead = !selectedAgencyId || !agencyIds.includes(selectedAgencyId);
  } else if (user.role === 'brandOwner') {
    dead = !!selectedBrandId && !brandIds.includes(selectedBrandId);
  } else if (user.role === 'agencyStaff' || user.role === 'brandStaff') {
    const orgId = selectedAgencyId ?? selectedBrandId;
    dead =
      !orgId ||
      !activeStaffRows.some((s) => s.agencyId === orgId || s.brandId === orgId);
  }

  // Also heal the "role set but no org" limbo for staff who lost their org. A
  // *null* role is NOT limbo — it is the legitimate pre-onboarding state for a
  // freshly verified user, who must be routed to role-selection and pick a role
  // (which is committed only when they create the matching org in the create-*
  // screens). Healing null → brandOwner here would skip role-selection entirely
  // and drop them on an org-less brand dashboard.
  const orgId = selectedAgencyId ?? selectedBrandId;
  const inLimbo =
    orgId == null &&
    (user.role === 'agencyStaff' || user.role === 'brandStaff');

  if (!dead && !inLimbo) return user;

  // Super-admin with no org → superAdmin role (independent of org membership).
  if (user.isSuperAdmin && orgId == null) {
    const [updated] = await db
      .update(users)
      .set({ role: 'superAdmin' })
      .where(eq(users.id, user.id))
      .returning();
    return updated;
  }

  const patch: Partial<typeof users.$inferInsert> = {};

  // 1. Prefer a valid agency membership → agency owner.
  if (agencyIds.length > 0) {
    patch.role = 'agencyOwner';
    patch.selectedAgencyId = agencyIds[0];
    patch.selectedBrandId = null;
  } else if (activeStaffRows.length > 0) {
    // 2. Any active staff record → staff role pointing at that org.
    const s = activeStaffRows[0];
    if (s.brandId) {
      patch.role = 'brandStaff';
      patch.selectedBrandId = s.brandId;
      patch.selectedAgencyId = null;
    } else {
      patch.role = 'agencyStaff';
      patch.selectedAgencyId = s.agencyId;
      patch.selectedBrandId = null;
    }
  } else if (brandIds.length > 0) {
    // 3. Any brand membership → brand owner.
    patch.role = 'brandOwner';
    patch.selectedBrandId = brandIds[0];
    patch.selectedAgencyId = null;
  } else {
    // 4. Nothing valid left → clean brandOwner fallback with no org.
    patch.role = 'brandOwner';
    patch.selectedAgencyId = null;
    patch.selectedBrandId = null;
  }

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, user.id))
    .returning();
  return updated;
}

export const authRouter = router({
  /**
   * Mint a one-time hand-off token so an authenticated session can be carried
   * across white-label subdomains (port of Flutter SubdomainDetector's
   * server-minted custom token). When a user logs in on the default `app` domain
   * but was referred by an agency, the client redirects them to that agency's
   * subdomain; since Supabase sessions are stored per-origin, we cannot share the
   * session directly. Instead we generate a short-lived, single-use magic-link
   * token_hash here — the subdomain redeems it with verifyOtp({type:'magiclink'})
   * to establish its own session (the same redemption path as /auth/confirm).
   * This never exposes the long-lived refresh token in a URL.
   */
  createSubdomainHandoff: protectedProcedure.mutation(async ({ ctx }) => {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: ctx.user.email,
    });
    if (error || !data?.properties?.hashed_token) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error?.message ?? 'Could not create hand-off token',
      });
    }
    return { tokenHash: data.properties.hashed_token };
  }),

  /**
   * Sign up (replaces the client `supabase.auth.signUp`). "Login now, verify
   * later": we create a login-ready account with `email_confirm: true` so the
   * user can sign in immediately (no blocking gate) — then deliver our own
   * branded verification link via SMTP. Email verification is tracked at the
   * APP level on `users.isEmailVerified` (starts false for email signups, set
   * true only when the user clicks our link); that flag drives the in-app
   * "verify your email" nudge banner, independent of GoTrue's email_confirmed_at
   * (which we set up-front purely to permit login). Names ride in user_metadata
   * so they survive to first authed load (ensureUser). The client signs in right
   * after this resolves, and redeems the link with verifyOtp({ type: 'magiclink' }).
   */
  signUp: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: created, error: createErr } =
        await supabaseAdmin.auth.admin.createUser({
          email: input.email,
          password: input.password,
          email_confirm: true, // GoTrue-level confirm so password login works immediately
          user_metadata: {
            first_name: input.firstName,
            last_name: input.lastName,
          },
        });
      if (createErr || !created?.user) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: createErr?.message ?? 'Could not create account',
        });
      }
      // Branded verification link (best-effort: the account already works without
      // it; the user can resend from the banner). Redeeming the magic link proves
      // inbox ownership, after which the client marks the app user verified.
      const { data: link, error: linkErr } =
        await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email: input.email,
        });
      if (!linkErr && link?.properties?.hashed_token) {
        const verificationUrl = `${ctx.clientOrigin}/auth/confirm?token_hash=${encodeURIComponent(
          link.properties.hashed_token,
        )}&type=magiclink`;
        await sendEmail({
          to: input.email,
          channel: 'verification',
          ...buildVerificationEmail({
            name: input.firstName,
            email: input.email,
            verificationUrl,
          }),
        });
      } else {
        console.warn(
          '[auth] signUp verification link failed',
          linkErr?.message,
        );
      }
      return { ok: true };
    }),

  /**
   * Resend the signup confirmation (replaces `supabase.auth.resend`). No password
   * is available at resend time, so we issue a magic link — redeeming it both
   * confirms the email and establishes a session. Always resolves success and
   * never leaks whether the email exists.
   */
  resendConfirmation: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: input.email,
      });
      if (error || !data?.properties?.hashed_token) {
        console.warn(
          '[auth] resendConfirmation generateLink failed',
          error?.message,
        );
        return { sent: true };
      }
      const verificationUrl = `${ctx.clientOrigin}/auth/confirm?token_hash=${encodeURIComponent(
        data.properties.hashed_token,
      )}&type=magiclink`;
      await sendEmail({
        to: input.email,
        channel: 'verification',
        ...buildVerificationEmail({ email: input.email, verificationUrl }),
      });
      return { sent: true };
    }),

  /**
   * Mark the signed-in user's email as verified (app-level), clearing the
   * "verify your email" nudge. Called from /auth/confirm after the user redeems
   * our verification link — redeeming it proves inbox ownership. Uses
   * sessionProcedure (not protected) because a fresh device may redeem the link
   * before the app `users` row exists; in that case we provision it verified.
   * Idempotent.
   */
  markEmailVerified: sessionProcedure.mutation(async ({ ctx }) => {
    const [updated] = await ctx.db
      .update(users)
      .set({ isEmailVerified: true })
      .where(eq(users.id, ctx.auth.id))
      .returning();
    if (updated) return updated;
    // Row not provisioned yet — create it verified, then attach the standard
    // support thread (mirrors ensureUser; best-effort, never blocks).
    const [created] = await ctx.db
      .insert(users)
      .values({
        id: ctx.auth.id,
        email: ctx.auth.email,
        firstName: ctx.auth.firstName,
        lastName: ctx.auth.lastName,
        isEmailVerified: true,
      })
      .onConflictDoUpdate({ target: users.id, set: { isEmailVerified: true } })
      .returning();
    try {
      await ensurePlatformAdminThread(created.id, ctx.db);
    } catch {
      /* support thread is best-effort */
    }
    return created;
  }),

  /**
   * Request a password reset (replaces `supabase.auth.resetPasswordForEmail`).
   * Generates a recovery link via our SMTP; the client redeems it on /auth/action
   * with verifyOtp({ type: 'recovery', token_hash }) then updateUser({ password }).
   * Always resolves success (don't reveal whether the account exists).
   */
  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: input.email,
      });
      if (error || !data?.properties?.hashed_token) {
        console.warn(
          '[auth] requestPasswordReset generateLink failed',
          error?.message,
        );
        return { sent: true };
      }
      const resetUrl = `${ctx.clientOrigin}/auth/action?token_hash=${encodeURIComponent(
        data.properties.hashed_token,
      )}&type=recovery`;
      await sendEmail({
        to: input.email,
        ...buildPasswordResetEmail({ email: input.email, resetUrl }),
      });
      return { sent: true };
    }),

  /**
   * Migrated-account login recovery — step 1: email a 4-digit code.
   * Users brought over from Firebase Auth have no usable password (the scrypt
   * hash can't be carried into GoTrue), so their `users` row is flagged
   * `requiresPasswordReset`. When a password login fails, the client calls this:
   * if that account is a flagged migrated user, we generate a 4-digit code,
   * store only its hash (+ 10-min expiry, attempts reset) and email the code via
   * our SMTP. Returns `{ migrated:false }` for everyone else so the client shows
   * the normal invalid-credentials error — and never reveals whether a
   * non-migrated email exists.
   */
  startMigratedReset: publicProcedure
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const row = (
        await ctx.db
          .select({ id: users.id, requiresPasswordReset: users.requiresPasswordReset, firstName: users.firstName })
          .from(users)
          .where(sql`lower(${users.email}) = lower(${input.email})`)
          .limit(1)
      )[0];
      if (!row?.requiresPasswordReset) return { migrated: false as const };

      const code = String(randomInt(1000, 10000)); // always 4 digits
      await ctx.db
        .update(users)
        .set({
          resetOtpHash: hashResetOtp(code, row.id),
          resetOtpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
          resetOtpAttempts: 0,
        })
        .where(eq(users.id, row.id));

      await sendEmail({
        to: input.email,
        ...buildPasswordResetOtpEmail({ name: row.firstName, email: input.email, otp: code }),
      });
      return { migrated: true as const };
    }),

  /**
   * Step 2a (optional fail-fast): check the 4-digit code without consuming it,
   * so the OTP screen can advance to the password step. Throws on a bad/expired
   * code (incrementing the attempt counter). Brute force is bounded by
   * OTP_MAX_ATTEMPTS + the short TTL.
   */
  verifyMigratedOtp: publicProcedure
    .input(z.object({ email: z.string().email(), code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertValidResetOtp(ctx.db, input.email, input.code);
      return { ok: true as const };
    }),

  /**
   * Step 2b: verify the code and set the new password (server-side via the admin
   * API, since the user has no session yet), then clear the migrated flag + OTP
   * state. The client signs in with the new password afterwards.
   */
  completeMigratedReset: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        code: z.string(),
        password: z.string().min(6),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = await assertValidResetOtp(ctx.db, input.email, input.code);
      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
        password: input.password,
      });
      if (error) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error.message });
      }
      await ctx.db
        .update(users)
        .set({
          requiresPasswordReset: false,
          resetOtpHash: null,
          resetOtpExpiresAt: null,
          resetOtpAttempts: 0,
        })
        .where(eq(users.id, userId));
      return { ok: true as const };
    }),

  /**
   * Invite someone to join Prodesk as an agency (or to create a brand). Sends the
   * standalone agency-invite email via our SMTP (ports sendAgencyInviteEmail).
   */
  sendAgencyInvite: protectedProcedure
    .input(
      z.object({ email: z.string().email(), isBrand: z.boolean().optional() }),
    )
    .mutation(async ({ ctx, input }) => {
      await enqueueEmail('agency-invite', {
        email: input.email,
        inviterName: inviterNameOf(ctx.user),
        isBrand: input.isBrand ?? false,
        signupUrl: `${emailBaseUrl(ctx.clientOrigin)}/signup?invite=agency`,
      });
      return { sent: true };
    }),

  /**
   * Redeem a new-user invitation token (the `/signup?invite=<token>` link). Called
   * by the client once the invited user has signed up AND verified their email.
   * The token is signed + email-matched so a forwarded link can't be claimed by a
   * different account.
   *
   *  - staff      → link + activate the pending staff row and switch the user into
   *                 the staff context (active role + selected org), so they land on
   *                 the staff workspace. Returns { kind: 'staff' }.
   *  - contractor → returns { kind: 'contractor', agencyId }; the client routes to
   *                 the contractor-create screen, which creates the active agency
   *                 connection once a profile exists (contractor.create).
   */
  redeemInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await verifyInviteToken(input.token);
      if (!invite)
        return {
          kind: 'invalid' as const,
          reason: 'This invitation link is invalid or has expired.',
        };
      // The invite link is a signed secret delivered to the intended inbox, so we
      // accept whoever redeems it and adopt the email they actually signed up with
      // (no rejection on a different address) — true for every invitation path.

      if (invite.kind === 'staff') {
        const member = (
          await ctx.db
            .select()
            .from(staff)
            .where(eq(staff.id, invite.staffId))
            .limit(1)
        )[0];
        if (!member || member.status === 'removed') {
          return {
            kind: 'invalid' as const,
            reason: 'This invitation is no longer available.',
          };
        }
        const [updated] = await ctx.db
          .update(staff)
          .set({
            userId: ctx.user.id,
            email: ctx.user.email,
            status: 'active',
            acceptedAt: new Date(),
          })
          .where(eq(staff.id, invite.staffId))
          .returning();
        // Switch the user into the staff context: active role + selected org so the
        // app routes them straight to the staff workspace after verifying.
        await ctx.db
          .update(users)
          .set({
            role: updated.agencyId ? 'agencyStaff' : 'brandStaff',
            selectedAgencyId: updated.agencyId ?? null,
            selectedBrandId: updated.brandId ?? null,
          })
          .where(eq(users.id, ctx.user.id));
        await completeSystemTask(
          'staffInvitation',
          updated.id,
          ctx.user.id,
          ctx.db,
        );
        await handleStaffPermissionGranted(
          ctx.user.id,
          { agencyId: updated.agencyId, brandId: updated.brandId },
          updated.permissions,
          ctx.db,
        );
        return { kind: 'staff' as const };
      }

      // Proposal: a brand recipient signed up / logged in through the
      // "View & Accept Proposal" link. If they already control the proposal's
      // brand, just hand back the id so the client opens it. Otherwise, if the
      // agency's referral brand is still unclaimed, claim it for this account so
      // the proposal connects to them (the chosen "claim the referral brand"
      // behaviour). If neither holds, the client routes to the public chooser.
      if (invite.kind === 'proposal') {
        const proposal = (
          await ctx.db
            .select()
            .from(proposals)
            .where(eq(proposals.id, invite.proposalId))
            .limit(1)
        )[0];
        if (!proposal)
          return {
            kind: 'proposal' as const,
            reason: 'This proposal is no longer available.',
          };
        // Stamp the referring agency on the recipient when they signed up
        // through this proposal's link. The signup link carries no `?ref=`
        // (the token is opaque), so provisioning couldn't capture it — do it
        // here. Only set it when still empty so an existing referral is kept.
        const referringAgencyId =
          proposal.agencyId ?? proposal.proposalSentByAgencyId ?? null;
        if (referringAgencyId) {
          await ctx.db
            .update(users)
            .set({ referredByAgencyId: referringAgencyId })
            .where(
              and(
                eq(users.id, ctx.user.id),
                isNull(users.referredByAgencyId),
              ),
            );
        }
        const targetBrandId = proposal.brandId ?? invite.brandId;
        const members = await ctx.db
          .select({ userId: userBrands.userId })
          .from(userBrands)
          .where(eq(userBrands.brandId, targetBrandId));
        const isMember = members.some((m) => m.userId === ctx.user.id);
        if (isMember) {
          return {
            kind: 'proposal' as const,
            proposalId: proposal.id,
            connected: true,
          };
        }
        if (members.length === 0) {
          // Unclaimed referral brand → claim it for this user.
          await ctx.db
            .insert(userBrands)
            .values({ userId: ctx.user.id, brandId: targetBrandId })
            .onConflictDoNothing();
          await ctx.db
            .update(brands)
            .set({ ownerId: ctx.user.id })
            .where(eq(brands.id, targetBrandId));
          await ctx.db
            .update(users)
            .set({
              selectedBrandId: targetBrandId,
              ...(ctx.user.role ? {} : { role: 'brandOwner' as const }),
            })
            .where(eq(users.id, ctx.user.id));
          if (proposal.brandId !== targetBrandId) {
            await ctx.db
              .update(proposals)
              .set({ brandId: targetBrandId, updatedAt: new Date() })
              .where(eq(proposals.id, proposal.id));
          }
          return {
            kind: 'proposal' as const,
            proposalId: proposal.id,
            connected: true,
          };
        }
        // Brand owned by someone else → let the client present the brand chooser.
        return {
          kind: 'proposal' as const,
          proposalId: proposal.id,
          connected: false,
        };
      }

      // Contractor: if the redeemer is ALREADY a contractor there's no profile
      // step to consume the token, so establish the connection now and tell the
      // client to skip the contractor-create screen. Otherwise hand the agency
      // back and let the client route to contractor-create (which consumes the
      // token once the profile exists).
      const existingContractor = (
        await ctx.db
          .select({ id: contractors.id })
          .from(contractors)
          .where(eq(contractors.id, ctx.user.id))
          .limit(1)
      )[0];
      if (existingContractor) {
        await connectContractorViaInvite(
          ctx.db,
          ctx.user.id,
          ctx.user.email,
          invite.agencyId,
          invite.note ?? null,
        );
        return {
          kind: 'contractor' as const,
          agencyId: invite.agencyId,
          alreadyContractor: true,
        };
      }
      return {
        kind: 'contractor' as const,
        agencyId: invite.agencyId,
        alreadyContractor: false,
      };
    }),

  /** Generic referral invite (ports sendReferralInviteEmail). */
  sendReferralInvite: protectedProcedure
    .input(
      z.object({
        email: z.string().email(),
        signupUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enqueueEmail('referral-invite', {
        email: input.email,
        inviterName: inviterNameOf(ctx.user),
        signupUrl: input.signupUrl ?? `${emailBaseUrl(ctx.clientOrigin)}/signup`,
      });
      return { sent: true };
    }),

  /**
   * Current session user + memberships + the granular StaffPermission set for
   * the active org context. Returns null when unauthenticated. The `permissions`
   * array drives both client-side route-access gating and sidebar nav visibility
   * (mirrors Flutter `staff.permissions` consulted by RouteAccess). Before
   * returning, runs the self-healing edge-case pass so a user whose selected
   * org was deleted or whose staff record was removed lands in a valid state
   * (Flutter AuthEdgeCaseService).
   */
  me: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.user) return null;
    const [agencyLinks, brandLinks, staffRows, contractorRow] =
      await Promise.all([
        ctx.db
          .select()
          .from(userAgencies)
          .where(eq(userAgencies.userId, ctx.user.id)),
        ctx.db
          .select()
          .from(userBrands)
          .where(eq(userBrands.userId, ctx.user.id)),
        ctx.db
          .select()
          .from(staff)
          .where(
            and(eq(staff.userId, ctx.user.id), eq(staff.status, 'active')),
          ),
        ctx.db
          .select({ id: contractors.id })
          .from(contractors)
          .where(eq(contractors.id, ctx.user.id))
          .limit(1),
      ]);
    const agencyIds = agencyLinks.map((a) => a.agencyId);
    const brandIds = brandLinks.map((b) => b.brandId);

    // Self-heal dead org / removed-staff states before resolving the active org.
    const user = await healUserEdgeCases(
      ctx.db,
      ctx.user,
      agencyIds,
      brandIds,
      staffRows,
    );

    // Resolve the active org the same way the client does (selected id → first membership).
    const activeAgencyId = user.selectedAgencyId ?? agencyIds[0] ?? null;
    const activeBrandId = user.selectedBrandId ?? brandIds[0] ?? null;
    const activeStaff = staffRows.find(
      (s) =>
        (activeAgencyId && s.agencyId === activeAgencyId) ||
        (activeBrandId && s.brandId === activeBrandId),
    );

    // Expand agency staff permissions with implied View Projects access for
    // workflow-permission holders and role designees (see kanban-permissions.md),
    // so the Projects nav item shows without `agencyProjects` ticked separately.
    let permissions: string[] = activeStaff?.permissions ?? [];
    if (activeAgencyId && activeStaff?.agencyId === activeAgencyId) {
      const agency = (
        await ctx.db.select().from(agencies).where(eq(agencies.id, activeAgencyId)).limit(1)
      )[0] ?? null;
      permissions = [...expandAgencyPermissions(activeStaff.permissions, agency, user.id)];
    }

    return {
      ...user,
      agencyIds,
      brandIds,
      // Drives the role-selection "Contractor" card suppression (Flutter
      // role_selection hides it when a contractor profile already exists).
      hasContractorProfile: contractorRow.length > 0,
      permissions,
    };
  }),

  /**
   * Provision the app `users` row after Supabase sign-up. Idempotent:
   * called from the client right after the GoTrue session is established.
   * Replaces the Firebase `on_user_created` trigger + auth_controller logic.
   */
  ensureUser: sessionProcedure
    .input(
      z.object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        // Referrer captured at provisioning from the signup URL. Stamped only on
        // the FIRST insert; later logins keep the original.
        // - `referredByUserId`: an individual affiliate (`?ref_user_id=<userId>`),
        //   paid directly in fulfillment (brandOwner.referredByUserId).
        // - `referredByAgencyId`: an agency affiliate (Flutter
        //   `refAgencyId ?? SubdomainDetector.referredByAgency?.id`): an explicit
        //   `?ref=<agencyId>` affiliate link, else the tenant subdomain username.
        referredByUserId: z.string().uuid().optional(),
        referredByAgencyId: z.string().uuid().optional(),
        referredBySubdomain: z.string().optional(),
        // Beta cohort code from `/signup?beta=<code>`, stashed client-side so it
        // survives the OAuth / email-verification hops before provisioning. This
        // is the ONLY point beta is stamped: Google signups never call signUp, so
        // stamping there would miss them entirely.
        betaCode: z.string().trim().max(40).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = (
        await ctx.db
          .select()
          .from(users)
          .where(eq(users.id, ctx.auth.id))
          .limit(1)
      )[0];
      if (existing) {
        // The row may have been provisioned moments ago by markEmailVerified (the
        // user redeemed the verification link on another device before this call
        // landed), which knows nothing about the beta code. Redeem it here — the
        // helper is bounded to freshly-created, not-yet-enrolled accounts, so this
        // can only ever complete an in-flight signup.
        if (input.betaCode) {
          const joined = await joinBetaOnProvisioning(ctx.db, existing, input.betaCode);
          if (joined) {
            return (
              await ctx.db.select().from(users).where(eq(users.id, ctx.auth.id)).limit(1)
            )[0];
          }
        }
        return existing;
      }
      // Resolve the referring agency: explicit id wins, else the subdomain
      // username maps to an agency (the tenant whose theme the user already saw).
      let referredByAgencyId = input.referredByAgencyId ?? null;
      if (!referredByAgencyId && input.referredBySubdomain) {
        const ag = (
          await ctx.db
            .select({ id: agencies.id })
            .from(agencies)
            .where(
              sql`lower(${agencies.username}) = lower(${input.referredBySubdomain})`,
            )
            .limit(1)
        )[0];
        referredByAgencyId = ag?.id ?? null;
      }
      // Resolve the beta cohort, if the signup carried a code. An unknown, closed
      // or full code resolves to no grant — never an error: a bad beta link must
      // still produce a working (non-beta) account, exactly as if the user had
      // arrived without it.
      const betaJoin = input.betaCode
        ? await resolveBetaJoin(ctx.db, input.betaCode)
        : null;
      if (betaJoin?.refusal) {
        console.warn(
          `[beta] signup code "${input.betaCode}" refused (${betaJoin.refusal}) for user ${ctx.auth.id}`,
        );
      }
      const betaGrant =
        betaJoin && betaJoin.refusal === null
          ? {
              isBetaUser: true,
              betaVersionId: betaJoin.version.id,
              betaStartedAt: new Date(),
              betaEndsAt: betaJoin.endsAt,
            }
          : {};
      const [created] = await ctx.db
        .insert(users)
        .values({
          ...betaGrant,
          id: ctx.auth.id,
          email: ctx.auth.email,
          // Prefer explicit input; fall back to names captured in user_metadata
          // at sign-up (the email-confirmation flow has no input to pass).
          firstName: input.firstName ?? ctx.auth.firstName,
          lastName: input.lastName ?? ctx.auth.lastName,
          referredByUserId: input.referredByUserId ?? null,
          referredByAgencyId,
          // OAuth providers (Google) vouch for the email; email/password signups
          // start unverified and must click our link (auth.markEmailVerified).
          isEmailVerified:
            ctx.auth.provider != null && ctx.auth.provider !== 'email',
        })
        .returning();
      // Every new user gets a self ("you") thread + a platform-admin support thread
      // (Flutter ensurePlatformAdminThread on signup). Non-fatal: never block provisioning.
      try {
        await ensurePlatformAdminThread(created.id, ctx.db);
      } catch {
        /* support thread is best-effort */
      }
      return created;
    }),

  /**
   * Role is no longer assigned here. The role-selection screen navigates to the
   * matching create screen (/create-brand · /create-agency · /create-contractor)
   * and the role + organization are committed only once that entity is created
   * (brands.create / agencies.create / contractor.create), so a user is never
   * left with a role but no organization — a 1:1 port of the Flutter onboarding
   * flow (role_selection_screen → create-* screens set the role on submit).
   */

  /**
   * The set of contexts the user can switch between, for the context selector
   * (1:1 port of Flutter ContextSelector._getOptions). Grouped as: admin
   * (super-admin only) → agencies → brands → contractor, alphabetical within
   * each group (owned + staff merged). Owned deleted agencies are dropped;
   * staff orgs are deduped against owned and carry pending/deleted status. Each option is
   * what the selector renders + what `switchContext` consumes.
   */
  contextOptions: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const [ownedAgencyRows, ownedBrandRows, staffRows, contractorRow] =
      await Promise.all([
        ctx.db
          .select({ a: agencies })
          .from(userAgencies)
          .innerJoin(agencies, eq(userAgencies.agencyId, agencies.id))
          .where(eq(userAgencies.userId, userId)),
        ctx.db
          .select({ b: brands })
          .from(userBrands)
          .innerJoin(brands, eq(userBrands.brandId, brands.id))
          .where(eq(userBrands.userId, userId)),
        ctx.db
          .select()
          .from(staff)
          .where(and(eq(staff.userId, userId), eq(staff.status, 'active'))),
        ctx.db
          .select({ id: contractors.id })
          .from(contractors)
          .where(eq(contractors.id, userId))
          .limit(1),
      ]);

    const options: ContextOption[] = [];

    // Admin (super-admin only).
    if (ctx.user.isSuperAdmin) {
      options.push({
        id: 'admin',
        label: 'Admin',
        role: 'superAdmin',
        entityId: null,
        type: 'admin',
        logoUrl: null,
        isDisabled: false,
        status: null,
      });
    }

    // Owned agencies (skip soft-deleted, username === 'deleted').
    const ownedAgencyIds = new Set<string>();
    for (const { a } of ownedAgencyRows) {
      if (a.username === 'deleted') continue;
      // Derived (brand shadow) agencies are hidden — the brand already appears.
      if (a.derivedFromBrandId) continue;
      ownedAgencyIds.add(a.id);
      options.push({
        id: `agency_owner_${a.id}`,
        label: a.businessName,
        role: 'agencyOwner',
        entityId: a.id,
        type: 'agency',
        logoUrl: a.logoUrl,
        isDisabled: false,
        status: a.emailVerified ? null : 'pending',
      });
    }

    // Staff agencies (dedup vs owned; deleted → disabled).
    const staffAgencyIds = staffRows
      .map((s) => s.agencyId)
      .filter((id): id is string => !!id);
    if (staffAgencyIds.length) {
      const rows = await ctx.db
        .select()
        .from(agencies)
        .where(inArray(agencies.id, staffAgencyIds));
      for (const a of rows) {
        if (ownedAgencyIds.has(a.id)) continue;
        // Derived (brand shadow) agencies are hidden from the selector.
        if (a.derivedFromBrandId) continue;
        const deleted = a.username === 'deleted';
        options.push({
          id: `agency_staff_${a.id}`,
          label: `${a.businessName} (Staff)`,
          role: 'agencyStaff',
          entityId: a.id,
          type: 'agency',
          logoUrl: a.logoUrl,
          isDisabled: deleted,
          status: deleted ? 'deleted' : a.emailVerified ? null : 'pending',
          permissions: staffRows.find((s) => s.agencyId === a.id)?.permissions ?? [],
        });
      }
    }

    // Owned brands.
    const ownedBrandIds = new Set<string>();
    for (const { b } of ownedBrandRows) {
      ownedBrandIds.add(b.id);
      options.push({
        id: `brand_owner_${b.id}`,
        label: b.businessName,
        role: 'brandOwner',
        entityId: b.id,
        type: 'brand',
        logoUrl: b.logoUrl,
        isDisabled: false,
        status: null,
      });
    }

    // Staff brands (dedup vs owned).
    const staffBrandIds = staffRows
      .map((s) => s.brandId)
      .filter((id): id is string => !!id);
    if (staffBrandIds.length) {
      const rows = await ctx.db
        .select()
        .from(brands)
        .where(inArray(brands.id, staffBrandIds));
      for (const b of rows) {
        if (ownedBrandIds.has(b.id)) continue;
        options.push({
          id: `brand_staff_${b.id}`,
          label: `${b.businessName} (Staff)`,
          role: 'brandStaff',
          entityId: b.id,
          type: 'brand',
          logoUrl: b.logoUrl,
          isDisabled: false,
          status: null,
          permissions: staffRows.find((s) => s.brandId === b.id)?.permissions ?? [],
        });
      }
    }

    // Contractor — uses the user's own profile photo (the same avatar shown
    // top-right), since a contractor has no separate org logo.
    if (contractorRow.length) {
      options.push({
        id: 'contractor',
        label: 'Contractor',
        role: 'individualContractor',
        entityId: null,
        type: 'contractor',
        logoUrl: ctx.user.profileUrl ?? null,
        isDisabled: false,
        status: null,
      });
    }

    // Alphabetical within each section; the selector renders groups from
    // contiguous runs of `type`, so the section order itself must stay
    // admin → agency → brand → contractor.
    const typeRank: Record<ContextOption['type'], number> = {
      admin: 0,
      agency: 1,
      brand: 2,
      contractor: 3,
    };
    return options.sort(
      (a, b) =>
        typeRank[a.type] - typeRank[b.type] ||
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );
  }),

  /**
   * Switch the active context (1:1 port of Flutter ContextSelector._handleSelection):
   * set the user's role + selectedAgencyId/selectedBrandId atomically. The role is
   * DERIVED server-side from the user's real membership (owner vs staff) — never
   * trusted from the client — so this can't be used to escalate privilege. Agency
   * and brand selection are mutually exclusive. admin/contractor only change role.
   */
  switchContext: protectedProcedure
    .input(
      z.object({
        type: z.enum(['admin', 'agency', 'brand', 'contractor']),
        entityId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      if (input.type === 'admin') {
        if (!ctx.user.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
        const [u] = await ctx.db
          .update(users)
          .set({ role: 'superAdmin' })
          .where(eq(users.id, userId))
          .returning();
        return u;
      }

      if (input.type === 'contractor') {
        const c = await ctx.db
          .select({ id: contractors.id })
          .from(contractors)
          .where(eq(contractors.id, userId))
          .limit(1);
        if (!c.length)
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'No contractor profile',
          });
        const [u] = await ctx.db
          .update(users)
          .set({ role: 'individualContractor' })
          .where(eq(users.id, userId))
          .returning();
        return u;
      }

      if (!input.entityId)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'entityId required',
        });

      if (input.type === 'agency') {
        const owned = await ctx.db
          .select({ id: userAgencies.agencyId })
          .from(userAgencies)
          .where(
            and(
              eq(userAgencies.userId, userId),
              eq(userAgencies.agencyId, input.entityId),
            ),
          )
          .limit(1);
        let role: 'agencyOwner' | 'agencyStaff' | null = owned.length
          ? 'agencyOwner'
          : null;
        if (!role) {
          const st = await ctx.db
            .select({ id: staff.id })
            .from(staff)
            .where(
              and(
                eq(staff.userId, userId),
                eq(staff.agencyId, input.entityId),
                eq(staff.status, 'active'),
              ),
            )
            .limit(1);
          if (st.length) role = 'agencyStaff';
        }
        if (!role)
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Not a member of this agency',
          });
        const [u] = await ctx.db
          .update(users)
          .set({
            role,
            selectedAgencyId: input.entityId,
            selectedBrandId: null,
          })
          .where(eq(users.id, userId))
          .returning();
        return u;
      }

      // brand
      const owned = await ctx.db
        .select({ id: userBrands.brandId })
        .from(userBrands)
        .where(
          and(
            eq(userBrands.userId, userId),
            eq(userBrands.brandId, input.entityId),
          ),
        )
        .limit(1);
      let role: 'brandOwner' | 'brandStaff' | null = owned.length
        ? 'brandOwner'
        : null;
      if (!role) {
        const st = await ctx.db
          .select({ id: staff.id })
          .from(staff)
          .where(
            and(
              eq(staff.userId, userId),
              eq(staff.brandId, input.entityId),
              eq(staff.status, 'active'),
            ),
          )
          .limit(1);
        if (st.length) role = 'brandStaff';
      }
      if (!role)
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Not a member of this brand',
        });
      const [u] = await ctx.db
        .update(users)
        .set({ role, selectedBrandId: input.entityId, selectedAgencyId: null })
        .where(eq(users.id, userId))
        .returning();
      return u;
    }),
});
