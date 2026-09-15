import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Check, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { Avatar, GhostButton, GroupAvatar, LiveButton, Spec } from '../primitives';
import type { RowMessage } from './MessageRow';

/**
 * Forward a message into other conversations.
 *
 * A forward is a SEND, not a copy of a row: each target gets a genuinely new
 * message from you, which is the only version that behaves correctly downstream
 * — unread counts, digests, the other person's realtime, the inbox preview. The
 * alternative (duplicating the original row's identity) would break every one of
 * those in a different way.
 *
 * Attachments forward by URL rather than by re-upload. The file already lives in
 * the chat bucket and the recipients are members of a thread you are sending it
 * to, so a second copy would cost storage and buy nothing.
 *
 * What DOES survive the copy is the "Forwarded" marker (`chat_messages
 * .is_forwarded`, migration 0100): the send is stamped on every target so the
 * destination transcript can say the words were not written there. It is stamped
 * unconditionally, so forwarding something that was itself forwarded keeps the
 * marker rather than laundering it back into an original.
 *
 * Not carried: WHO wrote it originally. Forwarding out of a DM into a group
 * would otherwise name someone to people they never spoke to, and "Forwarded"
 * alone is the answer the rest of the category settled on.
 */
export function ForwardDialog({
  message,
  fromThreadId,
  onClose,
}: {
  message: RowMessage;
  /** Excluded from the list — forwarding into the thread you are reading is a no-op. */
  fromThreadId: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  const list = useInfiniteQuery(
    trpc.chat.inbox.infiniteQueryOptions(
      { limit: 30, filter: 'all' },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
  const send = useMutation(trpc.chat.send.mutationOptions());

  const threads = useMemo(() => {
    const pages = list.data?.pages ?? [];
    const all = [...(pages[0]?.pinned ?? []), ...pages.flatMap((p) => p.items)];
    const needle = query.trim().toLowerCase();
    return all
      .filter((t) => t.id !== fromThreadId)
      .filter((t) => !needle || t.displayName.toLowerCase().includes(needle));
  }, [list.data, query, fromThreadId]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const forward = async () => {
    if (picked.length === 0) return;
    setSending(true);
    // Sequential, not Promise.all: each send bumps unread counters and schedules
    // a digest, and firing ten at once at the rate limiter is how a legitimate
    // forward gets refused halfway through.
    let sent = 0;
    for (const threadId of picked) {
      try {
        await send.mutateAsync({
          threadId,
          id: crypto.randomUUID(),
          content: message.content ?? undefined,
          type: (message.type as 'text' | 'image' | 'video' | 'document') ?? 'text',
          fileUrl: message.fileUrl ?? undefined,
          fileName: message.fileName ?? undefined,
          fileSize: message.fileSize ?? undefined,
          thumbnailUrl: message.thumbnailUrl ?? undefined,
          forwarded: true,
        });
        sent += 1;
      } catch (e) {
        toastError(e);
      }
    }
    setSending(false);
    if (sent > 0) toast.success(sent === 1 ? 'Forwarded' : `Forwarded to ${sent} conversations`);
    onClose();
  };

  const preview = message.content ?? message.fileName ?? 'Attachment';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
      style={{ background: 'var(--room-scrim)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Forward message"
    >
      <div
        className="cx-pop flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-[var(--radius-md)]"
        style={{ border: '1px solid var(--wire-2)' }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <header
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--wire)' }}
        >
          <Spec>Forward to</Spec>
          <button type="button" onClick={onClose} aria-label="Close" className="press">
            <X className="h-4 w-4" style={{ color: 'var(--voice-3)' }} />
          </button>
        </header>

        {/* What you're forwarding, so a multi-select never ends up sending the
            wrong message to five people at once. */}
        <div className="px-5 pt-4">
          <div
            className="rounded-[var(--radius-sm)] border-l-2 px-3 py-2"
            style={{ borderColor: 'var(--live)', background: 'var(--room-3)' }}
          >
            <Spec>{message.senderName ?? 'Message'}</Spec>
            <p className="mt-0.5 line-clamp-2 text-[13px]" style={{ color: 'var(--voice-2)' }}>
              {preview}
            </p>
          </div>
        </div>

        <div className="px-5 pt-3">
          <span
            className="flex items-center gap-2 rounded-full px-2.5"
            style={{ background: 'var(--room-3)', height: 34 }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--voice-3)' }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              style={{ color: 'var(--voice)' }}
            />
          </span>
        </div>

        <div className="cx-scroll mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {list.isLoading ? (
            <p className="py-10 text-center">
              <Spec>Loading…</Spec>
            </p>
          ) : threads.length === 0 ? (
            <p className="py-10 text-center">
              <Spec>{query ? 'Nothing matches that' : 'No other conversations yet'}</Spec>
            </p>
          ) : (
            threads.map((t) => {
              const on = picked.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  aria-pressed={on}
                  className="flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-3 py-2 text-left transition-colors"
                  style={{ background: on ? 'var(--live-soft)' : 'transparent' }}
                >
                  {t.type === 'group' ? (
                    <GroupAvatar members={t.faces} photoUrl={t.avatarUrl} size={30} />
                  ) : (
                    <Avatar name={t.displayName} url={t.avatarUrl} size={30} />
                  )}
                  <span
                    className="min-w-0 flex-1 truncate text-[13.5px] font-medium"
                    style={{ color: 'var(--voice)' }}
                  >
                    {t.displayName}
                  </span>
                  <span
                    className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full"
                    style={{
                      border: `1.5px solid ${on ? 'var(--live)' : 'var(--wire-2)'}`,
                      background: on ? 'var(--live)' : 'transparent',
                    }}
                  >
                    {on && <Check className="h-3 w-3 text-white" />}
                  </span>
                </button>
              );
            })
          )}

          {list.hasNextPage && (
            <button
              type="button"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
              className="press w-full py-3"
            >
              <Spec>{list.isFetchingNextPage ? 'Loading…' : 'More conversations'}</Spec>
            </button>
          )}
        </div>

        <footer
          className="flex items-center justify-between gap-3 px-5 py-4"
          style={{ borderTop: '1px solid var(--wire)' }}
        >
          <Spec>{picked.length === 0 ? 'Pick a conversation' : `${picked.length} selected`}</Spec>
          <div className="flex items-center gap-2">
            <GhostButton onClick={onClose}>Cancel</GhostButton>
            <LiveButton
              armed={picked.length > 0}
              disabled={picked.length === 0 || sending}
              onClick={() => void forward()}
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Forward
            </LiveButton>
          </div>
        </footer>
      </div>
    </div>
  );
}
