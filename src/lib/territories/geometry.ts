import { TERRITORY_MAX_VERTICES } from './constants';
import type { TerritoryBoundary, TerritoryBounds, TerritoryPoint } from './types';

const EPSILON = 1e-12;
const MIN_AREA = 1e-12;

export type BoundaryValidation =
  | { success: true; boundary: TerritoryBoundary; bounds: TerritoryBounds }
  | { success: false; error: string };

function samePoint(a: TerritoryPoint, b: TerritoryPoint): boolean {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function cross(a: TerritoryPoint, b: TerritoryPoint, c: TerritoryPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment(point: TerritoryPoint, a: TerritoryPoint, b: TerritoryPoint): boolean {
  if (Math.abs(cross(a, b, point)) > EPSILON) return false;
  return (
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}

function segmentsIntersectIncludingTouch(
  a: TerritoryPoint,
  b: TerritoryPoint,
  c: TerritoryPoint,
  d: TerritoryPoint
): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);

  if (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  ) {
    return true;
  }

  return (
    (Math.abs(abC) <= EPSILON && pointOnSegment(c, a, b)) ||
    (Math.abs(abD) <= EPSILON && pointOnSegment(d, a, b)) ||
    (Math.abs(cdA) <= EPSILON && pointOnSegment(a, c, d)) ||
    (Math.abs(cdB) <= EPSILON && pointOnSegment(b, c, d))
  );
}

function segmentsProperlyIntersect(
  a: TerritoryPoint,
  b: TerritoryPoint,
  c: TerritoryPoint,
  d: TerritoryPoint
): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  );
}

function signedArea(polygon: TerritoryBoundary): number {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const next = (i + 1) % polygon.length;
    sum += polygon[i][0] * polygon[next][1] - polygon[next][0] * polygon[i][1];
  }
  return sum / 2;
}

function hasSelfIntersection(polygon: TerritoryBoundary): boolean {
  const count = polygon.length;
  for (let i = 0; i < count; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % count];
    for (let j = i + 1; j < count; j++) {
      // Neighboring edges are expected to meet at one vertex. The first and
      // last edges are neighbors too because the polygon closes implicitly.
      if (j === i + 1 || (i === 0 && j === count - 1)) continue;
      const c = polygon[j];
      const d = polygon[(j + 1) % count];
      if (segmentsIntersectIncludingTouch(a, b, c, d)) return true;
    }
  }
  return false;
}

export function polygonBounds(polygon: TerritoryBoundary): TerritoryBounds {
  return polygon.reduce<TerritoryBounds>(
    (bounds, [lat, lng]) => ({
      min_lat: Math.min(bounds.min_lat, lat),
      max_lat: Math.max(bounds.max_lat, lat),
      min_lng: Math.min(bounds.min_lng, lng),
      max_lng: Math.max(bounds.max_lng, lng),
    }),
    {
      min_lat: Infinity,
      max_lat: -Infinity,
      min_lng: Infinity,
      max_lng: -Infinity,
    }
  );
}

/**
 * Normalize and validate an API-supplied territory boundary.
 *
 * A repeated closing point and consecutive duplicates are harmless drawing
 * artifacts, so they are removed. All other malformed geometry is rejected.
 */
export function validateTerritoryBoundary(value: unknown): BoundaryValidation {
  if (!Array.isArray(value)) {
    return { success: false, error: 'boundary must be an array of [latitude, longitude] points' };
  }

  const normalized: TerritoryBoundary = [];
  for (const point of value) {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      typeof point[0] !== 'number' ||
      typeof point[1] !== 'number' ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return { success: false, error: 'Each boundary point must contain finite latitude and longitude numbers' };
    }
    const next: TerritoryPoint = [point[0], point[1]];
    if (next[0] < -90 || next[0] > 90 || next[1] < -180 || next[1] > 180) {
      return { success: false, error: 'Boundary coordinates are outside valid latitude/longitude ranges' };
    }
    if (normalized.length === 0 || !samePoint(normalized[normalized.length - 1], next)) {
      normalized.push(next);
    }
  }

  if (normalized.length > 1 && samePoint(normalized[0], normalized[normalized.length - 1])) {
    normalized.pop();
  }
  if (normalized.length < 3) {
    return { success: false, error: 'A territory requires at least 3 distinct points' };
  }
  if (normalized.length > TERRITORY_MAX_VERTICES) {
    return {
      success: false,
      error: `A territory cannot contain more than ${TERRITORY_MAX_VERTICES} points`,
    };
  }
  if (Math.abs(signedArea(normalized)) < MIN_AREA) {
    return { success: false, error: 'Territory boundary must enclose an area' };
  }
  if (hasSelfIntersection(normalized)) {
    return { success: false, error: 'Territory boundary cannot cross itself' };
  }

  return { success: true, boundary: normalized, bounds: polygonBounds(normalized) };
}

/**
 * Boundary-inclusive membership. A lead exactly on a drawn street/boundary
 * belongs to the territory instead of disappearing between adjacent shapes.
 */
export function pointInPolygon(
  point: TerritoryPoint,
  polygon: TerritoryBoundary,
  includeBoundary = true
): boolean {
  if (polygon.length < 3) return false;
  for (let i = 0; i < polygon.length; i++) {
    if (pointOnSegment(point, polygon[i], polygon[(i + 1) % polygon.length])) {
      return includeBoundary;
    }
  }

  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function boundsHaveInteriorIntersection(a: TerritoryBounds, b: TerritoryBounds): boolean {
  return (
    Math.min(a.max_lat, b.max_lat) - Math.max(a.min_lat, b.min_lat) > EPSILON &&
    Math.min(a.max_lng, b.max_lng) - Math.max(a.min_lng, b.min_lng) > EPSILON
  );
}

/**
 * Build points just inside every polygon edge. These distinguish two polygons
 * that merely share a border (probes point in opposite directions) from
 * congruent or collinearly-overlapping polygons (a probe enters both).
 */
function interiorEdgeProbes(polygon: TerritoryBoundary): TerritoryPoint[] {
  const bounds = polygonBounds(polygon);
  const offset = Math.max(
    Math.max(bounds.max_lat - bounds.min_lat, bounds.max_lng - bounds.min_lng) * 1e-7,
    1e-9
  );
  const orientation = signedArea(polygon) >= 0 ? 1 : -1;
  const probes: TerritoryPoint[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) continue;
    const midpoint: TerritoryPoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const probe: TerritoryPoint = [
      midpoint[0] + ((-dy / length) * offset * orientation),
      midpoint[1] + ((dx / length) * offset * orientation),
    ];
    if (pointInPolygon(probe, polygon, false)) probes.push(probe);
  }
  return probes;
}

/**
 * Whether two valid, simple polygons have overlapping interiors.
 *
 * Sharing only an edge or vertex is intentionally allowed so neighboring
 * territories can meet cleanly without requiring a gap.
 */
export function polygonsOverlap(a: TerritoryBoundary, b: TerritoryBoundary): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (!boundsHaveInteriorIntersection(polygonBounds(a), polygonBounds(b))) return false;

  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (
        segmentsProperlyIntersect(
          a[i],
          a[(i + 1) % a.length],
          b[j],
          b[(j + 1) % b.length]
        )
      ) {
        return true;
      }
    }
  }

  if (a.some((point) => pointInPolygon(point, b, false))) return true;
  if (b.some((point) => pointInPolygon(point, a, false))) return true;
  if (interiorEdgeProbes(a).some((point) => pointInPolygon(point, b, false))) return true;
  return interiorEdgeProbes(b).some((point) => pointInPolygon(point, a, false));
}
