#!/usr/bin/env node
/**
 * The pre-commit body: type-check only the workspaces the staged changes
 * touch, in parallel (one multi---filter `bun run`). Falls back to every
 * workspace when a shared package or tooling file changed (see affected.mjs).
 *
 * Type-checking is a superset of what actually blocks commits in this repo —
 * the full production build (vite bundling) runs once per push in the pre-push
 * hook, so bundle-only failures still can't reach a shared branch.
 */
import { spawnSync } from 'node:child_process';
import { affectedWorkspaces, stagedFiles } from './affected.mjs';
import { root } from './workspaces.mjs';

const names = affectedWorkspaces(stagedFiles());

if (names.length === 0) {
  console.log('› pre-commit: no workspace files staged — skipping typecheck.');
  process.exit(0);
}

console.log(`› pre-commit: type-checking ${names.length} affected workspace(s): ${names.join(', ')}`);

// Mirror run-all.mjs's Windows handling: bun is often a .cmd/.ps1 shim there,
// launchable by node only through the shell. Our args have no spaces/metachars.
const args = ['run', ...names.flatMap((n) => ['--filter', n]), 'typecheck'];
const win = process.platform === 'win32';
const r = win
  ? spawnSync(['bun', ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true })
  : spawnSync('bun', args, { cwd: root, stdio: 'inherit' });

if (r.error) {
  console.error(`affected-typecheck: failed to launch bun — ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
