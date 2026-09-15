import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  ArrowUpRight,
  Download,
  FileText,
  Loader2,
  Play,
  UserPlus,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { Avatar, EmptyState, GhostButton, LiveButton, Spec } from '../primitives';
import { isOnline, type HeaderMember } from './ThreadHeader';
import { useChatInvalidate } from '../../app/use-invalidate';
import { threadPath } from '../../app/routes';
import { fileSize, inboxTime } from '../../lib/format';
import { downloadFile } from '@shared/lib/download';

/**
 * THE CONVERSATION'S DETAIL SCREEN.
 *
 * One sheet, three tabs, and the split between them is the split between three
 * genuinely different questions:
 *
 *   Members  who is here, and what can I do about it (rename, admin, remove)
 *   Media    show me the pictures — a grid, because you recognise a photo
 *   Files    give me that document — a list, because you recognise a name
 *
 * Media and Files are not one "Attachments" tab. A photo is identified by
 * looking at it and a spreadsheet is identified by reading its name, so one of
 * them wants a grid of thumbnails and the other wants rows of type, size and
 * date. Merging them produces a view that is bad at both.
 *
 * A right-side SHEET, not a modal: you should be able to read the conversation
 * while you manage it, and a dialog that blacks out the thing you are reasoning
 * about makes "wait, who said that?" an impossible question to answer.
 */

export type DetailTab = 'members' | 'media' | 'files';

export function ThreadDetail({
  threadId,
  type,
  title,
  members,
  meId,
  tab,
  onTab,
  onOpenMedia,
  onJumpTo,
  onClose,
}: {
  threadId: string;
  type: 'direct' | 'group' | 'you';
  title: string;
  members: HeaderMember[];
  meId: string | null;
  tab: DetailTab;
  onTab: (tab: DetailTab) => void;
  /** Open the lightbox on one message. */
  onOpenMedia: (messageId: string) => void;
  /** Close the sheet and scroll the transcript to the message. */
  onJumpTo: (messageId: string) => void;
  onClose: () => void;
}) {
  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Notes-to-self has no roster to manage, so the tab would be a dead row.
  const tabs: DetailTab[] = type === 'you' ? ['media', 'files'] : ['members', 'media', 'files'];
  const active = tabs.includes(tab) ? tab : tabs[0];

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      style={{ background: 'var(--room-scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Conversation details"
    >
      <aside
        className="flex h-full w-full max-w-[400px] flex-col"
        style={{
          background: 'var(--room-2)',
          borderLeft: '1px solid var(--wire-2)',
          // Full-bleed on a phone, so it owns the notch and the home indicator.
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <header
          className="flex shrink-0 items-center justify-between gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--wire)' }}
        >
          <span className="min-w-0">
            <Spec>{type === 'group' ? 'Group' : type === 'you' ? 'Notes' : 'Conversation'}</Spec>
            <span
              className="mt-0.5 block truncate text-[15px] font-bold tracking-tight"
              style={{ color: 'var(--voice)' }}
            >
              {title}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-full"
          >
            <X className="h-4 w-4" style={{ color: 'var(--voice-3)' }} />
          </button>
        </header>

        {/* Tabs. Ink, not pigment — pigment in this app means someone is here,
            and which panel you are looking at is not that. The active tab is
            carried by weight and a rule, the way the rest of the app separates
            live from resting. */}
        <div
          className="flex shrink-0 items-stretch px-2"
          style={{ borderBottom: '1px solid var(--wire)' }}
          role="tablist"
        >
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active === key}
              onClick={() => onTab(key)}
              className="relative px-3.5 py-2.5 text-[13px] font-semibold capitalize transition-colors"
              style={{ color: active === key ? 'var(--voice)' : 'var(--voice-3)' }}
            >
              {key}
              {active === key && (
                <span
                  className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full"
                  style={{ background: 'var(--voice)' }}
                />
              )}
            </button>
          ))}
        </div>

        {active === 'members' && (
          <MembersTab
            threadId={threadId}
            type={type}
            title={title}
            members={members}
            meId={meId}
            onClose={onClose}
          />
        )}
        {active === 'media' && (
          <MediaTab threadId={threadId} onOpenMedia={onOpenMedia} />
        )}
        {active === 'files' && <FilesTab threadId={threadId} onJumpTo={onJumpTo} />}
      </aside>
    </div>
  );
}

/* ── Members ─────────────────────────────────────────────────────────────── */

