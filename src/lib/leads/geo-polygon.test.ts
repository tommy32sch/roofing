import { describe, it, expect } from 'vitest';
import { pointInPolygon } from './geo-polygon';

// A simple square boundary (lat 33-34, lng -112 to -111)
const square: [number, number][] = [
  [33, -112],
  [34, -112],
  [34, -111],
  [33, -111],
];

describe('pointInPolygon', () => {
  it('returns true for a point clearly inside', () => {
    expect(pointInPolygon([33.5, -111.5], square)).toBe(true);
  });

  it('returns false for a point outside', () => {
    expect(pointInPolygon([35, -111.5], square)).toBe(false);
    expect(pointInPolygon([33.5, -113], square)).toBe(false);
  });

  it('handles a non-rectangular (concave) polygon', () => {
    // arrow/L shape
    const poly: [number, number][] = [
      [0, 0],
      [0, 4],
      [4, 4],
      [4, 2],
      [2, 2],
      [2, 0],
    ];
    expect(pointInPolygon([1, 1], poly)).toBe(true); // in the leg
    expect(pointInPolygon([3, 1], poly)).toBe(false); // in the notch (outside)
    expect(pointInPolygon([3, 3], poly)).toBe(true); // in the upper arm
  });

  it('returns false for a degenerate polygon (< 3 points)', () => {
    expect(pointInPolygon([0, 0], [[0, 0], [1, 1]])).toBe(false);
    expect(pointInPolygon([0, 0], [])).toBe(false);
  });
});
