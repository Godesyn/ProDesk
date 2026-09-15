import { useEffect, useState, type CSSProperties } from 'react';
import { Wrench } from 'lucide-react';
import { thumbnailFor, youtubeEmbedUrl, isYoutubeUrl, inferVideoAspectRatio } from './media';
import { LazyImage } from '../../components/ui/lazy-image';

/**
 * Media panel for the service / package detail dialogs — ports the Flutter
 * `_buildMediaContent` (horizontal layout) + `ServiceVideoPreview`.
 *
 * The media is ALWAYS contained (`object-contain`) — never cover/crop — and the
 * surrounding panel is sized to the artwork's aspect ratio (see
 * {@link useDetailMediaPanel}). So the media fills the panel exactly while the
 * panel is within its size band, and only letterboxes (bezels top/bottom) once
 * a very wide cover hits the panel's max-width cap. The `bg-black` shows through
 * as those bezels.
 *  • uploaded video → inline <video> with the generated thumbnail as poster,
 *  • YouTube link   → embedded iframe,
 *  • image only     → contained <img>,
 *  • nothing        → the design-services placeholder.
 */
export function DetailMedia({
  imageUrl,
  videoUrl,
  onAspect,
}: {
  imageUrl?: string | null;
  videoUrl?: string | null;
  /** Reports the media's true aspect ratio (w/h) once known, so the panel resizes. */
  onAspect?: (ratio: number) => void;
}) {
  const hasVideo = !!videoUrl?.trim();
  const hasImage = !!imageUrl?.trim();

  if (hasVideo) {
    const embed = youtubeEmbedUrl(videoUrl!);
    if (isYoutubeUrl(videoUrl) && embed) {
      return (
        <iframe
          src={embed}
          title="Promotional video"
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      );
    }
    return (
      <video
        src={videoUrl!}
        poster={thumbnailFor(videoUrl) ?? imageUrl ?? undefined}
        controls
        playsInline
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (v.videoWidth > 0 && v.videoHeight > 0) onAspect?.(v.videoWidth / v.videoHeight);
        }}
        className="absolute inset-0 h-full w-full bg-paper object-contain"
      />
    );
  }

  if (hasImage) {
    return (
      <LazyImage
        src={imageUrl!}
        alt=""
        onMeasure={onAspect}
        wrapperClassName="absolute inset-0 h-full w-full bg-paper"
        className="object-contain"
      />
    );
  }

  return (
    <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-ink-80 to-ink-100">
      <div className="grid h-20 w-20 place-items-center rounded-full bg-white/5">
        <Wrench className="h-10 w-10 text-white/25" />
      </div>
    </div>
  );
}

/** The detail dialogs stack vertically below the `md` (768px) breakpoint. */
function useIsStacked(breakpoint = 768): boolean {
  const [stacked, setStacked] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = () => setStacked(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return stacked;
}

/**
 * Sizes the (fixed-size) detail dialog's media panel to the artwork's aspect
 * ratio so the contained media fills it with no side bezels — a port of the
 * Flutter horizontal/vertical layout intent, done in pure CSS (no layout
 * measurement, so it can't get out of sync):
 *
 *  • Desktop (side-by-side): the panel fills the row height and derives its
 *    WIDTH from `aspect-ratio`, capped at 2/3 of the row (`max-width`). A
 *    portrait/vertical cover narrows to its exact shape (no side bezels); only
 *    a wide cover hits the 2/3 cap and then letterboxes top/bottom.
 *  • Mobile (stacked): the panel is full-width and derives its HEIGHT from
 *    `aspect-ratio`, so the media always fills the width (no side bezels); a
 *    tall portrait just makes a taller media area with content below.
 *
 * Spread `panelStyle` on the media panel and pass `onAspect` to
 * {@link DetailMedia} (so a video reports its true ratio once metadata loads).
 * Before any ratio is known the panel falls back to its CSS classes.
 */
export function useDetailMediaPanel(opts: { imageAspectRatio?: number | null; videoUrl?: string | null }) {
  const initial = opts.imageAspectRatio ?? inferVideoAspectRatio(opts.videoUrl) ?? null;
  const [aspect, setAspect] = useState<number | null>(initial);
  const stacked = useIsStacked();

  let panelStyle: CSSProperties = {};
  if (aspect != null) {
    panelStyle = stacked
      ? { width: '100%', height: 'auto', aspectRatio: String(aspect) }
      : { height: '100%', width: 'auto', maxWidth: '66.6667%', aspectRatio: String(aspect) };
  }

  return { panelStyle, onAspect: setAspect };
}
