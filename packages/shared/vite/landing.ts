import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/** Repo-relative home of the static assets shared by clients AND servers. */
const SHARED_PUBLIC = path.join('packages', 'shared', 'public');

/** Placeholder every shared page uses where the app's own origin belongs. */
const APP_ORIGIN_TOKEN = /%APP_ORIGIN%/g;

/** Text types that get `%APP_ORIGIN%` substituted; everything else is copied raw. */
const SUBSTITUTED = new Set(['.html', '.css', '.js']);

/**
 * Never published. The directory documents itself (README.md) and that note is
 * for us, not for visitors — without this it would ship in every client's build
 * and answer at /README.md. Mirrored in servers/redirector/src/landing.ts.
 */
const PRIVATE_EXTENSIONS = new Set(['.md']);

/**
 * Locate `packages/shared/public` by walking up from `from`.
 *
 * Found by search rather than a fixed `../..` hop so it survives a client
 * changing depth, and so a missing directory throws here instead of silently
 * producing a build with no landing page. Also used by servers that serve the
 * same assets (see servers/redirector/src/landing.ts for the runtime twin).
 */
export function sharedPublicDir(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, SHARED_PUBLIC);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`[shared-public] no ${SHARED_PUBLIC} found above ${from}`);
    }
    dir = parent;
  }
}

/** Is this a file we refuse to publish? */
export function isPrivate(relative: string): boolean {
  return PRIVATE_EXTENSIONS.has(path.extname(relative).toLowerCase());
}

/** Every publishable file under `dir`, relative to it (POSIX separators). */
function walk(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else if (!isPrivate(rel)) out.push(rel);
  }
  return out;
}

export interface SharedPublicOptions {
  /**
   * Absolute origin to substitute for `%APP_ORIGIN%`. Defaults to `''` — the
   * empty string leaves route links host-relative, which is what a frontend
   * serving the page on its OWN origin wants. Servers on a different host pass
   * the app's origin so those links cross back (see the redirector).
   */
  appOrigin?: string;
}

/**
 * Serve `packages/shared/public/**` from a client's dev server and copy it into
 * the client's build output.
 *
 * Vite's `publicDir` is a single directory and each client already uses its own
 * for client-specific files (favicons, …), so shared static assets — currently
 * the Adeyy marketing page framed by `@shared/pages/landing` — need this second
 * source. Files land at the same root-relative URLs in dev, preview and prod
 * (`/adeyy/Adeyy.html`), which is what lets the redirector serve the very same
 * bytes from its own host.
 */
export function sharedPublic(options: SharedPublicOptions = {}): Plugin {
  const appOrigin = options.appOrigin ?? '';
  let dir: string;

  /** Read one shared file, substituting `%APP_ORIGIN%` in text types. */
  const read = (rel: string): Buffer | string => {
    const ext = path.extname(rel).toLowerCase();
    if (!SUBSTITUTED.has(ext)) return fs.readFileSync(path.join(dir, rel));
    return fs
      .readFileSync(path.join(dir, rel), 'utf8')
      .replace(APP_ORIGIN_TOKEN, appOrigin);
  };

  /** The file backing a request URL, or null when it isn't a shared asset. */
  const tryRead = (url: string | undefined): Buffer | string | null => {
    let rel: string;
    try {
      rel = decodeURIComponent((url ?? '').split('?')[0]).replace(/^\/+/, '');
    } catch {
      return null; // malformed percent-encoding — let vite answer it
    }
    // Reject traversal before touching the filesystem: the normalized path must
    // stay inside the shared directory.
    if (!rel || rel.split('/').includes('..') || isPrivate(rel)) return null;
    const abs = path.join(dir, rel);
    if (!abs.startsWith(dir + path.sep)) return null;
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
    return read(rel);
  };

  /** Connect middleware answering the shared URLs straight from disk. */
  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): void => {
    const body = tryRead(req.url);
    if (body === null) return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType(req.url ?? ''));
    res.end(body);
  };

  return {
    name: 'prodesk-shared-public',
    configResolved(config) {
      dir = sharedPublicDir(config.root);
    },
    // Dev: the only source for these URLs (nothing has been built yet).
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    // Preview: dist already holds the copies from generateBundle, but serving
    // from disk here keeps preview byte-identical to dev and picks up edits to
    // the marketing page without a rebuild.
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
    // Build: emit each file as a rollup asset so it lands in outDir untouched
    // by hashing, exactly as `public/` files do.
    generateBundle() {
      for (const rel of walk(dir)) {
        this.emitFile({
          type: 'asset',
          fileName: rel,
          source: toSource(read(rel)),
        });
      }
    },
  };
}

/** Rollup wants a string or Uint8Array — Buffer is one, but narrow the type. */
function toSource(body: Buffer | string): string | Uint8Array {
  return typeof body === 'string' ? body : new Uint8Array(body);
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export function contentType(urlOrPath: string): string {
  const ext = path.extname(urlOrPath.split('?')[0]).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}
