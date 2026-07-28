import { describe, expect, it } from 'vitest';
import { TERRITORY_MAX_VERTICES } from './constants';
import {
  pointInPolygon,
  polygonBounds,
  polygonsOverlap,
  validateTerritoryBoundary,
} from './geometry';
import type { TerritoryBoundary } from './types';

const square = (
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number
): TerritoryBoundary => [
  [minLat, minLng],
  [maxLat, minLng],
  [maxLat, maxLng],
  [minLat, maxLng],
];

describe('validateTerritoryBoundary', () => {
  it('normalizes drawing artifacts and returns a bounding box', () => {
    const result = validateTerritoryBoundary([
      [33, -112],
      [33, -112],
      [34, -112],
      [34, -111],
      [33, -111],
      [33, -112],
    ]);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.boundary).toEqual(square(33, -112, 34, -111));
    expect(result.bounds).toEqual({
      min_lat: 33,
      max_lat: 34,
      min_lng: -112,
      max_lng: -111,
    });
  });

  it('rejects malformed and out-of-range coordinates', () => {
    expect(validateTerritoryBoundary('nope').success).toBe(false);
    expect(validateTerritoryBoundary([[0, 0], [1, 1], [2, Number.NaN]]).success).toBe(false);
    expect(validateTerritoryBoundary([[0, 0], [91, 1], [2, 0]]).success).toBe(false);
    expect(validateTerritoryBoundary([[0, 0], [1, 181], [2, 0]]).success).toBe(false);
  });

  it('rejects degenerate and self-crossing polygons', () => {
    expect(validateTerritoryBoundary([[0, 0], [1, 1], [2, 2]]).success).toBe(false);
    expect(
      validateTerritoryBoundary([
        [0, 0],
        [2, 2],
        [0, 2],
        [2, 0],
      ]).success
    ).toBe(false);
  });

  it('enforces the stored vertex limit', () => {
    const points = Array.from({ length: TERRITORY_MAX_VERTICES + 1 }, (_, i) => {
      const angle = (i / (TERRITORY_MAX_VERTICES + 1)) * Math.PI * 2;
      return [Math.sin(angle), Math.cos(angle)] as [number, number];
    });
    expect(validateTerritoryBoundary(points)).toEqual({
      success: false,
      error: `A territory cannot contain more than ${TERRITORY_MAX_VERTICES} points`,
    });
  });
});

describe('territory membership', () => {
  const polygon = square(0, 0, 2, 2);

  it('includes interior and boundary leads but excludes outside points', () => {
    expect(pointInPolygon([1, 1], polygon)).toBe(true);
    expect(pointInPolygon([0, 1], polygon)).toBe(true);
    expect(pointInPolygon([0, 0], polygon)).toBe(true);
    expect(pointInPolygon([3, 1], polygon)).toBe(false);
  });

  it('can perform strict interior checks for overlap detection', () => {
    expect(pointInPolygon([0, 1], polygon, false)).toBe(false);
    expect(pointInPolygon([1, 1], polygon, false)).toBe(true);
  });

  it('calculates bounds for negative longitudes', () => {
    expect(polygonBounds(square(33, -112, 34, -111))).toEqual({
      min_lat: 33,
      max_lat: 34,
      min_lng: -112,
      max_lng: -111,
    });
  });
});

describe('polygonsOverlap', () => {
  it('detects edge crossings, containment and identical polygons', () => {
    const base = square(0, 0, 2, 2);
    expect(polygonsOverlap(base, square(1, 1, 3, 3))).toBe(true);
    expect(polygonsOverlap(base, square(0.5, 0.5, 1.5, 1.5))).toBe(true);
    expect(polygonsOverlap(base, square(0, 0, 2, 2))).toBe(true);
  });

  it('detects positive-area overlap whose edges are collinear', () => {
    expect(polygonsOverlap(square(0, 0, 2, 2), square(1, 0, 3, 2))).toBe(true);
  });

  it('allows neighboring territories to share only an edge or vertex', () => {
    const base = square(0, 0, 2, 2);
    expect(polygonsOverlap(base, square(2, 0, 4, 2))).toBe(false);
    expect(polygonsOverlap(base, square(2, 2, 4, 4))).toBe(false);
  });

  it('returns false for separated polygons', () => {
    expect(polygonsOverlap(square(0, 0, 1, 1), square(2, 2, 3, 3))).toBe(false);
  });

  it('handles concave containment without relying on a polygon centroid', () => {
    const concave: TerritoryBoundary = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    expect(polygonsOverlap(concave, square(0.2, 2, 0.8, 3))).toBe(true);
    expect(polygonsOverlap(concave, square(2, 2, 3, 3))).toBe(false);
  });
});
