import { memo, useState } from 'react';
import {
  Check,
  CheckCheck,
  Copy,
  CornerUpLeft,
  CornerUpRight,
  Pencil,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import { Avatar } from '../primitives';
import { useLongPress } from '../../lib/a11y';
import { clockTime } from '../../lib/format';
import { QUICK } from '../../lib/emoji';
import { firstLink } from '@shared/pages/chat/links';
import { AttachmentBlock } from './AttachmentBlock';
import { anchorOf } from '@shared/lib/popover-anchor';
import { LinkPreview } from './LinkPreview';
import { MessageText } from './MessageText';

/**
 * One message in the transcript.
 *
 * BUBBLES, matching the workspace MessagePanel
 * (packages/shared/src/pages/chat/message-panel.tsx) beat for beat: avatar in the
 * left gutter at a run's start, a content-hugging bubble capped at 72% of the
 * pane, the sender's name inside it, and a time + read-tick line that prints only
 * on the newest message of a run. Same anatomy, same grouping rules, same
 * behaviour — the two surfaces are one product and a person moving between them
 * should not have to re-learn how a conversation is laid out.
 *
 * What is NOT shared is the palette. The panel puts your own messages in
 * `ink-100 / paper`; here that same relationship — the maximum-contrast inverse
 * of the ground — is `--voice` on `--room`, so the layout is identical while Chat
 * keeps its own dark ground, its own accent and its own type.
 *
 * This replaced a bubble-less transcript with a "spine" down the gutter. That
 * design read well in isolation and read as a different application the moment
 * you had both open.
 */

export type RowMessage = {
  id: string;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  content: string | null;
  type: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  thumbnailUrl: string | null;
  replyToId: string | null;
  isForwarded: boolean;
  editedAt: Date | string | null;
  deletedAt: Date | string | null;
  timestamp: string;
};

export type BeadPerson = {
  id: string;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  typing: boolean;
};

type Props = {
  message: RowMessage;
  /** First message of a run — prints the avatar and the name. */
  runStart: boolean;
  mine: boolean;
  /** Last message of a run — prints the time and the tick. */
  showMeta: boolean;
  /** Everyone else has read up to here (drives the double tick). */
  readByOthers: boolean;
  /** People whose last-read pointer sits on THIS message. */
  beads: BeadPerson[];
  /** Reaction chips, already summarised. */
  reactions: { emoji: string; count: number; mine: boolean }[];
  /**
   * The message this one answers. Resolved from the loaded window when it is
   * there and from `chat.messagePreviews` when it is not, so a quote reads even
   * when its original is thousands of rows back. `missing` means we looked and it
   * is gone (deleted, or in a thread we've left).
   */
  replyTo: {
    senderName: string | null;
    content: string | null;
    missing: boolean;
    type: string;
  } | null;
  flash: boolean;
  canEdit: boolean;
  onReact: (emoji: string) => void;
  onOpenPicker: (anchor: { x: number; y: number }) => void;
  onReply: () => void;
  onForward: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenMedia: () => void;
  onJumpToReply: () => void;
  /**
   * Press and hold (or right-click). Opens the action sheet — which is the ONLY
   * way any of the hover-toolbar actions are reachable on a touch device.
   */
  onLongPress: () => void;
  /**
   * An attachment in this row finished measuring and the row changed height.
   * Passed straight through to the transcript, which re-pins if the reader is at
   * the live edge — see AttachmentBlock and stick-to-bottom.ts. Must be
   * identity-stable: the memo below does not compare it.
   */
  onMediaLoad: () => void;
};

function MessageRowInner({
  message,
  runStart,
  mine,
  showMeta,
  readByOthers,
  beads,
  reactions,
  replyTo,
  flash,
  canEdit,
  onReact,
  onOpenPicker,
  onReply,
  onForward,
  onEdit,
  onDelete,
  onOpenMedia,
  onJumpToReply,
  onLongPress,
  onMediaLoad,
}: Props) {
  const [hovered, setHovered] = useState(false);
  const longPress = useLongPress(onLongPress);
  const deleted = !!message.deletedAt;
  // Only the FIRST link gets a card. A message with five links wants to stay a
  // message; five stacked cards is a page.
  const firstUrl = !deleted && message.content ? firstLink(message.content) : null;

  // System notices sit centred as a pill — part of the record, but nobody said
  // them, so they get no avatar, no bubble and no ownership.
  if (message.type === 'system') {
    return (
      <div className="my-2 flex justify-center px-3">
        <span
          className="rounded-full px-3 py-1 text-center text-[11px]"
          style={{ background: 'var(--room-2)', color: 'var(--voice-2)' }}
        >
          {message.content}
        </span>
      </div>
    );
  }

  return (
    // HOVER IS TRACKED ON THE OUTER ROW, and the row carries `pt-3` so the
    // toolbar below — which floats above the bubble — sits INSIDE this box.
    //
    // It was tracked on the inner column with the toolbar hanging 12px above it.
    // Moving the pointer up onto the toolbar therefore left the tracked element,
    // the toolbar unmounted under the cursor, and the click never landed. That is
    // why Edit and Delete appeared to do nothing — and why an edit sometimes
    // ended up sent as a brand-new message instead.
    <div
      // pt-2 is the minimum that contains the -top-2 toolbar; a run start gets a
      // little more so a change of speaker reads as a break.
      className={`flex gap-2 px-3 pb-1.5 ${runStart ? 'pt-3' : 'pt-2'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The gutter. An invisible placeholder inside a run keeps every bubble in
          a run on the same left edge — a run whose second message slid 36px left
          would read as a different speaker. */}
      {!mine && (
        <span className={runStart ? '' : 'invisible'}>
          <Avatar
            name={message.senderName ?? 'Someone'}
            url={message.senderAvatar}
            size={28}
            className="mt-0.5"
          />
        </span>
      )}

      {/* The highlight wraps the whole ROW, not the bubble: it is answering
          "this one", and a ring drawn tight around a 400px bubble reads as a
          selection state rather than as a landing marker. */}
      <div
        className={`relative flex min-w-0 flex-1 flex-col rounded-[var(--radius-md)] ${
          mine ? 'items-end' : 'items-start'
        } ${flash ? 'cx-flash' : ''}`}
      >
        <div
          className="w-fit max-w-full rounded-[var(--radius-md)] px-3 py-2 text-sm sm:max-w-[72%]"
          style={{
            background: mine ? 'var(--voice)' : 'var(--room-2)',
            color: mine ? 'var(--room)' : 'var(--voice)',
            // iOS answers a long press on text with its own selection callout,
            // which would race this one. Suppressing it is the trade WhatsApp
            // and Telegram both make, and the sheet carries a Copy action so
            // nothing is actually lost.
            WebkitTouchCallout: 'none',
          }}
          {...(deleted ? {} : longPress.handlers)}
          onClickCapture={(e) => {
            // The click the browser sends when the finger lifts after a hold.
            // Without this, holding a photo opens the sheet AND the lightbox.
            if (longPress.suppressClick()) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          {!mine && runStart && (
            <div
              className="mb-0.5 truncate text-[11px] font-bold"
              style={{ color: 'var(--voice)' }}
            >
              {message.senderName ?? 'Someone'}
            </div>
          )}

          {/* "Forwarded" — these words were written somewhere else, and that
              changes how they should be read. It sits ABOVE the quote and the
              content, in the bubble's quiet colour, because it is a provenance
              note rather than part of what was said. A tombstone gets none: a
              deleted message has no provenance left to describe. */}
          {message.isForwarded && !deleted && (
            <div
              className="mb-0.5 flex items-center gap-1 text-[10.5px] italic"
              style={{ color: mine ? 'var(--room-3)' : 'var(--voice-3)' }}
            >
              <CornerUpRight className="h-3 w-3" aria-hidden="true" />
              Forwarded
            </div>
          )}

          {replyTo && !deleted && (
            <button
              type="button"
              onClick={onJumpToReply}
              className="mb-1 block w-full rounded-[var(--radius-sm)] border-l-2 px-2 py-1 text-left"
              style={{
                borderColor: mine ? 'var(--room-3)' : 'var(--live)',
                background: mine ? 'rgba(0,0,0,0.07)' : 'var(--room-3)',
              }}
            >
              <span
                className="block text-[10px] font-bold"
                style={{ color: mine ? 'var(--room-3)' : 'var(--voice-2)' }}
              >
                {replyTo.senderName ?? 'Someone'}
              </span>
              <span
                className="block truncate text-[11px]"
                style={{ color: mine ? 'var(--room-3)' : 'var(--voice-3)' }}
              >
                {replyTo.missing
                  ? 'Message no longer available'
                  : (replyTo.content ??
                    (replyTo.type === 'image'
                      ? 'Photo'
                      : replyTo.type === 'video'
                        ? 'Video'
                        : 'Attachment'))}
              </span>
            </button>
          )}

          {deleted ? (
            <div className="italic" style={{ color: mine ? 'var(--room-3)' : 'var(--voice-3)' }}>
              Message deleted
            </div>
          ) : (
            <>
              {message.fileUrl && (
                <AttachmentBlock
                  type={message.type}
                  url={message.fileUrl}
                  name={message.fileName}
                  thumbnailUrl={message.thumbnailUrl}
                  size={message.fileSize}
                  onOpen={onOpenMedia}
                  onMediaLoad={onMediaLoad}
                />
              )}
              {message.content && (
                <div className="speech whitespace-pre-wrap break-words">
                  <MessageText
                    text={message.content}
                    tone={mine ? 'mine' : 'theirs'}
                  />
                  {message.editedAt && (
                    <>
                      {' '}
                      <span
                        className="text-[10px]"
                        style={{ color: mine ? 'var(--room-3)' : 'var(--voice-3)' }}
                      >
                        edited
                      </span>
                    </>
                  )}
                </div>
              )}
              {/* The unfurled card for the first link in the message, under the
                  words rather than replacing them — the sentence is still what
                  was said, and the card is what it points at. */}
              {!message.fileUrl && firstUrl && (
                <LinkPreview url={firstUrl} tone={mine ? 'mine' : 'theirs'} onLoad={onMediaLoad} />
              )}
            </>
          )}
        </div>

        {/* Hover actions. Absolutely positioned above the bubble, on the side the
            bubble is aligned to, so nothing in the transcript moves when they
            appear and they never cover the words.
            ALWAYS MOUNTED, hidden with opacity + pointer-events rather than by a
            conditional: a toolbar that unmounts the instant hover flickers takes
            the in-flight click with it. */}
        {!deleted && (
          <div
            className={`absolute -top-2 z-10 flex items-center gap-0.5 rounded-full px-1 py-0.5 transition-opacity ${
              mine ? 'right-0' : 'left-0'
            }`}
            style={{
              background: 'var(--room-2)',
              border: '1px solid var(--wire-2)',
              boxShadow: '0 4px 14px rgba(0,0,0,0.28)',
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? 'auto' : 'none',
            }}
          >
            {/* Most-used first: reacting is the single commonest gesture in any
                modern messenger, so it gets the leftmost slots. */}
            {QUICK.slice(0, 3).map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                className="press grid h-6 w-6 place-items-center rounded-full text-[14px]"
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <Action label="More reactions" onClick={(e) => onOpenPicker(anchorOf(e.currentTarget))}>
              <SmilePlus className="h-3.5 w-3.5" />
            </Action>
            <Action label="Reply" onClick={onReply}>
              <CornerUpLeft className="h-3.5 w-3.5" />
            </Action>
            <Action label="Forward" onClick={onForward}>
              <CornerUpRight className="h-3.5 w-3.5" />
            </Action>
            {message.content && (
              <Action
                label="Copy"
                onClick={() => void navigator.clipboard?.writeText(message.content ?? '')}
              >
                <Copy className="h-3.5 w-3.5" />
              </Action>
            )}
            {mine && canEdit && message.type === 'text' && (
              <Action label="Edit" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" />
              </Action>
            )}
            {mine && (
              <Action label="Delete" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Action>
            )}
          </div>
        )}

        {reactions.length > 0 && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
            {reactions.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => onReact(r.emoji)}
                className="cx-chip press"
                data-mine={r.mine}
                aria-label={`${r.emoji} ${r.count}`}
                aria-pressed={r.mine}
              >
                <span style={{ fontSize: 13 }}>{r.emoji}</span>
                {r.count}
              </button>
            ))}
          </div>
        )}

        {showMeta && (
          <span className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: 'var(--voice-3)' }}>
            {clockTime(message.timestamp)}
            {mine &&
              (readByOthers ? (
                <CheckCheck className="h-3 w-3" style={{ color: 'var(--live)' }} />
              ) : (
                <Check className="h-3 w-3" />
              ))}
          </span>
        )}

        {/* The beads — Chat's own addition, kept because they say something the
            tick above cannot: WHO has got this far. In a group of eight the tick
            is one bit; this is seven faces, and it stays. Re-homed from the old
            spine gutter to under the message they point at. */}
        {beads.length > 0 && <ReadBeads people={beads} align={mine ? 'end' : 'start'} />}
      </div>
    </div>
  );
}

function Action({
  label,
  onClick,
  children,
}: {
  label: string;
  // Takes the event, so a caller that opens a popover can anchor it to this
  // button rather than centring it over the conversation.
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="press grid h-6 w-6 place-items-center rounded-full"
      style={{ color: 'var(--voice-2)' }}
    >
      {children}
    </button>
  );
}

/**
 * Each participant's face, docked at the last message they have read.
 *
 * In a DM there is one; in a group of eight there are seven, clustering where
 * people are together and strung out where they are not. Nobody else renders
 * group read state at all — WhatsApp gives you two ticks and Slack gives you
 * nothing — which is why this survived the move to bubbles.
 *
 * They overlap rather than sit in a row, so a cluster of five reads as a cluster
 * instead of pushing the row's width around.
 */
function ReadBeads({ people, align }: { people: BeadPerson[]; align: 'start' | 'end' }) {
  return (
    <span
      className={`mt-1 flex items-center ${align === 'end' ? 'justify-end' : 'justify-start'}`}
      aria-hidden="true"
    >
      {people.slice(0, 5).map((p, i) => (
        <img
          key={p.id}
          className="cx-bead"
          data-online={p.online}
          data-typing={p.typing}
          src={
            p.avatarUrl ??
            // A neutral dot rather than a broken image when someone has no photo.
            `data:image/svg+xml;utf8,${encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="%23${'5F6772'}"/></svg>`,
            )}`
          }
          alt=""
          title={p.name}
          style={{ marginLeft: i === 0 ? 0 : -5 }}
        />
      ))}
      {people.length > 5 && (
        <span className="ml-1 text-[9px]" style={{ color: 'var(--voice-3)' }}>
          +{people.length - 5}
        </span>
      )}
    </span>
  );
}

