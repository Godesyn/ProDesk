import { useState } from 'react';
import { Download, FileText, Play } from 'lucide-react';
import { Spec } from '../primitives';
import { fileSize } from '../../lib/format';
import { downloadFile } from '@shared/lib/download';
import { inlineBox, knownRatio, rememberRatio, UNKNOWN_RATIO } from '@shared/lib/media-size';

/**
 * An attachment.
 *
 * It renders INSIDE the message bubble, as its own inset card — an image, a
 * video or a file is an object rather than something someone said, and giving it
 * an edge of its own is what keeps a photo from reading as part of the sentence
 * underneath it. The workspace MessagePanel does the same.
 *
 * Two things it now does that it did not:
 *
 * IT RESERVES ITS SPACE. Every inline picture is sized from a remembered aspect
 * ratio (lib/media-size.ts) and carries intrinsic width/height, so the row is
 * the right height before the bytes arrive. An unsized image is the single
 * biggest source of layout shift in a transcript, and in a bottom-anchored one
 * that shift is what leaves the reader parked above the message that just
 * landed. `onMediaLoad` covers the first-ever sight of a picture, where there is
 * nothing remembered to reserve from.
 *
 * IT IS DOWNLOADABLE without being opened first. The lightbox has a download
 * too, but reaching it for a file you already recognise is two extra gestures,
 * and on a phone "open the picture, then find the browser's own save" is a route
 * a lot of people simply do not have.
 */
export function AttachmentBlock({
  type,
  url,
  name,
  thumbnailUrl,
  size,
  onOpen,
  onMediaLoad,
}: {
  type: string;
  url: string;
  name: string | null;
  thumbnailUrl: string | null;
  size: number | null;
  onOpen: () => void;
  /** The element resolved its real dimensions and the row just changed height. */
  onMediaLoad?: () => void;
}) {
  if (type === 'image') {
    return (
      <MediaCard
        kind="image"
        src={thumbnailUrl ?? url}
        downloadUrl={url}
        name={name}
        size={size}
        onOpen={onOpen}
        onMediaLoad={onMediaLoad}
      />
    );
  }

  if (type === 'video') {
    return (
      <MediaCard
        kind="video"
        src={url}
        posterUrl={thumbnailUrl}
        downloadUrl={url}
        name={name}
        size={size}
        onOpen={onOpen}
        onMediaLoad={onMediaLoad}
      />
    );
  }

  // Everything else. A file card is a row you read, so it says the two things
  // that identify a document — its name and how big it is — and offers the two
  // things you can do with it. The card itself opens it; the button saves it.
  return (
    <div className="cx-card mb-1 flex max-w-[340px] items-center gap-3 py-2 pl-3 pr-2">
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)]"
        style={{ background: 'var(--room-3)' }}
      >
        <FileText className="h-4 w-4" style={{ color: 'var(--voice-2)' }} />
      </span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="press min-w-0 flex-1"
        title={name ?? undefined}
      >
        <span className="block truncate text-[13px] font-medium" style={{ color: 'var(--voice)' }}>
          {name ?? 'Attachment'}
        </span>
        <Spec>{[extensionLabel(name), fileSize(size)].filter(Boolean).join(' · ')}</Spec>
      </a>
      <button
        type="button"
        onClick={() => void downloadFile(url, name)}
        aria-label={`Download ${name ?? 'attachment'}`}
        title="Download"
        className="press grid h-8 w-8 shrink-0 place-items-center rounded-full"
        style={{ color: 'var(--voice-2)' }}
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * A picture or a clip, at the shape it actually is.
 *
 * The download control sits over the top corner and appears on hover on a
 * precise pointer; on touch there is no hover, so it stays visible. That
 * asymmetry is deliberate — on a desktop the picture should be a picture until
 * you reach for it, and on a phone a control you cannot discover is a control
 * that does not exist.
 */
function MediaCard({
  kind,
  src,
  posterUrl,
  downloadUrl,
  name,
  size,
  onOpen,
  onMediaLoad,
}: {
  kind: 'image' | 'video';
  src: string;
  posterUrl?: string | null;
  downloadUrl: string;
  name: string | null;
  size: number | null;
  onOpen: () => void;
  onMediaLoad?: () => void;
}) {
  // Seeded from the remembered ratio so a scroll-back reserves the right box
  // with no measurement at all; state so the FIRST sight of a picture settles
  // into its real shape as soon as it decodes.
  const [ratio, setRatio] = useState(() => knownRatio(src) ?? UNKNOWN_RATIO);
  const box = inlineBox(ratio);

  const settle = (width: number, height: number) => {
    if (!width || !height) return;
    rememberRatio(src, width, height);
    const next = width / height;
    // Only re-render when it is actually a different shape — a video fires
    // loadedmetadata more than once in some browsers.
    if (Math.abs(next - ratio) > 0.001) setRatio(next);
    // ALWAYS notify, even when the ratio was already right: the row still grew
    // from "nothing decoded" to "a picture", and the transcript needs to re-pin.
    onMediaLoad?.();
  };

  return (
    <span
      className="group/media relative mb-1 block w-fit"
      style={{ maxWidth: '100%' }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="cx-card press block overflow-hidden"
        aria-label={
          kind === 'video' ? `Play ${name ?? 'video'}` : `Open ${name ?? 'image'}`
        }
      >
        {kind === 'image' ? (
          <img
            src={src}
            alt={name ?? ''}
            loading="lazy"
            decoding="async"
            // Intrinsic dimensions — this pair is what reserves the box. CSS
            // below shrinks it proportionally on a narrow screen.
            width={box.width}
            height={box.height}
            onLoad={(e) => settle(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
          />
        ) : (
          // `preload="metadata"` gets the dimensions AND paints the first frame,
          // which is why a clip has a real preview here even though nothing ever
          // writes thumbnailUrl for chat uploads.
          <video
            src={src}
            poster={posterUrl ?? undefined}
            muted
            playsInline
            preload="metadata"
            width={box.width}
            height={box.height}
            onLoadedMetadata={(e) => settle(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
          />
        )}
      </button>

      {kind === 'video' && (
        <span
          className="pointer-events-none absolute inset-0 grid place-items-center"
          aria-hidden="true"
        >
          <span
            className="grid h-12 w-12 place-items-center rounded-full"
            style={{ background: 'rgba(0,0,0,0.55)' }}
          >
            <Play className="h-5 w-5" fill="white" color="white" />
          </span>
        </span>
      )}

      <button
        type="button"
        onClick={() => void downloadFile(downloadUrl, name)}
        aria-label={`Download ${name ?? (kind === 'video' ? 'video' : 'image')}`}
        title="Download"
        className="press absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-full opacity-0 transition-opacity group-hover/media:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        style={{ background: 'rgba(0,0,0,0.55)', color: '#fff' }}
      >
        <Download className="h-4 w-4" />
      </button>

      {size ? (
        <span
          className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-[var(--radius-sm)] px-1.5 py-0.5"
          style={{ background: 'rgba(0,0,0,0.5)' }}
        >
          <Spec style={{ color: '#fff' }}>{fileSize(size)}</Spec>
        </span>
      ) : null}
    </span>
  );
}

/** `PDF`, `XLSX` — the one word that says what a file is, from its name. */
function extensionLabel(name: string | null): string {
  const ext = name?.split('.').pop();
  if (!ext || ext === name || ext.length > 5) return 'File';
  return ext.toUpperCase();
}
