import { describe, it, expect } from 'vitest';
import {
  defaultScope,
  localDayBounds,
  followUpUrgency,
  compareFollowUps,
  isValidDayWindow,
  isValidDateString,
} from './today';

describe('defaultScope', () => {
  it('gives reps their own book and admins the team', () => {
    expect(defaultScope('setter')).toBe('mine');
    expect(defaultScope('closer')).toBe('mine');
    expect(defaultScope('admin')).toBe('all');
  });
});

describe('localDayBounds', () => {
  it('spans local midnight to the next local midnight', () => {
    const { start, end, date } = localDayBounds(new Date(2026, 6, 24, 14, 30));
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(end).getHours()).toBe(0);
    expect(new Date(end).getDate()).toBe(25);
    expect(date).toBe('2026-07-24');
  });

  // The whole reason the boundary is computed on the device: late in the day a
  // UTC-based server would already have rolled over to tomorrow for anyone in
  // the Americas, and the rep would see tomorrow's appointments.
  it('still reports the local date late at night', () => {
    expect(localDayBounds(new Date(2026, 6, 24, 23, 59)).date).toBe('2026-07-24');
    expect(localDayBounds(new Date(2026, 6, 24, 0, 1)).date).toBe('2026-07-24');
  });

  it('rolls over month and year ends', () => {
    expect(new Date(localDayBounds(new Date(2026, 6, 31, 9, 0)).end).getMonth()).toBe(7); // Aug
    const ny = localDayBounds(new Date(2026, 11, 31, 9, 0));
    expect(new Date(ny.end).getFullYear()).toBe(2027);
    expect(ny.date).toBe('2026-12-31');
  });

  it('pads single-digit months and days', () => {
    expect(localDayBounds(new Date(2026, 0, 5, 12, 0)).date).toBe('2026-01-05');
  });

  // A spring-forward day is 23h, not 24h. Adding 86400000ms would land an hour
  // into the following day; setDate(+1) lands on real local midnight.
  it('ends at midnight even on a short DST day', () => {
    const end = new Date(localDayBounds(new Date(2026, 2, 8, 12, 0)).end);
    expect(end.getHours()).toBe(0);
    expect(end.getDate()).toBe(9);
  });
});

describe('followUpUrgency', () => {
  const today = '2026-07-24';

  it('separates overdue, today and upcoming', () => {
    expect(followUpUrgency('2026-07-23', today)).toBe('overdue');
    expect(followUpUrgency('2026-07-24', today)).toBe('today');
    expect(followUpUrgency('2026-07-25', today)).toBe('upcoming');
  });

  // Guards the classic trap: new Date('2026-07-24') is UTC midnight, which is
  // the 23rd in every US timezone — today's follow-ups would read as overdue.
  it('does not misread today as overdue across a year or month edge', () => {
    expect(followUpUrgency('2026-01-01', '2026-01-01')).toBe('today');
    expect(followUpUrgency('2025-12-31', '2026-01-01')).toBe('overdue');
    expect(followUpUrgency('2026-08-01', '2026-07-31')).toBe('upcoming');
  });
});

describe('compareFollowUps', () => {
  it('puts the oldest promise first', () => {
    const rows = [
      { follow_up_date: '2026-07-24' },
      { follow_up_date: '2026-07-20' },
      { follow_up_date: '2026-07-22' },
    ];
    expect([...rows].sort(compareFollowUps).map((r) => r.follow_up_date)).toEqual([
      '2026-07-20',
      '2026-07-22',
      '2026-07-24',
    ]);
  });

  it('survives a null date instead of throwing', () => {
    const rows = [{ follow_up_date: null }, { follow_up_date: '2026-07-20' }];
    expect([...rows].sort(compareFollowUps)[0].follow_up_date).toBe('2026-07-20');
  });
});

describe('isValidDayWindow', () => {
  it('accepts a real day', () => {
    const { start, end } = localDayBounds(new Date(2026, 6, 24, 8, 0));
    expect(isValidDayWindow(start, end)).toBe(true);
  });

  // The client supplies the boundary, so an absurd range must not quietly turn
  // "today" into "everything".
  it('rejects missing, malformed, inverted and oversized ranges', () => {
    expect(isValidDayWindow(null, null)).toBe(false);
    expect(isValidDayWindow('not-a-date', '2026-07-25T00:00:00Z')).toBe(false);
    expect(isValidDayWindow('2026-07-25T00:00:00Z', '2026-07-24T00:00:00Z')).toBe(false);
    expect(isValidDayWindow('2026-07-24T00:00:00Z', '2026-07-24T00:00:00Z')).toBe(false);
    expect(isValidDayWindow('2026-07-01T00:00:00Z', '2026-07-31T00:00:00Z')).toBe(false);
  });

  it('still allows a 25-hour fall-back day', () => {
    expect(isValidDayWindow('2026-11-01T06:00:00Z', '2026-11-02T07:00:00Z')).toBe(true);
  });
});

describe('isValidDateString', () => {
  it('accepts YYYY-MM-DD only', () => {
    expect(isValidDateString('2026-07-24')).toBe(true);
    expect(isValidDateString('2026-7-4')).toBe(false);
    expect(isValidDateString('07/24/2026')).toBe(false);
    expect(isValidDateString(null)).toBe(false);
    expect(isValidDateString('')).toBe(false);
  });
});
