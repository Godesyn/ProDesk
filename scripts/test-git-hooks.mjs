#!/usr/bin/env node
/**
 * Regression tests for .githooks/pre-commit.
 *
 * The hook stashes unstaged work so it can type-check exactly the staged
 * snapshot, which means it moves the index and working tree and must put them
 * back perfectly. A 2026-07-26 incident showed what happens when it cannot: the
 * old hook ran `git reset --hard` and then an UNCHECKED `git stash pop`, so a
 * failed pop (a Windows file lock is enough) left the index empty and git
 * recorded an EMPTY commit carrying the full commit message.
 *
 * These tests run the real hook inside throwaway repos, with the node check
 * commands swapped for a stub so pass/fail is controllable, and one variant that
 * forces the restore to fail. Scenario 5 is the regression guard: a hook that
 * can strand work must never let a commit through.
 *
 *   node scripts/test-git-hooks.mjs      (or: bun run test:hooks)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { affectedWorkspaces, allNames, stagedFiles } from './affected.mjs';

const HOOK_SRC = fileURLToPath(new URL('../.githooks/pre-commit', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'hooktest-'));
let pass = 0;
const failures = [];

const ok = (name) => {
  pass++;
  console.log(`   PASS  ${name}`);
};
const bad = (name, detail = '') => {
  failures.push(name);
  console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Run a git command in `cwd`, returning stdout (never throws). */
function git(cwd, args) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

/**
 * Install the real hook, replacing the two node check invocations with a stub.
 * `breakRestore` forces both `git stash pop` attempts to fail.
 */
function installHook(repo, { checkExit = 0, breakRestore = false, checkCmd = null } = {}) {
  let src = readFileSync(HOOK_SRC, 'utf8');
  const wiring = /^node scripts\/check-frontend-wiring\.mjs \\$/m;
  const typecheck = /^ {2}&& node scripts\/affected-typecheck\.mjs$/m;
  if (!wiring.test(src) || !typecheck.test(src)) {
    throw new Error('test-git-hooks: could not find the check invocations to stub — update installHook()');
  }
  src = src
    .replace(wiring, checkCmd ?? `sh -c "exit ${checkExit}"`)
    .replace(typecheck, '');
  if (breakRestore) {
    // Substring swaps, so they rot silently if the hook is reworded — assert
    // both actually matched rather than shipping a test that always passes.
    for (const pop of ['git stash pop -q --index "$STASH_REF" 2>/dev/null', 'git stash pop -q "$STASH_REF" 2>/dev/null']) {
      if (!src.includes(pop)) throw new Error(`test-git-hooks: hook no longer contains \`${pop}\` — update installHook()`);
      src = src.replace(pop, 'false');
    }
  }
  const dir = join(repo, '.git', 'hooks');
  mkdirSync(dir, { recursive: true });
  const dst = join(dir, 'pre-commit');
  writeFileSync(dst, src, { encoding: 'utf8' });
  chmodSync(dst, 0o755);
}

