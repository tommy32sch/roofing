import { describe, it, expect } from 'vitest';
import {
  STORM_TYPES,
  toggleStormType,
  countStormsByType,
  sortStormsForDrawing,
  stormLegendEntries,
  stormRadius,
  stormColor,
  stormAgeDays,
  stormAgeBucket,
  stormAgeShort,
  stormZoneStyle,
  type StormReport,
  type StormType,
} from './map-constants';

const report = (type: StormType, value: number | null): StormReport => ({
  lat: 33.4,
  lon: -112,
  value,
  date: '2026-07-24',
  location: 'Phoenix',
  state: 'AZ',
  type,
});

describe('toggleStormType', () => {
  it('turns a type on and off', () => {
    expect(toggleStormType([], 'wind')).toEqual(['wind']);
    expect(toggleStormType(['wind'], 'wind')).toEqual([]);
  });

  // The point of the change: both overlays at once.
  it('allows wind and hail together', () => {
    expect(toggleStormType(['wind'], 'hail')).toEqual(['wind', 'hail']);
    expect(toggleStormType(['hail'], 'wind')).toEqual(['wind', 'hail']);
  });

  it('removes one and keeps the other', () => {
    expect(toggleStormType(['wind', 'hail'], 'wind')).toEqual(['hail']);
    expect(toggleStormType(['wind', 'hail'], 'hail')).toEqual(['wind']);
  });

  // Toolbar order must not depend on click order, or the buttons would reshuffle.
  it('normalises to STORM_TYPES order regardless of how it was built', () => {
    expect(toggleStormType(['hail'], 'wind')).toEqual(STORM_TYPES);
    expect(toggleStormType(['wind'], 'hail')).toEqual(STORM_TYPES);
  });
});

describe('countStormsByType', () => {
  it('counts each type independently', () => {
    const reports = [report('wind', 60), report('wind', 80), report('hail', 1.5)];
    expect(countStormsByType(reports)).toEqual({ wind: 2, hail: 1 });
  });

  it('reports zeros for an empty list', () => {
    expect(countStormsByType([])).toEqual({ wind: 0, hail: 0 });
  });
});

describe('sortStormsForDrawing', () => {
  // A 2" hail circle is wide enough to cover several wind points; the biggest
  // must be drawn first so it sits underneath and the small ones stay clickable.
  it('orders largest radius first', () => {
    const small = report('wind', 58);
    const big = report('hail', 2);
    const sorted = sortStormsForDrawing([small, big]);
    expect(stormRadius(sorted[0].type, sorted[0].value)).toBeGreaterThanOrEqual(
      stormRadius(sorted[1].type, sorted[1].value)
    );
    expect(sorted[0]).toBe(big);
  });

  it('does not mutate the input, which is React state', () => {
    const input = [report('wind', 58), report('hail', 2)];
    const copy = [...input];
    sortStormsForDrawing(input);
    expect(input).toEqual(copy);
  });

  it('handles null values without throwing', () => {
    expect(sortStormsForDrawing([report('wind', null), report('hail', null)])).toHaveLength(2);
  });
});

describe('stormLegendEntries', () => {
  it('is empty when no overlay is active', () => {
    expect(stormLegendEntries([])).toEqual([]);
  });

  it('shows only the active overlay', () => {
    expect(stormLegendEntries(['hail']).every((e) => e.label.includes('Hail') || e.label.includes('"'))).toBe(true);
    expect(stormLegendEntries(['wind']).some((e) => e.label.includes('Wind'))).toBe(true);
    expect(stormLegendEntries(['wind']).some((e) => e.label.includes('Hail'))).toBe(false);
  });

  // With both on, the legend has to explain both colour ramps or the map is
  // unreadable — amber-to-red wind next to cyan-to-violet hail.
  it('shows both ramps when both are active, wind first', () => {
    const entries = stormLegendEntries(['wind', 'hail']);
    expect(entries).toHaveLength(6);
    expect(entries[0].label).toContain('Wind');
    expect(entries.some((e) => e.label.includes('Hail'))).toBe(true);
  });

  it('gives every entry a unique key and its own colour', () => {
    const entries = stormLegendEntries(['wind', 'hail']);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    expect(entries[0].color).toBe(stormColor('wind', 58));
  });

  // Independent of the caller's array order, so the legend can't flip around.
  it('is stable regardless of input order', () => {
    expect(stormLegendEntries(['hail', 'wind'])).toEqual(stormLegendEntries(['wind', 'hail']));
  });
});

