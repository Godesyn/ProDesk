import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ArrowDown, Loader2, Paperclip, RotateCw, X } from 'lucide-react';
import type { PendingMessage } from '@shared/pages/chat/pending-messages';
import { useStickToBottom } from '@shared/pages/chat/stick-to-bottom';
import { Spec } from '../primitives';
import { MessageRow, type BeadPerson, type RowMessage } from './MessageRow';
import { clockTime, sameRun, shouldShowTimeDivider, timeDividerLabel } from '../../lib/format';
import { rememberScroll, recallScroll } from '../../stores/scroll-memory';
import { usePrefersReducedMotion } from '../../lib/a11y';

/**
 * The transcript.
 *
 * This file owns scroll orchestration and nothing else — it is the one place in
 * the app allowed to be complicated, because bottom-anchored virtualised lists
 * with prepend-without-jump are genuinely hard and every shortcut here shows up
 * as a visible defect. The traps marked TRAP N below are the ones the shared
 * MessagePanel discovered the expensive way.
 */

/** Virtuoso needs a large base so `firstItemIndex` can be decremented on prepend. */
const START_INDEX = 100_000;

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'new'; key: string }
  | { kind: 'msg'; key: string; m: RowMessage; runStart: boolean; showMeta: boolean }
  | { kind: 'pending'; key: string; p: PendingMessage };

