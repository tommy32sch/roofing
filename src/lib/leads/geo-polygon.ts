/**
 * Point-in-polygon test (ray casting), used to find which leads fall inside a
 * boundary drawn on the map. Pure — no map/Leaflet dependency, so it's testable
 * and reusable. Points and polygon vertices are [lat, lng]; the algorithm is
 * axis-agnostic as long as both use the same order.
 */
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
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
