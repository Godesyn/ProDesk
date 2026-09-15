import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { usePendingMessages, type PendingMessage } from '@shared/pages/chat/pending-messages';
import { MUTE_OPTIONS, muteLabel } from '@shared/pages/chat/mute';
import { EmptyState, Spec } from '../primitives';
import { muteEntry, type MenuEntry } from '../Menu';
import { MessageList } from './MessageList';
import { ThreadHeader, isOnline, type HeaderMember } from './ThreadHeader';
import { ThreadDetail, type DetailTab } from './ThreadDetail';
import { ForwardDialog } from './ForwardDialog';
import { DropVeil } from './DropVeil';
import { MessageActionSheet } from './MessageActions';
import { Composer, type ComposerHandle } from '../composer/Composer';
import type { BeadPerson, RowMessage } from './MessageRow';
import { useChatMe } from '../../app/ChatProvider';
import { useChatInvalidate } from '../../app/use-invalidate';
import { useThreadPrefs } from '../../app/thread-prefs';
import { broadcastRead, useThreadStream, useTypingPing } from '../../app/use-thread-stream';
import { mergeMessageUpdate, trimToNewestPage } from '../../app/cache';
import { forgetScroll } from '../../stores/scroll-memory';
import { useTypingIds } from '../../stores/typing';
import { GRID, summarise } from '../../lib/emoji';
import { uploadAttachment, type Attachment } from '../../lib/upload';
import { announce } from '../../lib/a11y';
import { mediaSearch } from '../../app/routes';
import { placeBeside } from '@shared/lib/popover-anchor';

/**
 * One open conversation.
 *
 * This is the assembly point: it owns the queries, the live wire, the send path
 * and the small pieces of state a conversation needs (what you are replying to,
 * what you are editing, which message just flashed). Everything visual is
 * delegated — the transcript's scroll orchestration to MessageList, the row
 * design to MessageRow, the input to Composer.
 *
 * The read pointer is advanced only while you are actually AT the live edge, not
 * merely because the thread is open. A conversation left open in a background tab
 * has not been read, and marking it so is how people miss messages.
 */

const EDIT_WINDOW_MS = 15 * 60_000;

/** The keyset cursor `chat.messages` pages on — it carries its own direction. */
type MessageCursor = { timestamp: string; id: string; dir?: 'older' | 'newer' };

/** One line of a message that isn't in the loaded window — see `messagePreviews`. */
type QuotedPreview = { id: string; senderName: string | null; content: string | null; type: string };

