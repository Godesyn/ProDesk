/**
 * Marketplace media helpers — port of Flutter `video_thumbnail_widget.dart` +
 * `UploadUtils.getThumbnailFor` + `inferAspectRatioFromVideoUrl`.
 *
 * The backend (server `modules/media/transcode.ts`) already generates a
 * `<path>_thumbnail.jpg` next to every uploaded video, and YouTube exposes a
 * canonical thumbnail URL. Neither is stored on the row — like Flutter, we
 * DERIVE the poster URL at display time from `videoUrl`. That's what turns the
 * perpetual card shimmer into an actual thumbnail.
 */

const YT_PATTERNS = [
  /youtube\.com\/watch\?v=([a-zA-Z0-9_-]+)/,
  /youtube\.com\/embed\/([a-zA-Z0-9_-]+)/,
  /youtube\.com\/shorts\/([a-zA-Z0-9_-]+)/,
  /youtu\.be\/([a-zA-Z0-9_-]+)/,
  /youtube\.com\/v\/([a-zA-Z0-9_-]+)/,
];

/** Extract a YouTube video id, or null for non-YouTube/unknown URLs. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  for (const re of YT_PATTERNS) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export const isYoutubeUrl = (url: string | null | undefined): boolean => youtubeId(url) != null;

/** A YouTube Shorts URL — these are vertical (9:16), unlike standard 16:9 videos. */
export const isYoutubeShort = (url: string | null | undefined): boolean =>
  !!url && /youtube\.com\/shorts\//.test(url);

/** A YouTube embed URL (for inline playback in the detail dialog). */
export function youtubeEmbedUrl(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

/**
 * The poster/thumbnail URL for a video — YouTube's `mqdefault.jpg`, or the
 * backend-generated `<base>_thumbnail.jpg` for an uploaded object (Supabase
 * public URLs carry no query string, unlike Firebase's `?alt=media`).
 */
export function thumbnailFor(videoUrl: string | null | undefined): string | null {
  const url = videoUrl?.trim();
  if (!url) return null;
  const id = youtubeId(url);
  if (id) return `https://img.youtube.com/vi/${id}/mqdefault.jpg`;
  // Strip the last extension and append the generated-thumbnail suffix.
  if (!/\.[^./?#]+$/.test(url)) return null;
  return url.replace(/\.[^./?#]+$/, '') + '_thumbnail.jpg';
}

/** The image to show for a card/dialog: an explicit cover, else the video poster. */
export function posterFor(
  imageUrl: string | null | undefined,
  videoUrl: string | null | undefined,
): string | null {
  return imageUrl?.trim() ? imageUrl : thumbnailFor(videoUrl);
}

/** Aspect ratio to assume for a video with no measured cover (Flutter inferAspectRatioFromVideoUrl). */
export function inferVideoAspectRatio(videoUrl: string | null | undefined): number | null {
  if (!videoUrl?.trim()) return null;
  if (isYoutubeShort(videoUrl)) return 9 / 16; // vertical
  return isYoutubeUrl(videoUrl) ? 16 / 9 : 4 / 3;
}

/**
 * Measure an image's aspect ratio (width / height) from a URL — used at upload
 * time to persist `imageAspectRatio`, mirroring Flutter's decode-on-upload.
 */
export function measureImageAspectRatio(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
