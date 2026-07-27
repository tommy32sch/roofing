import { describe, it, expect } from 'vitest';
import {
  distanceKm,
  convexHull,
  clusterReports,
  buildStormZones,
  partitionStormReports,
  polygonAreaKm2,
  hullWidthKm,
  ZONE_MIN_REPORTS,
} from './zones';
import type { StormReport, StormType } from '@/components/leads/map-constants';

const report = (
  lat: number,
  lon: number,
  date = '2026-07-01',
  type: StormType = 'hail',
  value: number | null = 1
): StormReport => ({ lat, lon, value, date, location: '', state: 'MN', type });

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm(45, -93, 45, -93)).toBe(0);
  });

  it('gets a known distance about right', () => {
    // Minneapolis -> Saint Paul is ~14 km.
    const d = distanceKm(44.9778, -93.265, 44.9537, -93.09);
    expect(d).toBeGreaterThan(12);
    expect(d).toBeLessThan(16);
  });

  it('is symmetric', () => {
    expect(distanceKm(45, -93, 44.9, -93.1)).toBeCloseTo(distanceKm(44.9, -93.1, 45, -93), 6);
  });

  it('scales a degree of latitude to about 111 km', () => {
    expect(distanceKm(45, -93, 46, -93)).toBeGreaterThan(110);
    expect(distanceKm(45, -93, 46, -93)).toBeLessThan(112);
  });
});

describe('convexHull', () => {
  it('returns the corners of a square, dropping the interior point', () => {
    const hull = convexHull([[0, 0], [0, 1], [1, 1], [1, 0], [0.5, 0.5]]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([0.5, 0.5]);
  });

  it('keeps every corner of a triangle', () => {
    expect(convexHull([[0, 0], [2, 0], [1, 2]])).toHaveLength(3);
  });

  it('does not repeat the first point — Leaflet closes the polygon itself', () => {
    const hull = convexHull([[0, 0], [0, 2], [2, 2], [2, 0]]);
    const seen = new Set(hull.map((p) => p.join(',')));
    expect(seen.size).toBe(hull.length);
  });

  it('passes through inputs too small to enclose an area', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([[1, 1]])).toEqual([[1, 1]]);
    expect(convexHull([[1, 1], [2, 2]])).toHaveLength(2);
  });

  // Three points on a line have no interior; the caller must be able to reject it.
  it('does not invent area from collinear points', () => {
    const hull = convexHull([[0, 0], [1, 1], [2, 2]]);
    expect(hull.length).toBeLessThanOrEqual(3);
  });

  it('handles duplicate points without looping forever', () => {
    const hull = convexHull([[0, 0], [0, 0], [1, 0], [0, 1]]);
    expect(hull.length).toBeGreaterThanOrEqual(3);
  });
});