/**
 * Memoised on what actually changes. The messages array gets a new identity on
 * every realtime patch, so without this a single incoming message re-renders
 * every message on screen — including their images.
 */
export const MessageRow = memo(MessageRowInner, (a, b) => {
  const x = a.message;
  const y = b.message;
  return (
    x.id === y.id &&
    x.content === y.content &&
    // THE ATTACHMENT FIELDS BELONG HERE, and their absence was a real bug: a
    // realtime UPDATE that fills in a thumbnail, or a patch that swaps a file
    // url, changes nothing this comparator looked at, so the row kept rendering
    // the old attachment until something unrelated forced it to re-render.
    x.type === y.type &&
    x.fileUrl === y.fileUrl &&
    x.fileName === y.fileName &&
    x.fileSize === y.fileSize &&
    x.thumbnailUrl === y.thumbnailUrl &&
    x.isForwarded === y.isForwarded &&
    String(x.editedAt) === String(y.editedAt) &&
    String(x.deletedAt) === String(y.deletedAt) &&
    a.runStart === b.runStart &&
    a.mine === b.mine &&
    a.showMeta === b.showMeta &&
    a.readByOthers === b.readByOthers &&
    a.flash === b.flash &&
    a.canEdit === b.canEdit &&
    a.replyTo?.content === b.replyTo?.content &&
    a.replyTo?.senderName === b.replyTo?.senderName &&
    a.replyTo?.missing === b.replyTo?.missing &&
    a.reactions.length === b.reactions.length &&
    a.reactions.every((r, i) => r.emoji === b.reactions[i]?.emoji && r.count === b.reactions[i]?.count && r.mine === b.reactions[i]?.mine) &&
    a.beads.length === b.beads.length &&
    a.beads.every((p, i) => p.id === b.beads[i]?.id && p.online === b.beads[i]?.online && p.typing === b.beads[i]?.typing)
  );
});
