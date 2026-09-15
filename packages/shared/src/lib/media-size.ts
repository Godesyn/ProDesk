/**
 * Remembered aspect ratios for attachments, keyed by URL.
 *
 * An `<img>` with no width and height occupies zero rows until it decodes and
 * then jumps to its full height — which in a bottom-anchored transcript means
 * the conversation shoves itself around every time you scroll a picture back
 * into view. The browser's own fix is intrinsic dimensions on the element, and
 * we do not have them: chat_messages stores a URL, a name and a size, and
 * nothing about the picture's shape.
 *
 * So the first render of any given attachment learns its ratio, and every render
 * after that reserves the right box before a byte is fetched. In practice the
 * only unreserved paint in a session is the very first sight of each image, and
 * even that one is caught by the transcript's re-pin (see stick-to-bottom.ts).
 *
 * Module-level and unbounded on purpose: an entry is two numbers and a string,
 * a busy thread holds a few hundred, and the map dies with the tab. Persisting
 * it would be a cache-invalidation problem in exchange for nothing.
 */
const ratios = new Map<string, number>();

/** The last known width ÷ height for a URL, or null if it has never loaded. */
export function knownRatio(url: string | null | undefined): number | null {
  if (!url) return null;
  return ratios.get(url) ?? null;
}

/** Record what an element reported once it had real dimensions. */
export function rememberRatio(
  url: string | null | undefined,
  width: number,
  height: number,
): void {
  if (!url || !width || !height) return;
  ratios.set(url, width / height);
}

/**
 * Record a ratio measured somewhere other than the transcript — specifically,
 * from the LOCAL file at upload time (see lib/upload.ts).
 *
 * This is what makes sending a photo shift nothing at all. The sender's browser
 * already has the file decoded while it is uploading, so by the time the sent
 * message renders, its URL's shape is a known quantity and the bubble is drawn
 * at its final height on the first paint. The recipient still learns the shape
 * the ordinary way, on first sight.
 */
export function rememberAspect(url: string | null | undefined, ratio: number): void {
  if (!url || !Number.isFinite(ratio) || ratio <= 0) return;
  ratios.set(url, ratio);
}

/**
 * The shape to reserve for an attachment that has never been seen.
 *
 * 4:3 landscape, because it is the least-wrong guess: it is the shape of most
 * photos and most screenshots, and being wrong by a little in the common case
 * beats being right about portraits and badly wrong about everything else.
 */
export const UNKNOWN_RATIO = 4 / 3;

/** Longest edge an inline attachment is allowed, in px. */
export const MAX_INLINE_EDGE = 340;

/**
 * The box an inline attachment should occupy: the largest rectangle of the given
 * ratio that fits inside `maxEdge` square. Returned as intrinsic width/height
 * for the element, which CSS then shrinks proportionally on a narrow screen
 * (`max-width:100%; height:auto`).
 *
 * Bounding BOTH edges, rather than capping the height and letting `object-fit:
 * cover` crop, is what stops a portrait screenshot from being delivered as a
 * centre-cropped strip that omits the part someone is pointing at.
 *
 * `maxEdge` is a parameter because the two chat surfaces have different room for
 * it: the messenger's transcript is a full pane, the workspace panel is a dock
 * that can be 320px wide.
 */
export function inlineBox(ratio: number, maxEdge = MAX_INLINE_EDGE): { width: number; height: number } {
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : UNKNOWN_RATIO;
  return safe >= 1
    ? { width: maxEdge, height: Math.round(maxEdge / safe) }
    : { width: Math.round(maxEdge * safe), height: maxEdge };
}
