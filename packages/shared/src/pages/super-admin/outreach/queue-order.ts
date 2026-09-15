/**
 * The order the send queue is read in.
 *
 * Two screens need it and they need it to agree: the List Builder renders the
 * queue in three groups, and the run screen steps between runs with arrows. A
 * pair of arrows that walked a different order from the list they came from
 * would be worse than no arrows at all, so the ordering lives here rather than
 * in either of them.
 *
 * Generic over the two fields it actually reads, so both callers can pass the
 * rows straight off `outreach.listRuns` without either of them exporting a row
 * interface to the other.
 */

interface Ordered {
  queueState: string;
  position: number;
}

/** The queue split into the three groups it is rendered in. */
export function queueGroups<T extends Ordered>(rows: T[]) {
  const byPosition = (a: T, b: T) => a.position - b.position;
  return {
    queued: rows.filter((r) => r.queueState === 'queued').sort(byPosition),
    sending: rows.filter((r) => r.queueState === 'sending').sort(byPosition),
    // Most recently sent nearest the live end of the list, so the boundary
    // between what just happened and what happens next is one line, not a scroll.
    sent: rows.filter((r) => r.queueState === 'sent').sort((a, b) => b.position - a.position),
  };
}

/** The same thing, flattened top to bottom — what the arrows step through. */
export function queueOrder<T extends Ordered>(rows: T[]): T[] {
  const g = queueGroups(rows);
  return [...g.queued, ...g.sending, ...g.sent];
}