let n = 0;
function newRepo() {
  const repo = join(root, `r${++n}`);
  mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '.']);
  git(repo, ['config', 'user.email', 't@t.t']);
  git(repo, ['config', 'user.name', 'test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  writeFileSync(join(repo, 'other.txt'), 'other\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-qm', 'base']);
  return repo;
}

const commitFileCount = (repo) =>
  git(repo, ['show', '--numstat', '--format=', 'HEAD']).split('\n').filter(Boolean).length;
const head = (repo) => git(repo, ['rev-parse', 'HEAD']);
const hasStagedChanges = (repo) => git(repo, ['diff', '--cached', '--name-only']).length > 0;

/* 1 ─ staged only, checks pass */
console.log('\n1. staged only, checks pass');
{
  const r = newRepo();
  installHook(r);
  writeFileSync(join(r, 'tracked.txt'), 'STAGED\n');
  git(r, ['add', 'tracked.txt']);
  git(r, ['commit', '-qm', 'c1']);
  commitFileCount(r) === 1 ? ok('commit contains exactly 1 file') : bad('commit file count', commitFileCount(r));
  git(r, ['show', 'HEAD:tracked.txt']) === 'STAGED'
    ? ok('committed the staged content')
    : bad('committed content', git(r, ['show', 'HEAD:tracked.txt']));
  git(r, ['status', '--porcelain']) === '' ? ok('tree clean afterwards') : bad('tree dirty');
}

/* 2 ─ staged + unstaged on the same file */
console.log('\n2. staged + unstaged edits to the same file');
{
  const r = newRepo();
  installHook(r);
  writeFileSync(join(r, 'tracked.txt'), 'STAGED\n');
  git(r, ['add', 'tracked.txt']);
  writeFileSync(join(r, 'tracked.txt'), 'UNSTAGED\n');
  git(r, ['commit', '-qm', 'c2']);
  git(r, ['show', 'HEAD:tracked.txt']) === 'STAGED'
    ? ok('committed the STAGED version, not the working tree')
    : bad('committed the wrong version', git(r, ['show', 'HEAD:tracked.txt']));
  readFileSync(join(r, 'tracked.txt'), 'utf8').trim() === 'UNSTAGED'
    ? ok('unstaged edit restored afterwards')
    : bad('unstaged edit lost');
}

/* 3 ─ staged + untracked */
console.log('\n3. staged + untracked file');
{
  const r = newRepo();
  installHook(r);
  writeFileSync(join(r, 'tracked.txt'), 'STAGED\n');
  git(r, ['add', 'tracked.txt']);
  writeFileSync(join(r, 'untracked.txt'), 'scratch\n');
  git(r, ['commit', '-qm', 'c3']);
  existsSync(join(r, 'untracked.txt')) ? ok('untracked file restored') : bad('untracked file lost');
  git(r, ['ls-tree', '-r', '--name-only', 'HEAD']).includes('untracked.txt')
    ? bad('untracked file was committed')
    : ok('untracked file stayed out of the commit');
}

/* 4 ─ checks fail → commit blocked, everything restored */
console.log('\n4. checks fail → commit blocked, work restored');
{
  const r = newRepo();
  installHook(r, { checkExit: 1 });
  const before = head(r);
  writeFileSync(join(r, 'tracked.txt'), 'STAGED\n');
  git(r, ['add', 'tracked.txt']);
  writeFileSync(join(r, 'tracked.txt'), 'STAGED\nUNSTAGED\n');
  writeFileSync(join(r, 'untracked.txt'), 'scratch\n');
  git(r, ['commit', '-qm', 'c4']);
  head(r) === before ? ok('no commit created') : bad('a commit was created anyway');
  existsSync(join(r, 'untracked.txt')) ? ok('untracked restored') : bad('untracked lost');
  hasStagedChanges(r) ? ok('staged changes still staged') : bad('staged changes lost');
}

/* 5 ─ REGRESSION: restore fails → the commit must be blocked */
console.log('\n5. REGRESSION: restore fails → commit must be blocked (no empty commit)');
{
  const r = newRepo();
  installHook(r, { breakRestore: true });
  const before = head(r);
  writeFileSync(join(r, 'tracked.txt'), 'STAGED\n');
  git(r, ['add', 'tracked.txt']);
  writeFileSync(join(r, 'tracked.txt'), 'UNSTAGED\n');
  const out = git(r, ['commit', '-m', 'c5']);
  head(r) === before
    ? ok('commit blocked')
    : bad('EMPTY-COMMIT BUG: a commit was created', `${commitFileCount(r)} files`);
  /could not restore/.test(out) ? ok('printed recovery instructions') : bad('no recovery message');
  git(r, ['stash', 'list']).includes('pre-commit-stash')
    ? ok('work preserved in the stash')
    : bad('stash missing — work would be lost');
  hasStagedChanges(r) ? ok('index still holds the staged snapshot') : bad('index was left empty');
}

/* 6 ─ fidelity: the checks must see staged content, not the working tree */
console.log('\n6. fidelity: checks see the staged snapshot, not the working tree');
{
  const r = newRepo();
  installHook(r, { checkCmd: 'sh -c "grep -q GOOD tracked.txt"' });
  writeFileSync(join(r, 'tracked.txt'), 'GOOD\n');
  git(r, ['add', 'tracked.txt']);
  writeFileSync(join(r, 'tracked.txt'), 'BROKEN\n');
  git(r, ['commit', '-qm', 'c6']);
  git(r, ['log', '--oneline']).includes('c6')
    ? ok('checked the staged content (commit allowed)')
    : bad('checked the working tree instead (commit blocked)');
  readFileSync(join(r, 'tracked.txt'), 'utf8').trim() === 'BROKEN'
    ? ok('working tree keeps its unstaged edit')
    : bad('working tree was clobbered');
}

/* 7 ─ scoping: which workspaces the staged changes map to.
 *
 * The stash scenarios above prove the hook checks the staged SNAPSHOT; this
 * proves it checks the right WORKSPACES. Regression guard: `--diff-filter`
 * once omitted `D` and left rename detection on, so a commit that only deleted
 * or moved files mapped to zero workspaces and skipped the type-check
 * entirely — exactly the change most likely to break another file's imports. */
console.log('\n7. scoping: staged paths → affected workspaces');
{
  const r = newRepo();
  const write = (p, body) => {
    mkdirSync(join(r, p, '..'), { recursive: true });
    writeFileSync(join(r, p), body);
  };
  /** Seed `paths` as committed files, run `act`, then map what that staged. */
  const stage = (paths, act) => {
    for (const p of paths) write(p, 'seed\n');
    git(r, ['add', '-A']);
    git(r, ['commit', '-qm', 'seed']);
    act();
    git(r, ['add', '-A']);
    return affectedWorkspaces(stagedFiles(r));
  };

  const deleted = stage(['clients/links/src/gone.ts'], () => git(r, ['rm', '-q', 'clients/links/src/gone.ts']));
  deleted.includes('links')
    ? ok('a delete-only commit still checks the workspace')
    : bad('deletions are invisible to the type-check', JSON.stringify(deleted));

  const moved = stage(['clients/links/src/moved.ts'], () => {
    mkdirSync(join(r, 'clients/jobs/src'), { recursive: true });
    git(r, ['mv', 'clients/links/src/moved.ts', 'clients/jobs/src/moved.ts']);
  });
  moved.includes('links') && moved.includes('jobs')
    ? ok('a cross-workspace move checks BOTH sides')
    : bad('a rename only checks its destination', JSON.stringify(moved));

  const edited = stage(['clients/reviews/src/edit.ts'], () => write('clients/reviews/src/edit.ts', 'changed\n'));
  edited.length === 1 && edited[0] === 'reviews'
    ? ok('an ordinary edit stays scoped to one workspace')
    : bad('scoping wrong for a plain edit', JSON.stringify(edited));

  affectedWorkspaces(['packages/shared/src/x.ts']).length === allNames().length
    ? ok('a shared-package change forces a full check')
    : bad('shared change did not force a full check');
  affectedWorkspaces(['docs/readme.md']).length === 0
    ? ok('a non-workspace change checks nothing')
    : bad('non-workspace change pulled in workspaces');
}

try {
  rmSync(root, { recursive: true, force: true });
} catch {
  /* Windows sometimes holds a handle briefly; the temp dir is disposable. */
}

console.log(`\n${failures.length ? '✗' : '✓'} git hooks: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
