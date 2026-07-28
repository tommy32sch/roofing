import type { StormReport, StormType } from '@/components/leads/map-constants';

/**
 * Storm ZONES — the swath a storm actually cut, rather than the individual
 * reports that sampled it.
 *
 * Individual markers answer "what fell here". They cannot answer "which
 * neighbourhoods got hit recently", because at the zoom where you'd scan a whole
 * metro the dots are a few pixels each: shape is indistinguishable, opacity
 * differences disappear, and severity colour is doing its own job. Area and hue
 * are the only channels that survive being zoomed out, and a hull gives us both.
 *
 * So: group the reports that belong to one storm, draw the outline they trace,
 * and colour that outline by AGE. From across the metro you see hot blobs
 * (recent) and cold ones (old) — which is the question a canvassing decision
 * actually turns on.
 */

export interface StormZone {
  key: string;
  type: StormType;
  /** Outline of the swath, as [lat, lon] pairs. */
  hull: [number, number][];
  /** Most recent report in the cluster — the zone's age is the freshest hit. */
  latestDate: string;
  earliestDate: string;
  /** Highest measured value in the cluster (inches or mph). */
  peakValue: number | null;
  reportCount: number;
  /** Rough centre, for labelling. */
  center: [number, number];
}

/** Reports further apart than this are different storms. Metro-scale. */
export const ZONE_MAX_KM = 12;
/** A system can straddle midnight, so allow one day of slack. */
export const ZONE_MAX_DAYS_APART = 1;
/** Below this a "zone" is noise — the individual markers say it better. */
export const ZONE_MIN_REPORTS = 3;
/**
 * Smallest swath worth outlining, in km².
 *
 * Single-linkage chaining can string a handful of nearly-collinear reports into
 * a hull that is tens of km long and metres wide. It passes the 3-point test but
 * renders as a stray line across the map and implies a corridor that the data
 * doesn't describe. A genuine narrow swath still clears this easily: reports
 * scattered even a kilometre either side of a 20 km line cover ~40 km².
 */
export const ZONE_MIN_AREA_KM2 = 5;
/**
 * Narrowest swath worth outlining, in km — measured as area / longest span.
 *
 * Area alone can't separate a corridor from a line: measured against the live
 * Minneapolis data, the one genuine swath was 175 km² over a 34 km span (5.1 km
 * wide) while a stray chain was 8.7 km² over 31 km — only 0.28 km wide, yet it
 * cleared any sane area floor and drew an arrow across the metro. Effective
 * width is what actually distinguishes "a neighbourhood got hit" from "three
 * reports happened to line up".
 */
export const ZONE_MIN_WIDTH_KM = 2.5;

/**
 * Great-circle distance, equirectangular approximation.
 *
 * Accurate to well under a percent at metro scale, and much cheaper than
 * haversine — this runs O(n²) over every pair in view.
 */
export function distanceKm(
  aLat: number, aLon: number, bLat: number, bLon: number
): number {
  const R = 6371;
  const toRad = Math.PI / 180;
  const x = (bLon - aLon) * toRad * Math.cos(((aLat + bLat) / 2) * toRad);
  const y = (bLat - aLat) * toRad;
  return Math.sqrt(x * x + y * y) * R;
}

/** Whole days between two "YYYY-MM-DD" dates, anchored at UTC noon. */
function daysApart(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`);
  const tb = Date.parse(`${b}T12:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(Math.round((tb - ta) / 86_400_000));
}

/**
 * Convex hull by Andrew's monotone chain, in O(n log n).
 *
 * Returns points in counter-clockwise order, without repeating the first point
 * — Leaflet closes a Polygon itself.
 *
 * A degenerate input (fewer than 3 points, or points all on one line) yields a
 * result with fewer than 3 entries. That is deliberate: it has no interior, and
 * the caller rejects it rather than drawing a sliver that implies coverage the
 * data doesn't support.
 */
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return [...points];

  // Sort by lon then lat so the chain walks left to right.
  const pts = [...points].sort((p, q) => (p[1] - q[1]) || (p[0] - q[0]));

  // > 0 when the turn from o->a->b is counter-clockwise.
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);

  const build = (source: [number, number][]) => {
    const chain: [number, number][] = [];
    for (const p of source) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) {
        chain.pop();
      }
      chain.push(p);
    }
    chain.pop(); // last point starts the other chain
    return chain;
  };

  // Collinear input collapses to under 3 points here, which is the signal the
  // caller needs. Returning the original points instead would manufacture a
  // zero-area "zone" out of a straight line of reports.
  return [...build(pts), ...build([...pts].reverse())];
}

/**
 * Area of a lat/lon polygon in km², by the shoelace formula.
 *
 * Degrees are converted to km locally (longitude scaled by cos(lat)), which is
 * ample at metro scale — this only ever decides "is this a real area or a line".
 */
