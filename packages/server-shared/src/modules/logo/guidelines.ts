/**
 * Living brand guidelines — the "$50k agency deliverable" a solopreneur gets out
 * of the studio (DESIGN.md 05). The rules and size ladder live HERE so the
 * on-screen rulebook, the exported PDF, and the public share page can never drift
 * apart; the router and export both read this module.
 *
 * The document is composed with pdfkit. Marks are placed as high-density rasters
 * derived from the outlined lockups (so type is faithful — see outline.ts), while
 * swatches and rules are drawn as native PDF vectors.
 */
import PDFDocument from 'pdfkit';
import { buildLockupSvg, orderedPalette } from './svg.js';
import { svgToPng, svgToPngWide } from './raster.js';
import { snapTypeface, getTypeface } from './typefaces.js';
import type { LockupSlot, LogoGeneration, LogoSpec } from './types.js';

export interface GuidelineRule {
  do: boolean;
  text: string;
}

export interface MinSize {
  px: number;
  label: string;
}

/** The size ladder shown as a specimen row (DESIGN.md: Favicon -> Full). */
export const MIN_SIZES: MinSize[] = [
  { px: 16, label: 'Favicon' },
  { px: 24, label: 'Minimum on screen' },
  { px: 48, label: 'App icon' },
  { px: 96, label: 'Full lockup' },
];

export const GUIDELINE_RULES: GuidelineRule[] = [
  { do: true, text: 'Keep clearspace of at least one cap-height on every side.' },
  { do: true, text: 'Use the mark-only lockup below 96px or in tight avatars.' },
  { do: true, text: 'Place the reversed mark on imagery and dark surfaces.' },
  { do: true, text: 'Scale the mark proportionally, from the vector files.' },
  { do: false, text: 'Never recolour the mark outside the brand palette.' },
  { do: false, text: 'Never stretch, rotate, or add effects to the mark.' },
  { do: false, text: 'Never place the mark on low-contrast backgrounds.' },
  { do: false, text: 'Never rebuild the wordmark in a different typeface.' },
];

export interface GuidelinesData {
  clearspace: string;
  minSizes: MinSize[];
  rules: GuidelineRule[];
}

/** The guidelines payload for a mark, honouring its clearspace adjustment. */
export function buildGuidelines(spec: LogoSpec | null): GuidelinesData {
  const clearspace = spec?.adjust?.clearspace ?? 1;
  return {
    clearspace: `${clearspace.toFixed(1)}x`,
    minSizes: MIN_SIZES,
    rules: GUIDELINE_RULES,
  };
}

/* ── PDF ────────────────────────────────────────────────────────────────── */

const PAGE = { w: 595.28, h: 841.89 };
const M = 56; // page margin
const INK = '#0E0E0C';
const MUTED = '#6B6960';
const RULE = '#D8D5CB';

const SUITE_SLOTS: LockupSlot[] = ['primary', 'stacked', 'mark', 'wordmark', 'mono', 'reversed'];

/**
 * Render the full guidelines document for a mark. Returns the PDF bytes.
 */
