import { Fragment, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { linkLabel, splitLinks, useLinkPreview } from './links';

/**
 * Links in the workspace chat panel.
 *
 * The messenger's twin lives in `clients/chat/src/components/thread/` — same
 * behaviour, same shared data layer (`links.ts`), different palette. See
 * `attachment-block.tsx` for why the two surfaces keep separate chrome.
 */

/**
 * The words in a message, with any links made clickable.
 *
 * Carried by an UNDERLINE rather than a colour. `mine` bubbles are paper on ink
 * and everyone else's are ink on inset, so a single accent hex is unreadable on
 * one of the two; an underline works on both and needs no exception.
 *
 * The printed text is the host and path, not the raw URL — a tracking link with
 * sixty characters of query string is not information, and it wraps the bubble
 * to five lines. The href is untouched.
 */
export function MessageText({ text, mine }: { text: string; mine: boolean }) {
  const segments = splitLinks(text);
  // Fast path — most messages contain no link, and this is the hottest render
  // in the panel.
  if (segments.length === 1 && segments[0].kind === 'text') return <>{text}</>;

  return (
    <>
      {segments.map((segment, i) =>
        segment.kind === 'text' ? (
          <Fragment key={i}>{segment.value}</Fragment>
        ) : (
          <a
            key={i}
            href={segment.href}
            // Cross-origin by definition — a pasted link leaves the app, and
            // taking the workspace with it is how people lose their place.
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={segment.href}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'underline decoration-1 underline-offset-2 hover:decoration-2',
              mine ? 'decoration-paper/50' : 'decoration-ink-40',
            )}
          >
            {linkLabel(segment.value)}
          </a>
        ),
      )}
    </>
  );
}

/**
 * The card under a message that carries a link.
 *
 * A URL tells you the host and nothing else, so the reader's choice is "leave
 * the conversation to find out, or ignore it" — and most links in a chat are
 * ignored for exactly that reason. The card answers "is this worth opening?" in
 * place, which is the whole job.
 *
 * It is NOT an embed: no iframe, no third-party script, no autoplay. A picture,
 * a title and a line of text, fetched and vetted by our own server
 * (server-shared `modules/chat/unfurl.ts`). An embed hands a stranger's code a
 * seat inside the transcript.
 */
export function LinkCard({
  url,
  mine,
  onLoad,
}: {
  url: string;
  mine: boolean;
  /** The card changed the row's height — lets the transcript re-pin. */
  onLoad?: () => void;
}) {
  const data = useLinkPreview(url);

  // The card arriving is a height change the virtualiser reports; the image
  // inside it lands later still — hence both this and the img's own onLoad.
  useEffect(() => {
    if (data) onLoad?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data) return null;

  return (
    <a
      href={data.finalUrl}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'mt-1.5 block max-w-[300px] overflow-hidden rounded-[var(--radius-sm)] border',
        mine ? 'border-paper/20 bg-paper/10' : 'border-[color:var(--color-border-hairline)] bg-card',
      )}
    >
      {data.imageUrl && (
        // 1.91:1 — the ratio every og:image is authored at, so reserving it
        // means the card is its final height before the picture arrives.
        <span
          className={cn('block w-full overflow-hidden', mine ? 'bg-paper/10' : 'bg-inset')}
          style={{ aspectRatio: '1.91 / 1' }}
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
      <span className="block px-2.5 py-2">
        <span className={cn('block truncate text-[10px] uppercase tracking-wider', mine ? 'text-paper/60' : 'text-ink-40')}>
          {data.siteName ?? data.host}
        </span>
        {data.title && (
          <span className={cn('mt-0.5 block text-xs font-semibold leading-snug', mine ? 'text-paper' : 'text-ink-100')}>
            {data.title}
          </span>
        )}
        {data.description && (
          <span
            className={cn('mt-0.5 block text-[11px] leading-snug', mine ? 'text-paper/70' : 'text-ink-60')}
            style={{
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
