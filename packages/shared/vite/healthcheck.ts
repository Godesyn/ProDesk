import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface HealthcheckOptions {
  /** Path the liveness response is served on. Default: '/health'. */
  path?: string;
  /** Client id echoed in the body, so it's obvious which app answered. */
  client?: string;
}

/**
 * Serve a real liveness endpoint from the static `vite preview` server — the
 * server Railway runs for each frontend (see `.railway/configs/clients/*.json`).
 *
 * Why this exists: the API servers expose `/health`, but the frontends are SPAs
 * with no server of their own. Without this, a platform healthcheck on `/health`
 * would fall through to the SPA's index.html — a 200, but HTML, not a real probe.
 * This mounts a tiny middleware that answers `/health` with `200 {"ok":true}`.
 *
 * Mounted on PREVIEW only. The dev server intentionally proxies `/health` to the
 * API (each vite.config's `server.proxy`), which stays untouched.
 */
export function healthcheck(options: HealthcheckOptions = {}): Plugin {
  const path = options.path ?? '/health';
  const body = JSON.stringify({ ok: true, client: options.client });
  const handler = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void => {
    if ((req.url ?? '').split('?')[0] !== path) return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(body);
  };
  return {
    name: 'prodesk-healthcheck',
    // Only hooks the preview server; has no effect on dev or build.
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
