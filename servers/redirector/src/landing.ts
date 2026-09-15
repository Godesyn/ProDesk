import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serve `packages/shared/public` from the redirector — the runtime twin of the
 * vite plugin in `packages/shared/vite/landing.ts`.
 *
 * The Adeyy marketing page is one file used by two hosts: the Links frontend
 * frames it (see @shared/pages/landing) and the redirector serves it as the top
 * document on `/`, so a visitor who is not signed in gets the same landing page
 * on url.adeyy.com that they'd get on the app domain. Both hosts publish it at
 * the same root-relative URLs, so its asset paths need no rewriting — only
 * `%APP_ORIGIN%`, which each host resolves to itself vs. the app.
 */

/** Repo-relative home of the static assets shared by clients and servers. */
const SHARED_PUBLIC = path.join('packages', 'shared', 'public');

/** Placeholder marking where the app's own origin belongs in shared markup. */
const APP_ORIGIN_TOKEN = /%APP_ORIGIN%/g;

/** Text types that get `%APP_ORIGIN%` substituted; everything else is sent raw. */
const SUBSTITUTED = new Set(['.html', '.css', '.js']);

/**
 * Never served — the directory's own README documents the contract for us, not
 * for visitors. Mirrors PRIVATE_EXTENSIONS in packages/shared/vite/landing.ts.
 */
const PRIVATE_EXTENSIONS = new Set(['.md']);

/** URL of the marketing page — matches ADEYY_LANDING_PATH in @shared/pages/landing. */
export const LANDING_PATH = '/adeyy/Adeyy.html';

/**
 * Locate `packages/shared/public` by walking up from this module. Works from
 * `src/` under tsx-watch and from `dist/` in production (same depth), and throws
 * a clear error rather than silently serving nothing if the layout ever moves.
 */
function resolveSharedPublic(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = path.join(dir, SHARED_PUBLIC);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`[Redirector] no ${SHARED_PUBLIC} found above ${dir}`);
    }
    dir = parent;
  }
}

const SHARED_DIR = resolveSharedPublic();

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

export function contentTypeFor(pathname: string): string {
  return CONTENT_TYPES[path.extname(pathname).toLowerCase()] ?? 'application/octet-stream';
}

/** Read a shared file, substituting `%APP_ORIGIN%` in text types. */
function read(relative: string, appOrigin: string): Buffer | string {
  const abs = path.join(SHARED_DIR, relative);
  if (!SUBSTITUTED.has(path.extname(relative).toLowerCase())) {
    return fs.readFileSync(abs);
  }
  return fs.readFileSync(abs, 'utf8').replace(APP_ORIGIN_TOKEN, appOrigin);
}

/**
 * The shared asset behind a request path, or null when the path doesn't name
 * one. Rejects traversal before touching the filesystem.
 */
export function sharedAsset(
  pathname: string,
  appOrigin: string,
): { body: Buffer | string; contentType: string } | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return null; // malformed percent-encoding
  }
  if (!relative || relative.split(/[\\/]/).includes('..')) return null;
  if (PRIVATE_EXTENSIONS.has(path.extname(relative).toLowerCase())) return null;
  const abs = path.join(SHARED_DIR, relative);
  if (!abs.startsWith(SHARED_DIR + path.sep)) return null;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null;
  return { body: read(relative, appOrigin), contentType: contentTypeFor(relative) };
}

/**
 * The marketing page with `%APP_ORIGIN%` pointing at the app, cached per origin.
 * Read from disk once because the file never changes within a deploy.
 */
const htmlCache = new Map<string, string>();
export function landingHtml(appOrigin: string): string {
  const cached = htmlCache.get(appOrigin);
  if (cached !== undefined) return cached;
  const html = read(LANDING_PATH.replace(/^\/+/, ''), appOrigin) as string;
  htmlCache.set(appOrigin, html);
  return html;
}
