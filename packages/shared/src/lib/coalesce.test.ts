import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createCoalescer, createInvalidator } from './coalesce';

/**
 * These cover the three properties the chat realtime layer actually depends on.
 * Each one maps to a specific way the un-coalesced version failed under load:
 * a burst became one refetch per message (batching), a BUSY thread never
 * refreshed at all because the debounce kept re-arming (maxWait), and the same
 * query key was invalidated dozens of times per flush (dedupe).
 */
describe('createCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst into one call', () => {
    const run = vi.fn();
    const c = createCoalescer<number>(run, { wait: 40 });
    for (let i = 0; i < 30; i++) c.push(i);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toHaveLength(30);
  });

  it('preserves arrival order', () => {
    const run = vi.fn();
    const c = createCoalescer<string>(run, { wait: 10 });
    c.push('a');
    c.push('b');
    c.push('c');
    vi.advanceTimersByTime(10);
    expect(run.mock.calls[0][0]).toEqual(['a', 'b', 'c']);
  });

  it('re-arms the quiet period on each push', () => {
    const run = vi.fn();
    const c = createCoalescer<number>(run, { wait: 50 });
    c.push(1);
    vi.advanceTimersByTime(40);
    c.push(2);
    vi.advanceTimersByTime(40);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('fires at maxWait even while items keep arriving', () => {
    // The bug this exists to stop: a thread where people are actively talking
    // re-arms a plain debounce forever, so the badge freezes for exactly as long
    // as the conversation stays busy.
    const run = vi.fn();
    const c = createCoalescer<number>(run, { wait: 50, maxWait: 200 });
    for (let t = 0; t < 300; t += 40) {
      c.push(t);
      vi.advanceTimersByTime(40);
    }
    expect(run).toHaveBeenCalled();
    const batched = run.mock.calls.flatMap((call) => call[0] as number[]);
    expect(batched.length).toBeGreaterThan(0);
  });

  it('never drops an item across a maxWait flush', () => {
    const run = vi.fn();
    const c = createCoalescer<number>(run, { wait: 50, maxWait: 120 });
    for (let i = 0; i < 10; i++) {
      c.push(i);
      vi.advanceTimersByTime(30);
    }
    vi.advanceTimersByTime(200);
    const seen = run.mock.calls.flatMap((call) => call[0] as number[]);
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('dedupes by key, keeping the last value', () => {
    const run = vi.fn();
    const c = createCoalescer<{ id: string; n: number }>(run, {
      wait: 10,
      key: (x) => x.id,
    });
    c.push({ id: 'a', n: 1 });
    c.push({ id: 'b', n: 2 });
    c.push({ id: 'a', n: 3 });
    vi.advanceTimersByTime(10);
    expect(run.mock.calls[0][0]).toEqual([
      { id: 'a', n: 3 },
      { id: 'b', n: 2 },
    ]);
  });

  it('flush() runs immediately and empties the queue', () => {
    const run = vi.fn();
    const c = createCoalescer<number>(run, { wait: 1_000 });
    c.push(1);
    c.flush();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(run).toHaveBeenCalledTimes(1); // nothing left to fire
  });

  it('flush() on an empty queue does nothing', () => {
    const run = vi.fn();
    createCoalescer<number>(run, { wait: 10 }).flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('cancel() drops queued work and ignores later pushes', () => {
    const run = vi.fn();
    const c = createCoalescer<number>(run, { wait: 10 });
    c.push(1);
    c.cancel();
    vi.advanceTimersByTime(100);
    c.push(2);
    vi.advanceTimersByTime(100);
    expect(run).not.toHaveBeenCalled();
  });

  it('reports whether anything is waiting', () => {
    const c = createCoalescer<number>(() => {}, { wait: 10 });
    expect(c.pending).toBe(false);
    c.push(1);
    expect(c.pending).toBe(true);
    vi.advanceTimersByTime(10);
    expect(c.pending).toBe(false);
  });
});

describe('createInvalidator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('invalidates each distinct query key exactly once per burst', () => {
    const invalidate = vi.fn();
    const inv = createInvalidator(invalidate, { wait: 20 });
    const inbox = { queryKey: [['chat', 'inbox']] };
    const reads = { queryKey: [['chat', 'readState']] };
    // Thirty messages, each pushing the same two filters.
    for (let i = 0; i < 30; i++) {
      inv.push(inbox);
      inv.push(reads);
    }
    vi.advanceTimersByTime(20);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('treats structurally equal keys built separately as the same key', () => {
    const invalidate = vi.fn();
    const inv = createInvalidator(invalidate, { wait: 20 });
    // tRPC's pathFilter() returns a fresh array every call — deduping by
    // identity would have missed this entirely.
    inv.push({ queryKey: [['chat', 'inbox'], { type: 'infinite' }] });
    inv.push({ queryKey: [['chat', 'inbox'], { type: 'infinite' }] });
    vi.advanceTimersByTime(20);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
