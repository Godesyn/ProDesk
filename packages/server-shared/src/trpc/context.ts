import type { CreateExpressContextOptions } from '@trpc/server/adapters/express';
import { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } from 'jose';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, agencies } from '../db/schema.js';
import { env } from '../lib/env.js';

const RESERVED_SUBDOMAINS = new Set(['app', 'www', 'api', 'admin', 'localhost', '']);

/** Extract the tenant subdomain from a Host header (e.g. `acme.app.prodesk.com` → `acme`). */
export function tenantFromHost(host?: string): string | null {
  if (!host) return null;
  const name = host.split(':')[0]; // strip port
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return null; // bare IP
  const label = name.split('.')[0]?.toLowerCase();
  return label && !RESERVED_SUBDOMAINS.has(label) ? label : null;
}

async function resolveTenant(host?: string) {
  const sub = tenantFromHost(host);
  if (!sub) return null;
  return (await db.select().from(agencies).where(eq(agencies.username, sub)).limit(1))[0] ?? null;
}

// Legacy HS256 verification key (project JWT secret).
const hsSecret = new TextEncoder().encode(env.SUPABASE_JWT_SECRET);
// Asymmetric (ES256/RS256) verification via the project's published JWKS. Used
// by the new Supabase JWT signing-keys system. Lazily fetched + cached by jose.
const jwks = createRemoteJWKSet(new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));

export interface AuthUser {
  id: string;
  email: string;
  token: string;
  /** GoTrue sign-in provider ('email', 'google', …). OAuth providers vouch for
   *  the email; 'email' users must verify via our own link (isEmailVerified). */
  provider?: string;
  /** From Supabase user_metadata, set at sign-up (survives email confirmation). */
  firstName?: string;
  lastName?: string;
}

/**
 * Verifies the Supabase GoTrue access token and loads the matching app user
 * row. Supports both the legacy HS256 (shared JWT secret) and the new
 * asymmetric signing-keys system (ES256/RS256 via JWKS), chosen by the token's
 * `alg` header.
 */
async function authenticate(authHeader?: string): Promise<{ auth: AuthUser | null; dbUser: typeof users.$inferSelect | null }> {
  if (!authHeader?.startsWith('Bearer ')) return { auth: null, dbUser: null };
  const token = authHeader.slice('Bearer '.length);
  try {
    const alg = decodeProtectedHeader(token).alg;
    const { payload } = alg === 'HS256'
      ? await jwtVerify(token, hsSecret)
      : await jwtVerify(token, jwks);
    const id = payload.sub as string;
    const email = (payload.email as string) ?? '';
    const meta = (payload.user_metadata ?? {}) as { first_name?: string; last_name?: string };
    const appMeta = (payload.app_metadata ?? {}) as { provider?: string };
    const dbUser = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0] ?? null;
    return {
      auth: { id, email, token, provider: appMeta.provider, firstName: meta.first_name, lastName: meta.last_name },
      dbUser,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    if (env.NODE_ENV === 'development') {
      const hdr = (() => { try { return decodeProtectedHeader(token); } catch { return null; } })();
      console.warn('[auth] token verify failed:', { alg: hdr?.alg, kid: hdr?.kid, iss: (() => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).iss; } catch { return null; } })(), error: (err as Error)?.message });
    }
    return { auth: null, dbUser: null };
  }
}

export async function createContext({ req }: CreateExpressContextOptions) {
  const [{ auth, dbUser }, tenant] = await Promise.all([
    authenticate(req.headers.authorization),
    resolveTenant(req.headers.host),
  ]);
  
  // The client passes its actual origin (e.g., https://dashboard.prodesk.com).
  // If absent (e.g., direct API hit, old clients), fall back to the main app origin.
  const rawOrigin = req.headers['x-client-origin'];
  const clientOrigin = typeof rawOrigin === 'string' && rawOrigin.trim() ? rawOrigin : env.SERVER_ORIGIN;

  // Caller IP (first hop of x-forwarded-for behind the proxy). Used by
  // signature-capture flows (e.g. payments proposal acceptance) — optional so
  // test-constructed contexts don't need it.
  const fwd = req.headers['x-forwarded-for'];
  const ip =
    (typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : fwd?.[0]) ??
    req.socket?.remoteAddress ??
    null;

  // Browser/device string + which Prodesk frontend issued the call. Used for
  // support-ticket diagnostics (and optional elsewhere), so both are nullable.
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null;
  const rawClient = req.headers['x-prodesk-client'];
  const client = typeof rawClient === 'string' && rawClient.trim() ? rawClient : null;

  return { db, auth, user: dbUser, tenant, clientOrigin, ip, userAgent, client };
}


type BaseContext = Awaited<ReturnType<typeof createContext>>;
/** `ip`/`userAgent`/`client` are optional so hand-built test contexts can omit them. */
export type Context = Omit<BaseContext, 'ip' | 'userAgent' | 'client'> & {
  ip?: string | null;
  userAgent?: string | null;
  client?: string | null;
};
