import { describe, it, expect } from 'vitest';
import {
  STORM_TYPES,
  toggleStormType,
  countStormsByType,
  sortStormsForDrawing,
  stormLegendEntries,
  stormRadius,
  stormColor,
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
