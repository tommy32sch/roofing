import { describe, it, expect } from 'vitest';
import {
  FOLLOW_UP_PRESETS,
  relativeFollowUpDate,
  describeFollowUp,
  daysBetween,
} from './follow-up';

describe('relativeFollowUpDate', () => {
  it('adds whole days', () => {
    const now = new Date(2026, 6, 24, 9, 0);
    expect(relativeFollowUpDate(now, 1)).toBe('2026-07-25');
    expect(relativeFollowUpDate(now, 2)).toBe('2026-07-26');
    expect(relativeFollowUpDate(now, 7)).toBe('2026-07-31');
    expect(relativeFollowUpDate(now, 0)).toBe('2026-07-24');
  });

  // The reason this doesn't go through toISOString(): in the evening, UTC is
  // already tomorrow for the Americas, so a UTC-derived "tomorrow" would land
  // two days out — or "today" would land on tomorrow.
  it('uses the local date late in the evening', () => {
    expect(relativeFollowUpDate(new Date(2026, 6, 24, 23, 45), 1)).toBe('2026-07-25');
    expect(relativeFollowUpDate(new Date(2026, 6, 24, 0, 15), 1)).toBe('2026-07-25');
  });

  it('rolls over month and year boundaries', () => {
    expect(relativeFollowUpDate(new Date(2026, 6, 31, 9, 0), 1)).toBe('2026-08-01');
    expect(relativeFollowUpDate(new Date(2026, 11, 28, 9, 0), 7)).toBe('2027-01-04');
    expect(relativeFollowUpDate(new Date(2028, 1, 28, 9, 0), 1)).toBe('2028-02-29'); // leap year
  });

  // setDate(+n) rather than +n*86400000: a spring-forward day is 23 hours, so
  // millisecond arithmetic would land on the previous date.
  it('is unaffected by a DST transition', () => {
    expect(relativeFollowUpDate(new Date(2026, 2, 7, 9, 0), 1)).toBe('2026-03-08');
    expect(relativeFollowUpDate(new Date(2026, 2, 8, 9, 0), 1)).toBe('2026-03-09');
    expect(relativeFollowUpDate(new Date(2026, 10, 1, 9, 0), 1)).toBe('2026-11-02');
  });

  it('pads single-digit months and days', () => {
    expect(relativeFollowUpDate(new Date(2026, 0, 4, 9, 0), 1)).toBe('2026-01-05');
  });

  it('every preset produces a date strictly in the future', () => {
    const now = new Date(2026, 6, 24, 9, 0);
    const today = relativeFollowUpDate(now, 0);
    for (const p of FOLLOW_UP_PRESETS) {
      expect(relativeFollowUpDate(now, p.days) > today).toBe(true);
    }
  });
});

describe('daysBetween', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween('2026-07-24', '2026-07-25')).toBe(1);
    expect(daysBetween('2026-07-24', '2026-07-24')).toBe(0);
    expect(daysBetween('2026-07-25', '2026-07-24')).toBe(-1);
    expect(daysBetween('2026-07-24', '2026-08-03')).toBe(10);
  });

  // Anchoring at UTC noon keeps a DST-shifted day from rounding to 0 or 2.
  it('stays exact across a DST boundary', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it('returns 0 rather than NaN on malformed input', () => {
    expect(daysBetween('nope', '2026-07-24')).toBe(0);
  });
});

describe('describeFollowUp', () => {
  const today = '2026-07-24';

  it('names the near dates', () => {
    expect(describeFollowUp('2026-07-24', today)).toBe('Today');
    expect(describeFollowUp('2026-07-25', today)).toBe('Tomorrow');
    expect(describeFollowUp('2026-07-23', today)).toBe('Yesterday');
    expect(describeFollowUp('2026-07-27', today)).toBe('In 3 days');
    expect(describeFollowUp('2026-07-20', today)).toBe('4 days ago');
  });

  it('falls back to the raw date beyond a week', () => {
    expect(describeFollowUp('2026-08-30', today)).toBe('2026-08-30');
  });
});
