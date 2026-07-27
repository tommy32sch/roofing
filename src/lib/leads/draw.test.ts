import { describe, it, expect } from 'vitest';
import {
  perpendicularDistance,
  simplifyPath,
  isDrag,
  shouldCapture,
  DRAG_THRESHOLD_PX,
  CAPTURE_SPACING_PX,
  MAX_CAPTURE_POINTS,
} from './draw';

describe('perpendicularDistance', () => {
  it('measures the offset from a horizontal line', () => {
    expect(perpendicularDistance([1, 3], [0, 0], [2, 0])).toBeCloseTo(3, 6);
  });

  it('is zero for a point on the line', () => {
    expect(perpendicularDistance([1, 1], [0, 0], [2, 2])).toBeCloseTo(0, 6);
  });

  it('is symmetric in the segment endpoints', () => {
    const a: [number, number] = [0, 0];
    const b: [number, number] = [4, 2];
    expect(perpendicularDistance([1, 3], a, b)).toBeCloseTo(perpendicularDistance([1, 3], b, a), 6);
  });

  // A drag can emit two identical points; without this the formula divides by
  // zero and every downstream comparison becomes NaN.
  it('falls back to point distance for a zero-length segment', () => {
    expect(perpendicularDistance([3, 4], [0, 0], [0, 0])).toBeCloseTo(5, 6);
  });
});

describe('simplifyPath', () => {
  it('leaves a path with no redundant points alone', () => {
    expect(simplifyPath([[0, 0], [1, 1]], 0.1)).toEqual([[0, 0], [1, 1]]);
    expect(simplifyPath([], 0.1)).toEqual([]);
  });

  it('collapses points that lie on a straight run', () => {
    const line: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
    expect(simplifyPath(line, 0.1)).toEqual([[0, 0], [4, 0]]);
  });

  // The point of the whole exercise: corners are the shape, straight stretches
  // are not. The bend here is at [2,0] — [3,3] and [4,6] lie exactly on the
  // line running from it, so dropping them loses nothing.
  it('keeps the corner while dropping the straight runs either side', () => {
    const path: [number, number][] = [
      [0, 0], [1, 0],
      [2, 0], // the corner
      [3, 3], [4, 6], [5, 9],
    ];
    const out = simplifyPath(path, 0.5);
    expect(out).toContainEqual([2, 0]);
    expect(out).toEqual([[0, 0], [2, 0], [5, 9]]);
  });

  it('always keeps the first and last point', () => {
    const path: [number, number][] = [[0, 0], [1, 0.01], [2, 0], [3, 0.01], [9, 0]];
    const out = simplifyPath(path, 1);
    expect(out[0]).toEqual([0, 0]);
    expect(out.at(-1)).toEqual([9, 0]);
  });

  it('drops more points as the tolerance grows', () => {
    const wobble: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, Math.sin(i / 3)]);
    const tight = simplifyPath(wobble, 0.05);
    const loose = simplifyPath(wobble, 0.8);
    expect(loose.length).toBeLessThan(tight.length);
    expect(tight.length).toBeLessThanOrEqual(wobble.length);
  });

  it('returns the path unchanged when tolerance is zero or negative', () => {
    const path: [number, number][] = [[0, 0], [1, 0], [2, 0]];
    expect(simplifyPath(path, 0)).toEqual(path);
    expect(simplifyPath(path, -1)).toEqual(path);
  });

  it('preserves the original point order', () => {
    const path: [number, number][] = [[0, 0], [5, 5], [10, 0], [15, 5], [20, 0]];
    const out = simplifyPath(path, 0.1);
    expect(out).toEqual(path.filter((p) => out.some((q) => q[0] === p[0] && q[1] === p[1])));
  });

  // Iterative, not recursive, precisely so a long lasso can't blow the stack.
  // Uses a smooth path because that is what a real drag produces — measured at
  // 20,000 points it simplifies to ~33 in single-digit milliseconds.
  it('handles a very long smooth path without overflowing or crawling', () => {
    const long: [number, number][] = Array.from({ length: 20000 }, (_, i) => {
      const t = (i / 20000) * Math.PI * 2;
      return [Math.cos(t) * 10, Math.sin(t) * 10];
    });
    const started = performance.now();
    const out = simplifyPath(long, 0.05);
    expect(out.length).toBeLessThan(200);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('cuts a realistic freehand lasso down hard', () => {
    // A rough circle sampled far more finely than a boundary needs.
    const circle: [number, number][] = Array.from({ length: 400 }, (_, i) => {
      const t = (i / 400) * Math.PI * 2;
      return [Math.cos(t) * 10, Math.sin(t) * 10];
    });
    const out = simplifyPath(circle, 0.05);
    expect(out.length).toBeLessThan(circle.length / 3);
    expect(out.length).toBeGreaterThan(8); // still recognisably a circle
  });
});

describe('isDrag', () => {
  it('treats a press that barely moves as a click', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 102, y: 101 })).toBe(false);
  });

  it('treats real movement as a drag', () => {
    expect(isDrag({ x: 100, y: 100 }, { x: 140, y: 100 })).toBe(true);
  });

  it('triggers exactly at the threshold', () => {
    expect(isDrag({ x: 0, y: 0 }, { x: DRAG_THRESHOLD_PX, y: 0 })).toBe(true);
    expect(isDrag({ x: 0, y: 0 }, { x: DRAG_THRESHOLD_PX - 0.01, y: 0 })).toBe(false);
  });

  it('measures diagonally, not per-axis', () => {
    // 5px on each axis is ~7.07px of travel — past the threshold.
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(true);
  });
});

describe('shouldCapture', () => {
  it('always captures the first point', () => {
    expect(shouldCapture(null, { x: 10, y: 10 })).toBe(true);
  });

  it('skips points too close to the last captured one', () => {
    expect(shouldCapture({ x: 100, y: 100 }, { x: 101, y: 101 })).toBe(false);
  });

  it('captures once the pointer has travelled far enough', () => {
    expect(shouldCapture({ x: 100, y: 100 }, { x: 100 + CAPTURE_SPACING_PX, y: 100 })).toBe(true);
  });

  // The safety valve: simplification degrades quadratically on a path where
  // every point is a corner, so an unbounded lasso is the real hazard.
  it('stops capturing at the point ceiling', () => {
    const far = { x: 0, y: 0 };
    const next = { x: 999, y: 999 };
    expect(shouldCapture(far, next, { capturedCount: MAX_CAPTURE_POINTS - 1 })).toBe(true);
    expect(shouldCapture(far, next, { capturedCount: MAX_CAPTURE_POINTS })).toBe(false);
    // The ceiling beats even the always-capture-first rule.
    expect(shouldCapture(null, next, { capturedCount: MAX_CAPTURE_POINTS })).toBe(false);
  });

  it('honours a custom spacing', () => {
    expect(shouldCapture({ x: 0, y: 0 }, { x: 3, y: 0 }, { spacing: 2 })).toBe(true);
    expect(shouldCapture({ x: 0, y: 0 }, { x: 3, y: 0 }, { spacing: 10 })).toBe(false);
  });
});
