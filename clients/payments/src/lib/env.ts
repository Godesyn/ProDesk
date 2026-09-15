/**
 * Environment helpers for feature gating — thin aliases over the central env
 * module (`@shared/lib/env`), kept so the app's many `@/lib/env` imports stay
 * short.
 *
 * isProd  — true in ANY built bundle (Vite PROD flag; includes deployed
 *           dev/staging builds). For deployment-environment gating use
 *           `@shared/lib/app-env` (IS_PRODUCTION) instead.
 * isDev   — true in local dev / preview sandbox
 *
 * Usage:
 *   import { isProd } from "@/lib/env";
 *   {!isProd && <button>Coming-soon feature</button>}
 */
import { IS_PROD_BUILD } from "@shared/lib/env";

export const isProd: boolean = IS_PROD_BUILD;
export const isDev: boolean = !isProd;
