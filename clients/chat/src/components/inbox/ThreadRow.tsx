import { memo, useState } from 'react';
import { MoreHorizontal, Pin } from 'lucide-react';
import { MUTE_OPTIONS, muteLabel } from '@shared/pages/chat/mute';
import { Avatar, GroupAvatar, Spec } from '../primitives';
import { Menu, muteEntry, type MenuEntry } from '../Menu';
import { inboxTime } from '../../lib/format';
import { useDraft } from '../../stores/drafts';
import { useTypingIds } from '../../stores/typing';

/**
 * One conversation in the list.
 *
 * Every element here earns its place, and two of them are deliberately NOT what
 * the category does:
 *
 *  - A DM's unread marker is a DOT, not a count. On a one-to-one thread the
 *    number is noise — you either owe this person a reply or you don't, and "7"
 *    only makes it feel heavier. Groups get a count, because there volume is
 *    genuinely information.
 *  - A group's avatar is a tile of its people, not a generic group glyph. Who is
 *    IN a group is what identifies it; "Design" and "Design (old)" are told apart
 *    by their faces and never by their names.
 *
 * The hover controls are one quick Pin plus a ⋯ menu. They used to be three bare
 * icon buttons, which was fine while there were three things to do and stopped
 * being fine at eight — and an icon row has nowhere to say "Muted until 6pm" or
 * to turn Archive into Unarchive when you are looking at the archive.
 */

export type ThreadRowItem = {
  id: string;
  type: 'direct' | 'group' | 'you';
  displayName: string;
  avatarUrl: string | null;
  faces: { id: string; name: string; avatarUrl: string | null }[];
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: Date | string | null;
  lastMessageMine: boolean;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  mutedUntil: Date | string | null;
  isArchived: boolean;
  /** Which list header this row sits under — see routers/chat/consumer.ts. */
  section: 'unread' | 'read';
  counterpartOnline: boolean;
};

type Props = {
  item: ThreadRowItem;
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onMute: (until: Date | null) => void;
  onArchive: (archived: boolean) => void;
  onMarkUnread: () => void;
  onMarkRead: () => void;
};

function previewOf(item: ThreadRowItem, typingNames: number): string {
  if (typingNames > 0) return typingNames === 1 ? 'typing…' : `${typingNames} people typing…`;
  if (!item.lastMessage) return 'No messages yet';
  if (item.type === 'group' && !item.lastMessageMine) return item.lastMessage;
  return item.lastMessageMine ? `You: ${item.lastMessage}` : item.lastMessage;
}

