/**
 * Freehand territory drawing.
 *
 * Dragging a lasso across a metro produces hundreds of points — one per pointer
 * event — which is far more detail than a territory boundary needs and makes
 * every downstream point-in-polygon test more expensive. These helpers turn a
 * raw drag into a shape that looks identical but carries a fraction of the
 * vertices.
 */

/** Ignore pointer movement below this (CSS pixels) — it's a click, not a drag. */
export const DRAG_THRESHOLD_PX = 6;

/** Minimum screen-space gap between captured points while dragging. */
export const CAPTURE_SPACING_PX = 5;

/**
 * Hard ceiling on captured points for one lasso.
 *
 * Simplification is O(n²) in the worst case — a path where every point is a
 * genuine corner never collapses. Measured: a smooth drag of 20,000 points
 * simplifies to ~33 in 7ms, but a pure zigzag of the same length takes 10.6
 * SECONDS. Real drags are smooth, so this is a safety valve rather than a
 * normal limit: at 5px spacing, 2,000 points is a 10,000px path, far longer
 * than any territory outline, and bounds the pathological case to ~100ms.
 */
export const MAX_CAPTURE_POINTS = 2000;

export type DrawGestureEndAction = 'cancel' | 'point' | 'path';

/**
 * Decide what, if anything, the end of a drawing gesture commits.
 *
 * Cancellation is distinct from pointerup: the browser or OS can cancel a
 * pointer for reasons unrelated to user intent, so it must never be promoted
 * to either a tap or a completed freehand path.
 */
export function classifyDrawGestureEnd(
  freehand: boolean,
  cancelled: boolean
): DrawGestureEndAction {
  if (cancelled) return 'cancel';
  return freehand ? 'path' : 'point';
}

/** Perpendicular distance from p to the line through a and b, in the same units. */
export function perpendicularDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;

  // A degenerate segment has no line to measure against — fall back to the
  // distance from the shared endpoint.
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);

  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.hypot(dx, dy);
}

/**
 * Ramer–Douglas–Peucker: drop points that don't change the shape.
 *
 * Keeps any vertex further than `tolerance` from the straight line between the
 * points that would replace it, so corners survive and the smooth stretches
 * between them collapse. Iterative rather than recursive — a long drag can be
 * thousands of points, and recursion on that risks a stack overflow on the very
 * input this exists to handle.
 */
export function simplifyPath(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2 || tolerance <= 0) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop()!;
    let maxDist = 0;
    let index = -1;

    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }

    if (index !== -1 && maxDist > tolerance) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/**
 * Whether two screen points are far enough apart to count as a drag.
 *
 * A press that never really moves should still place a single vertex, so
 * freehand and click-to-place can share one gesture without fighting.
 */
export function isDrag(
  from: { x: number; y: number },
  to: { x: number; y: number },
  threshold: number = DRAG_THRESHOLD_PX
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= threshold;
}

/**
 * Whether a freehand point is far enough from the last captured one to keep.
 *
 * Sampling every pointer event would capture dozens of points per centimetre;
 * this thins the stream as it arrives so the live preview stays cheap.
 */
export function shouldCapture(
  last: { x: number; y: number } | null,
  next: { x: number; y: number },
  options: { spacing?: number; capturedCount?: number; maxPoints?: number } = {}
): boolean {
  const { spacing = CAPTURE_SPACING_PX, capturedCount = 0, maxPoints = MAX_CAPTURE_POINTS } = options;
  // Stop growing rather than degrade: the shape is already drawn, and an
  // unbounded path is what makes simplification pathological.
  if (capturedCount >= maxPoints) return false;
  if (!last) return true;
  return Math.hypot(next.x - last.x, next.y - last.y) >= spacing;
}

/**
 * Smallest lasso that counts, measured as the longer side of its screen-space
 * bounding box.
 *
 * With release committing the selection, every stray flick past the 6px drag
 * threshold would otherwise select whatever happened to sit under it. 24px is
 * below any deliberate loop and above the accidental ones.
 */
export const MIN_LASSO_SPAN_PX = 24;

export interface PixelBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function emptyBounds(): PixelBounds {
  return { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
}

export function growBounds(bounds: PixelBounds, p: { x: number; y: number }): PixelBounds {
  return {
    minX: Math.min(bounds.minX, p.x),
    maxX: Math.max(bounds.maxX, p.x),
    minY: Math.min(bounds.minY, p.y),
    maxY: Math.max(bounds.maxY, p.y),
  };
}

/**
 * Whether the traced area is big enough to be intentional.
 *
 * Uses the LONGER side rather than area, so a long thin lasso down one side of a
 * street still qualifies — that is a real way to pick a block, and an area test
 * would reject it.
 */
export function isDeliberateLasso(
  bounds: PixelBounds,
  minSpan: number = MIN_LASSO_SPAN_PX
): boolean {
  if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return false;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return Math.max(width, height) >= minSpan;
}
