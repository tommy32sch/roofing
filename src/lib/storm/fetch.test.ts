import { describe, it, expect } from 'vitest';
import { eachDate, planStormFetch, mapLimit } from './fetch';

describe('eachDate', () => {
  it('is inclusive of both ends', () => {
    expect(eachDate('2026-07-22', '2026-07-24')).toEqual(['2026-07-22', '2026-07-23', '2026-07-24']);
  });

  it('handles a single day', () => {
    expect(eachDate('2026-07-24', '2026-07-24')).toEqual(['2026-07-24']);
  });

  it('crosses month and year boundaries', () => {
    expect(eachDate('2026-01-31', '2026-02-01')).toEqual(['2026-01-31', '2026-02-01']);
    expect(eachDate('2025-12-31', '2026-01-01')).toEqual(['2025-12-31', '2026-01-01']);
  });

  it('includes the leap day', () => {
    expect(eachDate('2028-02-28', '2028-03-01')).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  // Walks in UTC on purpose: local-time arithmetic can repeat or skip a date
  // across a DST transition, which would double-fetch or silently lose a day.
  it('produces exactly one entry per day across a DST change', () => {
    expect(eachDate('2026-03-07', '2026-03-09')).toHaveLength(3);
    expect(eachDate('2026-10-31', '2026-11-02')).toHaveLength(3);
  });

  it('returns nothing for an inverted or malformed range', () => {
    expect(eachDate('2026-07-24', '2026-07-22')).toEqual([]);
    expect(eachDate('nope', '2026-07-24')).toEqual([]);
  });

  it('spans two years at the expected length', () => {
    // 2024-07-24 .. 2026-07-24 includes one leap day (2024-02-29 is outside it)
    expect(eachDate('2024-07-24', '2026-07-24')).toHaveLength(731);
  });
});

describe('planStormFetch', () => {
  // The real shape of the request: NOAA has archives through 2025, so the
  // current year must come from daily files.
  it('splits a two-year window into archive years plus current-year dailies', () => {
    const plan = planStormFetch('2024-07-24', '2026-07-24', [2020, 2021, 2022, 2023, 2024, 2025]);
    expect(plan.archiveYears).toEqual([2024, 2025]);
    expect(plan.dailyDates[0]).toBe('2026-01-01');
    expect(plan.dailyDates.at(-1)).toBe('2026-07-24');
    expect(plan.dailyDates).toHaveLength(205);
    // Two files replace 526 daily requests for 2024–2025.
    expect(plan.dailyDates.some((d) => d.startsWith('2024') || d.startsWith('2025'))).toBe(false);
  });

  it('uses only dailies when no archive is published', () => {
    const plan = planStormFetch('2026-07-22', '2026-07-24', []);
    expect(plan.archiveYears).toEqual([]);
    expect(plan.dailyDates).toHaveLength(3);
  });

  it('uses only the archive when the range sits inside published years', () => {
    const plan = planStormFetch('2025-03-01', '2025-03-05', [2025]);
    expect(plan.archiveYears).toEqual([2025]);
    expect(plan.dailyDates).toEqual([]);
  });

  // A partial year still comes from its archive file: the file holds the whole
  // year and the caller trims to the range.
  it('takes a partial year from the archive rather than day by day', () => {
    const plan = planStormFetch('2025-11-01', '2025-12-31', [2025]);
    expect(plan.archiveYears).toEqual([2025]);
    expect(plan.dailyDates).toEqual([]);
  });

  it('never lists a year in both plans', () => {
    const plan = planStormFetch('2025-12-30', '2026-01-02', [2025]);
    expect(plan.archiveYears).toEqual([2025]);
    expect(plan.dailyDates).toEqual(['2026-01-01', '2026-01-02']);
  });

  it('returns years sorted regardless of the order given', () => {
    const plan = planStormFetch('2024-01-01', '2025-12-31', [2025, 2024]);
    expect(plan.archiveYears).toEqual([2024, 2025]);
  });
});

describe('mapLimit', () => {
  it('preserves input order in the results', async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });

  // The politeness guarantee: NOAA must never see more than `limit` at once.
  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return null;
    });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('handles an empty list without hanging', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it('copes with a limit larger than the list', async () => {
    expect(await mapLimit([1, 2], 10, async (n) => n)).toEqual([1, 2]);
  });
});
