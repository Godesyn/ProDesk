import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { brands, outreachProspectState, users } from '../../db/schema.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { env } from '../../lib/env.js';

/**
 * The `yes` → Verdiict account handoff (§10).
 *
 * Two decisions shape this file:
 *
 *  1. **The link rides in the human's reply**, not a separate system email. It
 *     goes out through Smartlead from the person they just replied to, on the
 *     warmed sending domain, at the moment of highest intent. So this module
 *     RETURNS a link; it never sends anything itself.
 *  2. **They log in to something already built.** The brand is pre-created from
 *     the list-builder data, so the first screen has their business on it rather
 *     than an empty form. That is the whole reason the offer lands.
 */

/** Where Verdiict lives, for the confirmation link. */
function verdiictOrigin(): string {
  const host = env.VITE_REVIEWS_PRODESK_ORIGIN;
  if (env.NODE_ENV === 'development') return env.SERVER_ORIGIN;
  return host.startsWith('http') ? host : `https://${host}`;
}

export interface HandoffResult {
  /** The confirmation URL to paste into the approved reply. */
  link: string;
  status: 'created' | 'existing';
  brandId: string | null;
  userId: string;
}

/**
 * Create (or find) a Verdiict account for a prospect and return its login link.
 *
 * Idempotent by design: if an account already exists for the address we do NOT
 * create a second one — we mint a fresh link for the existing user and record
 * the handoff as satisfied. Someone replying twice must not end up with two
 * accounts and two brands.
 *
 * The Supabase confirmation email is never triggered: `generateLink` only
 * generates. The link reaches them in our reply.
 */
export async function createVerdiictAccount(opts: {
  /** The address that REPLIED — not always the one we prospected. */
  email: string;
  /** The prospected address, used to find the row we enriched. */
  prospectEmail: string;
}): Promise<HandoffResult> {
  const email = opts.email.trim().toLowerCase();

  const [prospect] = await db
    .select()
    .from(outreachProspectState)
    .where(eq(outreachProspectState.email, opts.prospectEmail.trim().toLowerCase()))
    .limit(1);

  // Does an app user already exist for this address?
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let userId = existingUser?.id ?? null;
  let status: 'created' | 'existing' = existingUser ? 'existing' : 'created';

  if (!userId) {
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      // No password: they set one on the confirmation screen. Confirmed at the
      // GoTrue level so the magic link establishes a session immediately.
      email_confirm: true,
      user_metadata: {
        business_name: prospect?.businessName ?? undefined,
        source: 'outreach',
      },
    });
    if (error || !created?.user) {
      // An address that already exists in GoTrue but not in `users` lands here.
      // Treat it as existing rather than failing the handoff.
      if (!/already/i.test(error?.message ?? '')) {
        throw new Error(`Could not create the account: ${error?.message ?? 'unknown error'}`);
      }
      status = 'existing';
    } else {
      userId = created.user.id;
    }
  }

  const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(`Could not generate the login link: ${linkErr?.message ?? 'unknown error'}`);
  }

  // The link is generated BEFORE the brand, because it is the only thing that
  // can recover the id in one case: an address GoTrue already knows but our
  // `users` table does not. `createUser` refuses that as "already registered",
  // which left `userId` null and skipped the pre-created brand entirely — so
  // the one prospect most likely to have touched the suite before was the one
  // who landed on an empty form.
  if (!userId && link.user?.id) userId = link.user.id;

  /*
   * The app `users` row, before the brand that has to reference it.
   *
   * `brands.owner_id` is a foreign key to `users.id`, and nothing in this file
   * had ever written that row: `createUser` creates a GoTrue identity, and the
   * local row is normally created by `ensureUser` on first authed load — which
   * is AFTER this runs, by definition. So the brand insert below failed its
   * foreign key on every single handoff, was swallowed by the catch that exists
   * for name clashes, and `fulfilment_brand_id` came back null every time.
   *
   * The whole promise of §10 is that they log in to something already built.
   * They were logging in to an empty form, and the only trace was a line in the
   * Worker log.
   *
   * Written the same way `ensureUser` writes it — same id, conflict-safe — so
   * the first real sign-in updates this row rather than racing it.
   */
  if (userId) {
    await db
      .insert(users)
      .values({
        id: userId,
        email,
        isEmailVerified: true,
      })
      .onConflictDoNothing({ target: users.id })
      .catch((e) => {
        console.error('[outreach] user row pre-create failed', (e as Error).message);
      });
  }

  // Pre-create the brand from what the list builder already learned, so they
  // land on something built rather than an empty form.
  let brandId: string | null = null;
  if (userId) {
    const [existingBrand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.ownerId, userId))
      .limit(1);

    if (existingBrand) {
      brandId = existingBrand.id;
    } else if (prospect?.businessName) {
      const [createdBrand] = await db
        .insert(brands)
        .values({
          ownerId: userId,
          businessName: prospect.businessName,
          email,
          website: prospect.website,
          industry: prospect.category,
        })
        .returning({ id: brands.id })
        .catch((e) => {
          // Business names share one unique namespace — a clash must not sink
          // the handoff, they can rename on first login.
          console.error('[outreach] brand pre-create failed', (e as Error).message);
          return [] as { id: string }[];
        });
      brandId = createdBrand?.id ?? null;
    }
  }

  // Built against the VERDIICT origin — against ProDesk's, the confirmation
  // would land in the wrong product entirely.
  const url = `${verdiictOrigin()}/auth/confirm?token_hash=${encodeURIComponent(
    link.properties.hashed_token,
  )}&type=magiclink`;

  await db
    .update(outreachProspectState)
    .set({
      fulfilmentStatus: status,
      fulfilmentAt: new Date(),
      fulfilmentEmail: email,
      fulfilmentBrandId: brandId,
    })
    .where(eq(outreachProspectState.email, opts.prospectEmail.trim().toLowerCase()));

  return { link: url, status, brandId, userId: userId ?? '' };
}

/**
 * A fresh link for someone who lost theirs — the Reply Queue's "resend account
 * link". Creates nothing; if there is no account yet, the caller should run the
 * full handoff instead.
 */
export async function regenerateAccountLink(email: string): Promise<string> {
  const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: email.trim().toLowerCase(),
  });
  if (error || !link?.properties?.hashed_token) {
    throw new Error(`Could not generate a link: ${error?.message ?? 'unknown error'}`);
  }
  return `${verdiictOrigin()}/auth/confirm?token_hash=${encodeURIComponent(
    link.properties.hashed_token,
  )}&type=magiclink`;
}
