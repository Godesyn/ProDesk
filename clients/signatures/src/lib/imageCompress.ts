/**
 * Client-side image compression for signature uploads.
 *
 * Signature images are stored and then referenced by URL in the generated email
 * HTML, so their weight directly affects how fast a signature loads — and Gmail
 * clips any message whose total HTML weight tops ~102KB. We shrink images in the
 * browser (via <canvas>, no dependency) before upload so both the request body
 * and the final email stay small.
 *
 * Format-aware on purpose:
 * - Photos (headshots) → JPEG. They're opaque and render tiny in a signature,
 *   so downscaling + lossy JPEG is a huge size win with no visible loss.
 * - Logos → PNG, resize-only. They're usually transparent; JPEG would fill the
 *   transparency and add artifacts on flat colour, so we never re-encode them.
 */

export type CompressResult = {
  /** Base64 WITHOUT the `data:` prefix — ready for the upload mutation. */
  base64: string;
  contentType: string;
  filename: string;
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

/** Scale so the longest side is at most `maxDim`; never upscale. */
function fitDimensions(w: number, h: number, maxDim: number) {
  const scale = Math.min(1, maxDim / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

function replaceExt(filename: string, ext: string) {
  return filename.replace(/\.[^./\\]+$/, '') + ext;
}

/**
 * Downscale a headshot and re-encode as JPEG. Falls back to the untouched file
 * if anything goes wrong (SVGs, decode failures) so an upload never breaks.
 */
export async function compressPhoto(
  file: File,
  { maxDim = 480, quality = 0.82 }: { maxDim?: number; quality?: number } = {},
): Promise<CompressResult> {
  try {
    const img = await loadImage(file);
    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // JPEG has no alpha — paint white first so any transparent source pixels
    // don't turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return {
      base64: dataUrl.split(',')[1],
      contentType: 'image/jpeg',
      filename: replaceExt(file.name, '.jpg'),
    };
  } catch {
    return fileToResult(file);
  }
}

/**
 * Resize a logo if it's larger than `maxDim`, keeping PNG (lossless, keeps
 * transparency). If it's already within bounds, the original bytes are used.
 */
export async function compressLogo(
  file: File,
  { maxDim = 800 }: { maxDim?: number } = {},
): Promise<CompressResult> {
  try {
    const img = await loadImage(file);
    if (Math.max(img.naturalWidth, img.naturalHeight) <= maxDim) {
      return fileToResult(file);
    }
    const { width, height } = fitDimensions(img.naturalWidth, img.naturalHeight, maxDim);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    return {
      base64: dataUrl.split(',')[1],
      contentType: 'image/png',
      filename: replaceExt(file.name, '.png'),
    };
  } catch {
    return fileToResult(file);
  }
}

/** Pass a file through untouched (base64-encoded) — the safe fallback. */
function fileToResult(file: File): Promise<CompressResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      resolve({
        base64: dataUrl.split(',')[1],
        contentType: file.type,
        filename: file.name,
      });
    };
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}
