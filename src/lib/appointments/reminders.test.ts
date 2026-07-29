import { describe, it, expect } from 'vitest';
import {
  localDayKey,
  dayDifference,
  reminderKindFor,
  reminderDedupeKey,
  reminderWindow,
  formatLocalAppointment,
  planReminders,
  DEFAULT_TIME_ZONE,
} from './reminders';

const AZ = 'America/Phoenix';   // no DST, always UTC-7
const MN = 'America/Chicago';   // CST/CDT

describe('localDayKey', () => {
  it('reports the market-local day, not the UTC one', () => {
    // 02:00 UTC on the 30th is still the EVENING of the 29th in both markets.
    expect(localDayKey('2026-07-30T02:00:00Z', AZ)).toBe('2026-07-29');
    expect(localDayKey('2026-07-30T02:00:00Z', MN)).toBe('2026-07-29');
  });

  it('separates the two markets when the date rolls over between them', () => {
    // 05:30 UTC: 22:30 on the 29th in Phoenix, 00:30 on the 30th in Minneapolis.
    expect(localDayKey('2026-07-30T05:30:00Z', AZ)).toBe('2026-07-29');
    expect(localDayKey('2026-07-30T05:30:00Z', MN)).toBe('2026-07-30');
  });

  it('returns null for an unparseable instant', () => {
    expect(localDayKey('not-a-date', AZ)).toBeNull();
  });

  it('falls back to the default zone rather than throwing on a bad one', () => {
    expect(localDayKey('2026-07-29T20:00:00Z', 'Mars/Olympus')).toBe(
      localDayKey('2026-07-29T20:00:00Z', DEFAULT_TIME_ZONE)
    );
  });
});

describe('dayDifference', () => {
  it('counts calendar days', () => {
    expect(dayDifference('2026-07-29', '2026-07-30')).toBe(1);
    expect(dayDifference('2026-07-29', '2026-07-29')).toBe(0);
    expect(dayDifference('2026-07-30', '2026-07-29')).toBe(-1);
  });

  it('crosses month and year boundaries', () => {
    expect(dayDifference('2026-07-31', '2026-08-01')).toBe(1);
    expect(dayDifference('2026-12-31', '2027-01-01')).toBe(1);
  });

  // A 24h span is not a calendar day across a DST change; the keys are already
  // local dates, so the arithmetic must stay in whole days and never re-derive
  // an offset.
  it('is unaffected by DST, because it operates on local date keys', () => {
    expect(dayDifference('2026-11-01', '2026-11-02')).toBe(1);
    expect(dayDifference('2026-03-08', '2026-03-09')).toBe(1);
  });
});

describe('reminderKindFor', () => {
  // The cron runs 14:00 UTC = 07:00 Phoenix.
  const runAZ = '2026-07-29T14:00:00Z';

  it('sends the morning-of notice for an appointment later the same day', () => {
    // 10:00 Phoenix, three hours after the run.
    expect(reminderKindFor('2026-07-29T17:00:00Z', runAZ, AZ)).toBe('morning_of');
  });

  it('sends the day-before notice for an appointment tomorrow', () => {
    expect(reminderKindFor('2026-07-30T17:00:00Z', runAZ, AZ)).toBe('day_before');
  });

  it('sends nothing for an appointment further out', () => {
    expect(reminderKindFor('2026-08-02T17:00:00Z', runAZ, AZ)).toBeNull();
  });

  // Telling someone about a visit that already happened is worse than silence.
  it('sends nothing for an appointment already in the past', () => {
    expect(reminderKindFor('2026-07-29T13:00:00Z', runAZ, AZ)).toBeNull();
  });

  it('sends nothing for an appointment exactly now', () => {
    expect(reminderKindFor(runAZ, runAZ, AZ)).toBeNull();
  });

  it('rejects unparseable input rather than guessing', () => {
    expect(reminderKindFor('nonsense', runAZ, AZ)).toBeNull();
    expect(reminderKindFor('2026-07-29T17:00:00Z', 'nonsense', AZ)).toBeNull();
  });

  // The reason markets carry their own zone: the SAME instant is a different
  // calendar day in each office, so it earns a different reminder.
  it('classifies one instant differently per market', () => {
    const run = '2026-07-30T04:00:00Z'; // 21:00 on the 29th AZ, 23:00 on the 29th MN
    const appointment = '2026-07-30T15:00:00Z';
    expect(reminderKindFor(appointment, run, AZ)).toBe('day_before');
    expect(reminderKindFor(appointment, run, MN)).toBe('day_before');

    // Push the run past Minneapolis midnight but not Phoenix's.
    const later = '2026-07-30T06:00:00Z'; // 23:00 on the 29th AZ, 01:00 on the 30th MN
    expect(reminderKindFor(appointment, later, AZ)).toBe('day_before');
    expect(reminderKindFor(appointment, later, MN)).toBe('morning_of');
  });

  // Arizona ignores DST while Minnesota shifts; a fixed offset would misfile
  // one of them on these dates.
  it('stays correct across the US DST transitions', () => {
    // Spring forward: 2026-03-08.
    const springRun = '2026-03-08T14:00:00Z';
    expect(reminderKindFor('2026-03-08T18:00:00Z', springRun, MN)).toBe('morning_of');
    expect(reminderKindFor('2026-03-09T18:00:00Z', springRun, MN)).toBe('day_before');
    // Fall back: 2026-11-01.
    const fallRun = '2026-11-01T14:00:00Z';
    expect(reminderKindFor('2026-11-01T20:00:00Z', fallRun, MN)).toBe('morning_of');
    expect(reminderKindFor('2026-11-02T20:00:00Z', fallRun, MN)).toBe('day_before');
  });
});

