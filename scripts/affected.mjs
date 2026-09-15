/**
 * Change → workspace mapping for the git hooks. Given a list of changed
 * repo-relative paths, work out which workspaces must be re-checked so the
 * pre-commit hook can typecheck only what a commit actually touches instead of
 * the whole monorepo.
 *
 * Roots force a full check: a change to either shared package (imported
 * everywhere via path aliases), to build/dev tooling in scripts/, to the hooks
 * themselves, or to root TS/package config can affect any workspace — so we
 * can't scope and must check them all.
 */
import { execFileSync } from 'node:child_process';
import { SHARED, clients, servers, root } from './workspaces.mjs';

/** Every workspace package name (shared + servers + clients). */
export function allNames() {
  return [...SHARED, ...servers(), ...clients()].map((w) => w.name);
}

/** A changed path that means "we can't scope — check everything". */
function forcesAll(f) {
  return (
    f.startsWith('packages/shared/') ||
    f.startsWith('packages/server-shared/') ||
    f.startsWith('scripts/') ||
    f.startsWith('.githooks/') ||
    f === 'package.json' ||
    f === 'bun.lock' ||
    f === 'tsconfig.base.json'
  );
}

/**
 * Map changed paths to the set of workspace package names to check. Returns
 * every workspace when a root/tooling file changed, otherwise just the
 * clients/servers whose directory contains a changed file.
 */
export function affectedWorkspaces(changed) {
  if (changed.some(forcesAll)) return allNames();

  const workspaces = [...servers(), ...clients()];
  const hit = new Set();
  for (const f of changed) {
    for (const w of workspaces) {
      if (f.startsWith(`${w.dir}/`)) hit.add(w.name);
    }
  }
  return [...hit];
}

/**
 * Repo-relative paths staged for commit — every change kind, both sides of a
 * rename.
 *
 * Deletions MUST be included: removing a file is the most common way to break
 * another module's imports, and if a commit only deletes files then dropping
 * `D` leaves zero affected workspaces and the hook skips the type-check
 * entirely. `--no-renames` for the same reason — with rename detection on,
 * `--name-only` prints only an `R`'s destination, so moving a file out of a
 * workspace would never re-check the workspace it left.
 */
export function stagedFiles(cwd = root) {
  const out = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--no-renames', '--diff-filter=ACMRD'],
    { cwd, encoding: 'utf8' },
  );
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}
