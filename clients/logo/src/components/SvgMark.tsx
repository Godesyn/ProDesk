import { useMemo } from 'react';

/**
 * Renders a real (generated / edited) SVG mark inline. The wrapper `<span>` sets
 * the CSS `color` that the mark's `currentColor` ink inherits — so switching
 * between ink, the Forest pigment, and reversed paper-white is a single property,
 * the literal "colour is a decision" mechanism. Lockup SVGs that carry their own
 * `style="color:…"` keep it (their inline color wins over the inherited one).
 *
 * SVG strings are sanitised server-side (modules/logo/svg.ts) before they ever
 * reach the client, so inlining is safe.
 */
export type MarkTone = 'ink' | 'pigment' | 'paper';

/**
 * Repaint a composed lockup by rewriting the `color:` on its root — its ink is
 * `currentColor`, so one property drives mark and wordmark together. This is how
 * the studio previews a colour BEFORE it is committed server-side.
 */
export function recolorSvg(svg: string, css: string): string {
  if (/style="[^"]*color:/.test(svg)) return svg.replace(/color:\s*[^;"]+/, `color:${css}`);
  return svg.replace(/<svg\b/, `<svg style="color:${css}"`);
}

function colorFor(tone: MarkTone): string {
  if (tone === 'pigment') return 'var(--pigment)';
  if (tone === 'paper') return '#f4f1ea';
  return 'var(--ink)';
}

/** Inject the self-drawing reveal onto stroke/shape elements (staggered). */
function withDraw(svg: string): string {
  let i = 0;
  return svg.replace(
    /<(path|circle|line|polyline|polygon|ellipse|rect)\b/g,
    (_m, tag: string) => `<${tag} data-draw="" pathLength="1" style="animation-delay:${i++ * 110}ms"`,
  );
}

export function SvgMark({
  svg,
  tone = 'ink',
  animate = false,
  className,
  title,
  style,
}: {
  svg: string;
  tone?: MarkTone;
  animate?: boolean;
  className?: string;
  title?: string;
  /** Extra styles — e.g. an exact px box for the minimum-size ladder. */
  style?: React.CSSProperties;
}) {
  const html = useMemo(() => (animate ? withDraw(svg) : svg), [svg, animate]);
  return (
    <span
      className={`svg-mark ${className ?? ''}`}
      style={{ color: colorFor(tone), ...style }}
      role="img"
      aria-label={title ?? 'Logo mark'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