describe('reminderDedupeKey', () => {
  const base = {
    appointmentId: 'appt-1',
    scheduledAt: '2026-07-30T17:00:00Z',
    kind: 'day_before' as const,
    recipient: 'rep@example.com',
  };

  it('is stable for the same reminder', () => {
    expect(reminderDedupeKey(base)).toBe(reminderDedupeKey({ ...base }));
  });

  // The point of including scheduled_at: a rescheduled appointment must be able
  // to send a fresh reminder rather than look already-notified.
  it('changes when the appointment is rescheduled', () => {
    const moved = { ...base, scheduledAt: '2026-07-30T21:00:00Z' };
    expect(reminderDedupeKey(moved)).not.toBe(reminderDedupeKey(base));
  });

  it('separates the two reminder kinds and the recipients', () => {
    expect(reminderDedupeKey({ ...base, kind: 'morning_of' })).not.toBe(reminderDedupeKey(base));
    expect(reminderDedupeKey({ ...base, recipient: 'other@example.com' })).not.toBe(
      reminderDedupeKey(base)
    );
  });

  it('treats recipient casing and padding as the same person', () => {
    expect(reminderDedupeKey({ ...base, recipient: '  REP@Example.com ' })).toBe(
      reminderDedupeKey(base)
    );
  });

  it('normalises equivalent instants written differently', () => {
    expect(reminderDedupeKey({ ...base, scheduledAt: '2026-07-30T17:00:00.000Z' })).toBe(
      reminderDedupeKey(base)
    );
  });
});

describe('reminderWindow', () => {
  it('spans now to 48 hours out', () => {
    const w = reminderWindow('2026-07-29T14:00:00Z');
    expect(w).toEqual({ start: '2026-07-29T14:00:00.000Z', end: '2026-07-31T14:00:00.000Z' });
  });

  it('returns null for a bad instant', () => {
    expect(reminderWindow('nope')).toBeNull();
  });

  // The window has to be wide enough that "tomorrow, local" is always inside it
  // for every market offset — 48h covers the worst case.
  it('contains every appointment that could earn a reminder', () => {
    const now = '2026-07-29T14:00:00Z';
    const w = reminderWindow(now)!;
    for (const tz of [AZ, MN]) {
      for (let h = 1; h < 48; h++) {
        const at = new Date(Date.parse(now) + h * 3_600_000).toISOString();
        if (reminderKindFor(at, now, tz)) {
          expect(at >= w.start && at <= w.end).toBe(true);
        }
      }
    }
  });
});

describe('formatLocalAppointment', () => {
  it('renders in the market clock with its zone name', () => {
    const az = formatLocalAppointment('2026-07-29T17:00:00Z', AZ);
    expect(az).toContain('10:00');
    expect(az).toMatch(/MST|GMT-7/);
  });

  it('shows the same instant differently per market', () => {
    const iso = '2026-07-29T17:00:00Z';
    expect(formatLocalAppointment(iso, AZ)).not.toBe(formatLocalAppointment(iso, MN));
  });

  it('returns an empty string rather than "Invalid Date"', () => {
    expect(formatLocalAppointment('nope', AZ)).toBe('');
  });

  it('survives an unknown zone', () => {
    expect(formatLocalAppointment('2026-07-29T17:00:00Z', 'Mars/Olympus')).not.toBe('');
  });
});

describe('planReminders', () => {
  const now = '2026-07-29T14:00:00Z';
  const appointments = [
    { id: 'today', scheduled_at: '2026-07-29T17:00:00Z', timeZone: AZ },
    { id: 'tomorrow', scheduled_at: '2026-07-30T17:00:00Z', timeZone: AZ },
    { id: 'next-week', scheduled_at: '2026-08-05T17:00:00Z', timeZone: AZ },
    { id: 'past', scheduled_at: '2026-07-29T12:00:00Z', timeZone: AZ },
  ];

  it('plans only the appointments that are due, with the right label', () => {
    const out = planReminders(appointments, now, () => ['rep@example.com']);
    expect(out.map((r) => [r.appointmentId, r.kind])).toEqual([
      ['today', 'morning_of'],
      ['tomorrow', 'day_before'],
    ]);
  });

  it('fans out to every recipient', () => {
    const out = planReminders(appointments, now, () => ['a@x.com', 'b@x.com']);
    expect(out).toHaveLength(4);
    expect(new Set(out.map((r) => r.dedupeKey)).size).toBe(4);
  });

  it('skips appointments with no one to notify', () => {
    expect(planReminders(appointments, now, () => [])).toEqual([]);
  });

  it('drops blank recipients instead of emailing nobody', () => {
    const out = planReminders(appointments, now, () => ['', '   ', 'real@x.com']);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.dedupeKey.endsWith('real@x.com'))).toBe(true);
  });

  it('falls back to the default zone when a market has none', () => {
    const out = planReminders(
      [{ id: 'a', scheduled_at: '2026-07-29T17:00:00Z', timeZone: null }],
      now,
      () => ['rep@example.com']
    );
    expect(out[0].timeZone).toBe(DEFAULT_TIME_ZONE);
  });
});