export function polygonAreaKm2(hull: [number, number][]): number {
  if (hull.length < 3) return 0;
  const latRef = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos((latRef * Math.PI) / 180);

  let twiceArea = 0;
  for (let i = 0; i < hull.length; i++) {
    const [aLat, aLon] = hull[i];
    const [bLat, bLon] = hull[(i + 1) % hull.length];
    twiceArea += (aLon * kmPerDegLon) * (bLat * kmPerDegLat) - (bLon * kmPerDegLon) * (aLat * kmPerDegLat);
  }
  return Math.abs(twiceArea) / 2;
}

/** Longest distance between any two hull vertices. */
export function hullSpanKm(hull: [number, number][]): number {
  let span = 0;
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      span = Math.max(span, distanceKm(hull[i][0], hull[i][1], hull[j][0], hull[j][1]));
    }
  }
  return span;
}

/**
 * Effective width of a swath: how wide it would be if squared off along its
 * longest axis. The number that says whether this reads as an area or a line.
 */
export function hullWidthKm(hull: [number, number][]): number {
  const span = hullSpanKm(hull);
  return span > 0 ? polygonAreaKm2(hull) / span : 0;
}

/**
 * Single-linkage clustering: reports join a zone if they are within ZONE_MAX_KM
 * and ZONE_MAX_DAYS_APART of ANY report already in it.
 *
 * Single linkage on purpose — a storm swath is a long chain, not a blob, so
 * requiring closeness to a centroid would chop one squall line into pieces.
 */
export function clusterReports(
  reports: StormReport[],
  maxKm = ZONE_MAX_KM,
  maxDays = ZONE_MAX_DAYS_APART
): StormReport[][] {
  const unvisited = new Set(reports.keys());
  const clusters: StormReport[][] = [];

  for (const seed of reports.keys()) {
    if (!unvisited.has(seed)) continue;
    unvisited.delete(seed);
    const cluster = [reports[seed]];
    const queue = [seed];

    while (queue.length) {
      const i = queue.pop()!;
      const a = reports[i];
      for (const j of [...unvisited]) {
        const b = reports[j];
        if (a.type !== b.type) continue; // wind and hail are separate swaths
        if (daysApart(a.date, b.date) > maxDays) continue;
        if (distanceKm(a.lat, a.lon, b.lat, b.lon) > maxKm) continue;
        unvisited.delete(j);
        cluster.push(b);
        queue.push(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

export interface StormZonePartition {
  zones: StormZone[];
  /**
   * Reports that didn't form a zone — isolated hits and rejected slivers.
   *
   * Returned so callers can keep real reports visible even when no meaningful
   * swath hull can be formed.
   */
  strays: StormReport[];
}

/**
 * Split reports into drawable zones and the strays left over.
 *
 * Clusters are dropped to strays when they can't describe a swath: too few
 * reports, or a hull too thin to have meaningful area. Both would draw a sliver
 * implying coverage the data doesn't support.
 */
export function partitionStormReports(reports: StormReport[]): StormZonePartition {
  const zones: StormZone[] = [];
  const strays: StormReport[] = [];

  for (const cluster of clusterReports(reports)) {
    const reject = () => strays.push(...cluster);
    if (cluster.length < ZONE_MIN_REPORTS) { reject(); continue; }

    const hull = convexHull(cluster.map((r) => [r.lat, r.lon] as [number, number]));
    // Perfectly collinear reports have no area; nearly-collinear ones pass the
    // point count but render as a stray line across the map.
    if (hull.length < 3) { reject(); continue; }
    if (polygonAreaKm2(hull) < ZONE_MIN_AREA_KM2) { reject(); continue; }
    if (hullWidthKm(hull) < ZONE_MIN_WIDTH_KM) { reject(); continue; }

    const dates = cluster.map((r) => r.date).sort();
    const values = cluster.map((r) => r.value).filter((v): v is number => v != null);
    const center: [number, number] = [
      cluster.reduce((s, r) => s + r.lat, 0) / cluster.length,
      cluster.reduce((s, r) => s + r.lon, 0) / cluster.length,
    ];

    zones.push({
      // Stable across renders: type + span + size identifies the cluster.
      key: `${cluster[0].type}-${dates[0]}-${dates[dates.length - 1]}-${cluster.length}-${center[0].toFixed(3)}`,
      type: cluster[0].type,
      hull,
      // The zone's age is its FRESHEST hit: a neighbourhood struck again last
      // month is a live opportunity regardless of what happened a year ago.
      latestDate: dates[dates.length - 1],
      earliestDate: dates[0],
      peakValue: values.length ? Math.max(...values) : null,
      reportCount: cluster.length,
      center,
    });
  }

  // Oldest first so recent zones paint on top.
  zones.sort((a, b) => (a.latestDate < b.latestDate ? -1 : a.latestDate > b.latestDate ? 1 : 0));
  return { zones, strays };
}

/** Just the zones, for callers that don't render strays. */
export function buildStormZones(reports: StormReport[]): StormZone[] {
  return partitionStormReports(reports).zones;
}
