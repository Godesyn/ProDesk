/**
 * Elliptical-arc bounds, pinned to hand-derived geometry.
 *
 * WHY its own file: arcs are how a generated mark draws a ring, and they used to
 * be bounded by a radius-sized box around both endpoints — never clipping, but so
 * loose and so lopsided that `layoutLockup`, which centres the favicon/avatar
 * square on this measurement, put the artwork visibly off-centre and shrank it
 * inside a box twice the size it needed. The centring tests next door can't catch
 * that on their own: they re-measure with `inkBounds`, so a self-consistently
 * wrong box still looks centred. These expectations come from the geometry
 * instead.
 */
import { describe, expect, it } from 'vitest';
import { inkBounds } from './bbox.js';

/** A single filled path — no stroke, so the box is the geometry exactly. */
const boundsOf = (d: string) =>
  inkBounds(`<svg viewBox="0 0 100 100"><path fill="currentColor" stroke="none" d="${d}"/></svg>`);

const expectBox = (d: string, want: [number, number, number, number]) => {
  const box = boundsOf(d);
  expect(box).not.toBeNull();
  expect(box!.minX).toBeCloseTo(want[0], 6);
  expect(box!.minY).toBeCloseTo(want[1], 6);
  expect(box!.maxX).toBeCloseTo(want[2], 6);
  expect(box!.maxY).toBeCloseTo(want[3], 6);
};

describe('bbox.ts — elliptical arcs', () => {
  it('bounds a ring drawn as two half arcs by the circle itself', () => {
    // r=32 about (50,50).
    expectBox('M 18 50 A 32 32 0 1 0 82 50 A 32 32 0 1 0 18 50', [18, 18, 82, 82]);
  });

  it('bounds a semicircle by the half it actually sweeps', () => {
    // Same endpoints, opposite sweep flag — the box must follow the bulge, which
    // the old radius-box approximation could not express.
    expectBox('M 20 50 A 30 30 0 0 1 80 50', [20, 20, 80, 50]);
    expectBox('M 20 50 A 30 30 0 0 0 80 50', [20, 50, 80, 80]);
  });

  it('bounds a quarter arc by its endpoints — no phantom extremum', () => {
    expectBox('M 50 18 A 32 32 0 0 1 82 50', [50, 18, 82, 50]);
  });

  it('honours the x-axis rotation', () => {
    // rx=30 ry=10 turned 90° → the long axis runs vertically about (50,50).
    expectBox('M 50 20 A 30 10 90 1 0 50 80 A 30 10 90 1 0 50 20', [40, 20, 60, 80]);
  });

  it('handles relative arcs and the large-arc / sweep flag pair', () => {
    expectBox('M 50 20 a 30 30 0 1 1 0 60', [50, 20, 80, 80]);
  });

  it('scales radii too small to span the chord, per the spec', () => {
    // r=10 cannot reach across a 60-unit chord: it is scaled to 30, giving the
    // same half circle as above rather than a box hung off the stated radius.
    expectBox('M 20 50 A 10 10 0 0 1 80 50', [20, 20, 80, 50]);
  });

  it('treats a zero radius as the straight line it renders as', () => {
    expectBox('M 20 30 A 0 0 0 0 1 80 70', [20, 30, 80, 70]);
  });
});
