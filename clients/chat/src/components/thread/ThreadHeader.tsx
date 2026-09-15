import { ArrowLeft, MoreHorizontal, Search } from 'lucide-react';
import { Avatar, GroupAvatar, Spec } from '../primitives';
import { Menu, type MenuEntry } from '../Menu';
import { lastSeenLabel } from '../../lib/format';
import type { DetailTab } from './ThreadDetail';

/**
 * The room's header.
 *
 * 56px, and the subtitle does real work rather than repeating the title: for a DM
 * it is presence (`ONLINE` / `LAST SEEN 14:02`), for a group it is the roster
 * (`8 MEMBERS · 3 ONLINE`) and it is the way into the members sheet. Those are the
 * two questions people actually have when they open a conversation.
 */

export type HeaderMember = {
  userId: string;
  name: string;
  avatar: string | null;
  lastSeenAt: Date | string | null;
  isAdmin?: boolean | null;
};

const ONLINE_WINDOW_MS = 90_000;

export function isOnline(lastSeenAt: Date | string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const t = new Date(lastSeenAt).getTime();
  return !Number.isNaN(t) && Date.now() - t <= ONLINE_WINDOW_MS;
}

export function ThreadHeader({
  title,
  type,
  members,
  meId,
  photoUrl,
  onBack,
  onOpenDetail,
  onSearch,
  menu,
}: {
  title: string;
  type: 'direct' | 'group' | 'you';
  members: HeaderMember[];
  meId: string | null;
  photoUrl: string | null;
  onBack?: () => void;
  /** Open the detail sheet on a given tab — see ThreadDetail. */
  onOpenDetail: (tab: DetailTab) => void;
  onSearch: () => void;
  menu: MenuEntry[];
}) {
  const others = members.filter((m) => m.userId !== meId);
  const onlineCount = others.filter((m) => isOnline(m.lastSeenAt)).length;
  const counterpart = type === 'direct' ? others[0] : undefined;

  const subtitle =
    type === 'you'
      ? 'ONLY YOU'
      : type === 'direct'
        ? counterpart && isOnline(counterpart.lastSeenAt)
          ? 'ONLINE'
          : lastSeenLabel(counterpart?.lastSeenAt ?? null)
        : `${members.length} MEMBER${members.length === 1 ? '' : 'S'}${
            onlineCount ? ` · ${onlineCount} ONLINE` : ''
          }`;

  return (
    <header
      className="flex shrink-0 items-center gap-3 px-3 sm:px-4"
      style={{
        borderBottom: '1px solid var(--wire)',
        background: 'var(--room)',
        // 56px of chrome PLUS whatever the device puts above it. On a phone the
        // room is the whole screen, so without the inset the title sits under
        // the notch and the Back control is half unreachable.
        height: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to conversations"
          className="press -ml-1 grid h-9 w-9 place-items-center rounded-full md:hidden"
          style={{ color: 'var(--voice-2)' }}
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </button>
      )}

      {type === 'group' ? (
        <GroupAvatar
          members={others.map((m) => ({ name: m.name, avatarUrl: m.avatar }))}
          photoUrl={photoUrl}
          size={32}
        />
      ) : (
        <Avatar
          name={title}
          url={counterpart?.avatar ?? photoUrl}
          size={32}
          online={!!counterpart && isOnline(counterpart.lastSeenAt)}
        />
      )}

      {/* The title is the way in to the detail screen for EVERY conversation,
          not just groups. It used to be inert in a DM, which meant the media and
          files of the conversation people share most were reachable only from
          the ⋯ menu. A DM opens on Media (there is no roster to manage), a group
          opens on Members. */}
      <button
        type="button"
        onClick={() => onOpenDetail(type === 'group' ? 'members' : 'media')}
        aria-label="Conversation details"
        className="min-w-0 flex-1 text-left"
      >
        <span
          className="block truncate text-[15px] font-bold tracking-tight"
          style={{ color: 'var(--voice)' }}
        >
          {title}
        </span>
        <Spec>{subtitle}</Spec>
      </button>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Search in conversation"
        className="press grid h-9 w-9 place-items-center rounded-full"
        style={{ color: 'var(--voice-2)' }}
      >
        <Search className="h-4 w-4" />
      </button>

      {/* The same dropdown the thread rows use — including its in-place Mute
          submenu — rather than a second implementation that would drift. */}
      <Menu label="Conversation options" entries={menu} triggerClassName="h-9 w-9">
        <MoreHorizontal className="h-4 w-4" />
      </Menu>
    </header>
  );
}
