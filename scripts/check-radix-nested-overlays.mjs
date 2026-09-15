/**
 * Guard: portalled Radix overlays nested inside a modal host.
 *
 * A modal Radix host (Dialog / Sheet / AlertDialog / Drawer) sets
 * `pointer-events: none` on <body> while open. Radix Popover / DropdownMenu /
 * ContextMenu / Menubar / HoverCard render their content through a PORTAL to
 * <body> — outside the host's subtree — so unless they declare `modal`, that
 * content renders but silently ignores every click.
 *
 * The inverse failure is just as bad: a MODAL menu restores <body>'s
 * pointer-events on a deferred tick, so if selecting an item unmounts the menu's
 * tree (navigate, switch screen, sign out) the restore never runs and the whole
 * page goes dead — text still selectable, which is the tell-tale sign.
 *
 * There is no default that is right in both cases, so this guard demands the
 * choice be EXPLICIT: any portalled Radix overlay rendered inside a modal host
 * must pass `modal` or `modal={false}`, with a comment saying why.
 *
 * Only Radix-portalled components count. `packages/shared/src/components/ui/popover.tsx`
 * is a hand-rolled inline popover (`position: absolute`, no portal) and is immune,
 * so it is deliberately not on the list.
 *
 * Run by `bun run typecheck` via scripts/run-all.mjs — see check-frontend-wiring.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['clients', 'packages/shared/src'];
const HOSTS = ['DialogContent', 'SheetContent', 'AlertDialogContent', 'DrawerContent'];

/** Radix components whose content is portalled out of the host's subtree. */
const PORTALLED = ['DropdownMenu', 'ContextMenu', 'Menubar', 'HoverCard'];

/**
 * `Popover` is ambiguous across the repo: Radix in the per-client shadcn kits,
 * hand-rolled and inline in packages/shared. Treat it as portalled only when the
 * file imports the Radix-backed one.
 */
const RADIX_POPOVER_IMPORT = /import\s*\{[^}]*\bPopover\b[^}]*\}\s*from\s*['"][^'"]*components\/ui\/popover['"]/;
const SHARED_POPOVER_IMPORT = /from\s*['"][^'"]*(\.\.\/)+components\/ui\/popover['"]/;

/** End offset (exclusive) of the JSX opening tag starting at `from`. */
function tagEnd(src, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return i + 1;
  }
  return src.length;
}

/** Every `<Name …>` with its full, possibly multi-line, attribute text. */
function tags(src, name) {
  const out = [];
  const re = new RegExp(`<${name}(?=[\\s/>])`, 'g');
  let m;
  while ((m = re.exec(src))) {
    const end = tagEnd(src, m.index);
    out.push({ index: m.index, attrs: src.slice(m.index + name.length + 1, end - 1) });
  }
  return out;
}

/** [start, end) of each modal-host content subtree. */
function hostSpans(src) {
  const spans = [];
  for (const host of HOSTS) {
    for (const t of tags(src, host)) {
      if (src[tagEnd(src, t.index) - 2] === '/') continue; // self-closing
      let depth = 1;
      let i = tagEnd(src, t.index);
      const step = new RegExp(`<(/?)${host}(?=[\\s/>])`, 'g');
      step.lastIndex = i;
      let s;
      while (depth > 0 && (s = step.exec(src))) {
        depth += s[1] === '/' ? -1 : 1;
        i = s.index + s[0].length;
      }
      spans.push([t.index, i]);
    }
  }
  return spans;
}

function collectFiles(roots) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'dist') walk(p);
      } else if (e.name.endsWith('.tsx')) files.push(p);
    }
  };
  for (const r of roots) walk(r);
  return files;
}

const hasModal = (attrs) => /(^|\s)modal(\s|=|$)/.test(attrs);

const problems = [];
for (const file of collectFiles(ROOTS)) {
  // The UI kit itself declares the primitives; it is not a usage site.
  if (file.includes(`components${path.sep}ui${path.sep}`)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const spans = hostSpans(src);
  if (!spans.length) continue;

  const names = [...PORTALLED];
  if (RADIX_POPOVER_IMPORT.test(src) && !SHARED_POPOVER_IMPORT.test(src)) names.push('Popover');

  for (const name of names) {
    for (const t of tags(src, name)) {
      if (!spans.some(([a, b]) => t.index > a && t.index < b)) continue;
      if (hasModal(t.attrs)) continue;
      problems.push({
        file: file.split(path.sep).join('/'),
        line: src.slice(0, t.index).split('\n').length,
        name,
      });
    }
  }
}

if (problems.length) {
  console.error('\n✖ Portalled Radix overlay inside a modal host without an explicit `modal` prop:\n');
  for (const p of problems) console.error(`  ${p.file}:${p.line}  <${p.name}>`);
  console.error(
    '\n  A modal host sets `pointer-events: none` on <body>; these portal their content\n' +
      '  outside it, so without `modal` the content renders but ignores clicks.\n' +
      '  Pass `modal` (content is inside a dialog) or `modal={false}` (the action\n' +
      '  unmounts the menu’s tree), and say which in a comment.\n' +
      '  See scripts/check-radix-nested-overlays.mjs.\n',
  );
  process.exit(1);
}

console.log('✔ No portalled Radix overlay nested in a modal host without an explicit `modal`.');
