/**
 * Client-side image downscale/compression before upload — replaces the Flutter
 * image-compression step (which showed a progress bar). Large images are scaled
 * to fit `maxDim` and re-encoded; non-images and small files pass through
 * untouched. Best-effort: any failure falls back to the original file.
 */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export async function compressImage(file: File, opts: { maxDim?: number; quality?: number } = {}): Promise<File> {
  const maxDim = opts.maxDim ?? 1600;
  const quality = opts.quality ?? 0.82;
  if (!IMAGE_TYPES.includes(file.type)) return file;
  // Skip tiny files — not worth the work.
  if (file.size < 200 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob || blob.size >= file.size) return file; // no win — keep the original
    const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
    return new File([blob], name, { type: 'image/webp' });
  } catch {
    return file;
  }
}
