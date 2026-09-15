/**
 * Ink bounds for a mark SVG — the box the artwork actually occupies inside its
 * viewBox, rather than the viewBox itself.
 *
 * WHY: a lockup sets the wordmark against the mark. Aligning type to the mark's
 * *box* misaligns it the moment the artwork sits high, low, or off-centre inside
 * that box — which generated marks routinely do (a summit dot near the top edge,
 * a ridge that stops well short of the bottom). Measuring the real ink lets the
 * wordmark share the mark's optical centre line, and lets the lockup frame the
 * artwork instead of its padding.
 *
 * There is no DOM here — lockups are composed server-side for the PDF/PNG
 * exports too — so geometry is parsed and flattened by hand: curves are sampled,
 * arcs solved to their true extrema, and stroke width added as half-width
 * padding. Anything we cannot parse with confidence fails the WHOLE measurement
 * (returns null) rather than returning a plausible-but-wrong box: callers then
 * fall back to the viewBox, which is loose but never clips.
 */

export interface InkBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/** Affine matrix [a, b, c, d, e, f] — the SVG transform representation. */
type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Parse a transform list into one matrix. Unrecognised functions → null (bail). */
function parseTransform(value: string): Mat | null {
  let out = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  let seen = false;
  while ((m = re.exec(value))) {
    seen = true;
    const fn = m[1].toLowerCase();
    const n = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (n.some((v) => !Number.isFinite(v))) return null;
    let step: Mat;
    switch (fn) {
      case 'translate':
        step = [1, 0, 0, 1, n[0] ?? 0, n[1] ?? 0];
        break;
      case 'scale':
        step = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const rad = ((n[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const rot: Mat = [cos, sin, -sin, cos, 0, 0];
        // rotate(a cx cy) === translate(cx cy) rotate(a) translate(-cx -cy)
        if (n.length >= 3) {
          const [cx, cy] = [n[1], n[2]];
          step = mul(mul([1, 0, 0, 1, cx, cy], rot), [1, 0, 0, 1, -cx, -cy]);
        } else step = rot;
        break;
      }
      case 'skewx':
        step = [1, 0, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewy':
        step = [1, Math.tan(((n[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      case 'matrix':
        if (n.length < 6) return null;
        step = [n[0], n[1], n[2], n[3], n[4], n[5]];
        break;
      default:
        return null;
    }
    out = mul(out, step);
  }
  return seen ? out : IDENTITY;
}

/* ── attribute reading ──────────────────────────────────────────────────── */

function attr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function num(attrs: string, name: string): number | null {
  const raw = attr(attrs, name);
  if (raw === null) return null;
  const v = Number(raw.trim().replace(/px$/i, ''));
  return Number.isFinite(v) ? v : null;
}

function points(value: string): { x: number; y: number }[] | null {
  const n = value.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (!n.length || n.some((v) => !Number.isFinite(v))) return null;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push({ x: n[i], y: n[i + 1] });
  return out.length ? out : null;
}

/* ── path flattening ────────────────────────────────────────────────────── */

const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
/** How finely curves are sampled — 12 steps is well inside a hairline at logo scale. */
const CURVE_STEPS = 12;

/**
 * The points an elliptical arc (`A`) is bounded by: its two endpoints plus every
 * axis-extreme it actually sweeps through, via the spec's endpoint-to-centre
 * conversion (SVG 1.1 F.6.5).
 *
 * WHY EXACTLY, and not a cheap bound: an arc used to be bounded by a radius-sized
 * box around both endpoints. That is never-clipping but wildly loose AND
 * off-centre — a ring drawn as one `A 32 32 0 1 0 …` measured ~2× its real height
 * and sat a third of its width off true. Since `layoutLockup` centres the mark's
 * SQUARE by this measurement, that loose box put the favicon/avatar artwork
 * visibly off-centre and undersized. Arcs turn out to be the ordinary way a
 * generated mark draws a ring, so the approximation had to go.
 *
 * Degenerate input (a zero radius, coincident endpoints) is a straight line per
 * the spec — bounded by the endpoints alone.
 */
function arcPoints(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  fA: number,
  fS: number,
  x2: number,
  y2: number,
): { x: number; y: number }[] | null {
  const ends = [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return ends;

  const phi = ((phiDeg % 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);

  // Step 1 — the endpoints in the ellipse's own (unrotated, midpoint) frame.
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const px = cos * dx + sin * dy;
  const py = -sin * dx + cos * dy;

  // Step 2 — scale the radii up if they're too small to span the chord.
  const lambda = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // Step 3 — the centre, in that same frame and then in user space.
  const denom = rx * rx * py * py + ry * ry * px * px;
  if (!denom) return ends;
  const ratio = Math.max(0, (rx * rx * ry * ry - denom) / denom);
  const coef = (fA === fS ? -1 : 1) * Math.sqrt(ratio);
  const cxp = (coef * rx * py) / ry;
  const cyp = (-coef * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;

  // Step 4 — the swept angle range.
  const theta1 = Math.atan2((py - cyp) / ry, (px - cxp) / rx);
  const theta2 = Math.atan2((-py - cyp) / ry, (-px - cxp) / rx);
  let delta = theta2 - theta1;
  const TAU = Math.PI * 2;
  if (!fS && delta > 0) delta -= TAU;
  if (fS && delta < 0) delta += TAU;
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(delta)) return null;

  const at = (t: number) => ({
    x: cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin,
    y: cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos,
  });
  /** Is angle `t` inside the sweep? Compared as a signed offset from θ1. */
  const swept = (t: number) => {
    let off = (t - theta1) % TAU;
    if (delta >= 0) {
      if (off < 0) off += TAU;
      return off <= delta;
    }
    if (off > 0) off -= TAU;
    return off >= delta;
  };

  // dx/dt = 0 and dy/dt = 0 give the horizontal and vertical extremes; each
  // solution repeats every half turn, so both branches are tested.
  const out = [...ends];
  for (const base of [Math.atan2(-ry * sin, rx * cos), Math.atan2(ry * cos, rx * sin)]) {
    for (const t of [base, base + Math.PI, base - Math.PI]) {
      if (swept(t)) out.push(at(t));
    }
  }
  return out;
}

/**
 * Flatten a path's `d` into the points its outline passes through. Cubics and
 * quadratics are sampled; elliptical arcs are solved for their true extrema.
 * Returns null on anything malformed, so the caller can fall back safely.
 */
function pathPoints(d: string): { x: number; y: number }[] | null {
  const pts: { x: number; y: number }[] = [];
  const push = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    pts.push({ x, y });
    return true;
  };

  let i = 0;
  const skipSep = () => {
    while (i < d.length && (d[i] === ' ' || d[i] === ',' || d[i] === '\n' || d[i] === '\r' || d[i] === '\t'))
      i++;
  };
  const readNum = (): number | null => {
    skipSep();
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(d);
    if (!m) return null;
    i = NUM_RE.lastIndex;
    return Number(m[0]);
  };
  // Arc flags may be written glued to the next number ("0130"), so they are read
  // one character at a time rather than as numbers.
  const readFlag = (): number | null => {
    skipSep();
    const c = d[i];
    if (c === '0' || c === '1') {
      i++;
      return Number(c);
    }
    return null;
  };
  const nextIsNumber = () => {
    skipSep();
    return i < d.length && /[-+.\d]/.test(d[i]);
  };

  // Current point, subpath start, and the reflected-control state for S/T.
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;

  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) => {
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const px = u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x;
      const py = u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y;
      if (!push(px, py)) return false;
    }
    return true;
  };
  const quad = (x1: number, y1: number, x: number, y: number) => {
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const px = u * u * cx + 2 * u * t * x1 + t * t * x;
      const py = u * u * cy + 2 * u * t * y1 + t * t * y;
      if (!push(px, py)) return false;
    }
    return true;
  };

  skipSep();
  while (i < d.length) {
    const ch = d[i];
    if (!/[A-Za-z]/.test(ch)) return null; // arguments without a command
    i++;
    const rel = ch === ch.toLowerCase();
    const cmd = ch.toUpperCase();

    if (cmd === 'Z') {
      cx = sx;
      cy = sy;
      lastCubic = lastQuad = null;
      skipSep();
      continue;
    }

    let first = true;
    do {
      switch (cmd) {
        case 'M':
        case 'L': {
          const x = readNum();
          const y = readNum();
          if (x === null || y === null) return null;
          cx = rel ? cx + x : x;
          cy = rel ? cy + y : y;
          // Only the first pair of an M moves the subpath start; the rest are lines.
          if (cmd === 'M' && first) {
            sx = cx;
            sy = cy;
          }
          if (!push(cx, cy)) return null;
          lastCubic = lastQuad = null;
          break;
        }
        case 'H': {
          const x = readNum();
          if (x === null) return null;
          cx = rel ? cx + x : x;
          if (!push(cx, cy)) return null;
          lastCubic = lastQuad = null;
          break;
        }
        case 'V': {
          const y = readNum();
          if (y === null) return null;
          cy = rel ? cy + y : y;
          if (!push(cx, cy)) return null;
          lastCubic = lastQuad = null;
          break;
        }
        case 'C':
        case 'S': {
          let x1: number;
          let y1: number;
          if (cmd === 'C') {
            const a = readNum();
            const b = readNum();
            if (a === null || b === null) return null;
            x1 = rel ? cx + a : a;
            y1 = rel ? cy + b : b;
          } else {
            // S: first control is the reflection of the previous cubic's second.
            x1 = lastCubic ? 2 * cx - lastCubic[0] : cx;
            y1 = lastCubic ? 2 * cy - lastCubic[1] : cy;
          }
          const a2 = readNum();
          const b2 = readNum();
          const ax = readNum();
          const ay = readNum();
          if (a2 === null || b2 === null || ax === null || ay === null) return null;
          const x2 = rel ? cx + a2 : a2;
          const y2 = rel ? cy + b2 : b2;
          const x = rel ? cx + ax : ax;
          const y = rel ? cy + ay : ay;
          if (!cubic(x1, y1, x2, y2, x, y)) return null;
          cx = x;
          cy = y;
          lastCubic = [x2, y2];
          lastQuad = null;
          break;
        }
        case 'Q':
        case 'T': {
          let x1: number;
          let y1: number;
          if (cmd === 'Q') {
            const a = readNum();
            const b = readNum();
            if (a === null || b === null) return null;
            x1 = rel ? cx + a : a;
            y1 = rel ? cy + b : b;
          } else {
            x1 = lastQuad ? 2 * cx - lastQuad[0] : cx;
            y1 = lastQuad ? 2 * cy - lastQuad[1] : cy;
          }
          const ax = readNum();
          const ay = readNum();
          if (ax === null || ay === null) return null;
          const x = rel ? cx + ax : ax;
          const y = rel ? cy + ay : ay;
          if (!quad(x1, y1, x, y)) return null;
          cx = x;
          cy = y;
          lastQuad = [x1, y1];
          lastCubic = null;
          break;
        }
        case 'A': {
          const rx = readNum();
          const ry = readNum();
          const rot = readNum();
          const laf = readFlag();
          const sf = readFlag();
          const ax = readNum();
          const ay = readNum();
          if (
            rx === null ||
            ry === null ||
            rot === null ||
            laf === null ||
            sf === null ||
            ax === null ||
            ay === null
          )
            return null;
          const x = rel ? cx + ax : ax;
          const y = rel ? cy + ay : ay;
          const arc = arcPoints(cx, cy, rx, ry, rot, laf, sf, x, y);
          if (!arc) return null;
          for (const p of arc) if (!push(p.x, p.y)) return null;
          cx = x;
          cy = y;
          lastCubic = lastQuad = null;
          break;
        }
        default:
          return null;
      }
      first = false;
    } while (nextIsNumber());
    skipSep();
  }

  return pts.length ? pts : null;
}

/* ── the walk ───────────────────────────────────────────────────────────── */

/** Elements whose geometry we can measure. */
const DRAWABLE = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
/** Elements that carry no ink of their own and are safe to walk through / ignore. */
const IGNORABLE = new Set(['svg', 'g', 'title', 'desc', 'metadata']);
/**
 * Elements that DEFINE paint rather than lay it down: their subtree is skipped
 * whole, because nothing inside it renders at the point of declaration.
 *
 * WHY skip rather than bail: a `<defs>` block or a lone gradient is ordinary in
 * generated marks, and failing the whole measurement over one meant falling back
 * to the viewBox — which is exactly the mis-framing this module exists to avoid.
 * A `clip-path` / `mask` REFERENCE on a drawn element is still ignored, so a
 * clipped shape measures as its unclipped self: a loose box, never a clipping one,
 * the same trade-off the arc bounds take.
 */
const DEFINING = new Set([
  'defs',
  'clippath',
  'mask',
  'pattern',
  'filter',
  'symbol',
  'marker',
  'lineargradient',
  'radialgradient',
  'stop',
  'style',
]);

interface Frame {
  matrix: Mat;
  hidden: boolean;
  stroked: boolean;
  strokeWidth: number;
}

/** Inherited paint state, resolved from an element's own attributes. */
function frameFrom(parent: Frame, attrs: string, override: number | null): Frame | null {
  const t = attr(attrs, 'transform');
  const local = t === null ? IDENTITY : parseTransform(t);
  if (!local) return null;
  const stroke = attr(attrs, 'stroke');
  const width = num(attrs, 'stroke-width');
  const display = attr(attrs, 'display');
  const visibility = attr(attrs, 'visibility');
  return {
    matrix: mul(parent.matrix, local),
    hidden:
      parent.hidden || display?.toLowerCase() === 'none' || visibility?.toLowerCase() === 'hidden',
    stroked: stroke === null ? parent.stroked : stroke.toLowerCase() !== 'none',
    strokeWidth: override ?? (width === null ? parent.strokeWidth : width),
  };
}

/**
 * The ink bounds of a mark SVG in its own viewBox units, or null when the
 * geometry cannot be measured with confidence.
 *
 * `strokeWidth` overrides every element's own width — pass the editor's global
 * stroke override (expressed in the same units) so the measured box matches what
 * will actually be drawn.
 */
export function inkBounds(markSvg: string, opts: { strokeWidth?: number | null } = {}): InkBox | null {
  const svg = String(markSvg ?? '');
  if (!svg) return null;
  const override = opts.strokeWidth ?? null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const stack: Frame[] = [
    { matrix: IDENTITY, hidden: false, stroked: false, strokeWidth: 1 },
  ];

  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*?)(\/?)>/g;
  /** The definition subtree currently being skipped, with its nesting depth. */
  let skip: { name: string; depth: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(svg))) {
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    const selfClosing = m[4] === '/';

    if (skip) {
      if (name !== skip.name) continue;
      if (closing) {
        if (--skip.depth === 0) skip = null;
      } else if (!selfClosing) skip.depth++;
      continue;
    }
    if (closing) {
      if (IGNORABLE.has(name) && stack.length > 1) stack.pop();
      continue;
    }
    if (DEFINING.has(name)) {
      if (!selfClosing) skip = { name, depth: 1 };
      continue;
    }
    if (!DRAWABLE.has(name) && !IGNORABLE.has(name)) return null; // <text>, <use>, …

    const parent = stack[stack.length - 1];
    const frame = frameFrom(parent, attrs, override);
    if (!frame) return null;

    if (!DRAWABLE.has(name)) {
      if (!selfClosing) stack.push(frame);
      continue;
    }
    if (frame.hidden) continue;

    const box = localBox(name, attrs);
    if (box === null) return null;
    if (!box) continue; // nothing drawn (e.g. a zero-radius circle)

    // Grow by half the stroke before transforming, so a scaled group scales its
    // own hairline too.
    const pad = frame.stroked ? Math.abs(frame.strokeWidth) / 2 : 0;
    const corners: [number, number][] = [
      [box.minX - pad, box.minY - pad],
      [box.maxX + pad, box.minY - pad],
      [box.maxX + pad, box.maxY + pad],
      [box.minX - pad, box.maxY + pad],
    ];
    for (const [x, y] of corners) {
      const [tx, ty] = applyMat(frame.matrix, x, y);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      if (tx < minX) minX = tx;
      if (ty < minY) minY = ty;
      if (tx > maxX) maxX = tx;
      if (ty > maxY) maxY = ty;
    }
  }

  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * An element's untransformed, unstroked bounds. Returns null when the geometry
 * is malformed (fail the measurement) and undefined when there is simply nothing
 * to draw (skip the element).
 */
function localBox(
  name: string,
  attrs: string,
): { minX: number; minY: number; maxX: number; maxY: number } | null | undefined {
  const box = (xs: number[], ys: number[]) => ({
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  });

  switch (name) {
    case 'circle': {
      const r = num(attrs, 'r');
      if (r === null) return undefined;
      if (r <= 0) return undefined;
      const cx = num(attrs, 'cx') ?? 0;
      const cy = num(attrs, 'cy') ?? 0;
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case 'ellipse': {
      const rx = num(attrs, 'rx');
      const ry = num(attrs, 'ry');
      if (rx === null || ry === null) return undefined;
      if (rx <= 0 || ry <= 0) return undefined;
      const cx = num(attrs, 'cx') ?? 0;
      const cy = num(attrs, 'cy') ?? 0;
      return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry };
    }
    case 'rect': {
      const w = num(attrs, 'width');
      const h = num(attrs, 'height');
      if (w === null || h === null) return undefined;
      if (w <= 0 || h <= 0) return undefined;
      const x = num(attrs, 'x') ?? 0;
      const y = num(attrs, 'y') ?? 0;
      return { minX: x, minY: y, maxX: x + w, maxY: y + h };
    }
    case 'line': {
      const x1 = num(attrs, 'x1');
      const y1 = num(attrs, 'y1');
      const x2 = num(attrs, 'x2');
      const y2 = num(attrs, 'y2');
      if (x1 === null || y1 === null || x2 === null || y2 === null) return undefined;
      return box([x1, x2], [y1, y2]);
    }
    case 'polyline':
    case 'polygon': {
      const raw = attr(attrs, 'points');
      if (raw === null) return undefined;
      const pts = points(raw);
      if (!pts) return null;
      return box(pts.map((p) => p.x), pts.map((p) => p.y));
    }
    case 'path': {
      const d = attr(attrs, 'd');
      if (d === null || !d.trim()) return undefined;
      const pts = pathPoints(d);
      if (!pts) return null;
      return box(pts.map((p) => p.x), pts.map((p) => p.y));
    }
    default:
      return null;
  }
}
