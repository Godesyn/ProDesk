/**
 * Procedural specimen marks. Six hand-authored geometric forms keyed by seed —
 * stroke-based so they can "draw themselves in" via the [data-draw] animation
 * (the birth-of-the-mark hero moment). Monochrome by default; the Forest pigment
 * is opt-in via `tone`, honouring the studio's "colour is a decision" thesis.
 */

export type MarkTone = 'ink' | 'pigment' | 'paper';

function strokeFor(tone: MarkTone) {
  if (tone === 'pigment') return 'var(--pigment)';
  if (tone === 'paper') return '#f4f1ea';
  return 'var(--ink)';
}

interface MarkProps {
  seed: number;
  tone?: MarkTone;
  animate?: boolean;
  strokeWidth?: number;
  className?: string;
  title?: string;
}

export function LogoMark({
  seed,
  tone = 'ink',
  animate = true,
  strokeWidth = 6.5,
  className,
  title,
}: MarkProps) {
  const stroke = strokeFor(tone);
  const shapes = MARKS[((seed % MARKS.length) + MARKS.length) % MARKS.length];

  const draw = (i: number) =>
    animate
      ? { 'data-draw': true, pathLength: 1, style: { animationDelay: `${i * 140}ms` } }
      : {};

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={title ?? 'Logo specimen'}
    >
      {shapes.map((s, i) =>
        s.c ? (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} {...draw(i)} />
        ) : (
          <path key={i} d={s.d} {...draw(i)} />
        ),
      )}
    </svg>
  );
}

type Shape =
  | { c?: false; d: string; cx?: never; cy?: never; r?: never }
  | { c: true; cx: number; cy: number; r: number; d?: never };

const MARKS: Shape[][] = [
  // 0 — Peak: an ascending meridian ridge
  [{ d: 'M16 74 L38 40 L52 57 L86 20' }, { c: true, cx: 86, cy: 20, r: 4.5 }],
  // 1 — Loop: interlocking M
  [{ d: 'M22 76 L22 28 L50 60 L78 28 L78 76' }],
  // 2 — Orbit: concentric guidance arcs
  [
    { c: true, cx: 50, cy: 50, r: 30 },
    { c: true, cx: 50, cy: 50, r: 19 },
    { c: true, cx: 50, cy: 50, r: 6.5 },
  ],
  // 3 — Prism: faceted triangle
  [{ d: 'M50 18 L82 74 L18 74 Z' }, { d: 'M50 18 L50 74' }, { d: 'M50 46 L82 74' }],
  // 4 — Compass: cardinal cross in a ring
  [
    { c: true, cx: 50, cy: 50, r: 32 },
    { d: 'M50 12 L50 88' },
    { d: 'M12 50 L88 50' },
    { d: 'M50 34 L62 50 L50 66 L38 50 Z' },
  ],
  // 5 — Ridge: stacked strata M
  [{ d: 'M20 46 L50 30 L80 46' }, { d: 'M20 60 L50 44 L80 60' }, { d: 'M20 74 L50 58 L80 74' }],
];
