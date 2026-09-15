import { IS_PRODUCTION } from './app-env';

/**
 * Dev-only credentials used to prefill the login/signup forms for faster manual
 * testing. Gated on the deployment environment (VITE_APP_ENV) rather than Vite's
 * `import.meta.env.DEV` — the latter is `false` in ALL built bundles, so it would
 * suppress prefill on the deployed dev/staging sites too. `IS_PRODUCTION` is a
 * static literal per build, so Vite still tree-shakes these values out of prod.
 */
export const DEV_AUTH_PREFILL = !IS_PRODUCTION
  ? {
      firstName: 'Sajat',
      lastName: 'Shrestha',
      email: 'zacch.b@noize.com.au',
      password: 'Test1234@',
    }
  : null;