function ThreadRowInner({
  item,
  active,
  onOpen,
  onTogglePin,
  onMute,
  onArchive,
  onMarkUnread,
  onMarkRead,
}: Props) {
  const draft = useDraft(item.id);
  const typing = useTypingIds(item.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const unread = item.unreadCount > 0 && !item.isMuted;
  // The open menu counts as "still hovering". Its panel hangs BELOW the row, so a
  // CSS :hover rule drops the moment you move the pointer into it — which faded
  // the whole strip, popover included, to transparent while you were reading it.
  const showActions = hovered || menuOpen;

  const entries: MenuEntry[] = [
    item.unreadCount > 0
      ? { label: 'Mark as read', onClick: onMarkRead }
      : { label: 'Mark as unread', onClick: onMarkUnread },
    { label: item.isPinned ? 'Unpin' : 'Pin to top', onClick: onTogglePin },
    muteEntry(item, MUTE_OPTIONS, onMute, muteLabel(item.mutedUntil)),
    { kind: 'sep' },
    item.isArchived
      ? { label: 'Unarchive', onClick: () => onArchive(false) }
      : { label: 'Archive', hint: 'silences it', onClick: () => onArchive(true) },
  ];

  return (
    <div
      className="cx-listrow group relative"
      data-active={active}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderBottom: '1px solid var(--wire)' }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full items-center gap-3 px-4 py-3 text-left"
        // minmax(0, 1fr), never a bare 1fr: an fr track takes its minimum from
        // content, so one truncating child would widen the entire list pane.
        style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto' }}
      >
        {item.type === 'group' ? (
          <GroupAvatar members={item.faces} photoUrl={item.avatarUrl} size={36} />
        ) : (
          <Avatar
            name={item.displayName}
            url={item.avatarUrl}
            size={36}
            online={item.type === 'direct' && item.counterpartOnline}
          />
        )}

        <span className="min-w-0">
          <span className="flex items-baseline gap-2">
            <span
              className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight"
              style={{ color: item.isMuted ? 'var(--voice-3)' : 'var(--voice)' }}
            >
              {item.displayName}
            </span>
            {/* The row is already called "Notes" (routers/chat/consumer.ts), so
                the tag says the part the name doesn't: nobody else is in here. */}
            {item.type === 'you' && <Spec>Only you</Spec>}
            {item.type === 'group' && item.memberCount > 2 && (
              <Spec>{item.memberCount}</Spec>
            )}
          </span>
          <span
            className="mt-0.5 block truncate text-[13px]"
            style={{
              color: draft
                ? 'var(--live)'
                : typing.length
                  ? 'var(--live)'
                  : item.isMuted
                    ? 'var(--voice-3)'
                    : 'var(--voice-2)',
            }}
          >
            {draft ? `Draft: ${draft}` : previewOf(item, typing.length)}
          </span>
        </span>

        <span className="flex flex-col items-end gap-1.5">
          {/* The hover actions sit ON TOP of the time, so the resting row stays
              quiet. Nothing shifts when they appear. */}
          <span style={{ opacity: showActions ? 0 : 1 }}>
            {item.isMuted ? (
              <Spec>{muteLabel(item.mutedUntil)}</Spec>
            ) : (
              <Spec>{inboxTime(item.lastMessageAt)}</Spec>
            )}
          </span>
          {unread && (
            <span
              className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums"
              style={{
                background: 'var(--live)',
                color: '#fff',
                // A DM shows a dot, not a number — see the docblock.
                width: item.type === 'group' ? undefined : 9,
                minWidth: item.type === 'group' ? 18 : 9,
                height: item.type === 'group' ? 18 : 9,
              }}
            >
              {item.type === 'group' ? Math.min(item.unreadCount, 99) : ''}
            </span>
          )}
          {item.isPinned && !unread && (
            <Pin className="h-3 w-3" style={{ color: 'var(--voice-3)' }} />
          )}
        </span>
      </button>

      {/* Row actions. Absolutely positioned so they cost the resting row nothing
          and can never reflow the preview mid-scan. They stay up while the menu
          is open — a menu that vanishes because the pointer moved into it is a
          menu you cannot use. */}
      <span
        className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-0.5 transition-opacity"
        style={{
          opacity: showActions ? 1 : 0,
          pointerEvents: showActions ? 'auto' : 'none',
        }}
      >
        <RowAction label={item.isPinned ? 'Unpin' : 'Pin'} onClick={onTogglePin}>
          <Pin className="h-3.5 w-3.5" />
        </RowAction>
        <Menu
          label="Conversation options"
          entries={entries}
          onOpenChange={setMenuOpen}
          className="grid place-items-center rounded-full"
          style={{ background: 'var(--room-2)' }}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Menu>
      </span>
    </div>
  );
}

function RowAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="press grid h-7 w-7 place-items-center rounded-full transition-colors"
      style={{ background: 'var(--room-2)', color: 'var(--voice-2)' }}
    >
      {children}
    </button>
  );
}

/**
 * Memoised on what actually changes. The inbox array gets a new identity on
 * every realtime patch, so without this every row re-renders each time anyone
 * anywhere sends a message.
 */
export const ThreadRow = memo(ThreadRowInner, (a, b) => {
  const x = a.item;
  const y = b.item;
  return (
    a.active === b.active &&
    x.id === y.id &&
    x.displayName === y.displayName &&
    x.avatarUrl === y.avatarUrl &&
    x.lastMessage === y.lastMessage &&
    String(x.lastMessageAt) === String(y.lastMessageAt) &&
    x.lastMessageMine === y.lastMessageMine &&
    x.unreadCount === y.unreadCount &&
    x.isPinned === y.isPinned &&
    x.isMuted === y.isMuted &&
    String(x.mutedUntil) === String(y.mutedUntil) &&
    x.isArchived === y.isArchived &&
    x.memberCount === y.memberCount &&
    x.counterpartOnline === y.counterpartOnline
  );
});
