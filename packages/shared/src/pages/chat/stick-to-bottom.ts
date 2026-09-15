import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * STICK TO BOTTOM — being at the end of a transcript is INTENT, not a measurement.
 *
 * Every "why am I not at the bottom any more?" bug in a chat UI comes from the
 * same mistake: asking `scrollHeight - scrollTop - clientHeight <= n` AFTER the
 * layout changed, and treating the answer as the reader's wish. That question is
 * unanswerable at that moment, because both of the reasons it can be false look
 * identical from the DOM:
 *
 *   the reader scrolled up          → they want to stay where they are
 *   something grew or the box shrank → they want to stay at the END
 *
 * and the second happens constantly in a chat: a read receipt appears under the
 * newest bubble, an image decodes, the typing indicator opens, the composer
 * grows a reply banner or an attachment strip, the textarea wraps to a second
 * line, the mobile keyboard opens, the window is resized. Every one of those
 * pushes the end of the content past the bottom of the viewport WITHOUT the
 * reader touching anything — and a post-hoc measurement then reports "not at the
 * bottom", strands the transcript mid-message and lights up a jump-to-latest
 * pill while the reader is, as far as they are concerned, at the latest message.
 *
 * So stickiness is held as state and only ever changed by the reader:
 *
 *   - A scroll event whose scrollHeight AND clientHeight are unchanged since the
 *     previous one is the reader moving through a stable list — that, and only
 *     that, re-evaluates the flag from the distance to the end. It covers every
 *     input there is (wheel, trackpad momentum, touch flick, scrollbar drag,
 *     PageUp, Home, find-in-page) without listening for any of them.
 *   - A scroll event that arrives together with a layout change is the layout's
 *     doing and is ignored.
 *   - While stuck, any layout change re-pins to the true end: the viewport
 *     resizing (watched here) and the content growing (reported by the caller,
 *     which is the one that knows when its virtualiser re-measured).
 *
 * This is the same model as `use-stick-to-bottom` and as Virtuoso's own chat
 * example, and it is why neither needs the timing hacks — settle windows, wheel
 * sniffing, "is this scroll ours?" flags — that a measurement-based transcript
 * accumulates. It replaced exactly those here.
 */

/**
 * How close to the end still counts as "at the end", in px.
 *
 * Under one line of text on purpose. Looser (the 120px this used to run with)
 * and reading a couple of lines back up counts as being at the live edge, so the
 * pill stays hidden and the thread keeps marking itself read while you are
 * reading history; tighter and a sub-pixel scroll position — which is what a
 * fractional device pixel ratio hands you — reads as "scrolled up".
 */
const DEFAULT_THRESHOLD_PX = 48;

export type StickToBottom = {
  /** Render-time truth, for the jump pill. */
  stuck: boolean;
  /** Callback-time truth. The ref, so listeners never close over a stale value. */
  isStuck: () => boolean;
  /**
   * Declare the intent directly. Two callers only: a scroll WE performed on the
   * reader's behalf (send, "jump to latest") sets true, and opening the
   * transcript somewhere that is not the end — an anchored window, a restored
   * position — sets false, before any measurement can guess wrong.
   */
  setStuck: (next: boolean) => void;
  /**
   * The content grew or shrank. Wire this to the virtualiser's own height
   * callback — that is the only thing that knows a row finished measuring.
   */
  onContentHeightChanged: () => void;
  /**
   * "Something just moved the end of the content and nothing else is going to
   * tell you about it." For the growth a virtualiser cannot report because it
   * happens INSIDE a row it has already measured — an image decoding, a video
   * resolving its metadata, a link preview's thumbnail arriving. Re-pins if, and
   * only if, the transcript is stuck; a no-op otherwise, so a row can call it
   * unconditionally on every media load.
   */
  repin: () => void;
};

