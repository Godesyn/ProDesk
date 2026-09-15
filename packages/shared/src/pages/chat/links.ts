import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';

/**
 * Finding links in what someone typed.
 *
 * Deliberately conservative. The tempting version of this matches bare domains
 * so `prodesk.com` becomes clickable, and it is a trap: `node.js`, `v2.1`,
 * `etc.` and every sentence that ends without a space after the full stop turn
 * into links, and a transcript full of false links is worse than one with none.
 * So a link is an explicit scheme or an explicit `www.`, which is what people
 * paste anyway — the case this exists for is the pasted URL, not the mentioned
 * brand.
 */

/**
 * `https://…`, `http://…` or `www.…`, stopping before trailing punctuation.
 *
 * The trailing-character class is the fiddly half: URLs legitimately contain
 * `)` and `.`, but a URL at the end of a sentence is followed by one, and
 * swallowing it produces a 404 on click. The rule is that a link may not END on
 * punctuation, which gets both `see https://a.com/b.` and `(https://a.com/b)`
 * right without a parser.
 */
const LINK_RE =
  /\b(?:https?:\/\/|www\.)[^\s<>"']*[^\s<>"'.,!?;:)\]}]/gi;

export type TextSegment =
  | { kind: 'text'; value: string }
  | { kind: 'link'; value: string; href: string };

/** Split a message body into plain runs and links, in order. */
export function splitLinks(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ kind: 'text', value: text.slice(last, at) });
    out.push({ kind: 'link', value: match[0], href: hrefOf(match[0]) });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** The first link in a message, which is the one that gets an unfurled card. */
export function firstLink(text: string): string | null {
  const match = text.match(LINK_RE);
  return match ? hrefOf(match[0]) : null;
}

/** A `www.`-only link still needs a scheme to be navigable. */
function hrefOf(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/**
 * The unfurled card for a URL, or null when it has none.
 *
 * The FETCH POLICY lives here rather than in each surface's card, because it is
 * the part that must not drift: the messenger and the workspace panel draw very
 * different-looking previews out of exactly the same data, and two components
 * each choosing their own staleTime is how one of them ends up re-fetching every
 * link in a thread on every mount.
 *
 * Long stale window on purpose. A page's card does not change while you are
 * reading a conversation, the same link is often quoted a dozen times in one
 * thread, and every miss is an outbound request our server makes on someone
 * else's behalf. `retry: false` for the same reason — a link with no card is the
 * ordinary case, not a failure worth three attempts.
 */
export function useLinkPreview(url: string | null) {
  const trpc = useTRPC();
  const query = useQuery({
    ...trpc.chat.linkPreview.queryOptions({ url: url ?? '' }),
    enabled: !!url,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });
  return query.data ?? null;
}

/**
 * How a link should read in the transcript. A full URL is usually noise — what
 * identifies it is the host and, when there is one, the last meaningful path
 * segment. The href is untouched; this is only what is printed.
 */
export function linkLabel(raw: string): string {
  try {
    const url = new URL(hrefOf(raw));
    const host = url.hostname.replace(/^www\./, '');
    const path = url.pathname.replace(/\/$/, '');
    if (!path && !url.search) return host;
    const printed = `${host}${path}${url.search}`;
    return printed.length > 64 ? `${printed.slice(0, 61)}…` : printed;
  } catch {
    return raw;
  }
}
