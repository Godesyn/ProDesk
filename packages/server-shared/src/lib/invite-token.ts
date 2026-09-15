import { SignJWT, jwtVerify } from 'jose';
import { env } from './env.js';

/**
 * Signed, expiring invite tokens carried in the new-user invitation email link
 * (`/signup?invite=<token>`). They let a brand-new user (no account yet) accept a
 * staff or contractor invitation simply by signing up through the link:
 *
 *  - staff      → the token references the pending `staff` row (created at invite
 *                 time so it shows in the org's staff list); redeeming it links +
 *                 activates that row and switches the user into the staff context.
 *  - contractor → the token carries the inviting agency; redeeming it routes the
 *                 user to the contractor-create screen, and the active connection
 *                 is created once their profile exists (contractor.create).
 *  - proposal   → the token carries the proposal + the referral brand the agency
 *                 sent it to (carried in the "View & Accept Proposal" email link).
 *                 Opening it shows a public read-only preview; signing up through
 *                 the link claims that referral brand so the proposal connects to
 *                 the new account (auth.redeemInvite + connectViaToken).
 *
 * Tokens are HS256-signed with the project JWT secret, so an unsigned/forged link
 * can't fabricate a connection to an arbitrary agency. They are NOT email-bound on
 * redemption: whoever signs up through the link is accepted, and the record adopts
 * the email they actually used (the `email` claim is informational only).
 */

const secret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
const ISSUER = 'prodesk-invite';

export type InvitePayload =
  | { kind: 'staff'; email: string; staffId: string }
  | { kind: 'contractor'; email: string; agencyId: string; note?: string }
  | { kind: 'proposal'; email: string; proposalId: string; brandId: string };

export async function signInviteToken(payload: InvitePayload, expiresInDays = 30): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${expiresInDays}d`)
    .sign(secret);
}

export async function verifyInviteToken(token: string): Promise<InvitePayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER });
    const email = payload.email;
    if (typeof email !== 'string') return null;
    if (payload.kind === 'staff' && typeof payload.staffId === 'string') {
      return { kind: 'staff', email, staffId: payload.staffId };
    }
    if (payload.kind === 'contractor' && typeof payload.agencyId === 'string') {
      return { kind: 'contractor', email, agencyId: payload.agencyId, note: typeof payload.note === 'string' ? payload.note : undefined };
    }
    if (payload.kind === 'proposal' && typeof payload.proposalId === 'string' && typeof payload.brandId === 'string') {
      return { kind: 'proposal', email, proposalId: payload.proposalId, brandId: payload.brandId };
    }
    return null;
  } catch {
    return null;
  }
}