function MembersTab({
  threadId,
  type,
  title,
  members,
  meId,
  onClose,
}: {
  threadId: string;
  type: 'direct' | 'group' | 'you';
  title: string;
  members: HeaderMember[];
  meId: string | null;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const confirm = useConfirm();
  const invalidate = useChatInvalidate();

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(title);
  const [addEmail, setAddEmail] = useState('');

  const rename = useMutation(trpc.chat.renameThread.mutationOptions());
  const removeMember = useMutation(trpc.chat.removeMember.mutationOptions());
  const setAdmin = useMutation(trpc.chat.setThreadAdmin.mutationOptions());
  const addMembers = useMutation(trpc.chat.addMembers.mutationOptions());
  const discover = useMutation(trpc.chat.discoverByEmail.mutationOptions());
  const createDirect = useMutation(trpc.chat.createDirect.mutationOptions());

  const iAmAdmin = members.some((m) => m.userId === meId && m.isAdmin);
  const isGroup = type === 'group';

  const addByEmail = () => {
    const email = addEmail.trim().toLowerCase();
    if (!email) return;
    discover.mutate(
      { email },
      {
        onSuccess: (res) => {
          if (!res.found) {
            // The same single negative state as the New-conversation dialog —
            // "no account", "opted out" and "blocked you" are indistinguishable
            // by design, so this screen must not invent three messages.
            toast.error('No Prodesk account for that address.');
            return;
          }
          addMembers.mutate(
            { threadId, userIds: [res.user.id] },
            {
              onSuccess: () => {
                setAddEmail('');
                invalidate.afterMembersChange();
                toast.success(`${res.user.name} added`);
              },
              onError: (e) => toastError(e),
            },
          );
        },
        onError: (e) => toastError(e),
      },
    );
  };

  const remove = async (member: HeaderMember) => {
    const ok = await confirm({
      title: `Remove ${member.name}?`,
      description: 'They’ll lose access to this conversation and its history.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    removeMember.mutate(
      { threadId, userId: member.userId },
      { onSuccess: invalidate.afterMembersChange, onError: (e) => toastError(e) },
    );
  };

  const messageDirectly = (member: HeaderMember) => {
    createDirect.mutate(
      { userId: member.userId },
      {
        onSuccess: ({ threadId: id }) => {
          onClose();
          navigate(threadPath(id));
        },
        onError: (e) => toastError(e),
      },
    );
  };

  return (
    <div className="cx-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
      {isGroup && (
        <div className="mb-6">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                autoFocus
                className="h-9 min-w-0 flex-1 px-2.5 text-sm outline-none"
                style={{
                  background: 'var(--room-3)',
                  border: '1px solid var(--wire)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--voice)',
                }}
              />
              <LiveButton
                armed={name.trim().length > 0}
                disabled={rename.isPending}
                onClick={() =>
                  rename.mutate(
                    { threadId, name: name.trim() },
                    {
                      onSuccess: () => {
                        setRenaming(false);
                        invalidate.afterThreadChange();
                      },
                      onError: (e) => toastError(e),
                    },
                  )
                }
              >
                {rename.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </LiveButton>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h2
                className="min-w-0 flex-1 truncate text-[18px] font-bold tracking-tight"
                style={{ color: 'var(--voice)' }}
              >
                {title}
              </h2>
              {iAmAdmin && <GhostButton onClick={() => setRenaming(true)}>Rename</GhostButton>}
            </div>
          )}
        </div>
      )}

      <Spec>
        {members.length} member{members.length === 1 ? '' : 's'}
      </Spec>

      <ul className="mt-3">
        {members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center gap-3 py-2.5"
            style={{ borderBottom: '1px solid var(--wire)' }}
          >
            <Avatar name={m.name} url={m.avatar} size={32} online={isOnline(m.lastSeenAt)} />
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[13.5px] font-semibold"
                style={{ color: 'var(--voice)' }}
              >
                {m.name}
                {m.userId === meId ? ' (you)' : ''}
              </span>
              {m.isAdmin && <Spec>Admin</Spec>}
            </span>
            {m.userId !== meId && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => messageDirectly(m)}
                  className="press text-[12px]"
                  style={{ color: 'var(--voice-2)' }}
                >
                  Message
                </button>
                {isGroup && iAmAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setAdmin.mutate(
                          { threadId, userId: m.userId, isAdmin: !m.isAdmin },
                          {
                            onSuccess: invalidate.afterMembersChange,
                            onError: (e) => toastError(e),
                          },
                        )
                      }
                      className="press text-[12px]"
                      style={{ color: 'var(--voice-2)' }}
                    >
                      {m.isAdmin ? 'Unadmin' : 'Admin'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(m)}
                      className="press text-[12px]"
                      style={{ color: 'var(--danger)' }}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {isGroup && iAmAdmin && (
        <div className="mt-6">
          <Spec>Add someone</Spec>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="email"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addByEmail()}
              placeholder="name@company.com"
              className="h-9 min-w-0 flex-1 px-2.5 outline-none"
              style={{
                background: 'var(--room-3)',
                border: '1px solid var(--wire)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--voice)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12.5,
              }}
            />
            <LiveButton
              armed={addEmail.trim().length > 0}
              disabled={discover.isPending || addMembers.isPending}
              onClick={addByEmail}
            >
              {discover.isPending || addMembers.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              Add
            </LiveButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Media ───────────────────────────────────────────────────────────────── */

/**
 * Everything anyone looked at, as a grid.
 *
 * Square tiles at three across. Squares, not the pictures' own aspect ratios: a
 * grid you SCAN wants one predictable shape per cell, and the moment cells are
 * different heights the eye stops reading rows and starts reading a collage.
 * The full frame is one tap away in the lightbox.
 */
function MediaTab({
  threadId,
  onOpenMedia,
}: {
  threadId: string;
  onOpenMedia: (messageId: string) => void;
}) {
  const query = useAttachments(threadId, 'media');
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isLoading) return <TabLoading />;
  if (!items.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <EmptyState line="No photos or video here yet. Send the first one." />
      </div>
    );
  }

  return (
    <AttachmentScroller query={query}>
      <div className="grid grid-cols-3 gap-1 p-1">
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onOpenMedia(m.id)}
            className="press relative aspect-square overflow-hidden rounded-[var(--radius-sm)]"
            style={{ background: 'var(--room-3)' }}
            aria-label={
              m.type === 'video' ? `Play ${m.fileName ?? 'video'}` : `Open ${m.fileName ?? 'photo'}`
            }
          >
            {m.type === 'video' ? (
              <>
                {m.thumbnailUrl ? (
                  <img src={m.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  // No stored poster: the video element paints its own first
                  // frame from the metadata, which is a real preview for free.
                  <video
                    src={m.fileUrl ?? undefined}
                    muted
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                )}
                <span
                  className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full"
                  style={{ background: 'rgba(0,0,0,0.55)' }}
                >
                  <Play className="h-2.5 w-2.5" fill="white" color="white" />
                </span>
              </>
            ) : (
              <img
                src={m.thumbnailUrl ?? m.fileUrl ?? undefined}
                alt={m.fileName ?? ''}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            )}
          </button>
        ))}
      </div>
    </AttachmentScroller>
  );
}

/* ── Files ───────────────────────────────────────────────────────────────── */

/**
 * Everything else, as a list. A file is recognised by its NAME, its size and who
 * sent it, so all three are on the row and the row's primary action is Download
 * — the thing people came here to do. "Show in conversation" is the secondary,
 * for the other reason you open this tab: finding what was said about it.
 */
function FilesTab({
  threadId,
  onJumpTo,
}: {
  threadId: string;
  onJumpTo: (messageId: string) => void;
}) {
  const query = useAttachments(threadId, 'files');
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  if (query.isLoading) return <TabLoading />;
  if (!items.length) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center">
        <EmptyState line="Nothing has been filed here yet. Drop something in." />
      </div>
    );
  }

  return (
    <AttachmentScroller query={query}>
      <ul className="px-2 py-2">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)]"
              style={{ background: 'var(--room-3)' }}
            >
              <FileText className="h-4 w-4" style={{ color: 'var(--voice-2)' }} />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className="block truncate text-[13px] font-medium"
                style={{ color: 'var(--voice)' }}
              >
                {m.fileName ?? 'Attachment'}
              </span>
              <Spec>
                {[m.senderName, fileSize(m.fileSize), inboxTime(m.timestamp)]
                  .filter(Boolean)
                  .join(' · ')}
              </Spec>
            </span>
            <button
              type="button"
              onClick={() => onJumpTo(m.id)}
              aria-label="Show in conversation"
              title="Show in conversation"
              className="press grid h-8 w-8 shrink-0 place-items-center rounded-full"
              style={{ color: 'var(--voice-3)' }}
            >
              <ArrowUpRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void downloadFile(m.fileUrl ?? '', m.fileName)}
              aria-label={`Download ${m.fileName ?? 'attachment'}`}
              title="Download"
              className="press grid h-8 w-8 shrink-0 place-items-center rounded-full"
              style={{ color: 'var(--voice-2)' }}
            >
              <Download className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </AttachmentScroller>
  );
}

/* ── Shared plumbing ─────────────────────────────────────────────────────── */

function useAttachments(threadId: string, kind: 'media' | 'files') {
  const trpc = useTRPC();
  return useInfiniteQuery(
    trpc.chat.threadAttachments.infiniteQueryOptions(
      { threadId, kind, limit: 48 },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
}

/**
 * The scroll container for both tabs, with the "load the next page" trigger.
 *
 * A sentinel + IntersectionObserver rather than a scroll listener with
 * arithmetic: the two tabs have very different row heights, and any threshold in
 * pixels that is right for a 40px file row loads three pages at a time in a grid
 * of 120px tiles.
 */
function AttachmentScroller({
  query,
  children,
}: {
  query: ReturnType<typeof useAttachments>;
  children: React.ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
      {children}
      <div ref={sentinel} className="flex h-12 items-center justify-center">
        {isFetchingNextPage && (
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--voice-3)' }} />
        )}
      </div>
    </div>
  );
}

function TabLoading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center">
      <Spec>Loading…</Spec>
    </div>
  );
}