describe('clusterReports', () => {
  it('groups nearby same-day reports into one cluster', () => {
    const clusters = clusterReports([
      report(45.0, -93.0),
      report(45.01, -93.01),
      report(45.02, -93.02),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('splits reports that are far apart', () => {
    const clusters = clusterReports([report(45.0, -93.0), report(46.5, -95.0)]);
    expect(clusters).toHaveLength(2);
  });

  it('splits storms months apart even at the same place', () => {
    const clusters = clusterReports([
      report(45.0, -93.0, '2026-07-01'),
      report(45.0, -93.0, '2026-01-01'),
    ]);
    expect(clusters).toHaveLength(2);
  });

  // A system can straddle midnight — one day of slack keeps it whole.
  it('keeps an overnight system together', () => {
    const clusters = clusterReports([
      report(45.0, -93.0, '2026-07-01'),
      report(45.01, -93.01, '2026-07-02'),
    ]);
    expect(clusters).toHaveLength(1);
  });

  it('never mixes wind and hail into one swath', () => {
    const clusters = clusterReports([
      report(45.0, -93.0, '2026-07-01', 'hail'),
      report(45.001, -93.001, '2026-07-01', 'wind'),
    ]);
    expect(clusters).toHaveLength(2);
  });

  // Single linkage on purpose: a squall line is a chain, and centroid-based
  // clustering would chop it into pieces.
  it('follows a chain of hops longer than the threshold end to end', () => {
    const chain = Array.from({ length: 6 }, (_, i) => report(45 + i * 0.08, -93));
    expect(clusterReports(chain)).toHaveLength(1);
  });

  it('returns nothing for no input', () => {
    expect(clusterReports([])).toEqual([]);
  });
});

describe('buildStormZones', () => {
  // Neighbourhood-scale, ~13 km across. Deliberately not smaller: a 4 km
  // diamond is under the effective-width floor and would be rejected as a
  // sliver, which is correct behaviour but a poor stand-in for a real swath.
  const swath = (date: string, type: StormType = 'hail', value = 1) => [
    report(45.0, -93.0, date, type, value),
    report(45.06, -93.08, date, type, value),
    report(45.12, -93.0, date, type, value),
    report(45.06, -92.92, date, type, value),
  ];

  it('builds a zone from a real cluster', () => {
    const zones = buildStormZones(swath('2026-07-01'));
    expect(zones).toHaveLength(1);
    expect(zones[0].reportCount).toBe(4);
    expect(zones[0].hull.length).toBeGreaterThanOrEqual(3);
  });

  // Two points make a line, not a swath — drawing one would imply coverage
  // that the data doesn't support.
  it('drops clusters below the minimum report count', () => {
    expect(ZONE_MIN_REPORTS).toBe(3);
    expect(buildStormZones([report(45, -93), report(45.01, -93.01)])).toEqual([]);
  });

  it('drops a cluster whose points are perfectly collinear', () => {
    const line = [report(45.0, -93.0), report(45.01, -93.0), report(45.02, -93.0)];
    expect(buildStormZones(line)).toEqual([]);
  });

  // The zone's age is its FRESHEST hit: a neighbourhood struck again last month
  // is live regardless of the older damage underneath it.
  it('dates a zone by its most recent report', () => {
    const mixed = [
      report(45.0, -93.0, '2026-07-01'),
      report(45.06, -93.08, '2026-07-02'),
      report(45.12, -93.0, '2026-07-02'),
      report(45.06, -92.92, '2026-07-01'),
    ];
    const [zone] = buildStormZones(mixed);
    expect(zone.latestDate).toBe('2026-07-02');
    expect(zone.earliestDate).toBe('2026-07-01');
  });

  it('reports the peak severity in the cluster', () => {
    const zones = buildStormZones([
      report(45.0, -93.0, '2026-07-01', 'hail', 1),
      report(45.06, -93.08, '2026-07-01', 'hail', 2.75),
      report(45.12, -93.0, '2026-07-01', 'hail', 1.5),
      report(45.06, -92.92, '2026-07-01', 'hail', null),
    ]);
    expect(zones[0].peakValue).toBe(2.75);
  });

  it('leaves peak null when nothing in the cluster was measured', () => {
    const zones = buildStormZones([
      report(45.0, -93.0, '2026-07-01', 'wind', null),
      report(45.06, -93.08, '2026-07-01', 'wind', null),
      report(45.12, -93.0, '2026-07-01', 'wind', null),
      report(45.06, -92.92, '2026-07-01', 'wind', null),
    ]);
    expect(zones[0].peakValue).toBeNull();
  });

  it('orders oldest first so recent zones paint on top', () => {
    const zones = buildStormZones([
      ...swath('2026-07-01'),
      ...swath('2026-01-01').map((r) => ({ ...r, lat: r.lat + 3 })),
    ]);
    expect(zones).toHaveLength(2);
    expect(zones[0].latestDate < zones[1].latestDate).toBe(true);
  });

  it('gives every zone a distinct key', () => {
    const zones = buildStormZones([
      ...swath('2026-07-01'),
      ...swath('2026-01-01').map((r) => ({ ...r, lat: r.lat + 3 })),
    ]);
    expect(new Set(zones.map((z) => z.key)).size).toBe(zones.length);
  });

  it('handles an empty list', () => {
    expect(buildStormZones([])).toEqual([]);
  });
});

describe('polygonAreaKm2', () => {
  it('is zero for degenerate input', () => {
    expect(polygonAreaKm2([])).toBe(0);
    expect(polygonAreaKm2([[45, -93], [45.1, -93]])).toBe(0);
  });

  it('approximates a known box', () => {
    // ~0.1 deg lat (11.06 km) by 0.1 deg lon at 45N (7.87 km) ≈ 87 km².
    const area = polygonAreaKm2([[45, -93], [45.1, -93], [45.1, -92.9], [45, -92.9]]);
    expect(area).toBeGreaterThan(80);
    expect(area).toBeLessThan(95);
  });

  it('does not depend on winding direction', () => {
    const cw: [number, number][] = [[45, -93], [45, -92.9], [45.1, -92.9], [45.1, -93]];
    const ccw = [...cw].reverse();
    expect(polygonAreaKm2(cw)).toBeCloseTo(polygonAreaKm2(ccw), 6);
  });

  it('gives a near-zero area to a sliver', () => {
    expect(polygonAreaKm2([[45, -93], [45.0001, -92.7], [45, -92.4]])).toBeLessThan(5);
  });
});

describe('buildStormZones rejects slivers', () => {
  // The bug this caught in practice: single-linkage chained a few nearly-
  // collinear reports into a hull tens of km long and metres wide, which drew a
  // stray line across the map implying a corridor that wasn't in the data.
  it('drops a long, nearly-collinear chain', () => {
    const sliver = [
      report(45.0, -93.0),
      report(45.0005, -93.05),
      report(45.001, -93.1),
      report(45.0015, -93.15),
    ];
    expect(buildStormZones(sliver)).toEqual([]);
  });

  it('keeps a genuinely narrow but real swath', () => {
    // A squall line with reports scattered either side of it still has area.
    const swath = [
      report(45.0, -93.0),
      report(45.03, -93.05),
      report(44.97, -93.1),
      report(45.02, -93.15),
      report(44.98, -93.05),
    ];
    expect(buildStormZones(swath)).toHaveLength(1);
  });
});

describe('hullWidthKm', () => {
  it('is near the true width for a rectangle', () => {
    // ~11 km tall by ~7.9 km wide at 45N; longest span is the diagonal (~13.6 km),
    // so effective width = area / diagonal.
    const w = hullWidthKm([[45, -93], [45.1, -93], [45.1, -92.9], [45, -92.9]]);
    expect(w).toBeGreaterThan(5);
    expect(w).toBeLessThan(8);
  });

  it('collapses toward zero for a long sliver', () => {
    expect(hullWidthKm([[45, -93], [45.002, -92.7], [45, -92.4]])).toBeLessThan(1);
  });

  it('is zero for degenerate input', () => {
    expect(hullWidthKm([])).toBe(0);
    expect(hullWidthKm([[45, -93]])).toBe(0);
  });
});

describe('buildStormZones width filter', () => {
  // Measured against the live Minneapolis data: the genuine corridor was 5.1 km
  // wide, while a stray chain 31 km long was 0.28 km wide and still cleared any
  // sane area floor. Width is the discriminator, not area.
  it('drops a long chain that clears the area floor but is only metres wide', () => {
    const chain = Array.from({ length: 6 }, (_, i) =>
      report(45.0 + (i % 2) * 0.003, -93.0 - i * 0.06)
    );
    expect(buildStormZones(chain)).toEqual([]);
  });

  it('keeps a broad corridor', () => {
    const broad = [
      report(45.0, -93.0), report(45.08, -93.02), report(45.02, -93.12),
      report(45.1, -93.14), report(45.05, -93.07), report(44.98, -93.1),
    ];
    expect(buildStormZones(broad)).toHaveLength(1);
  });
});

describe('partitionStormReports', () => {
  // Every report must land somewhere: hiding the severity markers in zones
  // view is only honest if nothing silently disappears.
  it('accounts for every report as either zone member or stray', () => {
    const reports = [
      // a real swath
      report(45.0, -93.0), report(45.06, -93.08), report(45.12, -93.0),
      report(45.06, -92.92),
      // an isolated hit far away
      report(46.5, -95.0),
    ];
    const { zones, strays } = partitionStormReports(reports);
    const zoned = zones.reduce((s, z) => s + z.reportCount, 0);
    expect(zoned + strays.length).toBe(reports.length);
    expect(zones).toHaveLength(1);
    expect(strays).toHaveLength(1);
    expect(strays[0].lat).toBe(46.5);
  });

  it('sends a rejected sliver to strays rather than dropping it', () => {
    const sliver = Array.from({ length: 6 }, (_, i) =>
      report(45.0 + (i % 2) * 0.003, -93.0 - i * 0.06)
    );
    const { zones, strays } = partitionStormReports(sliver);
    expect(zones).toEqual([]);
    expect(strays).toHaveLength(6);
  });

  it('matches buildStormZones for the zone half', () => {
    const reports = [
      report(45.0, -93.0), report(45.06, -93.08), report(45.12, -93.0),
      report(45.06, -92.92),
    ];
    expect(buildStormZones(reports)).toEqual(partitionStormReports(reports).zones);
  });
});
