import { useState } from 'react';
import { Download, FileText, Play } from 'lucide-react';
import { cn, formatNumber } from '../../lib/utils';
import { downloadFile } from '../../lib/download';
import { inlineBox, knownRatio, rememberRatio, UNKNOWN_RATIO } from '../../lib/media-size';

/**
 * An attachment inside a workspace-chat bubble.
 *
 * The messenger's twin of this lives at
 * `clients/chat/src/components/thread/AttachmentBlock.tsx`. They are two
 * components on purpose: the behaviour is identical and the palettes are not
 * (this one is ink/paper, that one is the messenger's `--room`/`--voice`), and
 * the house rule for the two chat surfaces is that logic is shared and chrome is
 * not. What IS shared is everything with a decision in it — `media-size.ts` for
 * the reserved box, `download.ts` for saving.
 *
 * Two things it does that the previous inline `<img>` did not:
 *
 * IT RESERVES ITS SPACE. A `max-h-64` image with no dimensions occupies zero
 * height until it decodes and then jumps to 256px. In a bottom-anchored
 * transcript that jump is what leaves the reader parked above the message that
 * just arrived — the same defect the messenger had. Intrinsic width/height come
 * from a remembered aspect ratio; `onMediaLoad` covers the first sight of a
 * picture, where there is nothing remembered yet.
 *
 * IT IS SAVEABLE WITHOUT BEING OPENED. The file viewer has a download, but
 * reaching it for a file you already recognise is two extra gestures — and on a
 * phone "open the picture, then find the browser's own save" is a route a lot of
 * people simply do not have.
 */
export function AttachmentBlock({
  type,
  url,
  name,
  thumbnailUrl,
  size,
  mine,
  onOpen,
  onMediaLoad,
}: {
  type: string;
  url: string;
  name: string | null;
  thumbnailUrl: string | null;
  size: number | null;
  /** Own bubbles are ink-on-paper inverted, so the file card's fill flips. */
  mine: boolean;
  onOpen: () => void;
  /** The element resolved its real dimensions and the row changed height. */
  onMediaLoad?: () => void;
}) {
  if (type === 'image' || type === 'video') {
    return (
      <MediaCard
        kind={type}
        src={type === 'image' ? (thumbnailUrl ?? url) : url}
        posterUrl={type === 'video' ? thumbnailUrl : null}
        downloadUrl={url}
        name={name}
        onOpen={onOpen}
        onMediaLoad={onMediaLoad}
      />
    );
  }

  return (
    <div
      className={cn(
        'mb-1 flex w-full items-center gap-2 rounded-[var(--radius-sm)] py-1.5 pl-2 pr-1',
        mine ? 'bg-paper/10' : 'bg-card',
      )}
    >
      <FileText className="h-4 w-4 shrink-0" />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left" title={name ?? undefined}>
        <span className="block truncate text-xs font-medium underline">{name ?? 'Document'}</span>
        {size ? (
          <span className={cn('block text-[10px]', mine ? 'text-paper/70' : 'text-ink-40')}>
            {formatFileSize(size)}
          </span>
        ) : null}
      </button>
      <button
        type="button"
        onClick={() => void downloadFile(url, name)}
        aria-label={`Download ${name ?? 'attachment'}`}
        title="Download"
        className={cn(
          'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors',
          mine ? 'hover:bg-paper/20' : 'hover:bg-inset',
        )}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * A picture or a clip at the shape it actually is.
 *
 * The download control appears on hover on a precise pointer and stays put where
 * there is no hover to reveal it with — on a desktop the picture should be a
 * picture until you reach for it, and on a phone a control you cannot discover
 * is a control that does not exist.
 */
function MediaCard({
  kind,
  src,
  posterUrl,
  downloadUrl,
  name,
  onOpen,
  onMediaLoad,
}: {
  kind: 'image' | 'video';
  src: string;
  posterUrl: string | null;
  downloadUrl: string;
  name: string | null;
  onOpen: () => void;
  onMediaLoad?: () => void;
}) {
  // Seeded from the remembered ratio, so a scroll-back reserves the right box
  // with no measurement at all; state so the FIRST sight of a picture settles
  // into its real shape as soon as it decodes.
  const [ratio, setRatio] = useState(() => knownRatio(src) ?? UNKNOWN_RATIO);
  const box = inlineBox(ratio, 300);

  const settle = (width: number, height: number) => {
    if (!width || !height) return;
    rememberRatio(src, width, height);
    const next = width / height;
    if (Math.abs(next - ratio) > 0.001) setRatio(next);
    // ALWAYS notify, even when the ratio was already right: the row still grew
    // from "nothing decoded" to "a picture", and the transcript needs to re-pin.
    onMediaLoad?.();
  };

  return (
    <span className="group/media relative mb-1 block w-fit max-w-full">
      <button
        type="button"
        onClick={onOpen}
        className="block overflow-hidden rounded-[var(--radius-sm)]"
        aria-label={kind === 'video' ? `Play ${name ?? 'video'}` : `Open ${name ?? 'image'}`}
      >
        {kind === 'image' ? (
          <img
            src={src}
            alt={name ?? 'image'}
            loading="lazy"
            decoding="async"
            width={box.width}
            height={box.height}
            onLoad={(e) => settle(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            className="block h-auto max-w-full"
          />
        ) : (
          // `preload="metadata"` gets the dimensions AND paints the first frame,
          // so a clip has a real preview even though nothing writes thumbnailUrl
          // for chat uploads. It replaced an inline `<video controls>`, which put
          // a second set of playback controls inside a bubble and played the clip
          // in a 256px box.
          <video
            src={src}
            poster={posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            width={box.width}
            height={box.height}
            onLoadedMetadata={(e) => settle(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            className="block h-auto max-w-full"
          />
        )}
      </button>

      {kind === 'video' && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-black/55">
            <Play className="h-4 w-4" fill="white" color="white" />
          </span>
        </span>
      )}

      <button
        type="button"
        onClick={() => void downloadFile(downloadUrl, name)}
        aria-label={`Download ${name ?? (kind === 'video' ? 'video' : 'image')}`}
        title="Download"
        className={cn(
          'absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white',
          'opacity-0 transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100',
          '[@media(hover:none)]:opacity-100',
        )}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/** `2.4 MB` — the panel's own scale, kept here so the card is self-contained. */
function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}
