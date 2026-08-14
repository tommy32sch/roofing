import { describe, it, expect } from 'vitest';
import {
  calendarDays,
  calendarRange,
  shiftAnchor,
  normalizeAnchor,
  calendarLabel,
  calendarDateFromParam,
  calendarDateParam,
  calendarScopeAssignment,
  calendarViewFromParam,
  isCalendarDateParam,
  resolveCalendarScope,
  scheduleExceptions,
  weekdayLabels,
  WEEK_STARTS_ON,
  type ScheduleAppointmentFacts,
} from './calendar';

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe('calendarDays — week', () => {
  it('returns seven days starting on Monday', () => {
    // 2026-07-26 is a Sunday; its week starts Monday the 20th.
    const days = calendarDays('week', new Date(2026, 6, 26));
    expect(days).toHaveLength(7);
    expect(days[0].getDay()).toBe(WEEK_STARTS_ON);
    expect(iso(days[0])).toBe('2026-07-20');
    expect(iso(days[6])).toBe('2026-07-26');
  });

  it('spans a month boundary without a gap', () => {
    const days = calendarDays('week', new Date(2026, 6, 1)); // Wed 1 July
    expect(iso(days[0])).toBe('2026-06-29');
    expect(iso(days[6])).toBe('2026-07-05');
  });
});

describe('calendarDays — month', () => {
  it('starts on the Monday on or before the 1st', () => {
    // 1 July 2026 is a Wednesday, so the grid opens Monday 29 June.
    const days = calendarDays('month', new Date(2026, 6, 15));
    expect(iso(days[0])).toBe('2026-06-29');
    expect(days[0].getDay()).toBe(WEEK_STARTS_ON);
  });

  it('ends on the Sunday on or after the last day', () => {
    // 31 July 2026 is a Friday, so the grid closes Sunday 2 August.
    const days = calendarDays('month', new Date(2026, 6, 15));
    expect(iso(days[days.length - 1])).toBe('2026-08-02');
  });

  it('always renders whole weeks', () => {
    for (let month = 0; month < 12; month++) {
      const days = calendarDays('month', new Date(2026, month, 15));
      expect(days.length % 7).toBe(0);
      expect(days.length).toBeGreaterThanOrEqual(28);
      expect(days.length).toBeLessThanOrEqual(42);
    }
  });

  it('contains every day of the month exactly once', () => {
    const days = calendarDays('month', new Date(2026, 6, 15)).map(iso);
    for (let d = 1; d <= 31; d++) {
      const day = `2026-07-${String(d).padStart(2, '0')}`;
      expect(days.filter((x) => x === day)).toHaveLength(1);
    }
  });

  it('handles February and a leap February', () => {
    expect(calendarDays('month', new Date(2026, 1, 10)).map(iso)).toContain('2026-02-28');
    const leap = calendarDays('month', new Date(2028, 1, 10)).map(iso);
    expect(leap).toContain('2028-02-29');
  });

  // Stepping by calendar day rather than +24h: a spring-forward day is 23 hours,
  // so millisecond arithmetic would drop or duplicate a date across the month.
  it('produces no duplicate or missing days across a DST change', () => {
    for (const anchor of [new Date(2026, 2, 15), new Date(2026, 10, 15)]) {
      const days = calendarDays('month', anchor).map(iso);
      expect(new Set(days).size).toBe(days.length);
    }
  });
});

describe('calendarRange', () => {
  it('covers the whole visible grid, not just the month', () => {
    // Appointments on the leading/trailing days must be real, or the last row
    // of June looks empty while viewing July.
    const { start, end } = calendarRange('month', new Date(2026, 6, 15));
    expect(iso(start)).toBe('2026-06-29');
    expect(iso(end)).toBe('2026-08-03'); // exclusive: day after Sun 2 Aug
  });

  it('gives an exclusive end for a week too', () => {
    const { start, end } = calendarRange('week', new Date(2026, 6, 22));
    expect(iso(start)).toBe('2026-07-20');
    expect(iso(end)).toBe('2026-07-27');
  });

  // The appointments API rejects windows over 90 days.
  it('never exceeds the API window cap', () => {
    for (let month = 0; month < 12; month++) {
      const { start, end } = calendarRange('month', new Date(2026, month, 15));
      const days = (end.getTime() - start.getTime()) / 86_400_000;
      expect(days).toBeLessThanOrEqual(43);
    }
  });
});