export async function guidelinesPdf(args: {
  gen: Pick<LogoGeneration, 'svg' | 'name'>;
  spec: LogoSpec;
  wordmark: string;
  brandName: string;
}): Promise<Buffer> {
  const { gen, spec, wordmark, brandName } = args;
  const pal = orderedPalette(spec.palette ?? []);
  const clearspace = spec.adjust?.clearspace ?? 1;

  // Pre-render every raster we need before touching the document — pdfkit's
  // stream is synchronous once started.
  const lockupSvg = (slot: LockupSlot) =>
    buildLockupSvg({ mark: gen.svg, wordmark, spec, slot, committed: slot === 'primary' });

  const primaryPng = await svgToPngWide(lockupSvg('primary'), 1600);
  const markPng = await svgToPng(gen.svg, 800, { ink: pal.ink });
  const suitePngs: { slot: LockupSlot; png: Buffer; wide: boolean }[] = [];
  for (const slot of SUITE_SLOTS) {
    const wide = slot !== 'mark';
    const svg = lockupSvg(slot);
    suitePngs.push({
      slot,
      png: wide ? await svgToPngWide(svg, 1200) : await svgToPng(svg, 600, { ink: pal.ink }),
      wide,
    });
  }
  const ladderPngs: { px: number; label: string; png: Buffer }[] = [];
  for (const s of MIN_SIZES) {
    ladderPngs.push({ ...s, png: await svgToPng(gen.svg, Math.max(s.px * 4, 96), { ink: pal.ink }) });
  }

  const doc = new PDFDocument({ size: 'A4', margin: M, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const label = (text: string, y: number) => {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(text.toUpperCase(), M, y, {
      characterSpacing: 1.2,
    });
  };
  const heading = (text: string, y: number) => {
    doc.font('Helvetica-Bold').fontSize(22).fillColor(INK).text(text, M, y);
  };
  const hairline = (y: number) => {
    doc.moveTo(M, y).lineTo(PAGE.w - M, y).lineWidth(0.5).strokeColor(RULE).stroke();
  };

  /* Page 1 — cover */
  doc.addPage();
  label('Brand guidelines', M);
  doc.font('Helvetica-Bold').fontSize(34).fillColor(INK).text(brandName, M, M + 22, {
    width: PAGE.w - M * 2,
  });
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor(MUTED)
    .text('How to use the mark — clearspace, sizing, colour, and the rules that keep it consistent.', M, doc.y + 6, { width: PAGE.w - M * 2 - 80 });
  const coverTop = 300;
  fitImage(doc, primaryPng, M, coverTop, PAGE.w - M * 2, 150);
  hairline(PAGE.h - M - 30);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    `${gen.name}  ·  generated in Prodesk Logo Studio`,
    M,
    PAGE.h - M - 20,
  );

  /* Page 2 — the logo suite */
  doc.addPage();
  label('01', M);
  heading('The logo suite', M + 14);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(
    'Six lockups cover every context. Always use the supplied vector files.',
    M,
    doc.y + 4,
    { width: PAGE.w - M * 2 },
  );
  let gy = 150;
  const cellW = (PAGE.w - M * 2 - 16) / 2;
  const cellH = 120;
  suitePngs.forEach((entry, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * (cellW + 16);
    const y = gy + row * (cellH + 24);
    const dark = entry.slot === 'reversed';
    doc.rect(x, y, cellW, cellH).lineWidth(0.5).strokeColor(RULE);
    if (dark) doc.fillColor(INK).fillAndStroke();
    else doc.stroke();
    fitImage(doc, entry.png, x + 16, y + 20, cellW - 32, cellH - 40);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
      entry.slot.toUpperCase(),
      x,
      y + cellH + 6,
      { width: cellW, align: 'center', characterSpacing: 1 },
    );
  });

  /* Page 3 — clearspace + minimum sizes */
  doc.addPage();
  label('02', M);
  heading('Clearspace & sizing', M + 14);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text(
    `Keep ${clearspace.toFixed(1)}x cap-height of clear space on every side. Nothing enters this zone.`,
    M,
    doc.y + 4,
    { width: PAGE.w - M * 2 },
  );

  const csTop = 150;
  const csBox = 190;
  const inset = Math.round((csBox * 0.16) * clearspace);
  doc.rect(M, csTop, csBox, csBox).lineWidth(0.5).strokeColor(RULE).stroke();
  doc
    .rect(M + inset, csTop + inset, csBox - inset * 2, csBox - inset * 2)
    .lineWidth(0.75)
    .dash(3, { space: 3 })
    .strokeColor('#B4B1A6')
    .stroke()
    .undash();
  fitImage(doc, markPng, M + inset + 10, csTop + inset + 10, csBox - inset * 2 - 20, csBox - inset * 2 - 20);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    `CLEARSPACE ${clearspace.toFixed(1)}X`,
    M,
    csTop + csBox + 8,
    { width: csBox, align: 'center', characterSpacing: 1 },
  );

  label('Minimum sizes', csTop + csBox + 50);
  let lx = M;
  const ladderY = csTop + csBox + 80;
  ladderPngs.forEach((l) => {
    const drawn = Math.max(l.px, 16);
    fitImage(doc, l.png, lx, ladderY + (96 - drawn), drawn, drawn);
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
      `${l.px}px`,
      lx,
      ladderY + 104,
      { width: Math.max(drawn, 44) },
    );
    doc.fontSize(7).fillColor(MUTED).text(l.label, lx, ladderY + 114, { width: Math.max(drawn, 78) });
    lx += Math.max(drawn, 84) + 26;
  });

  /* Page 4 — colour + type */
  doc.addPage();
  label('03', M);
  heading('Colour & type', M + 14);
  let py = 140;
  const swatches = (spec.palette ?? []).slice(0, 6);
  swatches.forEach((c) => {
    doc.rect(M, py, 54, 54).fillColor(c.hex).fill();
    doc.rect(M, py, 54, 54).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(c.name || c.role, M + 70, py + 10);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`${c.role}  ·  ${c.hex.toUpperCase()}`, M + 70, py + 26);
    py += 66;
  });
  if (!swatches.length) {
    doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Monochrome — no colour committed yet.', M, py);
    py += 30;
  }

  py += 14;
  label('Typography', py);
  py += 20;
  const roles: [string, string | undefined][] = [
    ['Heading', spec.fonts?.heading],
    ['Body', spec.fonts?.body],
    ['Detail', spec.fonts?.mono],
  ];
  roles.forEach(([role, family]) => {
    if (!family) return;
    const tf = getTypeface(snapTypeface(family));
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(tf.label, M, py);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(role, M + 200, py + 1);
    py += 22;
  });

  /* Page 5 — do / don't */
  doc.addPage();
  label('04', M);
  heading('Do & don’t', M + 14);
  py = 140;
  const colW = (PAGE.w - M * 2 - 24) / 2;
  const dos = GUIDELINE_RULES.filter((r) => r.do);
  const donts = GUIDELINE_RULES.filter((r) => !r.do);
  const column = (title: string, rules: GuidelineRule[], x: number, colour: string) => {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(colour).text(title, x, py);
    let y = py + 22;
    rules.forEach((r) => {
      doc.circle(x + 3, y + 5, 2).fillColor(colour).fill();
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(r.text, x + 14, y, { width: colW - 14 });
      y = doc.y + 8;
    });
  };
  column('Do', dos, M, '#2E9E58');
  column('Don’t', donts, M + colW + 24, '#B4241F');

  doc.end();
  return done;
}

/**
 * Place a PNG inside a box, preserving aspect and centring it. pdfkit's `fit`
 * does the scaling; we centre by measuring afterwards is not possible, so rely on
 * `fit` + `align`/`valign`.
 */
function fitImage(
  doc: PDFKit.PDFDocument,
  png: Buffer,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  doc.image(png, x, y, { fit: [w, h], align: 'center', valign: 'center' });
}
