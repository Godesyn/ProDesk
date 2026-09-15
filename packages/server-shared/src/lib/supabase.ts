import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

/**
 * Secret-key client — bypasses RLS (the secret key replaces the legacy
 * service_role key). Use ONLY in trusted server code (webhooks, jobs, admin
 * mutations). Never expose to the client.
 */
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SECRET_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

/**
 * Build a request-scoped client bound to the caller's access token, so
 * Supabase Storage / RLS-aware reads run as that user. Uses the publishable
 * key (replaces the legacy anon key).
 */
export function supabaseForToken(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
