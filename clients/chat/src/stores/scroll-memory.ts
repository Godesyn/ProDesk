/**
 * Where you were in each conversation.
 *
 * In memory only, and deliberately so. The transcript remounts on every thread
 * switch (`<Virtuoso key={threadId}>`), so the position has to outlive the
 * component — but it must NOT outlive the session. Restoring a scroll anchor
 * from yesterday drops you into the middle of a conversation that has moved on,
 * which is strictly worse than the two states that are always right: the bottom,
 * or the unread divider.
 *
 * Cleared on sign-out so the next person on a shared machine inherits nothing.
 */

export type ScrollAnchor = {
  /** Virtuoso data index (already adjusted for firstItemIndex by the caller). */
  index: number;
  offset: number;
  /** True when the user was pinned to the live edge — restore to the bottom. */
  atBottom: boolean;
};

const anchors = new Map<string, ScrollAnchor>();

export function rememberScroll(threadId: string, anchor: ScrollAnchor): void {
  anchors.set(threadId, anchor);
}

export function recallScroll(threadId: string): ScrollAnchor | null {
  return anchors.get(threadId) ?? null;
}

export function forgetScroll(threadId: string): void {
  anchors.delete(threadId);
}

export function forgetAllScroll(): void {
  anchors.clear();
}
