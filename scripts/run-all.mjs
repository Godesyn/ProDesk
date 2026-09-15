#!/usr/bin/env node
/**
 * Run a package script across every workspace — the body of the root
 * `build` / `typecheck` scripts. The workspace list is DERIVED from the
 * filesystem (see workspaces.mjs), so a new frontend or server is picked up
 * automatically — nothing to add to package.json.
 *
 *   node scripts/run-all.mjs typecheck   all shared + servers + clients, in
 *                                        parallel (one multi---filter bun run)
 *   node scripts/run-all.mjs build       server-shared → servers → clients,
 *                                        sequentially (order matters: backend
 *                                        consumes server-shared's dist; and
 *                                        parallel vite builds are memory-heavy
 *                                        for no deploy benefit — Railway builds
 *                                        each service independently anyway)
 */
import { spawnSync } from 'node:child_process';
import { SHARED, clients, servers, root } from './workspaces.mjs';

const script = process.argv[2];

function bun(args) {
  // On Windows bun is often installed behind a .cmd/.ps1 shim (e.g. via npm),
  // which node can only launch through the shell — so join the command into a
  // string there. None of our args contain spaces or shell metacharacters, so
  // no quoting is needed.
  const win = process.platform === 'win32';
  const r = win
    ? spawnSync(['bun', ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync('bun', args, { cwd: root, stdio: 'inherit' });
  if (r.error) {
    console.error(`run-all: failed to launch bun — ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (script === 'typecheck') {
  const names = [...SHARED, ...servers(), ...clients()].map((w) => w.name);
  bun(['run', ...names.flatMap((n) => ['--filter', n]), 'typecheck']);
} else if (script === 'build') {
  // @prodesk/shared has no build (consumed as source via path aliases).
  const names = [
    '@prodesk/server-shared',
    ...servers().map((w) => w.name),
    ...clients().map((w) => w.name),
  ];
  for (const n of names) bun(['run', '--filter', n, 'build']);
} else {
  console.error('usage: node scripts/run-all.mjs <typecheck|build>');
  process.exit(1);
}
