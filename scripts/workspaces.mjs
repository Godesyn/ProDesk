/**
 * Workspace discovery — the single source of truth for "what packages exist",
 * derived from the filesystem so nothing has to be hand-enumerated when a new
 * frontend or server is added. Used by run-all.mjs (root build/typecheck) and
 * check-frontend-wiring.mjs (the wiring guard).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export const root = path.resolve(import.meta.dirname, '..');

/** Workspace dirs under `dir` that hold a package.json, with their pkg name. */
function list(dir, skip = []) {
  return readdirSync(path.join(root, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !skip.includes(e.name))
    .filter((e) => existsSync(path.join(root, dir, e.name, 'package.json')))
    .map((e) => ({
      base: e.name,
      dir: `${dir}/${e.name}`,
      name: JSON.parse(
        readFileSync(path.join(root, dir, e.name, 'package.json'), 'utf8'),
      ).name,
    }));
}

/** The two shared packages (fixed — they are the roots everything imports). */
export const SHARED = [
  { base: 'shared', dir: 'packages/shared', name: '@prodesk/shared' },
  { base: 'server-shared', dir: 'packages/server-shared', name: '@prodesk/server-shared' },
];

/** All frontends. _template is the scaffold for new ones — never built or deployed. */
export function clients() {
  return list('clients', ['_template']);
}

/** All server services. */
export function servers() {
  return list('servers');
}
