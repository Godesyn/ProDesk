/**
 * Central access point for build-time (Vite) environment variables.
 *
 * This is the ONLY frontend module allowed to read `import.meta.env` — enforced
 * by `scripts/check-frontend-wiring.mjs`. Everything else imports the typed
 * constants below, or one of the semantic layers built on them:
 *
 *   - `app-env.ts`  — deployment environment (APP_ENV / IS_PRODUCTION / ENV_BADGE)
 *   - `origins.ts`  — cross-frontend host helpers (originUrl / mainAppUrl)
 *
 * One place to see everything a frontend build consumes, one place to add a new
 * var. All values are baked in at build time; deployed frontends all receive the
 * same set from the single shared Railway env file
 * (`.railway/envs/client/client.env`), and local dev reads the repo-root `.env`
 * (every client vite.config points `envDir` there).
 */

// ─── Vite build flags ────────────────────────────────────────────────────────
/** True only under the local `vite` dev server. False in ALL built bundles —
 * including the deployed dev/staging sites — so never use this for
 * deployment-environment gating; use `app-env.ts` (`IS_PRODUCTION`) instead. */
export const IS_DEV_SERVER: boolean = import.meta.env.DEV === true;
/** True in any built bundle (production AND deployed dev/staging builds). */
export const IS_PROD_BUILD: boolean = import.meta.env.PROD === true;

// ─── Deployment environment (raw — consume via app-env.ts) ──────────────────
/** Raw `VITE_APP_ENV`, lowercased ('development' | 'staging' | 'production'). */
export const APP_ENV_VAR: string | undefined = (
  import.meta.env.VITE_APP_ENV as string | undefined
)?.trim()
  .toLowerCase();

// ─── Backend services ────────────────────────────────────────────────────────
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

const rawApiUrl = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim();
/** Backend API base URL, normalized to an absolute URL (`https://` prefixed when
 * the var is a bare host). Empty string when unset — local dev proxies the API
 * through the vite server, so relative requests still work. */
export const API_URL: string =
  rawApiUrl && !rawApiUrl.startsWith('http') ? `https://${rawApiUrl}` : rawApiUrl;

// ─── Payments ────────────────────────────────────────────────────────────────
/** Stripe publishable (client) key — client-safe by design. */
export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
  | string
  | undefined;

// ─── Cross-frontend origins (consume via origins.ts helpers) ────────────────
/**
 * Prodesk frontend origins. Each `VITE_*_PRODESK_ORIGIN` is a **bare host** for
 * the current environment — with a port in local dev (`localhost:5173`) and a
 * domain when hosted (`app.prodesk.com`, `dev-app.prodesk.com`). Keeping these
 * in env (not hardcoded per frontend) means a frontend never has to know
 * another's URL.
 */
export const PRODESK_ORIGINS = {
  /** The main Prodesk app (`app.prodesk.com`). */
  app: import.meta.env.VITE_APP_PRODESK_ORIGIN as string | undefined,
  /** The Dashboard frontend (`dashboard.prodesk.com`). */
  dashboard: import.meta.env.VITE_DASHBOARD_PRODESK_ORIGIN as string | undefined,
  /** The Links/Adeyy frontend (`links.prodesk.com`). */
  links: import.meta.env.VITE_LINKS_PRODESK_ORIGIN as string | undefined,
  /** The Reviews/Verdiict frontend (`reviews.prodesk.com`). */
  reviews: import.meta.env.VITE_REVIEWS_PRODESK_ORIGIN as string | undefined,
  /** The Payments/EziQuotes frontend (`payments.prodesk.com`). */
  payments: import.meta.env.VITE_PAYMENTS_PRODESK_ORIGIN as string | undefined,
  /** The Signatures/SIGKITT frontend (`signatures.prodesk.com`). */
  signatures: import.meta.env.VITE_SIGNATURES_PRODESK_ORIGIN as string | undefined,
  /** The Jobs frontend (`jobs.prodesk.com`). */
  jobs: import.meta.env.VITE_JOBS_PRODESK_ORIGIN as string | undefined,
  /** The Websites frontend (`websites.prodesk.com`). */
  websites: import.meta.env.VITE_WEBSITES_PRODESK_ORIGIN as string | undefined,
  /** The Design frontend (`design.prodesk.com`). */
  design: import.meta.env.VITE_DESIGN_PRODESK_ORIGIN as string | undefined,
  /** The Logo frontend (`logo.prodesk.com`). */
  logo: import.meta.env.VITE_LOGO_PRODESK_ORIGIN as string | undefined,
  /** The Chat frontend — the consumer messenger (`chat.prodesk.com`). */
  chat: import.meta.env.VITE_CHAT_PRODESK_ORIGIN as string | undefined,
  /** The short-link redirector (`url.prodesk.com` / `adeyy.com`). */
  redirector: import.meta.env.VITE_REDIRECTOR_PRODESK_ORIGIN as string | undefined,
} as const;
