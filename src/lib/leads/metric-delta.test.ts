import { describe, it, expect } from 'vitest';
import {
  metricDelta,
  isFavourable,
  formatDelta,
  formatBaseline,
  formatCurrency,
  previousPeriod,
  FLAT_THRESHOLD_PERCENT,
} from './metric-delta';

describe('metricDelta', () => {
  it('reports a rise', () => {
    const d = metricDelta(18420, 14850);
    expect(d.change).toBe(3570);
    expect(d.percent).toBeCloseTo(24.04, 1);
    expect(d.direction).toBe('up');
  });

  it('reports a fall', () => {
    const d = metricDelta(48, 59);
    expect(d.change).toBe(-11);
    expect(d.direction).toBe('down');
  });

  /**
   * Without a dead band every metric shows an arrow every period from ordinary
   * noise, and an indicator that is always lit says nothing.
   */
  it('treats movement below the threshold as flat', () => {
    expect(metricDelta(1002, 1000).direction).toBe('flat');
    expect(metricDelta(1000, 1000).direction).toBe('flat');
  });

  it('reports movement at the threshold', () => {
    const d = metricDelta(100 + FLAT_THRESHOLD_PERCENT, 100);
    expect(d.direction).toBe('up');
  });

  /**
   * 0 -> 12 is not "1200% up", it is the first twelve. Dividing by zero would
   * produce Infinity and render as garbage.
   */
  it('has no percentage when there was no baseline', () => {
    const d = metricDelta(12, 0);
    expect(d.percent).toBeNull();
    expect(d.direction).toBe('up');
    expect(formatDelta(d)).toBe('+12');
  });

  it('handles falling to zero', () => {
    const d = metricDelta(0, 40);
    expect(d.percent).toBe(-100);
    expect(d.direction).toBe('down');
  });

  it('stays flat when both periods are zero', () => {
    const d = metricDelta(0, 0);
    expect(d.percent).toBeNull();
    expect(d.direction).toBe('flat');
  });

  // Percentage is relative to the size of the baseline, not its sign.
  it('handles a negative baseline without inverting the direction', () => {
    const d = metricDelta(-5, -10);
    expect(d.change).toBe(5);
    expect(d.direction).toBe('up');
  });
});

describe('isFavourable', () => {
  /**
   * The distinction that stops a growing backlog being painted green. Direction
   * and goodness are different questions.
   */
  it('reads a rise as good or bad depending on the metric', () => {
    const rising = metricDelta(120, 100);
    expect(isFavourable(rising, true)).toBe(true);    // revenue
    expect(isFavourable(rising, false)).toBe(false);  // overdue follow-ups
  });

  it('reads a fall the same way, inverted', () => {
    const falling = metricDelta(80, 100);
    expect(isFavourable(falling, true)).toBe(false);
    expect(isFavourable(falling, false)).toBe(true);
  });

  it('has no opinion when nothing moved', () => {
    expect(isFavourable(metricDelta(100, 100), true)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats a percentage change with its sign', () => {
    expect(formatDelta(metricDelta(18420, 14850))).toBe('+24.0%');
    expect(formatDelta(metricDelta(14850, 18420))).toBe('-19.4%');
  });

  it('says so plainly when nothing changed', () => {
    expect(formatDelta(metricDelta(100, 100))).toBe('No change');
  });

  it('formats the baseline, optionally as currency', () => {
    expect(formatBaseline(metricDelta(59, 48))).toBe('vs 48');
    expect(formatBaseline(metricDelta(18420, 14850), formatCurrency)).toBe('vs $14,850');
  });

  // Cents are noise at dashboard scale.
  it('rounds currency to whole dollars', () => {
    expect(formatCurrency(18420.49)).toBe('$18,420');
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('previousPeriod', () => {
  /**
   * The same LENGTH immediately before, not the previous calendar month.
   * Calendar months are uneven, and a 28-day February would read as a slump
   * that never happened.
   */
  it('mirrors the window immediately before', () => {
    const start = new Date('2026-07-08T00:00:00.000Z');
    const end = new Date('2026-08-07T00:00:00.000Z'); // 30 days
    const prev = previousPeriod(start, end);
    expect(prev.end.toISOString()).toBe(start.toISOString());
    expect((prev.end.getTime() - prev.start.getTime())).toBe(end.getTime() - start.getTime());
    expect(prev.start.toISOString()).toBe('2026-06-08T00:00:00.000Z');
  });

  it('handles a single-day window', () => {
    const start = new Date('2026-08-07T00:00:00.000Z');
    const end = new Date('2026-08-08T00:00:00.000Z');
    const prev = previousPeriod(start, end);
    expect(prev.start.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });
});
