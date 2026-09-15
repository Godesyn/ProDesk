/**
 * Build a Rollup `manualChunks` function that splits `node_modules` into
 * cacheable vendor chunks — keeping the app entry small while PRESERVING lazy
 * route chunks.
 *
 * Strategy:
 *  - React (react/react-dom/scheduler/wouter) and the data layer
 *    (@tanstack/@trpc/superjson) are each coalesced into one chunk — every page
 *    needs them, so splitting further only adds requests.
 *  - The markdown/unified ecosystem (a large web of tiny packages, pulled in
 *    only by the lazy chat view) is coalesced into one `markdown` chunk so chat
 *    doesn't fan out into ~30 micro-chunks.
 *  - Every OTHER dependency gets its OWN chunk. This per-package split is the key
 *    to not breaking lazy loading: a dep imported only by a lazy route (e.g.
 *    @ffmpeg) lands in a chunk by itself, so it's fetched on demand. A single
 *    shared "vendor" catch-all would instead merge it with eager libs and pull
 *    the whole thing into the initial load.
 *  - App code returns `undefined` → Vite's route-level code-splitting is left
 *    untouched.
 *
 * @param groups Optional extra coalescing, e.g. `{ charts: ['recharts'], dnd: ['@dnd-kit'] }`.
 *   A package matches a pattern when it equals it or starts with `${pattern}/`.
 */
export function vendorChunks(
  groups: Record<string, string[]> = {},
): (id: string) => string | undefined {
  // Roots of the react-markdown / remark / unified ecosystem (prefix-matched).
  const MARKDOWN = [
    'react-markdown', 'remark', 'rehype', 'micromark', 'mdast', 'hast', 'unist',
    'unified', 'vfile', 'property-information', 'character-entities',
    'character-reference', 'decode-named-character-reference',
    'comma-separated-tokens', 'space-separated-tokens', 'web-namespaces',
    'zwitch', 'html-void-elements', 'bail', 'trough', 'devlop', 'estree-util',
    'longest-streak', 'markdown-table', 'ccount', 'mdurl', 'parse-entities',
    'stringify-entities', 'trim-lines', 'github-slugger',
  ];
  const inGroup = (pkg: string, pat: string) =>
    pkg === pat || pkg.startsWith(`${pat}/`);

  return (rawId) => {
    if (rawId.startsWith('\0')) return undefined; // virtual modules
    const id = rawId.replace(/\\/g, '/'); // normalize Windows paths
    if (!id.includes('/node_modules/')) return undefined;
    const after = id.split('/node_modules/').pop() ?? '';
    const seg = after.split('/');
    const pkg = after.startsWith('@') ? `${seg[0]}/${seg[1]}` : seg[0];

    for (const [chunk, pats] of Object.entries(groups))
      if (pats.some((p) => inGroup(pkg, p))) return chunk;
    // `use-sync-external-store` MUST live in the react chunk: wouter (in this
    // chunk) imports it, and the shim reads `React.*` at module-init time. Splitting
    // it into its own chunk creates a react↔use-sync-external-store cycle, so on init
    // it dereferences React before the react chunk's exports exist → the whole app
    // crashes with "Cannot read properties of undefined (reading 'useState')".
    if (['react', 'react-dom', 'scheduler', 'wouter', 'use-sync-external-store'].includes(pkg)) return 'react';
    if (pkg.startsWith('@tanstack/') || pkg.startsWith('@trpc/') || pkg === 'superjson')
      return 'query';
    if (MARKDOWN.some((p) => pkg === p || pkg.startsWith(p))) return 'markdown';
    return `vendor-${pkg.replace(/^@/, '').replace(/\//g, '-')}`;
  };
}
