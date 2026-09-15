/**
 * File-type detection helpers — a 1:1 port of the Flutter `FileUtils`
 * (lib/src/shared/utils/file_utils.dart) so the React `AppFileViewer` classifies
 * URLs/filenames exactly the same way the Flutter app does.
 */

export type AppFileType =
  | 'image'
  | 'video'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'link'
  | 'svg'
  | 'audio'
  | 'unknown';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic'];
const VIDEO_EXT = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'ogv'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
const DOC_EXT = ['docx', 'doc'];
const PPT_EXT = ['pptx', 'ppt'];

/** MIME content type for an extension (mirrors Flutter `getContentType`). */
export function getContentType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    case 'mkv':
      return 'video/x-matroska';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/** Strip query/fragment + URL-encoding so extension sniffing is reliable. */
function pathOf(url: string): string {
  try {
    // Absolute URL → use just the pathname (drops ?query and #hash).
    const u = new URL(url);
    return decodeURIComponent(u.pathname).toLowerCase();
  } catch {
    // Relative path / data URL / bare filename — best-effort: drop query + hash.
    return decodeURIComponent(url.split('?')[0].split('#')[0]).toLowerCase();
  }
}

function endsWithAny(value: string, exts: string[]): boolean {
  return exts.some((e) => value.endsWith(`.${e}`));
}

/**
 * Classify a file by URL (and optional explicit filename). Matches the Flutter
 * precedence: pdf → svg → image → video → audio → docx → pptx → link → unknown.
 */
export function getFileType(url: string, fileName?: string): AppFileType {
  const pathOnly = pathOf(url);
  const nameOnly = (fileName ?? '').toLowerCase() || pathOnly;
  const isExt = (exts: string[]) => endsWithAny(nameOnly, exts) || endsWithAny(pathOnly, exts);

  if (nameOnly.endsWith('.pdf') || pathOnly.endsWith('.pdf')) return 'pdf';
  if (nameOnly.endsWith('.svg') || pathOnly.endsWith('.svg')) return 'svg';
  if (isExt(IMAGE_EXT)) return 'image';
  if (isExt(VIDEO_EXT)) return 'video';
  if (isExt(AUDIO_EXT)) return 'audio';
  if (isExt(DOC_EXT)) return 'docx';
  if (isExt(PPT_EXT)) return 'pptx';

  // YouTube/Vimeo links should preview as video.
  if (/(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(url)) return 'video';

  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (!pathOnly.includes('.') || pathOnly.endsWith('/')) return 'link';
  }

  return 'unknown';
}

/** Everything except `unknown` has an in-app preview. */
export function isViewable(type: AppFileType): boolean {
  return type !== 'unknown';
}

/**
 * Best-effort display name from a URL — mirrors the Flutter title cleanup
 * `title.split('/').last.split('%2F').last` and additionally drops the query.
 */
export function fileNameFromUrl(url: string): string {
  const noQuery = url.split('?')[0].split('#')[0];
  const last = noQuery.split('/').pop() ?? noQuery;
  const afterEncodedSlash = last.split('%2F').pop() ?? last;
  try {
    return decodeURIComponent(afterEncodedSlash) || afterEncodedSlash;
  } catch {
    return afterEncodedSlash;
  }
}

/** Extract a YouTube video id from the common URL shapes (port of ServiceVideoPreview). */
export function youtubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
    /youtu\.be\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Extract a Vimeo video id. */
export function vimeoVideoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m?.[1] ?? null;
}