export function useStickToBottom({
  scroller,
  resetKey,
  pin,
  initialStuck = true,
  threshold = DEFAULT_THRESHOLD_PX,
}: {
  /** The scrolling element. May be null until the virtualiser hands it over. */
  scroller: { current: HTMLElement | null };
  /**
   * The identity of the list being scrolled — thread, anchor, remount nonce.
   * Changing it rebinds the listeners, because the scroller element is a new
   * one after a remount.
   */
  resetKey: string;
  /** Scroll to the TRUE end, footer and all. Must be stable. */
  pin: () => void;
  /**
   * False when the list MOUNTS somewhere other than the end — a window centred
   * on a message from 2024, a restored position. Mount-time only, and it has to
   * be here rather than a `setStuck` in an effect: an effect is one commit late,
   * and one commit of "we are at the end" is enough for whatever watches this to
   * act on it.
   */
  initialStuck?: boolean;
  threshold?: number;
}): StickToBottom {
  const stuckRef = useRef(initialStuck);
  const [stuck, setStuckState] = useState(initialStuck);

  /**
   * The previous scroll event's layout, which is what makes a scroll
   * attributable. Not state: it is read and written inside a listener that must
   * not re-render anything.
   */
  const lastLayout = useRef({ scrollHeight: 0, clientHeight: 0 });

  const setStuck = useCallback((next: boolean) => {
    if (stuckRef.current === next) return;
    stuckRef.current = next;
    setStuckState(next);
  }, []);

  const isStuck = useCallback(() => stuckRef.current, []);

  const snapshot = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    lastLayout.current = { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
  }, [scroller]);

  // Read through a ref so `repin` can be identity-stable: it is handed down to
  // rows, and a callback that changes every render would defeat their memo.
  const pinRef = useRef(pin);
  pinRef.current = pin;

  /**
   * PIN NOW, AND AGAIN AFTER THE NEXT FRAME. The second one is not belt and
   * braces — it is the fix for the bug that stranded the transcript one
   * attachment short of the end.
   *
   * A pin is `scrollTop = scrollHeight`, so it is only as correct as
   * `scrollHeight` is at the moment it runs. Virtuoso reports a height change
   * from inside its own state commit, which can be BEFORE the browser has laid
   * the taller list out — so the pin reads the pre-growth height, lands at the
   * old end, and nothing fires again because the height change has already been
   * announced. The reader is left looking at the message above the one that just
   * arrived and has to scroll by hand: exactly the reported symptom, and exactly
   * why it only happened with images and attachments, whose rows grow late and
   * grow a lot.
   *
   * The second pin re-reads the height a frame later, when the layout is real.
   * It is skipped if the reader has un-stuck themselves in between, so it can
   * never drag anyone away from where they scrolled to.
   */
  const repin = useCallback(() => {
    if (!stuckRef.current) return;
    pinRef.current();
    requestAnimationFrame(() => {
      if (stuckRef.current) pinRef.current();
    });
  }, []);

  const onContentHeightChanged = useCallback(() => {
    snapshot();
    repin();
  }, [repin, snapshot]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    lastLayout.current = { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };

    const onScroll = () => {
      const scrollHeight = el.scrollHeight;
      const clientHeight = el.clientHeight;
      const prev = lastLayout.current;
      lastLayout.current = { scrollHeight, clientHeight };
      // Attribution, per the comment at the top of the file: a scroll that came
      // with a layout change is not the reader's decision, and re-deriving
      // stickiness from it is precisely the bug this hook exists to remove.
      if (scrollHeight !== prev.scrollHeight || clientHeight !== prev.clientHeight) return;
      setStuck(scrollHeight - el.scrollTop - clientHeight <= threshold);
    };

    // Both halves of "the end moved", watched the same way:
    //
    //  - the VIEWPORT shrinking or growing — the composer gaining a reply banner
    //    or an attachment strip, the textarea wrapping, the mobile keyboard, a
    //    window resize, a pane opening. The content did not move; the floor came
    //    up to meet it.
    //  - the CONTENT growing — an image decoding, markdown reflowing, a read
    //    receipt appearing, an AI reply streaming into the footer a token at a
    //    time. Watching the scroller's own content box catches all of it,
    //    including the growth a virtualiser reports through no callback of its
    //    own (a footer is not a row).
    const observer = new ResizeObserver(() => {
      lastLayout.current = { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      repin();
    });
    observer.observe(el);
    // Guarded because it reaches into the virtualiser's DOM: if the shape ever
    // changes we lose the content half and keep the viewport half, rather than
    // throwing. The caller's height callback covers the same ground.
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
    // `resetKey` is the dependency that matters: the scroller is a different
    // element after a remount, and `scroller.current` alone cannot say so.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, repin, setStuck, threshold]);

  return { stuck, isStuck, setStuck, onContentHeightChanged, repin };
}