describe('storm age', () => {
  // Fixed "now" so the buckets are deterministic.
  const NOW = Date.parse('2026-07-26T12:00:00Z');
  const daysAgo = (n: number) =>
    new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

  it('counts whole days since the report', () => {
    expect(stormAgeDays(daysAgo(0), NOW)).toBe(0);
    expect(stormAgeDays(daysAgo(1), NOW)).toBe(1);
    expect(stormAgeDays(daysAgo(400), NOW)).toBe(400);
  });

  it('clamps a future date to 0 instead of going negative', () => {
    expect(stormAgeDays('2027-01-01', NOW)).toBe(0);
  });

  it('returns 0 rather than NaN on a malformed date', () => {
    expect(stormAgeDays('nope', NOW)).toBe(0);
  });

  it('buckets by the boundaries the business turns on', () => {
    expect(stormAgeBucket(daysAgo(5), NOW).key).toBe('fresh');
    expect(stormAgeBucket(daysAgo(30), NOW).key).toBe('fresh');
    expect(stormAgeBucket(daysAgo(31), NOW).key).toBe('recent');
    expect(stormAgeBucket(daysAgo(180), NOW).key).toBe('recent');
    expect(stormAgeBucket(daysAgo(181), NOW).key).toBe('aging');
    expect(stormAgeBucket(daysAgo(365), NOW).key).toBe('aging');
    // Past the usual one-year filing deadline.
    expect(stormAgeBucket(daysAgo(366), NOW).key).toBe('stale');
    expect(stormAgeBucket(daysAgo(720), NOW).key).toBe('stale');
  });

  it('fades monotonically with age, so newer always reads stronger', () => {
    const ops = [5, 90, 300, 700].map((d) => stormAgeBucket(daysAgo(d), NOW).fillOpacity);
    for (let i = 1; i < ops.length; i++) expect(ops[i]).toBeLessThan(ops[i - 1]);
  });

  it('gives only the freshest bucket a heavier ring', () => {
    expect(stormAgeBucket(daysAgo(5), NOW).weight).toBeGreaterThan(
      stormAgeBucket(daysAgo(90), NOW).weight
    );
  });
});

describe('sortStormsForDrawing with age', () => {
  const NOW = Date.parse('2026-07-26T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);
  const at = (type: StormType, value: number, days: number): StormReport => ({
    lat: 33, lon: -112, value, date: daysAgo(days), location: '', state: 'AZ', type,
  });

  // The whole point: a fresh report must never be buried under an old one.
  it('draws oldest first so recent reports land on top', () => {
    const old = at('hail', 2, 700);
    const fresh = at('wind', 58, 3);
    expect(sortStormsForDrawing([fresh, old], NOW).at(-1)).toBe(fresh);
    expect(sortStormsForDrawing([old, fresh], NOW).at(-1)).toBe(fresh);
  });

  it('still puts the bigger circle underneath within one age bucket', () => {
    const bigSameDay = at('hail', 2, 5);
    const smallSameDay = at('wind', 58, 5);
    const sorted = sortStormsForDrawing([smallSameDay, bigSameDay], NOW);
    expect(stormRadius(sorted[0].type, sorted[0].value)).toBeGreaterThanOrEqual(
      stormRadius(sorted[1].type, sorted[1].value)
    );
  });

  it('does not mutate the input, which is React state', () => {
    const input = [at('hail', 1, 10), at('wind', 60, 400)];
    const copy = [...input];
    sortStormsForDrawing(input, NOW);
    expect(input).toEqual(copy);
  });
});

describe('stormAgeShort', () => {
  const NOW = Date.parse('2026-07-26T12:00:00Z');
  const daysAgo = (n: number) =>
    new Date(NOW - n * 86_400_000).toISOString().slice(0, 10);

  // The label written on each zone — it must read instantly, so the unit
  // steps up as the number grows.
  it('picks the unit a person would say', () => {
    expect(stormAgeShort(daysAgo(0), NOW)).toBe('today');
    expect(stormAgeShort(daysAgo(3), NOW)).toBe('3d');
    expect(stormAgeShort(daysAgo(21), NOW)).toBe('3w');
    expect(stormAgeShort(daysAgo(240), NOW)).toBe('8mo');
    expect(stormAgeShort(daysAgo(400), NOW)).toBe('1y+');
    expect(stormAgeShort(daysAgo(730), NOW)).toBe('2y+');
  });

  it('never emits 0 of a larger unit at a boundary', () => {
    expect(stormAgeShort(daysAgo(7), NOW)).toBe('1w');
    expect(stormAgeShort(daysAgo(60), NOW)).toBe('2mo');
    expect(stormAgeShort(daysAgo(365), NOW)).toBe('1y+');
  });
});

describe('stormZoneStyle', () => {
  it('fades fill monotonically with age — the single-hue ramp', () => {
    const keys = ['fresh', 'recent', 'aging', 'stale'];
    const fills = keys.map((k) => stormZoneStyle(k).fillOpacity);
    for (let i = 1; i < fills.length; i++) expect(fills[i]).toBeLessThan(fills[i - 1]);
  });

  it('keeps every swath fill light enough for report dots to remain readable', () => {
    for (const key of ['fresh', 'recent', 'aging', 'stale']) {
      expect(stormZoneStyle(key).fillOpacity).toBeLessThanOrEqual(0.2);
    }
  });

  // Past the filing window a zone is context, not opportunity: outline only.
  it('gives stale zones no fill and a dashed outline', () => {
    expect(stormZoneStyle('stale').fillOpacity).toBe(0);
    expect(stormZoneStyle('stale').dashArray).toBeTruthy();
    expect(stormZoneStyle('fresh').dashArray).toBeUndefined();
  });

  it('falls back to stale for an unknown bucket', () => {
    expect(stormZoneStyle('nope')).toEqual(stormZoneStyle('stale'));
  });
});
