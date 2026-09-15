import { useEffect } from 'react';
import { useLinkPreview } from '@shared/pages/chat/links';
import { Spec } from '../primitives';

/**
 * The card under a message that carries a link.
 *
 * WHY IT IS A CARD AND NOT JUST A LINK: a URL tells you the host and nothing
 * else, so the reader's choice is "leave the conversation to find out, or
 * ignore it". Most links in a chat are ignored for exactly that reason. The
 * card answers "is this worth opening?" in place, which is the entire job.
 *
 * WHAT IT DELIBERATELY IS NOT: an embed. No autoplaying video, no iframe, no
 * third-party script — a preview is a picture, a title and a line of text,
 * fetched and vetted by our own server (modules/chat/unfurl.ts). An embed hands
 * a stranger's code a seat inside the transcript.
 *
 * Nothing renders until the fetch resolves, and nothing renders at all if the
 * link has no card. A skeleton would be a box that appears under a message a
 * second after you read it and then vanishes again, which is a worse experience
 * than the card simply arriving.
 */
export function LinkPreview({
  url,
  tone,
  onLoad,
}: {
  url: string;
  tone: 'mine' | 'theirs';
  /** The card changed the row's height — lets the transcript re-pin. */
  onLoad?: () => void;
}) {
  // The fetch policy is shared with the workspace panel's card; only the chrome
  // below differs. See @shared/pages/chat/links#useLinkPreview.
  const data = useLinkPreview(url);

  // The card arriving is a height change the virtualiser reports, but the image
  // inside it lands later still — hence both this and the img's own onLoad.
  useEffect(() => {
    if (data) onLoad?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return null;

  const mine = tone === 'mine';
  return (
    <a
      href={data.finalUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className="press mt-1.5 block max-w-[340px] overflow-hidden rounded-[var(--radius-sm)]"
      style={{
        // Inside a `mine` bubble the ground is `--voice`, so the card cannot use
        // `--room-2` or it disappears; a wash of the bubble's own ink reads as
        // an inset on both.
        background: mine ? 'rgba(0,0,0,0.07)' : 'var(--room-3)',
        border: `1px solid ${mine ? 'rgba(0,0,0,0.10)' : 'var(--wire)'}`,
      }}
    >
      {data.imageUrl && (
        // 1.91:1 — the ratio every og:image is authored at, so reserving it means
        // the card is its final height before the picture arrives.
        <span
          className="block w-full overflow-hidden"
          style={{ aspectRatio: '1.91 / 1', background: mine ? 'rgba(0,0,0,0.06)' : 'var(--room-2)' }}
        >
          <img
            src={data.imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onLoad={() => onLoad?.()}
            // A broken og:image is common enough to plan for: hide the frame
            // rather than leave a grey band above the title.
            onError={(e) => {
              const frame = e.currentTarget.parentElement;
              if (frame) frame.style.display = 'none';
            }}
            className="h-full w-full object-cover"
          />
        </span>
      )}
      <span className="block px-3 py-2.5">
        <Spec style={{ color: mine ? 'var(--room-3)' : 'var(--voice-3)' }}>
          {data.siteName ?? data.host}
        </Spec>
        {data.title && (
          <span
            className="mt-1 block text-[13px] font-semibold leading-snug"
            style={{ color: mine ? 'var(--room)' : 'var(--voice)' }}
          >
            {data.title}
          </span>
        )}
        {data.description && (
          <span
            className="mt-0.5 block text-[12px] leading-snug"
            style={{
              color: mine ? 'var(--room-3)' : 'var(--voice-2)',
              // Two lines. A description is a hint, and a card that grows to six
              // lines stops being a hint and starts being the message.
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {data.description}
          </span>
        )}
      </span>
    </a>
  );
}
