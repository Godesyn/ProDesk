import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface LegacyStorageRedirectOptions {
  /** Route prefix the legacy asset URLs live under. Default: '/manus-storage'. */
  routePrefix?: string;
  /** Supabase Storage bucket the assets were migrated into. Default: 'brand-files'. */
  bucket?: string;
  /** Key prefix the migration mirrored legacy files under. Default: 'signatures/legacy'. */
  keyPrefix?: string;
}

/**
 * 301-redirect legacy Manus asset URLs to their migrated Supabase Storage copy.
 *
 * The legacy SIGKITT app served uploads from `<domain>/manus-storage/<key>`
 * (e.g. `/manus-storage/team-111/…png`), and those absolute URLs are embedded
 * as `<img src>` in email signatures ALREADY SENT to recipients — they must
 * keep resolving forever. The migration script
 * (servers/backend/src/scripts/migrate-sigkitt-export.ts) mirrors every
 * exported file to a deterministic key `signatures/legacy/<legacy key>` in the
 * public `brand-files` bucket, so the redirect is a pure rewrite — no lookup
 * table to ship. Email clients follow redirects when fetching images.
 *
 * Mounted on BOTH dev and preview servers (Railway serves clients via
 * `vite preview`, same as healthcheck.ts). VITE_SUPABASE_URL comes from
 * process env on Railway, or the root .env vite itself loads for local dev.
 */
export function legacyStorageRedirect(
  options: LegacyStorageRedirectOptions = {},
): Plugin {
  const route = options.routePrefix ?? '/manus-storage';
  const bucket = options.bucket ?? 'brand-files';
  const keyPrefix = options.keyPrefix ?? 'signatures/legacy';
  let warned = false;
  // Railway preview gets the var via process env; local dev via the root .env
  // that vite itself loads (captured from the resolved config).
  let envSupabaseUrl: string | undefined;

  const handler = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void => {
    const path = (req.url ?? '').split('?')[0];
    if (!path.startsWith(`${route}/`)) return next();

    const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? envSupabaseUrl)
      ?.trim()
      .replace(/\/+$/, '');
    if (!supabaseUrl) {
      if (!warned) {
        warned = true;
        console.warn(
          '[legacy-storage] VITE_SUPABASE_URL is not set — /manus-storage/* redirects are disabled',
        );
      }
      return next();
    }

    const key = path.slice(route.length + 1);
    // Storage keys are simple filenames under folder segments; reject anything
    // else (traversal, control chars) rather than forwarding it.
    if (
      !key ||
      key.includes('..') ||
      !/^[A-Za-z0-9._~%-]+(\/[A-Za-z0-9._~%-]+)*$/.test(key)
    ) {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }

    // Legacy social-icon PNGs were stored as `icons/<key>_<hex>_<suffix>.png`,
    // where <suffix> is an arbitrary per-render hash and the image content
    // depends ONLY on (icon key, colour). Emails in the wild reference suffixes
    // that were never captured in the DB export, so collapse every icon request
    // to a single canonical render `icons/<key>_<hex>.png` — the one filename
    // the backfill uploads per (key, colour). Non-icon keys pass through as-is.
    const targetKey = key.replace(
      /^icons\/([A-Za-z]+)_([0-9a-fA-F]{6})_[0-9a-fA-F]+\.png$/,
      'icons/$1_$2.png',
    );

    res.statusCode = 301;
    res.setHeader(
      'Location',
      `${supabaseUrl}/storage/v1/object/public/${bucket}/${keyPrefix}/${targetKey}`,
    );
    // The mapping is permanent; let clients/proxies cache the redirect.
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end();
  };

  return {
    name: 'prodesk-legacy-storage-redirect',
    configResolved(config) {
      envSupabaseUrl = (config.env as Record<string, string | undefined>)
        ?.VITE_SUPABASE_URL;
    },
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