describe('shiftAnchor', () => {
  it('moves a week at a time in week view', () => {
    expect(iso(shiftAnchor('week', new Date(2026, 6, 20), 1))).toBe('2026-07-27');
    expect(iso(shiftAnchor('week', new Date(2026, 6, 20), -1))).toBe('2026-07-13');
  });

  it('moves a month at a time in month view', () => {
    expect(iso(shiftAnchor('month', new Date(2026, 6, 1), 1))).toBe('2026-08-01');
    expect(iso(shiftAnchor('month', new Date(2026, 6, 1), -1))).toBe('2026-06-01');
  });

  it('rolls over the year end', () => {
    expect(iso(shiftAnchor('month', new Date(2026, 11, 1), 1))).toBe('2027-01-01');
    expect(iso(shiftAnchor('month', new Date(2026, 0, 1), -1))).toBe('2025-12-01');
  });

  // Jan 31 + 1 month must not land in March.
  it('clamps when the next month is shorter', () => {
    expect(iso(shiftAnchor('month', new Date(2026, 0, 31), 1))).toBe('2026-02-28');
  });
});

describe('normalizeAnchor', () => {
  it('snaps to the start of the week or month', () => {
    expect(iso(normalizeAnchor('week', new Date(2026, 6, 23)))).toBe('2026-07-20');
    expect(iso(normalizeAnchor('month', new Date(2026, 6, 23)))).toBe('2026-07-01');
  });

  // Switching views should keep you near where you were looking.
  it('keeps the month a week belongs to when switching to month view', () => {
    expect(iso(normalizeAnchor('month', new Date(2026, 6, 20)))).toBe('2026-07-01');
  });
});

describe('calendarLabel', () => {
  it('names the month in month view', () => {
    expect(calendarLabel('month', new Date(2026, 6, 1))).toBe('July 2026');
  });

  it('does not repeat the month for a week inside one', () => {
    expect(calendarLabel('week', new Date(2026, 6, 20))).toBe('Jul 20 – 26, 2026');
  });

  it('names both months for a week that straddles them', () => {
    expect(calendarLabel('week', new Date(2026, 6, 1))).toBe('Jun 29 – Jul 5, 2026');
  });
});

