#!/usr/bin/env node
/**
 * Workspace wiring guard — fails when a new frontend/server isn't fully wired
 * up, so it can't be silently skipped by verification or missing from dev.
 *
 * The root `build`/`typecheck` scripts derive the workspace list from the
 * filesystem via run-all.mjs, so those can't drift — this guard checks the
 * places that still need explicit registration:
 *   • root package.json delegates build/typecheck to run-all.mjs (regression check)
 *   • .githooks/pre-push builds via run-all.mjs; pre-commit type-checks
 *     affected workspaces (regression check)
 *   • each frontend is registered in scripts/dev.mjs (FRONTENDS table)
 *   • each frontend has a `dev:<name>` script in the root package.json
 *   • each frontend mounts <BetaProgram /> (beta overlays + feedback panel)
 *   • each frontend falls back to the shared <UnknownRouteRedirect> catch-all
 *   • frontend code reads build-time env ONLY via packages/shared/src/lib/env.ts
 * And WARNS (never fails) on deployment gaps: missing .railway env/config.
 *
 * Runs automatically as the first step of `bun run typecheck` and of
 * .githooks/pre-commit. Full new-frontend checklist: clients/_template/README.md
 * and .agents/AGENTS.md → "Creating a new frontend".
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { clients, servers, root } from './workspaces.mjs';

const read = (p) => readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const preCommit = read('.githooks/pre-commit');
const prePush = read('.githooks/pre-push');
const devScript = read('scripts/dev.mjs');

const errors = [];
const warnings = [];

// All frontends deploy with the single shared client env file.
if (!existsSync(path.join(root, '.railway/envs/client/client.env'))) {
  warnings.push('.railway/envs/client/client.env missing (shared env for ALL frontends)');
}
const syncScript = read('.railway/sync.ps1');

// Regression checks: build/typecheck stay self-maintaining via run-all.mjs.
if (!pkg.scripts.build?.includes('run-all.mjs build')) {
  errors.push('root package.json "build" no longer delegates to scripts/run-all.mjs');
}
if (!pkg.scripts.typecheck?.includes('run-all.mjs typecheck')) {
  errors.push('root package.json "typecheck" no longer delegates to scripts/run-all.mjs');
}
if (!prePush.includes('run-all.mjs build')) {
  errors.push('.githooks/pre-push no longer builds via scripts/run-all.mjs');
}
if (!preCommit.includes('affected-typecheck.mjs')) {
  errors.push('.githooks/pre-commit no longer type-checks affected workspaces via scripts/affected-typecheck.mjs');
}

// The beta programme is platform-wide: a beta member must see their countdown,
// their post-beta price report, and the feedback tab on EVERY frontend. Missing
// the mount is invisible in that frontend (nothing renders) but breaks the promise
// — the member can lose access with no warning shown where they were working. So
// it's checked rather than trusted to a checklist.
const BETA_MOUNT = '<BetaProgram';
function mountsBetaProgram(clientDir) {
  const appFile = path.join(root, clientDir, 'src', 'App.tsx');
  if (!existsSync(appFile)) return true; // no App.tsx → not a standard frontend
  return readFileSync(appFile, 'utf8').includes(BETA_MOUNT);
}

// Not-found handling is uniform across the suite: an unmatched route returns
// the visitor to that frontend's own root via the ONE shared
// <UnknownRouteRedirect>. A frontend that forgets the catch-all shows a blank
// screen instead (the Switch matches nothing and renders null) — invisible in
// review, dead-ending for the user — and a hand-rolled local copy is how the
// apps drifted apart before. Both are checked rather than trusted to a
// checklist. The catch-all does not always live in App.tsx (links puts it in
// app/LinksApp.tsx, dashboard in suite/SuiteApp.tsx), so scan the whole src tree.
const NOT_FOUND_MODULE = '@shared/components/unknown-route-redirect';
function notFoundWiring(clientDir) {
  const srcDir = path.join(root, clientDir, 'src');
  if (!existsSync(srcDir)) return { usesShared: true, localCopy: null };
  let usesShared = false;
  let localCopy = null;
  for (const file of tsFiles(srcDir)) {
    const src = readFileSync(file, 'utf8');
    if (src.includes(NOT_FOUND_MODULE)) usesShared = true;
    if (!localCopy && /function\s+UnknownRouteRedirect\s*\(/.test(src)) {
      localCopy = path.relative(root, file);
    }
  }
  return { usesShared, localCopy };
}
function checkNotFound(clientDir) {
  const { usesShared, localCopy } = notFoundWiring(clientDir);
  if (!usesShared) {
    errors.push(
      `${clientDir} — no route falls back to <UnknownRouteRedirect> from ${NOT_FOUND_MODULE} ` +
        `(mount it as the LAST <Route> of every Switch so an unmatched URL returns to "/")`,
    );
  }
  if (localCopy) {
    errors.push(
      `${localCopy} — defines a local UnknownRouteRedirect; import the shared one from ` +
        `${NOT_FOUND_MODULE} so every frontend redirects identically`,
    );
  }
}

for (const c of clients()) {
  if (!new RegExp(`['"]?${c.base}['"]?\\s*:`).test(devScript)) {
    errors.push(`${c.dir} — not registered in the scripts/dev.mjs FRONTENDS table`);
  }
  if (!pkg.scripts[`dev:${c.base}`]) {
    errors.push(`${c.dir} — no "dev:${c.base}" script in the root package.json`);
  }
  if (!mountsBetaProgram(c.dir)) {
    errors.push(
      `${c.dir} — src/App.tsx does not mount <BetaProgram /> ` +
        `(import it from @shared/beta/beta-program and render it in the authenticated branch)`,
    );
  }
  checkNotFound(c.dir);
  if (!new RegExp(`"[^"]*${c.base}[^"]*"\\s*=`, 'i').test(syncScript)) {
    warnings.push(`${c.dir} — no service entry in .railway/sync.ps1 $serviceMap (not wired for env sync)`);
  }
  if (!existsSync(path.join(root, `.railway/configs/clients/${c.base}.json`))) {
    warnings.push(`${c.dir} — no .railway/configs/clients/${c.base}.json (not wired for deployment)`);
  }
}

// Centralised env access: frontend code reads build-time env ONLY through
// packages/shared/src/lib/env.ts (or its semantic layers app-env.ts/origins.ts)
// — a direct `import.meta.env` read anywhere else is a failure. Comment-only
// mentions (lines starting with *, //) are allowed.
const ENV_MODULE = path.join('packages', 'shared', 'src', 'lib', 'env.ts');
function* tsFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* tsFiles(p);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield p;
  }
}
const envScanRoots = [
  'packages/shared/src',
  'clients/_template/src',
  ...clients().map((c) => `${c.dir}/src`),
];
for (const rel of envScanRoots) {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) continue;
  for (const file of tsFiles(abs)) {
    const relFile = path.relative(root, file);
    if (relFile === ENV_MODULE) continue;
    const src = readFileSync(file, 'utf8');
    if (!src.includes('import.meta.env')) continue;
    src.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (!t.includes('import.meta.env')) return;
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
      errors.push(
        `${relFile}:${i + 1} — reads import.meta.env directly; import from @shared/lib/env (or app-env/origins) instead`,
      );
    });
  }
}

// The template is the starting point for new frontends, so it must carry the
// mandatory mount too — otherwise every frontend copied from it starts unwired.
if (!mountsBetaProgram('clients/_template')) {
  errors.push(
    'clients/_template — src/App.tsx does not mount <BetaProgram />; new frontends copied from it would start unwired',
  );
}
checkNotFound('clients/_template');

// Servers are covered by run-all automatically; just surface deployment gaps.
for (const s of servers()) {
  if (!existsSync(path.join(root, `.railway/envs/server/${s.base}.env`))) {
    warnings.push(`${s.dir} — no .railway/envs/server/${s.base}.env (not wired for deployment)`);
  }
}

for (const w of warnings) console.warn(`⚠ wiring: ${w}`);
if (errors.length > 0) {
  console.error('');
  for (const e of errors) console.error(`✗ wiring: ${e}`);
  console.error(
    '\nAn unwired workspace is silently skipped by dev/verification. Wire it up' +
      '\n(checklist: clients/_template/README.md and .agents/AGENTS.md →' +
      '\n"Creating a new frontend") and re-run.',
  );
  process.exit(1);
}
