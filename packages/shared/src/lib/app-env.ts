/**
 * Deployment environment for the running client build.
 *
 * Resolved from `VITE_APP_ENV` (injected per environment at build time — see the
 * `.env.*` files / Railway env). Falls back to Vite's built-in `DEV` flag so a
 * local `vite` dev server always reads as development even without the var, and
 * to `production` for any unlabelled production build.
 */
import { APP_ENV_VAR, IS_DEV_SERVER } from './env';

export const APP_ENV: string = APP_ENV_VAR || (IS_DEV_SERVER ? 'development' : 'production');

export const IS_PRODUCTION = APP_ENV === 'production' || APP_ENV === 'prod';

/**
 * Short label shown in the nav for non-production builds (e.g. a "Staging" /
 * "Development" chip); `null` in production so nothing is shown.
 */
export const ENV_BADGE: string | null = IS_PRODUCTION
  ? null
  : APP_ENV === 'staging' || APP_ENV === 'stage'
    ? 'Staging'
    : APP_ENV === 'development' || APP_ENV === 'dev'
      ? 'Development'
      : APP_ENV.charAt(0).toUpperCase() + APP_ENV.slice(1);