describe('weekdayLabels', () => {
  it('starts on the same weekday as the grid', () => {
    expect(weekdayLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });
});

describe('calendar URL state', () => {
  it('round trips a local date without converting it through UTC', () => {
    const date = new Date(2026, 7, 14);
    expect(calendarDateParam(date)).toBe('2026-08-14');
    expect(calendarDateParam(calendarDateFromParam('2026-08-14', new Date(2020, 0, 1))))
      .toBe('2026-08-14');
  });

  it('rejects impossible dates and uses the local fallback day', () => {
    const fallback = new Date(2026, 6, 20, 15, 30);
    expect(isCalendarDateParam('2026-02-30')).toBe(false);
    expect(calendarDateParam(calendarDateFromParam('2026-02-30', fallback))).toBe('2026-07-20');
  });

  it('accepts only the two supported views', () => {
    expect(calendarViewFromParam('month')).toBe('month');
    expect(calendarViewFromParam('agenda')).toBe('week');
    expect(calendarViewFromParam(null)).toBe('week');
  });
});

describe('calendar team scope', () => {
  const SETTER_ID = '11111111-1111-4111-8111-111111111111';
  const CLOSER_ID = '22222222-2222-4222-8222-222222222222';

  it('defaults admins to all and reps to mine', () => {
    expect(resolveCalendarScope('admin', null)).toEqual({ ok: true, scope: 'all' });
    expect(resolveCalendarScope('setter', null)).toEqual({ ok: true, scope: 'mine' });
    expect(resolveCalendarScope('closer', null)).toEqual({ ok: true, scope: 'mine' });
  });

  it('lets an admin select one setter or closer', () => {
    expect(resolveCalendarScope('admin', `setter:${SETTER_ID}`)).toEqual({
      ok: true,
      scope: `setter:${SETTER_ID}`,
    });
    expect(calendarScopeAssignment(`closer:${CLOSER_ID}`)).toEqual({
      column: 'assigned_closer_id',
      accountId: CLOSER_ID,
    });
  });

  it('does not let a rep widen or switch the schedule through the URL', () => {
    expect(resolveCalendarScope('setter', 'all')).toMatchObject({ ok: false, status: 403 });
    expect(resolveCalendarScope('closer', `setter:${SETTER_ID}`)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it('rejects malformed person scopes before a query runs', () => {
    expect(resolveCalendarScope('admin', 'setter:not-a-uuid')).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(resolveCalendarScope('admin', 'everyone')).toMatchObject({ ok: false, status: 400 });
  });
});

describe('scheduleExceptions', () => {
  const appointment = (
    id: string,
    overrides: Partial<ScheduleAppointmentFacts> = {}
  ): ScheduleAppointmentFacts => ({
    id,
    appointment_type: 'inspection',
    scheduled_at: '2026-08-14T17:00:00.000Z',
    outcome: 'scheduled',
    market_id: 1,
    assigned_setter_id: 'setter-1',
    assigned_closer_id: 'closer-1',
    ...overrides,
  });

  it('shows missing ownership and an overdue result on unresolved inspections', () => {
    const result = scheduleExceptions([
      appointment('a', {
        assigned_setter_id: null,
        assigned_closer_id: null,
      }),
    ], '2026-08-14T18:00:00.000Z');

    expect(result.a).toEqual(['missing_setter', 'missing_closer', 'overdue_outcome']);
  });

  it('requires a closer but not a setter for an adjuster visit', () => {
    const result = scheduleExceptions([
      appointment('a', {
        appointment_type: 'adjuster',
        assigned_setter_id: null,
        assigned_closer_id: null,
      }),
    ], '2026-08-14T16:00:00.000Z');

    expect(result.a).toEqual(['missing_closer']);
  });

  it('flags two unresolved starts inside one hour for the same owner', () => {
    const result = scheduleExceptions([
      appointment('a'),
      appointment('b', {
        scheduled_at: '2026-08-14T17:30:00.000Z',
        assigned_setter_id: 'setter-2',
        assigned_closer_id: 'closer-2',
      }),
    ], '2026-08-14T16:00:00.000Z');

    expect(result.a).toContain('conflict');
    expect(result.b).toContain('conflict');
  });

  it('does not flag back-to-back, different-market, or settled appointments', () => {
    const result = scheduleExceptions([
      appointment('a'),
      appointment('back-to-back', { scheduled_at: '2026-08-14T18:00:00.000Z' }),
      appointment('different-market', {
        scheduled_at: '2026-08-14T17:15:00.000Z',
        market_id: 2,
        assigned_setter_id: 'setter-2',
        assigned_closer_id: 'closer-2',
      }),
      appointment('settled', {
        scheduled_at: '2026-08-14T17:10:00.000Z',
        outcome: 'completed',
        assigned_setter_id: null,
        assigned_closer_id: null,
      }),
    ], '2026-08-14T16:00:00.000Z');

    expect(result.a).toEqual([]);
    expect(result['back-to-back']).toEqual([]);
    expect(result['different-market']).toEqual([]);
    expect(result.settled).toEqual([]);
  });
});
