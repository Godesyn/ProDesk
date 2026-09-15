/**
 * Logo downloads produced ENTIRELY in the browser — single files and whole-suite
 * zips.
 *
 * Every surface that offers the logo already holds it as SVG markup in order to
 * render it (the studio composes lockups client-side; the share page is sent the
 * suite), so both formats can be made here: the SVG file *is* that payload, and
 * the PNG is the same markup rasterised through a canvas. Nothing new is exposed.
 *
 * Deliberately client-side rather than a server export per click:
 *   • the public share page is account-blind, with no session to authorise a
 *     server export with — and a public endpoint that uploaded to brand storage
 *     would let anyone replay the link to spend the brand's storage;
 *   • twelve files ×2 formats is 24 rasterise-and-upload round trips for a button
 *     the user expects to answer immediately.
 *
 * The paid-product side of a download is NOT client-side: `logo.assets.claim`
 * runs the subscription gate and stamps the rights transfer, and Assets awaits it
 * before any of this runs.
 */
import { viewBoxOf } from '@server/modules/logo/layout';
import { zipBlob, type ZipEntry } from './zip';

/**
 * The ink an undeclared lockup is baked in: `var(--ink)`. Suite assets always
 * declare their own colour, so this only backstops a raw mark.
 */
const INK = '#0E0E0C';

/** The long edge of a downloaded PNG — one size, big enough for print. */
const PNG_LONG_EDGE = 2048;

/** A file in a suite download: the artwork plus the stem it is named with. */
export interface SuiteFile {
  /** Filename stem WITHOUT an extension, e.g. `acme-primary-ink`. */
  name: string;
  svg: string;
}

export type DownloadFormat = 'svg' | 'png';

/**
 * Resolve `currentColor` to a concrete hex, mirroring `raster.ts` `bakeColor`:
 * neither a file on disk nor a canvas has a CSS `color` context to inherit from.
 *
 * A lockup that declares its own ink on the root (every suite asset does) wins
 * over the caller's default — otherwise a reversed lockup would bake to near-black
 * and vanish into its own dark plate.
 */
export function bakeInk(svg: string, ink: string = INK): string {
  const declared = svg.match(/<svg\b[^>]*\bstyle\s*=\s*"[^"]*\bcolor:\s*([^;"]+)/i)?.[1]?.trim();
  const effective = declared || ink;
  return svg
    .replace(/currentColor/g, effective)
    .replace(/style\s*=\s*"color:[^"]*"/gi, `style="color:${effective}"`);
}

/** Hand a blob to the browser as a download, then release it. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a macrotask so the navigation the click started has taken the URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Give the root an explicit pixel size. A composed lockup carries only a
 * `viewBox` (by contract — see svg.ts), and an `<img>` pointing at a size-less
 * SVG has no intrinsic dimensions to draw from, so the canvas would come out
 * empty or at the browser's 300×150 default.
 */
function withPixelSize(svg: string, w: number, h: number): string {
  return svg.replace(/<svg\b[^>]*>/i, (tag) =>
    tag
      .replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, '')
      .replace(/<svg\b/i, `<svg width="${w}" height="${h}"`),
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The mark could not be rendered.'));
    img.src = src;
  });
}

/** The SVG as a file, ink resolved. */
export function svgBlob(svg: string): Blob {
  return new Blob([bakeInk(svg)], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * Rasterise to a transparent PNG, scaled so the LONG edge is `PNG_LONG_EDGE` —
 * the aspect ratio is the lockup's own (a mark is square, a primary lockup is
 * wide), so fitting the long edge keeps every form at a comparable resolution
 * without distorting any of them.
 *
 * Lockups reference nothing external (the sanitiser strips `<image>`/`<use>`/
 * hrefs), so the canvas stays untainted and `toBlob` is allowed.
 */
export async function pngBlob(svg: string): Promise<Blob> {
  const [, , vw, vh] = viewBoxOf(svg);
  const scale = PNG_LONG_EDGE / Math.max(vw, vh, 1);
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));

  const url = URL.createObjectURL(
    new Blob([withPixelSize(bakeInk(svg), w, h)], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser cannot render the PNG.');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('This browser cannot render the PNG.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Download one lockup as an editable vector. */
export function downloadSvg(svg: string, filename: string): void {
  saveBlob(svgBlob(svg), filename);
}

/** Download one lockup as a transparent PNG. */
export async function downloadPng(svg: string, filename: string): Promise<void> {
  saveBlob(await pngBlob(svg), filename);
}

/**
 * Zip a set of suite files and download it.
 *
 * Files are foldered by format (`svg/`, `png/`) so a both-formats archive opens
 * as two clean folders rather than 24 loose files sorted by name — which would
 * interleave every form with its own PNG.
 *
 * Rasterising runs one file at a time on purpose: twelve 2048px canvases in
 * flight at once is a real memory spike on a phone, and the wall-clock difference
 * is small against the encode. `onProgress` is what the button reports.
 */
export async function downloadSuiteZip(args: {
  files: SuiteFile[];
  formats: DownloadFormat[];
  /** Archive name without the extension, e.g. `acme-logo-suite`. */
  archive: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { files, formats, archive, onProgress } = args;
  const total = files.length * formats.length;
  const entries: ZipEntry[] = [];
  let done = 0;

  for (const format of formats) {
    for (const file of files) {
      const blob = format === 'svg' ? svgBlob(file.svg) : await pngBlob(file.svg);
      entries.push({
        // A single-format archive doesn't need the folder — its name already says
        // which format it is.
        path: formats.length > 1 ? `${format}/${file.name}.${format}` : `${file.name}.${format}`,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      onProgress?.(++done, total);
    }
  }

  saveBlob(await zipBlob(entries), `${archive}.zip`);
}
