/**
 * Rasterisation + document export for Logo Studio. Reuses the `sharp` SVG→PNG
 * pattern from modules/signatures/iconColorizer.ts, extended to the export matrix
 * the market expects (transparent PNG @sizes, favicon, social avatars, print PDF).
 *
 * The editable SVG is always the source of truth; rasters are derived on demand.
 * Because `currentColor` drives the mark's ink, we bake a concrete colour into the
 * SVG before rasterising (sharp/librsvg does not inherit a CSS `color`).
 */
import sharp from 'sharp';
import PDFDocument from 'pdfkit';

/**
 * Replace `currentColor` with a concrete hex so a rasteriser (which has no CSS
 * `color` context) renders the intended ink. Also injects an explicit background
 * when one is requested (transparent otherwise).
 */
export function bakeColor(svg: string, ink: string, ground?: string | null): string {
  // A lockup built by svg.ts declares its own ink as `style="color:…"` on the
  // root (white for `reversed`, graphite for `mono`). That declaration is more
  // authoritative than a caller's generic default, so honour it — otherwise a
  // reversed lockup would rasterise in the primary colour and vanish into its
  // own dark ground.
  const declared = svg.match(/<svg\b[^>]*\bstyle\s*=\s*"[^"]*\bcolor:\s*([^;"]+)/i)?.[1]?.trim();
  const effective = declared || ink;
  let out = svg
    .replace(/currentColor/g, effective)
    .replace(/style\s*=\s*"color:[^"]*"/gi, `style="color:${effective}"`);
  if (ground) {
    // Insert a full-bleed background rect right after the opening <svg …>.
    out = out.replace(/(<svg\b[^>]*>)/i, `$1<rect x="-9999" y="-9999" width="19998" height="19998" fill="${ground}"/>`);
  }
  return out;
}

/** Render an SVG string to a transparent (or grounded) PNG at a square size. */
export async function svgToPng(
  svg: string,
  size: number,
  opts: { ink?: string; ground?: string | null } = {},
): Promise<Buffer> {
  const baked = bakeColor(svg, opts.ink ?? '#0E0E0C', opts.ground ?? null);
  return sharp(Buffer.from(baked), { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Render a wide lockup SVG to PNG at a target width (keeps aspect). */
export async function svgToPngWide(
  svg: string,
  width: number,
  opts: { ink?: string; ground?: string | null } = {},
): Promise<Buffer> {
  const baked = bakeColor(svg, opts.ink ?? '#0E0E0C', opts.ground ?? null);
  return sharp(Buffer.from(baked), { density: 384 })
    .resize({ width, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/** Multi-resolution favicon set (PNGs); browsers accept PNG favicons + we also ship the SVG. */
export async function faviconPngs(svg: string, ink: string): Promise<Record<number, Buffer>> {
  const sizes = [16, 32, 48, 180, 512];
  const out: Record<number, Buffer> = {};
  for (const s of sizes) out[s] = await svgToPng(svg, s, { ink });
  return out;
}

/** Standard social avatar/cover matrix (square avatar + wide cover), as PNGs. */
export async function socialKit(
  markSvg: string,
  lockupSvg: string,
  ink: string,
  ground: string,
): Promise<{ name: string; buffer: Buffer }[]> {
  return [
    { name: 'avatar-512.png', buffer: await svgToPng(markSvg, 512, { ink, ground }) },
    { name: 'avatar-400.png', buffer: await svgToPng(markSvg, 400, { ink, ground }) },
    { name: 'cover-1500x500.png', buffer: await coverPng(lockupSvg, 1500, 500, ink, ground) },
    { name: 'og-1200x630.png', buffer: await coverPng(lockupSvg, 1200, 630, ink, ground) },
  ];
}

async function coverPng(lockupSvg: string, w: number, h: number, ink: string, ground: string): Promise<Buffer> {
  const lockup = await svgToPngWide(lockupSvg, Math.round(w * 0.6), { ink });
  return sharp({ create: { width: w, height: h, channels: 4, background: ground } })
    .composite([{ input: lockup, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** A print-ready single-page PDF placing the vector lockup centred on the page. */
export async function lockupPdf(pngBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 72 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const pageW = doc.page.width - 144;
    doc.image(pngBuffer, 72, doc.page.height / 2 - 100, { fit: [pageW, 200], align: 'center' });
    doc.end();
  });
}
