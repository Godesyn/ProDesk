import { Fragment } from 'react';
import { linkLabel, splitLinks } from '@shared/pages/chat/links';

/**
 * The words in a message, with any links made clickable.
 *
 * Links are carried by an UNDERLINE, not a colour. The pigment doctrine
 * (index.css) reserves colour for presence — someone is here — and a URL
 * somebody pasted is not that; colouring it would put the same signal on a link
 * as on an online bead. An underline says "this goes somewhere" in both grounds
 * and inside both bubble palettes, which a single accent hex cannot do: `mine`
 * bubbles invert to `--room` on `--voice`, and a link coloured for one of those
 * is unreadable on the other.
 *
 * The printed text is the host and path rather than the raw URL — a tracking URL
 * with sixty characters of query string is not information, and it wraps the
 * bubble to five lines. The href is untouched.
 */
export function MessageText({ text, tone }: { text: string; tone: 'mine' | 'theirs' }) {
  const segments = splitLinks(text);
  // Fast path — most messages contain no link at all, and this is the hottest
  // render in the app.
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
            // taking the conversation with it is how people lose their place.
            target="_blank"
            rel="noopener noreferrer nofollow"
            title={segment.href}
            className="underline decoration-1 underline-offset-2 hover:decoration-2"
            style={{
              color: 'inherit',
              textDecorationColor:
                tone === 'mine' ? 'var(--room-3)' : 'var(--voice-3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {linkLabel(segment.value)}
          </a>
        ),
      )}
    </>
  );
}