export function Room({ threadId }: { threadId: string }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [location, navigate] = useLocation();
  /**
   * The list this room was opened from. Every "go back to the list" action reads
   * it, so leaving a conversation never silently moves you to a different tab —
   * an archived thread lives at `/archived/t/:id` precisely so this can be told
   * apart from the inbox's `/t/:id`.
   */
  const listPath = location.startsWith('/archived') ? '/archived' : '/';
  const confirm = useConfirm();
  const invalidate = useChatInvalidate();
  const prefs = useThreadPrefs();
  const { meId, meName, isMobile } = useChatMe();

  const [replyTo, setReplyTo] = useState<RowMessage | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  /** Which tab the thread-detail sheet opens on, or null when it is closed. */
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  /**
   * Which message the full reaction grid was opened for, and WHERE to float it.
   * The point comes from the control that opened it, so the grid appears beside
   * the message rather than covering the conversation — see ReactionPickerOverlay.
   */
  const [pickerFor, setPickerFor] = useState<{ id: string; anchor: { x: number; y: number } | null } | null>(null);
  /**
   * The message whose action sheet is open. Held HERE rather than per row so
   * there is one sheet in the tree instead of one per message — a virtualised
   * list recycles rows, and a sheet owned by a row would be torn out from under
   * the finger the moment the transcript re-measured.
   */
  const [actionsFor, setActionsFor] = useState<RowMessage | null>(null);
  /** The message the forward picker is open for, if any. */
  const [forwarding, setForwarding] = useState<RowMessage | null>(null);
  /**
   * "Take me to the end." Bumped in exactly two places, mirroring the workspace
   * panel's internal `wantBottomRef`:
   *
   *   • every send of MINE — unconditionally, wherever I was reading;
   *   • an INCOMING message, but only if I was already at the live edge.
   *
   * The at-the-edge test has to happen HERE, when the message lands, not after
   * the row is in the DOM: appending it grows the scroller, so by the time the
   * transcript re-measures, "am I at the bottom?" is already false and the view
   * strands itself one message behind. That is why this is a nonce and not
   * something the list works out for itself.
   */
  const [goToEndNonce, setGoToEndNonce] = useState(0);
  const goToEnd = useCallback(() => setGoToEndNonce((n) => n + 1), []);

  /* ── Drag and drop ───────────────────────────────────────────────────── */
  /**
   * Armed while a file is being dragged anywhere over the room.
   *
   * The counter is not optional. `dragenter` and `dragleave` fire for every
   * descendant the pointer crosses, so moving over a single message bubble
   * produces leave-then-enter and a naive boolean strobes the veil off and on
   * for the whole drag. Counting depth is the standard fix and the only one that
   * survives a virtualised list swapping rows in and out mid-drag.
   */
  const [dropArmed, setDropArmed] = useState(false);
  const dragDepth = useRef(0);
  const composerRef = useRef<ComposerHandle>(null);

  /** Is this drag carrying FILES? Dragging selected text or a link is not a drop. */
  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const disarm = () => {
    dragDepth.current = 0;
    setDropArmed(false);
  };

  /* ── Data ────────────────────────────────────────────────────────────── */

  /**
   * FOLLOWING A QUOTE, at any depth.
   *
   * `anchorId` switches the transcript from "the live edge, paging backwards" to
   * "a window centred on this one message, paging BOTH ways". Because it is part
   * of the query input it gets its own cache entry, so the live window is left
   * intact underneath and coming back to the present is a state change rather
   * than a refetch.
   *
   * The alternative — paging backwards until the quoted message happens to turn
   * up — is O(thread) round trips for something the user expects to be instant,
   * and is unusable the moment a conversation is a few thousand messages deep.
   */
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const pageOpts = {
    getNextPageParam: (last: { nextCursor: MessageCursor | null }) => last.nextCursor ?? undefined,
    // Reading FORWARD out of a jump. Null on the live window, which is already at
    // the newest message and has nothing newer to fetch.
    getPreviousPageParam: (first: { prevCursor: MessageCursor | null }) =>
      first.prevCursor ?? undefined,
  };

  /**
   * TAKE THE KEY FROM THE OPTIONS. Never rebuild it with `infiniteQueryKey(...)`.
   *
   * tRPC derives an infinite query's key from the WHOLE input minus the cursor,
   * so `infiniteQueryOptions({ threadId, limit: 30 })` is keyed on
   * `{ threadId, limit: 30 }` while `infiniteQueryKey({ threadId })` is keyed on
   * `{ threadId }`. `setQueryData` matches keys EXACTLY, so every realtime write
   * addressed with the hand-built key was landing in a cache entry no component
   * reads — and `appendMessage` bails on an entry with no pages, so it did
   * nothing at all, silently. Live messages only ever appeared because some
   * unrelated invalidation happened to refetch, which is why a message could
   * vanish between its optimistic row being dropped and that refetch landing.
   * (`invalidateQueries` matches partially, which is why those calls looked fine.)
   *
   * The live key is also deliberately NOT the anchored one: a brand-new message
   * belongs at the live edge, never spliced into a window centred on 2024.
   */
  const liveMessagesOpts = trpc.chat.messages.infiniteQueryOptions(
    { threadId, limit: 30 },
    pageOpts,
  );
  const liveMessagesKey = liveMessagesOpts.queryKey;

  const messagesQuery = useInfiniteQuery(
    anchorId
      ? trpc.chat.messages.infiniteQueryOptions(
          { threadId, limit: 30, around: anchorId },
          pageOpts,
        )
      : liveMessagesOpts,
  );
  const members = useQuery(trpc.chat.members.queryOptions({ threadId }));
  const readState = useQuery(trpc.chat.readState.queryOptions({ threadId }));
  const reactions = useQuery(trpc.chat.reactions.queryOptions({ threadId }));
  // Its own query, NOT a lookup into the inbox pages: the inbox is paginated, so
  // a conversation further down the list would simply not be there and the room
  // would fall back to "Conversation" once someone has more than thirty threads.
  const metaQuery = useQuery(trpc.chat.threadMeta.queryOptions({ threadId }));

  const send = useMutation(trpc.chat.send.mutationOptions());
  const markRead = useMutation(trpc.chat.markRead.mutationOptions());
  const editMessage = useMutation(trpc.chat.editMessage.mutationOptions());
  const deleteMessage = useMutation(trpc.chat.deleteMessage.mutationOptions());
  const leaveThread = useMutation(trpc.chat.leaveThread.mutationOptions());

  /**
   * Reactions land instantly.
   *
   * This is the one gesture people fire in bursts, and it used to wait for the
   * mutation AND a refetch of the whole thread's reaction set before the chip
   * moved — long enough that the natural reaction is to press again, which
   * toggles it straight back off. The row is written into the cache on the click
   * and rolled back only if the server refuses.
   *
   * `onMutate` is async and the options go INSIDE `mutationOptions({…})`; both
   * are load-bearing for the context type to infer (see app/thread-prefs.ts).
   */
  const reactionsKey = trpc.chat.reactions.queryKey({ threadId });
  const toggleReaction = useMutation(
    trpc.chat.toggleReaction.mutationOptions({
      onMutate: async ({ messageId, emoji }) => {
        const previous = qc.getQueryData(reactionsKey);
        qc.setQueryData(reactionsKey, (old) => {
          const rows = old ?? [];
          if (!meId) return rows;
          const has = rows.some(
            (r) => r.messageId === messageId && r.emoji === emoji && r.userId === meId,
          );
          return has
            ? rows.filter(
                (r) => !(r.messageId === messageId && r.emoji === emoji && r.userId === meId),
              )
            : [...rows, { messageId, emoji, userId: meId }];
        });
        return { previous };
      },
      onError: (e, _vars, ctx) => {
        qc.setQueryData(reactionsKey, ctx?.previous);
        toastError(e);
      },
      onSettled: () => void qc.invalidateQueries({ queryKey: reactionsKey }),
    }),
  );

  const { pending, add: addPending, update: updatePending, remove: removePending } =
    usePendingMessages(threadId);

  const messages = useMemo(
    () => (messagesQuery.data?.pages.flatMap((p) => p.items) ?? []) as unknown as RowMessage[],
    [messagesQuery.data],
  );

  const meta = metaQuery.data ?? null;

  /* ── Quoted replies whose original is outside the loaded window ───────── */
  /**
   * A quote has to be READABLE before you decide whether to follow it. The
   * original is often thousands of rows back, so rather than paging the archive
   * in to resolve one line, we ask the server for exactly the ids we cannot see.
   *
   * Accumulated in a map rather than derived per render so an id is fetched ONCE:
   * a plain `useQuery` keyed on "the ids I'm missing" would re-key every time a
   * page loaded and one of them stopped being missing.
   */
  const [quotedById, setQuotedById] = useState<Map<string, QuotedPreview | null>>(new Map());

  useEffect(() => {
    setQuotedById(new Map());
  }, [threadId]);

  const missingQuoteIds = useMemo(() => {
    const loaded = new Set(messages.map((m) => m.id));
    const out = new Set<string>();
    for (const m of messages) {
      if (m.replyToId && !loaded.has(m.replyToId) && !quotedById.has(m.replyToId)) {
        out.add(m.replyToId);
      }
    }
    return [...out].sort();
  }, [messages, quotedById]);

  const quotedQuery = useQuery({
    ...trpc.chat.messagePreviews.queryOptions({ messageIds: missingQuoteIds }),
    enabled: missingQuoteIds.length > 0,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!quotedQuery.data) return;
    setQuotedById((prev) => {
      const next = new Map(prev);
      // Seed every id we asked for as a MISS first. Without this, an id the
      // server declines to return (deleted, or in a thread we've since left)
      // stays "missing" forever and is re-requested on every render.
      for (const id of missingQuoteIds) if (!next.has(id)) next.set(id, null);
      for (const p of quotedQuery.data) next.set(p.id, p);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotedQuery.data]);

  /* ── Live wire ───────────────────────────────────────────────────────── */

  const atBottomRef = useRef(atBottom);
  atBottomRef.current = atBottom;
  // Read from inside the realtime callback, which closes over the first render.
  const anchorRef = useRef(anchorId);
  anchorRef.current = anchorId;

  /**
   * The transcript's identity, bumped when the live window sheds its oldest
   * pages (see `MAX_LIVE_MESSAGES`). MessageList folds it into its Virtuoso key,
   * because `firstItemIndex` may only ever DECREASE: shrinking the data from the
   * front on a live instance corrupts its index map. Only ever bumped while the
   * reader is at the live edge, where a remount lands them exactly where they
   * already were.
   */
  const [windowNonce, setWindowNonce] = useState(0);

  useThreadStream({
    threadId,
    meId,
    messagesKey: liveMessagesKey,
    // Read at FLUSH time, not at subscribe time — the batch may land long after
    // the channel was joined, and "is the reader at the end" is only meaningful
    // at the moment the messages arrive. Anchored in history counts as not at
    // the edge: the live window isn't even on screen.
    isAtLiveEdge: () => !anchorRef.current && atBottomRef.current,
    onWindowTrimmed: () => {
      // Drop the remembered position FIRST. It is a row index into the list as
      // it was before the trim, and the remount would restore it against a list
      // that is now shorter at the front — landing the reader at a random point
      // in the conversation. We only ever trim at the live edge, so the bottom
      // is both the correct answer and where they already were.
      forgetScroll(threadId);
      setWindowNonce((n) => n + 1);
    },
    // Called ONCE PER BATCH with the messages that were genuinely new and from
    // someone else. Per-message it was one mark-read and one scroll animation
    // each, which during a burst is thirty of both fighting over one viewport.
    onIncoming: () => {
      // A message arriving while you are reading a WINDOW of old history is not
      // arriving where you are looking: it lands in the live transcript, which is
      // not on screen. Neither marking it read nor scrolling would make sense.
      if (anchorRef.current) return;
      // Arriving while you're at the live edge means you've seen it — and the
      // view should follow it down. Arriving while you're scrolled up in history
      // must NOT quietly mark it read, and must NOT move you (the jump pill flags
      // it instead).
      if (!atBottomRef.current) return;
      doMarkRead();
      goToEnd();
    },
  });
  const pingTyping = useTypingPing(threadId, meId, meName);

  // A thread that was unmounted received nothing, so its cached pages can be
  // arbitrarily stale. Keep page zero for an instant paint and refetch behind it.
  useEffect(() => {
    trimToNewestPage(qc, liveMessagesKey);
    // Partial match on purpose here — this invalidates every window for the
    // thread, anchored ones included.
    void qc.invalidateQueries({ queryKey: trpc.chat.messages.infiniteQueryKey({ threadId }) });
    setReplyTo(null);
    setEditing(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (meta?.displayName) announce(`${meta.displayName} conversation open`);
  }, [meta?.displayName]);

  /**
   * Mark read — DEBOUNCED, WITH A CEILING, because it is called per arriving batch.
   *
   * Each call is a mutation whose success invalidates the read pointers, the
   * inbox, the thread meta and the unread badge, AND broadcasts `read` to every
   * other member, who each then refetch. Ten messages landing in a few seconds
   * meant ten mutations and forty refetches here plus a refetch on every other
   * screen in the room, while the transcript was also trying to follow the
   * messages down. That is what "the UI completely breaks" looks like from the
   * inside. One call per burst says exactly the same thing to the server.
   *
   * The ceiling is the half that a plain debounce is missing: a trailing timer
   * that is re-armed by every arrival NEVER fires while a conversation is
   * genuinely busy, so the thread would have stayed stuck at "unread" — badge
   * lit, divider showing — for as long as people kept talking, which is exactly
   * when you are most obviously reading it.
   */
  const MARK_READ_WAIT_MS = 400;
  const MARK_READ_MAX_WAIT_MS = 2_000;
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadSince = useRef(0);
  const doMarkRead = useCallback(() => {
    const now = Date.now();
    if (!markReadSince.current) markReadSince.current = now;
    const delay = Math.max(
      0,
      Math.min(MARK_READ_WAIT_MS, markReadSince.current + MARK_READ_MAX_WAIT_MS - now),
    );
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      markReadTimer.current = null;
      markReadSince.current = 0;
      markRead.mutate(
        { threadId },
        {
          onSuccess: () => {
            invalidate.afterRead();
            if (meId) broadcastRead(threadId, meId);
          },
        },
      );
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, meId]);

  useEffect(
    () => () => {
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (atBottom && (meta?.unreadCount ?? 0) > 0) doMarkRead();
  }, [atBottom, meta?.unreadCount, doMarkRead]);

  /* ── Derived view state ──────────────────────────────────────────────── */

  const typingIds = useTypingIds(threadId);

  /**
   * Where the `NEW` divider goes — RESOLVED ONCE PER THREAD, then frozen.
   *
   * It marks where you were when you opened the conversation. That is a fact
   * about the moment you arrived, so it must not move afterwards.
   *
   * It used to be a memo over `meta.unreadCount`, which changes on every arriving
   * message and again when mark-read zeroes it. The divider was therefore being
   * inserted and removed in the MIDDLE of the list several times a second during
   * a burst — rows appearing and vanishing under the virtualiser while it was
   * also trying to follow the conversation down.
   */
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const unreadResolved = useRef(false);

  useEffect(() => {
    unreadResolved.current = false;
    setFirstUnreadId(null);
  }, [threadId]);

  useEffect(() => {
    if (unreadResolved.current) return;
    // Wait for both to be real before committing — resolving against an empty
    // list would freeze the answer as "none".
    if (!meta || messages.length === 0) return;
    unreadResolved.current = true;
    const unread = meta.unreadCount ?? 0;
    if (unread <= 0) return;
    // messages are newest-first, so the nth-from-newest is the oldest unread.
    setFirstUnreadId(messages[Math.min(unread, messages.length) - 1]?.id ?? null);
  }, [meta, messages]);

  /**
   * The beads: every other member docked on the spine at their last-read message.
   * Built once per readState change rather than per row, so a thirty-message
   * screen costs one pass instead of thirty lookups.
   */
  const beadsByMessageId = useMemo(() => {
    const map = new Map<string, BeadPerson[]>();
    const byId = new Map((members.data ?? []).map((m) => [m.userId, m]));
    for (const r of readState.data ?? []) {
      if (!r.lastReadMessageId) continue;
      const person = byId.get(r.userId);
      if (!person) continue;
      const list = map.get(r.lastReadMessageId) ?? [];
      list.push({
        id: person.userId,
        name: person.name,
        avatarUrl: person.avatar ?? null,
        online: isOnline(person.lastSeenAt),
        typing: typingIds.includes(person.userId),
      });
      map.set(r.lastReadMessageId, list);
    }
    return map;
  }, [readState.data, members.data, typingIds]);

  const reactionsByMessageId = useMemo(
    () => summarise(reactions.data ?? [], meId),
    [reactions.data, meId],
  );

  /**
   * The double tick means "read by EVERYONE else", so it takes the OLDEST (min)
   * last-read pointer across the other members — someone who has never read
   * counts as 0 and holds the tick single until the whole group catches up. Max
   * would flip it the moment one person read. Same rule as the workspace panel.
   */
  const allOthersLastReadAt = useMemo(() => {
    const times = (readState.data ?? []).map((r) =>
      r.lastReadAt ? new Date(r.lastReadAt).getTime() : 0,
    );
    return times.length ? Math.min(...times) : 0;
  }, [readState.data]);

  /** Who is typing, by name — the footer indicator the workspace panel has. */
  const typingNames = useMemo(() => {
    const byId = new Map((members.data ?? []).map((m) => [m.userId, m.name]));
    return typingIds.map((id) => byId.get(id) ?? 'Someone');
  }, [typingIds, members.data]);

  /* ── Actions ─────────────────────────────────────────────────────────── */

  /**
   * Send.
   *
   * THE BUBBLE GOES UP FIRST, before any await. This used to upload every
   * attachment and await the mutation before anything appeared, so pressing Enter
   * on a normal message did nothing visible for as long as the round trip took —
   * which on a slow connection is long enough to press Enter again. The workspace
   * panel has always queued the optimistic row and returned immediately; this now
   * matches it.
   *
   * The optimistic bubble shares its id with the server row, so the realtime echo
   * dedupes against it and there is no flicker between "sending" and "sent". The
   * queue is sessionStorage-backed, so a failed send survives a reload and can
   * still be retried.
   */
  const doSend = ({ content, attachments }: { content: string; attachments: Attachment[] }) => {
    const replyToId = replyTo?.id;
    setReplyTo(null);
    goToEnd();

    // Attachments each become their own message, so a photo and a caption read as
    // two things rather than one bubble with a caption glued underneath. Each
    // gets its bubble immediately too — an upload is exactly the case where the
    // user most needs to see that something started.
    for (const attachment of attachments) {
      const id = crypto.randomUUID();
      addPending({
        id,
        threadId,
        content: null,
        type: attachment.kind,
        fileUrl: null,
        fileName: attachment.file.name,
        fileSize: attachment.file.size,
        thumbnailUrl: null,
        projectId: null,
        status: 'sending',
        timestamp: new Date().toISOString(),
      });
      void (async () => {
        try {
          const url = attachment.url ?? (await uploadAttachment(threadId, attachment, () => {}));
          await send.mutateAsync({
            threadId,
            id,
            type: attachment.kind,
            fileUrl: url,
            fileName: attachment.file.name,
            fileSize: attachment.file.size,
          });
          removePending(id);
          invalidate.afterMessageChange();
        } catch (e) {
          updatePending(id, { status: 'failed', error: (e as Error).message });
          toastError(e);
        }
      })();
    }

    if (!content) return;

    const id = crypto.randomUUID();
    addPending({
      id,
      threadId,
      content,
      type: 'text',
      fileUrl: null,
      fileName: null,
      fileSize: null,
      thumbnailUrl: null,
      projectId: null,
      replyToId: replyToId ?? null,
      status: 'sending',
      timestamp: new Date().toISOString(),
    });
    void (async () => {
      try {
        await send.mutateAsync({ threadId, id, content, type: 'text', replyToId });
        removePending(id);
        invalidate.afterMessageChange();
      } catch (e) {
        updatePending(id, { status: 'failed', error: (e as Error).message });
        toastError(e);
      }
    })();
  };

  /**
   * Take a drop. Files go to the composer's tray, not straight out as messages:
   * a drop is an ATTACH, and the caption you were about to write is the reason
   * you dropped it in this conversation rather than another one.
   *
   * Folders are refused by name. A dragged directory arrives in `files` as a
   * zero-byte entry with the folder's name, so sending it blind delivers an
   * empty file called "Screenshots" — saying what happened costs one line.
   */
  const acceptDrop = (dt: DataTransfer) => {
    const entries = Array.from(dt.items ?? []).map((item) =>
      typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null,
    );
    const folders = entries.filter((entry) => entry?.isDirectory).length;
    if (folders) {
      toast.error(
        folders === 1
          ? 'Folders can’t be sent — drop the files inside it.'
          : 'Folders can’t be sent — drop the files inside them.',
      );
    }
    // Match by index where the entry list lines up with the file list (it does
    // whenever `items` is supported), so a mixed drop of files AND a folder
    // still sends the files.
    const files = Array.from(dt.files ?? []).filter(
      (_file, i) => !entries[i]?.isDirectory,
    );
    if (!files.length) return;
    composerRef.current?.addFiles(files);
    composerRef.current?.focus();
  };

  const retryPending = async (p: PendingMessage) => {
    updatePending(p.id, { status: 'sending', error: undefined });
    try {
      await send.mutateAsync({
        threadId,
        id: p.id,
        content: p.content ?? undefined,
        type: p.type,
        fileUrl: p.fileUrl ?? undefined,
        fileName: p.fileName ?? undefined,
        fileSize: p.fileSize ?? undefined,
        replyToId: p.replyToId ?? undefined,
      });
      removePending(p.id);
      invalidate.afterMessageChange();
    } catch (e) {
      updatePending(p.id, { status: 'failed', error: (e as Error).message });
    }
  };

  /**
   * Follow a quote to its original, however far back it is.
   *
   * Two paths, and the second is the point of the whole `anchorId` machinery:
   *
   *   in the window   → just scroll and flash. No fetch.
   *   outside it      → re-anchor the transcript on that message. The server
   *                     returns a window CENTRED on it (`around`), so this costs
   *                     one query no matter how deep the message is, and the
   *                     reader can then scroll up OR down from where they land.
   *
   * `flashId` does double duty as before: MessageList scrolls to it and lights
   * it. When we re-anchor it simply lands after the new window renders.
   */
  const jumpTo = (messageId: string) => {
    if (!messages.some((m) => m.id === messageId)) setAnchorId(messageId);
    setFlashId(messageId);
    // Matches the `.cx-flash` keyframes (2s held, 1s fade). Cleared by identity
    // so a second jump during the first one doesn't cut the new highlight short.
    window.setTimeout(() => setFlashId((cur) => (cur === messageId ? null : cur)), 3000);
  };

  /**
   * Back to the live edge from an anchored window. Dropping the anchor swaps the
   * query back to the one that has been kept up to date by realtime all along,
   * so this is a state change and a scroll — not a reload of the conversation.
   */
  const goToLatest = useCallback(() => {
    // Drop the remembered position first. Leaving an anchor re-runs the opening
    // scroll (the list remounts), and that would otherwise restore wherever you
    // had last been in the LIVE window instead of taking you to the end you just
    // asked for.
    forgetScroll(threadId);
    setAnchorId(null);
    goToEnd();
  }, [goToEnd, threadId]);

  /**
   * Apply an edit or a delete to the loaded transcript ourselves.
   *
   * Both used to rely on `invalidate.afterMessageChange()` plus the realtime
   * UPDATE echo to bring the new text back, and neither is a guarantee: the echo
   * can be dropped (no replay after a reconnect) and the refetch is a round trip
   * you are staring at the stale text through. The result was an edit that
   * "didn't work" until a reload. Writing it into the cache makes the change land
   * on the click; the invalidation still runs behind it to reconcile.
   *
   * Applied to EVERY loaded window rather than one key: the edited row may be in
   * the live transcript, in an anchored window centred on it, or in both, and a
   * patch that misses is exactly the bug this exists to fix. The writer matches
   * by message id, so a window that doesn't hold it is a no-op.
   */
  const patchLoaded = useCallback(
    (messageId: string, patch: Partial<RowMessage>) => {
      const entries = qc.getQueriesData({
        queryKey: trpc.chat.messages.infiniteQueryKey({ threadId }),
      });
      for (const [key] of entries) {
        mergeMessageUpdate(qc, key, {
          id: messageId,
          ...patch,
        } as Parameters<typeof mergeMessageUpdate>[2]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, threadId],
  );

  const doDelete = async (m: RowMessage) => {
    // Never window.confirm — the shared promise-based dialog, destructive styling.
    const ok = await confirm({
      title: 'Delete this message?',
      description: 'Everyone in the conversation will see that it was deleted.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteMessage.mutate(
      { messageId: m.id },
      {
        onSuccess: () => {
          patchLoaded(m.id, {
            content: null,
            fileUrl: null,
            fileName: null,
            thumbnailUrl: null,
            deletedAt: new Date().toISOString(),
          });
          invalidate.afterMessageChange();
        },
        onError: (e) => toastError(e),
      },
    );
  };

  const editLast = () => {
    const mine = messages.find((m) => m.senderId === meId && !m.deletedAt && m.type === 'text');
    if (!mine) return;
    if (Date.now() - new Date(mine.timestamp).getTime() > EDIT_WINDOW_MS) return;
    setEditing({ id: mine.id, content: mine.content ?? '' });
  };

  /* ── Render ──────────────────────────────────────────────────────────── */

  const headerMembers: HeaderMember[] = (members.data ?? []).map((m) => ({
    userId: m.userId,
    name: m.name,
    avatar: m.avatar ?? null,
    lastSeenAt: m.lastSeenAt ?? null,
    isAdmin: m.isAdmin,
  }));

  const type = (meta?.type ?? 'direct') as 'direct' | 'group' | 'you';

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col"
      style={{ background: 'var(--room)' }}
      // The whole room is the drop target — see DropVeil for why that matters
      // more than it sounds. Note the veil itself is pointer-events:none, so
      // these keep firing while it is up.
      onDragEnter={(e) => {
        if (!dragHasFiles(e)) return;
        dragDepth.current += 1;
        setDropArmed(true);
      }}
      onDragOver={(e) => {
        if (!dragHasFiles(e)) return;
        // Without BOTH of these the browser refuses the drop and falls back to
        // opening the file as a page, which throws the user out of the app.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        if (!dragHasFiles(e)) return;
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) disarm();
      }}
      onDrop={(e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault();
        disarm();
        acceptDrop(e.dataTransfer);
      }}
    >
      <h1 className="cx-sr">{meta?.displayName ?? 'Conversation'}</h1>

      <ThreadHeader
        title={meta?.displayName ?? 'Conversation'}
        type={type}
        members={headerMembers}
        meId={meId}
        photoUrl={meta?.avatarUrl ?? null}
        // Back returns to the list you CAME from. From the archive that is
        // `/archived`, not the inbox — otherwise Back quietly changes which tab
        // you are in.
        onBack={isMobile ? () => navigate(listPath) : undefined}
        onOpenDetail={(tab) => setDetailTab(tab)}
        onSearch={() => navigate('/search')}
        menu={buildMenu()}
      />

      {messagesQuery.isLoading ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <Spec>Loading…</Spec>
        </div>
      ) : messages.length === 0 && pending.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center">
          <EmptyState
            line={
              type === 'you'
                ? 'Notes to yourself. Nobody else can see this.'
                : 'Say something.'
            }
          />
        </div>
      ) : (
        <MessageList
          threadId={threadId}
          meId={meId}
          messages={messages}
          pending={pending}
          hasOlder={!!messagesQuery.hasNextPage}
          loadingOlder={messagesQuery.isFetchingNextPage}
          onLoadOlder={() => void messagesQuery.fetchNextPage()}
          // Reading forward out of a jump. Only an anchored window has anything
          // newer to fetch; the live one is already at the end.
          hasNewer={!!messagesQuery.hasPreviousPage}
          loadingNewer={messagesQuery.isFetchingPreviousPage}
          onLoadNewer={() => void messagesQuery.fetchPreviousPage()}
          firstUnreadId={firstUnreadId}
          beadsByMessageId={beadsByMessageId}
          reactionsByMessageId={reactionsByMessageId}
          quotedById={quotedById}
          editableUntil={EDIT_WINDOW_MS}
          allOthersLastReadAt={allOthersLastReadAt}
          typingNames={typingNames}
          goToEndNonce={goToEndNonce}
          windowNonce={windowNonce}
          anchorId={anchorId}
          onGoToLatest={goToLatest}
          // Scrolling to the end of an anchored window means the same thing as
          // pressing the pill — the window has caught up with the live edge, so
          // hand back to the live transcript (which is the one realtime writes
          // to) instead of leaving them parked in a frozen slice of history.
          onReachedLiveEdge={goToLatest}
          flashId={flashId}
          onReact={(messageId, emoji) => toggleReaction.mutate({ messageId, emoji })}
          onOpenPicker={(messageId, anchor) => setPickerFor({ id: messageId, anchor })}
          onReply={(m) => {
            setReplyTo(m);
            // Replying to something you scrolled up to find should bring you back
            // to where the reply will land — otherwise you type into a composer
            // attached to a conversation you cannot see. The composer takes focus
            // on its own (see Composer's replyTo effect).
            goToEnd();
          }}
          onForward={setForwarding}
          onEdit={(m) => setEditing({ id: m.id, content: m.content ?? '' })}
          onDelete={(m) => void doDelete(m)}
          onOpenMedia={(messageId) =>
            navigate(`${window.location.pathname}?${mediaSearch(messageId)}`)
          }
          onLongPress={setActionsFor}
          onJumpTo={jumpTo}
          onRetryPending={(p) => void retryPending(p)}
          onDiscardPending={(p) => removePending(p.id)}
          onAtBottom={setAtBottom}
        />
      )}

      <Composer
        key={threadId}
        ref={composerRef}
        threadId={threadId}
        placeholder={
          type === 'you' ? 'Note to self…' : `Message ${meta?.displayName ?? ''}`.trim() + '…'
        }
        sending={send.isPending}
        replyTo={
          replyTo
            ? { id: replyTo.id, senderName: replyTo.senderName, content: replyTo.content }
            : null
        }
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        onSend={doSend}
        onSaveEdit={async (content) => {
          if (!editing) return;
          const { id } = editing;
          // Close edit mode FIRST. If the save fails we reopen it below with the
          // text intact — leaving the composer in edit mode through a round trip
          // is what let a second Enter fire a second edit at the same message.
          setEditing(null);
          try {
            await editMessage.mutateAsync({ messageId: id, content });
            patchLoaded(id, { content, editedAt: new Date().toISOString() });
            invalidate.afterMessageChange();
          } catch (e) {
            setEditing({ id, content });
            toastError(e);
          }
        }}
        onTyping={pingTyping}
        onEditLast={editLast}
      />

      <DropVeil active={dropArmed} />

      {detailTab && (
        <ThreadDetail
          threadId={threadId}
          type={type}
          title={meta?.displayName ?? 'Conversation'}
          members={headerMembers}
          meId={meId}
          tab={detailTab}
          onTab={setDetailTab}
          onOpenMedia={(messageId) =>
            navigate(`${window.location.pathname}?${mediaSearch(messageId)}`)
          }
          onJumpTo={(messageId) => {
            setDetailTab(null);
            jumpTo(messageId);
          }}
          onClose={() => setDetailTab(null)}
        />
      )}

      {forwarding && (
        <ForwardDialog
          message={forwarding}
          fromThreadId={threadId}
          onClose={() => setForwarding(null)}
        />
      )}

      {actionsFor && (
        <MessageActionSheet
          message={actionsFor}
          mine={!!meId && actionsFor.senderId === meId}
          canEdit={Date.now() - new Date(actionsFor.timestamp).getTime() < EDIT_WINDOW_MS}
          onReact={(emoji) => toggleReaction.mutate({ messageId: actionsFor.id, emoji })}
          onOpenPicker={() => setPickerFor({ id: actionsFor.id, anchor: null })}
          onReply={() => {
            setReplyTo(actionsFor);
            goToEnd();
          }}
          onForward={() => setForwarding(actionsFor)}
          onEdit={() => setEditing({ id: actionsFor.id, content: actionsFor.content ?? '' })}
          onDelete={() => void doDelete(actionsFor)}
          onClose={() => setActionsFor(null)}
        />
      )}

      {pickerFor && (
        <ReactionPickerOverlay
          anchor={pickerFor.anchor}
          onPick={(emoji) => {
            toggleReaction.mutate({ messageId: pickerFor.id, emoji });
            setPickerFor(null);
          }}
          onClose={() => setPickerFor(null)}
        />
      )}
    </section>
  );

  /**
   * The room's ⋯ menu — the same entries, in the same order, as a thread row's,
   * so the two never disagree about what a conversation can do. Everything here
   * is optimistic (app/thread-prefs.ts): the menu closes, the header updates, and
   * the server catches up.
   */
  function buildMenu(): MenuEntry[] {
    const items: MenuEntry[] = [];
    // Media and Files are offered in EVERY conversation, group or not: the
    // question "where's that PDF she sent me" has nothing to do with how many
    // people are in the thread. Members is the group-only entry.
    if (type === 'group') items.push({ label: 'Members', onClick: () => setDetailTab('members') });
    items.push({ label: 'Media', onClick: () => setDetailTab('media') });
    items.push({ label: 'Files', onClick: () => setDetailTab('files') });
    items.push({ kind: 'sep' });
    items.push({
      // "I'll deal with this later" — the one action that puts a conversation
      // back under Unread on purpose, and the reason the section is trustworthy.
      label: 'Mark as unread',
      onClick: () => prefs.markUnread(threadId, { onDone: () => navigate(listPath) }),
    });
    items.push({
      label: meta?.isPinned ? 'Unpin' : 'Pin to top',
      onClick: () => prefs.togglePin({ id: threadId, isPinned: !!meta?.isPinned }),
    });
    items.push(
      muteEntry(
        { isMuted: !!meta?.isMuted, mutedUntil: meta?.mutedUntil ?? null },
        MUTE_OPTIONS,
        (until) => prefs.mute(threadId, until),
        muteLabel(meta?.mutedUntil ?? null),
      ),
    );
    items.push({ kind: 'sep' });
    items.push(
      meta?.isArchived
        ? {
            label: 'Unarchive',
            onClick: () => prefs.archive(threadId, false),
          }
        : {
            label: 'Archive',
            hint: 'silences it',
            onClick: () => prefs.archive(threadId, true, { onDone: () => navigate(listPath) }),
          },
    );
    if (type === 'group') {
      items.push({ kind: 'sep' });
      items.push({
        label: 'Leave group',
        danger: true,
        onClick: () => void leaveGroup(),
      });
    }
    return items;
  }

  async function leaveGroup() {
    const ok = await confirm({
      title: 'Leave this group?',
      description: 'You’ll stop receiving messages and won’t be able to rejoin yourself.',
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    leaveThread.mutate(
      { threadId },
      {
        onSuccess: () => {
          invalidate.afterThreadChange();
          navigate(listPath);
        },
        onError: (e) => toastError(e),
      },
    );
  }
}

/**
 * The full reaction grid, opened from a message's `+` control.
 *
 * IT DOES NOT BLACK OUT THE ROOM. This used to be a centred modal behind
 * `--room-scrim` — the whole conversation dimmed and covered so you could pick a
 * 👍. That is the weight of a destructive confirmation applied to the lightest
 * gesture in the product, and it hid the very message you were reacting to, so
 * the one thing you needed while choosing was the one thing taken away.
 *
 * It is a popover now: a transparent layer that exists only to catch the click
 * that dismisses it, and a grid floated beside the control that opened it,
 * clamped into the viewport after measuring so it never hangs off an edge.
 * `aria-modal` went with the scrim — nothing behind it is inert any more.
 */
function ReactionPickerOverlay({
  anchor,
  onPick,
  onClose,
}: {
  /** Viewport point to float beside — the trigger's top-centre. */
  anchor: { x: number; y: number } | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure, then place. Estimating the grid's size and hoping is how a popover
  // ends up half off the bottom of a phone for whoever's message is near the fold.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const { width, height } = el.getBoundingClientRect();
    setPos(placeBeside(anchor, { width, height }));
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-label="Pick a reaction"
    >
      <div
        ref={ref}
        className="cx-pop absolute w-[268px] max-w-[calc(100vw-1rem)] rounded-[var(--radius-md)] p-2"
        style={{
          background: 'var(--room-2)',
          border: '1px solid var(--wire-2)',
          // Centred until measured (and when there is no anchor — the action
          // sheet has no single control to point at). `visibility` rather than a
          // conditional render, so the measure pass has something to measure.
          ...(pos
            ? { left: pos.left, top: pos.top }
            : anchor
              ? { left: 0, top: 0, visibility: 'hidden' as const }
              : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }),
        }}
      >
        <ReactionGrid onPick={onPick} />
      </div>
    </div>
  );
}

function ReactionGrid({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-0.5">
      {GRID.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          className="press grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[17px]"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