type Props = {
  threadId: string;
  meId: string | null;
  /** Newest-first, exactly as the infinite query returns it. */
  messages: RowMessage[];
  pending: PendingMessage[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Only an anchored window has anything newer — the live one is at the end. */
  hasNewer: boolean;
  loadingNewer: boolean;
  onLoadNewer: () => void;
  /** First unread message id, or null when caught up. */
  firstUnreadId: string | null;
  beadsByMessageId: Map<string, BeadPerson[]>;
  reactionsByMessageId: Map<string, { emoji: string; count: number; mine: boolean }[]>;
  /** Quoted originals that live outside the loaded window (null = gone). */
  quotedById: Map<string, { senderName: string | null; content: string | null; type: string } | null>;
  editableUntil: number;
  /**
   * The OLDEST last-read timestamp across every other member, so the double tick
   * means "read by everyone" rather than "read by the fastest person in the
   * group". Mirrors the workspace panel's `allOthersLastReadAt`.
   */
  allOthersLastReadAt: number;
  /** Names of everyone currently typing — the footer indicator. */
  typingNames: string[];
  flashId: string | null;
  onReact: (messageId: string, emoji: string) => void;
  /** Receives the trigger's viewport anchor so the grid floats beside it. */
  onOpenPicker: (messageId: string, anchor: { x: number; y: number }) => void;
  onReply: (m: RowMessage) => void;
  onForward: (m: RowMessage) => void;
  onEdit: (m: RowMessage) => void;
  onDelete: (m: RowMessage) => void;
  onOpenMedia: (messageId: string) => void;
  /** Press-and-hold / right-click on a message — opens the action sheet. */
  onLongPress: (m: RowMessage) => void;
  onJumpTo: (messageId: string) => void;
  onRetryPending: (p: PendingMessage) => void;
  onDiscardPending: (p: PendingMessage) => void;
  /** Fired when the transcript is at the live edge, so the room can mark read. */
  onAtBottom: (atBottom: boolean) => void;
  /**
   * "Take me to the end." Bumped by the room on every send of yours, and on an
   * incoming message when you were already at the live edge — see Room.tsx for
   * why that test cannot be made down here. The workspace panel expresses the
   * same rule with an internal `wantBottomRef`; the decision lives in a different
   * component here, so it arrives as a nonce.
   */
  goToEndNonce: number;
  /**
   * Bumped when the live window dropped its oldest pages to stay bounded (see
   * cache.ts#MAX_LIVE_MESSAGES). Folded into the Virtuoso key, because
   * `firstItemIndex` may only ever DECREASE and removing rows from the FRONT of
   * a live instance's data corrupts its index map — the same documented
   * constraint that forces a remount on re-anchor. The room only ever trims
   * while the reader is at the live edge, so the remount lands them exactly
   * where they already were.
   */
  windowNonce: number;
  /**
   * Non-null when the transcript is showing a window centred on one message
   * rather than the live edge. Two things change: the opening scroll targets the
   * anchor instead of the bottom, and the jump pill offers to leave.
   */
  anchorId: string | null;
  /** Drop the anchor and return to the live edge. */
  onGoToLatest: () => void;
  /**
   * The reader has READ THEIR WAY OUT of an anchored window: they scrolled to its
   * end and there is nothing newer left to page in, so the window they are
   * looking at IS the live edge. Same destination as `onGoToLatest`, arrived at
   * by scrolling rather than by pressing the pill — see the effect that fires it.
   */
  onReachedLiveEdge: () => void;
};

export function MessageList(props: Props) {
  const {
    threadId,
    meId,
    messages,
    pending,
    hasOlder,
    loadingOlder,
    onLoadOlder,
    hasNewer,
    loadingNewer,
    onLoadNewer,
    firstUnreadId,
    beadsByMessageId,
    reactionsByMessageId,
    quotedById,
    editableUntil,
    allOthersLastReadAt,
    typingNames,
    flashId,
    onAtBottom,
    goToEndNonce,
    windowNonce,
    anchorId,
    onGoToLatest,
    onReachedLiveEdge,
  } = props;

  const virtuoso = useRef<VirtuosoHandle>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const [firstItemIndex, setFirstItemIndex] = useState(START_INDEX);
  const [hasNewBelow, setHasNewBelow] = useState(false);

  // TRAP 6 — every scroll ref must reset on a thread change. Miss one and thread
  // two opens part-way through thread one's history.
  const didInitialScroll = useRef(false);
  /** The rows these two were last computed against. See TRAP 1. */
  const seenRows = useRef<Row[] | null>(null);
  /** The row the viewport is measured from when older pages land. See TRAP 1. */
  const frontAnchor = useRef<{ key: string; index: number } | null>(null);

  /**
   * The list's identity. A different thread, a different anchor or a trimmed
   * window is a different LIST, not a mutation of this one — see the Virtuoso
   * `key` below for why that distinction is load-bearing.
   */
  const listKey = `${threadId}:${anchorId ?? 'live'}:${windowNonce}`;

  /**
   * TRAP 7 — a programmatic scroll lands SHORT, and stickiness is what survives it.
   *
   * When we scroll to the end the content's real height is not yet known: the
   * bubble's text reflows, an image decodes, an attachment card measures, the
   * avatar loads — all AFTER the scroll has run. The same is true of everything
   * that happens later: a read receipt appears under the newest bubble, someone
   * starts typing, the composer grows a reply banner or an attachment strip, the
   * mobile keyboard opens. Each one moves the end of the content away from the
   * viewport without the reader doing anything.
   *
   * This used to be fought with a settle window and a wheel sniffer, and the
   * arithmetic was still the source of truth — so any growth taller than the
   * threshold un-stuck a transcript the reader had never scrolled. Now "am I at
   * the end" is INTENT, held by the hook: only a scroll over a stable layout
   * changes it, and while it holds, every re-measure and every viewport resize
   * re-pins. See stick-to-bottom.ts.
   */
  const pin = useCallback((behavior: 'auto' | 'smooth' = 'auto') => {
    const v = virtuoso.current;
    if (!v) return;
    // Jump the scroller itself first, synchronously, so an instant pin never
    // paints an intermediate position — scrollToIndex('LAST') aligns the last
    // ITEM's end, which leaves the footer (typing indicator plus its spacer)
    // below the fold, and that gap is enough to read as "scrolled up" for a
    // frame. A smooth pin is skipped here on purpose: it is the reader watching
    // the animation, and clobbering scrollTop would cancel it.
    const el = scroller.current;
    if (el && behavior === 'auto') el.scrollTop = el.scrollHeight;
    v.scrollToIndex({ index: 'LAST', align: 'end', behavior });
    // Virtualised heights are estimates until the rows render, so the first
    // scroll lands at the estimated end. One more frame, after they measured.
    requestAnimationFrame(() => v.scrollTo({ top: 1e9, behavior }));
  }, []);

  /**
   * The AUTOMATIC pin — what the hook calls when the content or the viewport
   * moved under a stuck transcript. Deliberately not the same thing as the
   * reader asking to go to the end (`goToEnd`), because of the guard:
   *
   * the end of an anchored WINDOW is not the end of the CONVERSATION. Pinning
   * there re-triggers `endReached`, which fetches the next page forward, which
   * grows the content, which pins again — a cascade that pages the archive from
   * 2024 to now, thirty messages at a time, while the reader watches. So while
   * there is anything newer to fetch, a growth is left below the fold where it
   * belongs and the reader keeps reading forward at their own pace.
   */
  const hasNewerRef = useRef(hasNewer);
  hasNewerRef.current = hasNewer;
  const pinNow = useCallback(() => {
    if (hasNewerRef.current) return;
    // The scroller alone, not the full `pin` — when a transcript is already
    // stuck the last row is by definition rendered, so asking the virtualiser to
    // scroll to it again is work that buys nothing and re-indexes the list on
    // every re-measure. Setting scrollTop past the end clamps to the true end.
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const stick = useStickToBottom({
    scroller,
    resetKey: listKey,
    pin: pinNow,
    // An anchored window OPENS in the middle of history. Saying so at mount
    // rather than correcting it in an effect is what stops the transcript from
    // treating that first commit as "at the live edge" — which, now that
    // reaching the live edge drops the anchor, would bounce the jump straight
    // back to the present.
    initialStuck: anchorId === null,
  });

  /**
   * Oldest-first for display, DEDUPED and SORTED.
   *
   * The query returns newest-first because it pages backwards through history,
   * so a plain reverse used to be enough. It is not once the transcript can page
   * in two directions: a window fetched with `around` and a page fetched forward
   * from it are assembled by react-query into one `pages` array, and a refetch of
   * an infinite query re-runs every stored page param against a thread that has
   * moved on. Any overlap between two pages then renders the same message twice
   * (duplicate React keys, which Virtuoso resolves by showing garbage), and any
   * mis-ordering shows up as messages apparently skipped.
   *
   * Dedupe by id and sort by the same (timestamp, id) compound key the server
   * pages on, so the transcript is correct regardless of how the pages arrived.
   * A few hundred rows is nothing next to the class of bug it removes.
   */
  const ordered = useMemo(() => {
    const seen = new Set<string>();
    // Decorate-sort-undecorate. The comparator used to parse both timestamps on
    // every comparison, i.e. O(n log n) Date constructions over a window that can
    // hold hundreds of messages — paid again on every arriving message. Parsing
    // once per message up front is the same result for a fraction of the work,
    // and it is the hot path precisely when the app is busiest.
    const keyed: { m: RowMessage; at: number }[] = [];
    for (const m of messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const at = new Date(m.timestamp).getTime();
      keyed.push({ m, at: Number.isNaN(at) ? 0 : at });
    }
    keyed.sort((a, b) => (a.at === b.at ? a.m.id.localeCompare(b.m.id) : a.at - b.at));
    return keyed.map((k) => k.m);
  }, [messages]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let prev: RowMessage | undefined;
    ordered.forEach((m, i) => {
      if (shouldShowTimeDivider(prev?.timestamp ?? null, m.timestamp)) {
        out.push({ kind: 'day', key: `day-${m.id}`, label: timeDividerLabel(m.timestamp) });
        prev = undefined; // a new day always starts a new run
      }
      if (firstUnreadId && m.id === firstUnreadId) {
        out.push({ kind: 'new', key: `new-${m.id}` });
        prev = undefined;
      }
      // Collapse the timestamp into runs exactly as the workspace panel does:
      // print it on the NEWEST message of a group only — i.e. when there is
      // nothing below, the next message is a different speaker, or more than a
      // minute passed. Printing it on every line turns a five-message burst into
      // five identical clocks.
      const next = ordered[i + 1];
      const showMeta =
        !next ||
        next.senderId !== m.senderId ||
        next.type === 'system' ||
        new Date(next.timestamp).getTime() - new Date(m.timestamp).getTime() > 60_000;
      out.push({ kind: 'msg', key: m.id, m, runStart: !sameRun(prev, m), showMeta });
      prev = m;
    });
    // A pending bubble whose confirmed row has ALREADY landed must not render.
    //
    // The optimistic row and the server row share a client-generated uuid on
    // purpose, and the realtime echo routinely beats the send mutation's own
    // response back to us — so between those two moments the same message was
    // drawn twice, once faded with a spinner and once for real. Invisible on a
    // fast connection, and permanently on screen for as long as the round trip
    // takes on a slow one, which is exactly when a user is most likely to press
    // send again. The pending queue is cleared by the mutation's own success
    // handler; this only decides what is DRAWN in the gap.
    const landed = new Set(ordered.map((m) => m.id));
    for (const p of pending) {
      if (landed.has(p.id)) continue;
      out.push({ kind: 'pending', key: p.id, p });
    }
    return out;
  }, [ordered, pending, firstUnreadId]);

  /** Take the reader to the end and DECLARE that that is where they want to be. */
  const goToEnd = useCallback(
    (behavior: 'auto' | 'smooth' = 'auto') => {
      stick.setStuck(true);
      setHasNewBelow(false);
      pin(behavior);
    },
    [pin, stick.setStuck],
  );

  /* ── Thread switch, or a re-anchor: reset everything ─────────────────── */
  /**
   * DURING RENDER, not in an effect — and that difference was a bug.
   *
   * `anchorId` belongs here alongside `threadId`: re-anchoring swaps the entire
   * data set for a different slice of history, so every scroll ref describes a
   * list that no longer exists, `didInitialScroll` included (resetting it is what
   * lets the opening scroll run again and land on the anchor).
   *
   * Doing it in an effect meant the freshly-keyed Virtuoso had ALREADY rendered
   * once with the previous list's `firstItemIndex`, and then saw that value jump
   * back up when the effect ran. `firstItemIndex` may only ever decrease — that
   * is a documented constraint — and violating it corrupts the index map, which
   * is what produced repeated rows, skipped rows and a scroll landing nowhere.
   *
   * Setting state during render of the SAME component is the supported React
   * pattern for deriving state from props: it re-renders immediately, before
   * anything is committed, so the new list's first render already has the base.
   */
  const listKeyRef = useRef(listKey);
  if (listKeyRef.current !== listKey) {
    listKeyRef.current = listKey;
    seenRows.current = null;
    frontAnchor.current = null;
    didInitialScroll.current = false;
    setFirstItemIndex(START_INDEX);
    setHasNewBelow(false);
    // Same reasoning as `initialStuck`, for the case where the list is REUSED
    // rather than remounted (a trimmed live window keeps its data, so this
    // component stays mounted while its Virtuoso instance is replaced).
    stick.setStuck(anchorId === null);
  }

  /**
   * TRAP 1 — prepending older pages must not move the viewport.
   *
   * IN THE SAME COMMIT AS THE DATA, which is the whole of it. `firstItemIndex`
   * is how Virtuoso is told "these rows went on the FRONT, keep the reader where
   * they are"; it only means that if the new `data` and the new index arrive in
   * one render. Computing it in an effect delivered them in two: Virtuoso first
   * saw thirty extra rows at the front with the index unchanged — which says
   * they were appended, so every virtual index now points at a row thirty places
   * earlier — rendered that, and only then got the correction. The reader was
   * looking at a message and it was replaced by one from half an hour before it.
   *
   * MEASURED BY FINDING THE ROW WE WERE ANCHORED ON, not by differencing
   * lengths. Rows are not messages: a page of thirty messages arrives as thirty
   * rows PLUS its day dividers, and the divider that used to sit above our
   * anchor can DISAPPEAR when the page before it turns out to be the same day.
   * The anchor's new index is, by definition, exactly how many rows are now
   * above it — which is the shift, and it stays correct when a realtime message
   * lands at the far end in the same commit.
   */
  if (seenRows.current !== rows) {
    seenRows.current = rows;
    const anchor = frontAnchor.current;
    if (anchor) {
      const now = rows.findIndex((r) => r.key === anchor.key);
      const delta = now - anchor.index;
      // `now < 0` is the front being TRIMMED rather than extended, which only
      // happens with a remount (see `windowNonce`) — nothing to compensate.
      if (now >= 0 && delta > 0) setFirstItemIndex((i) => i - delta);
    }
    // Anchor on the first MESSAGE, never on whatever row happens to be first: a
    // day divider is derived from its neighbours and can vanish under us.
    const at = rows.findIndex((r) => r.kind === 'msg');
    frontAnchor.current = at >= 0 ? { key: rows[at].key, index: at } : null;
  }

  /**
   * "TAKE ME TO THE END" — the room's word for it, which outranks stickiness.
   *
   * Rules 2 and 3 — stay at the end when a message arrives if you were already
   * there, don't move an inch if you weren't — are no longer this effect's job:
   * they fall straight out of the sticky flag, because an append is a height
   * change like any other and only a pinned transcript follows one.
   *
   * What is left is the case stickiness cannot express, which is intent that
   * CONTRADICTS the current position: you send a message while scrolled up in
   * history, or you reply to something you scrolled up to find. Both mean "I am
   * done reading back", so the room bumps a nonce and this re-declares the
   * transcript stuck rather than measuring anything.
   *
   * Keyed on the nonce ALONE, not on rows.length: a length that happens to come
   * out unchanged (a confirmed row replacing its optimistic twin in one commit)
   * would otherwise swallow the intent and fire it later against an unrelated
   * message.
   */
  useEffect(() => {
    if (goToEndNonce === 0) return;
    const raf = requestAnimationFrame(() => goToEnd('auto'));
    return () => cancelAnimationFrame(raf);
  }, [goToEndNonce, goToEnd]);

  /**
   * The live edge, reported to the room from ONE source of truth.
   *
   * Marking the thread read, and deciding whether an arriving message should be
   * followed, are both "is the reader at the live edge?" questions — and they
   * used to be answered by Virtuoso's `atBottomStateChange`, which fires for two
   * indistinguishable reasons: the reader scrolled, or the content grew out from
   * under a pinned viewport. Answering from the sticky flag instead means a
   * transcript that is pinned stays "at the live edge" through every re-measure,
   * and one the reader scrolled away from never claims to be.
   */
  useEffect(() => {
    onAtBottom(stick.stuck);
    if (stick.stuck) setHasNewBelow(false);
  }, [stick.stuck, onAtBottom]);

  /**
   * READING YOUR WAY OUT of an anchored window is the same as pressing the pill.
   *
   * A window centred on some message in 2024 is a dead end by design: realtime
   * writes land in the LIVE cache entry, so a reader who pages forward to the
   * end of it is parked at the bottom of a transcript that has quietly stopped
   * moving — with "Back to latest" still offering to take them somewhere they
   * appear to already be. Once there is nothing newer left to fetch, the window
   * IS the live edge, so drop the anchor and let the live one take over.
   */
  useEffect(() => {
    if (!anchorId || !stick.stuck) return;
    if (hasNewer || loadingNewer) return;
    onReachedLiveEdge();
  }, [anchorId, stick.stuck, hasNewer, loadingNewer, onReachedLiveEdge]);

  /**
   * RULE 1 — opening a conversation lands at THE END. Not near it: past the last
   * message, past the typing slot, past the footer's padding.
   *
   * Three things were each enough to break that on their own, and all three are
   * fixed here:
   *
   *  1. `scrollToIndex(last, 'end')` aligns the last ITEM's edge, which leaves
   *     the footer below the fold. `pin` follows it with a scroller level push
   *     to the true maximum.
   *  2. The first screen is still measuring — images, avatars, reflow — so a
   *     single scroll lands short. Opening stuck means every one of those
   *     re-measures re-pins, for as long as the reader stays at the end.
   *  3. It used to aim at the unread divider when there was one, which meant a
   *     conversation with anything unread never opened at the end at all. The
   *     divider still renders where it belongs; it is no longer a scroll target.
   *
   * Returning to a thread you had scrolled up in DOES restore that position —
   * that memory is in-process only (stores/scroll-memory.ts), so it survives a
   * thread switch and never a reload. A refresh always ends up at the end.
   */
  useEffect(() => {
    if (didInitialScroll.current || rows.length === 0) return;
    didInitialScroll.current = true;

    const remembered = recallScroll(threadId);

    // TRAP 5 — double rAF. Virtuoso needs one frame to measure before a
    // programmatic scroll lands anywhere meaningful.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // An anchored window opens ON its anchor, centred, with history above and
        // below already loaded — that is the whole point of having fetched a
        // window rather than a page.
        if (anchorId) {
          const at = rows.findIndex((r) => r.kind === 'msg' && r.m.id === anchorId);
          if (at >= 0) {
            stick.setStuck(false);
            virtuoso.current?.scrollToIndex({ index: at, align: 'center' });
            return;
          }
        }
        if (remembered && !remembered.atBottom) {
          // Restoring mid-history. Saying so explicitly matters: without it the
          // first re-measure after the restore would pin them to the end, since
          // stickiness defaults to true and nothing they did has cleared it.
          stick.setStuck(false);
          virtuoso.current?.scrollToIndex({ index: remembered.index, align: 'start' });
          return;
        }
        goToEnd('auto');
      });
    });
    // `rows` (not rows.length) because the anchored branch searches it, and
    // `anchorId` because a re-anchor must run this again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, threadId, anchorId, goToEnd]);

  /* ── Jump to a quoted message ────────────────────────────────────────── */
  // `flashId` was doing half the job: tapping a reply's quote lit the original
  // up wherever it happened to be, including when that was off-screen — which
  // reads as "nothing happened". The flash is the CONFIRMATION; this is the
  // navigation, and one without the other is worse than neither.
  useEffect(() => {
    if (!flashId) return;
    const index = rows.findIndex((r) => r.kind === 'msg' && r.m.id === flashId);
    if (index < 0) return;
    virtuoso.current?.scrollToIndex({
      index,
      align: 'center',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
    // Deliberately keyed on flashId alone: `rows` changes on every realtime
    // patch, and re-running then would drag the reader back mid-scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashId]);

  /* ── A message arrived ───────────────────────────────────────────────── */
  const lastCountRef = useRef(rows.length);
  useEffect(() => {
    if (rows.length > lastCountRef.current && !stick.isStuck()) {
      setHasNewBelow(true);
    }
    lastCountRef.current = rows.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  return (
    <div className="relative min-h-0 flex-1">
      <Virtuoso
        /**
         * KEYED ON THE ANCHOR AS WELL AS THE THREAD, and this is not a nicety.
         *
         * `firstItemIndex` is Virtuoso's prepend mechanism and it may only ever
         * DECREASE — that is a documented constraint, not a convention. Every
         * older page walks it down; re-anchoring swapped the entire data set and
         * reset it back UP to the base, on a live instance whose internal index
         * map still described the previous list. The result was exactly the
         * reported damage: rows repeating, rows skipped, and the scroll position
         * jumping to nowhere.
         *
         * A window centred on some message in 2024 is a different list, not a
         * mutation of this one, so it gets a new instance — the same way a thread
         * switch does. The remount is what makes resetting the index legal.
         */
        key={listKey}
        ref={virtuoso}
        scrollerRef={(el) => {
          scroller.current = el as HTMLElement | null;
        }}
        className="cx-scroll"
        data={rows}
        firstItemIndex={firstItemIndex}
        // `{index, align:'end'}`, not a bare number: the bare form puts the last
        // item at the TOP of the viewport, which opens every conversation with
        // its newest message stranded against the header.
        initialTopMostItemIndex={{ index: Math.max(0, rows.length - 1), align: 'end' }}
        atTopThreshold={120}
        startReached={() => {
          if (hasOlder && !loadingOlder) onLoadOlder();
        }}
        // Reading FORWARD out of an anchored window. On the live transcript
        // `hasNewer` is false, so reaching the end costs nothing.
        endReached={() => {
          if (hasNewer && !loadingNewer) onLoadNewer();
        }}
        // No `atBottomStateChange` / `atBottomThreshold`, deliberately. Virtuoso
        // reports at-bottom from a measurement it takes AFTER the layout settled,
        // so it cannot tell "they scrolled up" from "the content grew under a
        // pinned viewport" — and every consumer of it here needs exactly that
        // distinction. The sticky flag is the one source of truth instead.
        rangeChanged={(range) => {
          // NEVER while anchored. The remembered anchor is a row index, and an
          // index into a window centred on 2024 means something else entirely in
          // the live transcript — restoring it there drops you at a random point
          // in the conversation. That was the second half of "scroll breaks after
          // following a reply".
          if (anchorId) return;
          rememberScroll(threadId, {
            index: range.startIndex - firstItemIndex,
            offset: 0,
            atBottom: stick.isStuck(),
          });
        }}
        // TRAP 4 — images, long text, read receipts and the typing indicator all
        // remeasure AFTER a scroll, so a list that was at the bottom ends up
        // parked mid-message. This is the CONTENT half of staying pinned (the
        // viewport half is the hook's ResizeObserver): re-pin while stuck, and
        // never move a reader who has scrolled away.
        totalListHeightChanged={stick.onContentHeightChanged}
        // TRAP 2 — `itemContent`'s index is VIRTUAL (offset by firstItemIndex),
        // so anything that indexes into an array with it renders garbage, but
        // only AFTER the first prepend, which makes it invisible in dev. Every
        // renderer below takes the `row` object and ignores the index entirely,
        // which sidesteps the trap instead of remembering to compensate for it.
        computeItemKey={(_index, row) => row.key}
        components={{
          // ONE FIXED HEIGHT for all three states. The header sits ABOVE the
          // reader, so every px it changes by moves the whole transcript under
          // them — and it changes at the worst possible moment: swapping the
          // label for a spinner as a page starts loading, and collapsing to a
          // plain spacer when the last page reveals there is no more history.
          // Both were a visible lurch on top of whatever the prepend did.
          Header: () => (
            <div className="flex h-11 items-center justify-center">
              {!hasOlder ? null : loadingOlder ? (
                <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--voice-3)' }} />
              ) : (
                <Spec>Older messages</Spec>
              )}
            </div>
          ),
          // The typing indicator lives INSIDE the scroller, at the end of the
          // conversation, exactly as the workspace panel places it — not as a
          // fixed bar floating above the composer, which fights the bottom anchor
          // every time it appears and disappears.
          //
          // The spacer under it is the "padding of the last message": at the end
          // of a conversation the newest bubble sits clear of the composer rather
          // than jammed against it.
          Footer: () => (
            <>
              {hasNewer && (
                <div className="py-4 text-center">
                  {loadingNewer ? (
                    <Loader2
                      className="mx-auto h-4 w-4 animate-spin"
                      style={{ color: 'var(--voice-3)' }}
                    />
                  ) : (
                    <Spec>Newer messages</Spec>
                  )}
                </div>
              )}
              <TypingIndicator names={typingNames} />
              <div className="h-8" />
            </>
          ),
        }}
        itemContent={(_index, row) => (
          <RenderRow row={row} meId={meId} props={props} editableUntil={editableUntil} allOthersLastReadAt={allOthersLastReadAt} flashId={flashId} beadsByMessageId={beadsByMessageId} reactionsByMessageId={reactionsByMessageId} quotedById={quotedById} ordered={ordered} onMediaLoad={stick.repin} />
        )}
      />

      {/* Jump-to-latest. Shown whenever you are scrolled up — not only when
          something new arrived — because "take me back to the end" is the more
          common of the two needs and the panel offers it unconditionally. The
          pigment dot is what flags that there IS something new below.

          While anchored it is the ONLY way out of a window centred somewhere in
          2024, so it is always offered there regardless of scroll position, and
          it drops the anchor rather than scrolling within the window.

          Driven by the sticky flag, not by a measurement: the pill appearing
          while the reader sits at the newest message — because a read receipt
          landed, or the composer grew — was the whole complaint. */}
      {(!stick.stuck || anchorId) && (
        <button
          type="button"
          onClick={() => {
            if (anchorId) return onGoToLatest();
            setHasNewBelow(false);
            // No `setStuck(true)` here: a smooth pin is an animation, and the
            // scroll events it produces re-derive stickiness on arrival. Saying
            // "we are stuck" before we get there would hide the pill, then show
            // it again mid-flight as those events land short of the end.
            pin(reducedMotion ? 'auto' : 'smooth');
          }}
          aria-label={hasNewBelow ? 'Jump to new messages' : 'Scroll to latest'}
          className="cx-pop press absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-semibold shadow-lg"
          style={
            hasNewBelow || anchorId
              ? { background: 'var(--live)', color: '#fff' }
              : { background: 'var(--room-2)', color: 'var(--voice)', border: '1px solid var(--wire-2)' }
          }
        >
          {hasNewBelow && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
          {anchorId ? 'Back to latest' : hasNewBelow ? 'New messages' : 'Jump to latest'}
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Animated "is typing…" dots — the workspace panel's, in Chat's palette. */
function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  const label = names.length === 1 ? `${names[0]} is typing` : `${names.length} people are typing`;
  return (
    <div className="flex items-center gap-2 px-5 pb-2 text-xs" style={{ color: 'var(--voice-2)' }}>
      <span className="flex items-center gap-0.5">
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]"
          style={{ background: 'var(--voice-2)' }}
        />
        <span
          className="h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]"
          style={{ background: 'var(--voice-2)' }}
        />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full" style={{ background: 'var(--voice-2)' }} />
      </span>
      {label}
    </div>
  );
}

/** Row dispatch, extracted so MessageList stays about scrolling. */
function RenderRow({
  row,
  meId,
  props,
  editableUntil,
  allOthersLastReadAt,
  flashId,
  beadsByMessageId,
  reactionsByMessageId,
  quotedById,
  ordered,
  onMediaLoad,
}: {
  row: Row;
  meId: string | null;
  props: Props;
  editableUntil: number;
  allOthersLastReadAt: number;
  flashId: string | null;
  beadsByMessageId: Map<string, BeadPerson[]>;
  reactionsByMessageId: Map<string, { emoji: string; count: number; mine: boolean }[]>;
  quotedById: Map<string, { senderName: string | null; content: string | null; type: string } | null>;
  ordered: RowMessage[];
  /**
   * An attachment or a link card in this row settled at its real size.
   *
   * TRAP 8 — the growth a virtualiser cannot see. Virtuoso reports total height
   * changes, but by the time an image inside an already-measured row decodes,
   * that report has been and gone (see stick-to-bottom.ts#repin for what went
   * wrong). This is the row telling the transcript directly, and it is why
   * sending a photo now lands at the end instead of one bubble above it.
   */
  onMediaLoad: () => void;
}) {
  if (row.kind === 'day') {
    // A centred pill, exactly as the workspace panel draws it.
    return (
      <div className="my-3 flex items-center gap-2 px-3">
        <span className="h-px flex-1" style={{ background: 'var(--wire)' }} />
        <span
          className="rounded-[10px] px-2.5 py-1 text-[10px] font-bold"
          style={{ background: 'var(--room-2)', color: 'var(--voice)' }}
        >
          {row.label}
        </span>
        <span className="h-px flex-1" style={{ background: 'var(--wire)' }} />
      </div>
    );
  }

  if (row.kind === 'new') {
    // Deliberately survives until it scrolls out of view rather than vanishing
    // the instant you arrive — the point is to show you where you stopped. Chat's
    // own addition; the workspace panel has no unread divider.
    return (
      <div className="my-3 flex items-center gap-2 px-3">
        <span className="h-px flex-1" style={{ background: 'var(--live-dim)' }} />
        <span
          className="rounded-[10px] px-2.5 py-1 text-[10px] font-bold"
          style={{ background: 'var(--live-soft)', color: 'var(--live)' }}
        >
          New
        </span>
        <span className="h-px flex-1" style={{ background: 'var(--live-dim)' }} />
      </div>
    );
  }

  if (row.kind === 'pending') {
    // The optimistic outgoing bubble. Mirrors the panel's PendingBubble: a normal
    // "mine" bubble at reduced opacity with a spinner where the tick goes, and on
    // failure a danger-coloured card carrying Retry / Discard inline.
    const p = row.p;
    const failed = p.status === 'failed';
    return (
      <div className="flex flex-col items-end px-3 pb-1.5 pt-3">
        <div
          className="w-fit max-w-full rounded-[var(--radius-md)] px-3 py-2 text-sm sm:max-w-[72%]"
          style={
            failed
              ? { background: 'var(--danger)', color: '#fff' }
              : { background: 'var(--voice)', color: 'var(--room)', opacity: 0.7 }
          }
        >
          {p.type !== 'text' && p.fileName && (
            <div
              className="mb-1 flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs"
              style={{ background: failed ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)' }}
            >
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{p.fileName}</span>
            </div>
          )}
          {p.content && <div className="speech whitespace-pre-wrap break-words">{p.content}</div>}

          {failed && (
            <div className="mt-1.5 flex items-center gap-2 border-t border-white/25 pt-1.5">
              <span className="flex-1 truncate text-[11px] text-white/80">
                {p.error ?? 'Not sent'}
              </span>
              <button
                type="button"
                onClick={() => props.onRetryPending(p)}
                className="press inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-white/20 px-2 py-1 text-[11px] font-medium"
              >
                <RotateCw className="h-3 w-3" /> Retry
              </button>
              <button
                type="button"
                onClick={() => props.onDiscardPending(p)}
                className="press inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-white/20 px-2 py-1 text-[11px] font-medium"
              >
                <X className="h-3 w-3" /> Discard
              </button>
            </div>
          )}
        </div>
        <span
          className="mt-0.5 flex items-center gap-1 text-[10px]"
          style={{ color: failed ? 'var(--danger)' : 'var(--voice-3)' }}
        >
          {clockTime(p.timestamp)}
          {!failed && <Loader2 className="h-3 w-3 animate-spin" />}
        </span>
      </div>
    );
  }

  const m = row.m;
  // The quoted original, from the loaded window if it happens to be there and
  // otherwise from the fetched previews. `undefined` means we haven't resolved it
  // yet (show a placeholder); `null` means it is genuinely gone.
  const quoted = m.replyToId
    ? (ordered.find((x) => x.id === m.replyToId) ?? quotedById.get(m.replyToId))
    : undefined;
  const age = Date.now() - new Date(m.timestamp).getTime();

  return (
    <MessageRow
      message={m}
      runStart={row.runStart}
      showMeta={row.showMeta}
      readByOthers={allOthersLastReadAt >= new Date(m.timestamp).getTime()}
      mine={!!meId && m.senderId === meId}
      beads={beadsByMessageId.get(m.id) ?? []}
      reactions={reactionsByMessageId.get(m.id) ?? []}
      replyTo={
        m.replyToId
          ? {
              senderName: quoted?.senderName ?? null,
              content: quoted?.content ?? null,
              // Only claim it's gone once we've actually looked.
              missing: quoted === null,
              type: quoted?.type ?? 'text',
            }
          : null
      }
      flash={flashId === m.id}
      canEdit={age < editableUntil}
      onReact={(emoji) => props.onReact(m.id, emoji)}
      onOpenPicker={(anchor) => props.onOpenPicker(m.id, anchor)}
      onReply={() => props.onReply(m)}
      onForward={() => props.onForward(m)}
      onEdit={() => props.onEdit(m)}
      onDelete={() => props.onDelete(m)}
      onOpenMedia={() => props.onOpenMedia(m.id)}
      onJumpToReply={() => m.replyToId && props.onJumpTo(m.replyToId)}
      onLongPress={() => props.onLongPress(m)}
      onMediaLoad={onMediaLoad}
    />
  );
}
