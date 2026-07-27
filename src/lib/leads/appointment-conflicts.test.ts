import { describe, it, expect } from 'vitest';
import {
  findConflicts,
  conflictWindow,
  conflictSummary,
  APPOINTMENT_SLOT_MINUTES,
  type ExistingAppointment,
} from './appointment-conflicts';

const at = (iso: string, id = iso, name?: string): ExistingAppointment => ({
  id,
  scheduled_at: iso,
  appointment_type: 'inspection',
  leads: name ? { first_name: name, last_name: 'Test' } : null,
});

describe('findConflicts', () => {
  const TEN = '2026-08-03T17:00:00.000Z'; // 10:00 Phoenix

  it('flags an exact double-booking', () => {
    const c = findConflicts(TEN, [at(TEN)]);
    expect(c).toHaveLength(1);
    expect(c[0].minutesApart).toBe(0);
  });

  it('flags a booking part-way through the slot', () => {
    expect(findConflicts(TEN, [at('2026-08-03T17:30:00.000Z')])[0].minutesApart).toBe(30);
    expect(findConflicts(TEN, [at('2026-08-03T16:30:00.000Z')])[0].minutesApart).toBe(30);
  });

  // Back-to-back is the normal way to run a day — 10:00 and 11:00 must both be
  // bookable, or the warning fires constantly and gets ignored.
  it('does not flag back-to-back bookings at exactly one slot apart', () => {
    expect(findConflicts(TEN, [at('2026-08-03T18:00:00.000Z')])).toEqual([]);
    expect(findConflicts(TEN, [at('2026-08-03T16:00:00.000Z')])).toEqual([]);
  });

  it('does not flag bookings well clear of the slot', () => {
    expect(findConflicts(TEN, [at('2026-08-03T21:00:00.000Z')])).toEqual([]);
    expect(findConflicts(TEN, [at('2026-08-04T17:00:00.000Z')])).toEqual([]);
  });

  // Rescheduling an appointment must not report it clashing with itself.
  it('excludes the appointment being rescheduled', () => {
    const existing = [at(TEN, 'appt-1')];
    expect(findConflicts(TEN, existing, { excludeId: 'appt-1' })).toEqual([]);
    expect(findConflicts(TEN, existing, { excludeId: 'other' })).toHaveLength(1);
  });

  it('orders the closest clash first', () => {
    const c = findConflicts(TEN, [
      at('2026-08-03T17:45:00.000Z', 'far'),
      at('2026-08-03T17:05:00.000Z', 'near'),
    ]);
    expect(c.map((x) => x.id)).toEqual(['near', 'far']);
  });

  it('carries the lead name through for the warning', () => {
    expect(findConflicts(TEN, [at(TEN, 'a', 'Chao')])[0].leadName).toBe('Chao Test');
    expect(findConflicts(TEN, [at(TEN, 'a')])[0].leadName).toBeNull();
  });

  it('returns nothing rather than throwing on malformed input', () => {
    expect(findConflicts('not-a-date', [at(TEN)])).toEqual([]);
    expect(findConflicts(TEN, [{ id: 'x', scheduled_at: 'nope' }])).toEqual([]);
    expect(findConflicts(TEN, [])).toEqual([]);
  });

  it('honours a custom slot length', () => {
    const half = { slotMinutes: 30 };
    // 45 min away clashes on a 60-min slot but not on a 30-min one.
    expect(findConflicts(TEN, [at('2026-08-03T17:45:00.000Z')])).toHaveLength(1);
    expect(findConflicts(TEN, [at('2026-08-03T17:45:00.000Z')], half)).toEqual([]);
  });

  it('uses a one-hour slot by default', () => {
    expect(APPOINTMENT_SLOT_MINUTES).toBe(60);
  });
});

describe('conflictWindow', () => {
  it('spans one slot either side of the proposal', () => {
    const w = conflictWindow('2026-08-03T17:00:00.000Z')!;
    expect(w.start).toBe('2026-08-03T16:00:00.000Z');
    expect(w.end).toBe('2026-08-03T18:00:00.000Z');
  });

  // The window must contain every appointment findConflicts could flag, or a
  // real clash would be invisible to the server query.
  it('contains every conflict the matcher can find', () => {
    const proposed = '2026-08-03T17:00:00.000Z';
    const w = conflictWindow(proposed)!;
    for (const offset of [-59, -30, 0, 30, 59]) {
      const iso = new Date(Date.parse(proposed) + offset * 60_000).toISOString();
      expect(findConflicts(proposed, [at(iso)])).toHaveLength(1);
      expect(iso >= w.start && iso <= w.end).toBe(true);
    }
  });

  it('returns null for a malformed time', () => {
    expect(conflictWindow('nope')).toBeNull();
  });
});

describe('conflictSummary', () => {
  const fmt = () => '10:00 AM';

  it('is empty when there is nothing to report', () => {
    expect(conflictSummary([], fmt)).toBe('');
  });

  it('names the person and says how close it is', () => {
    const c = findConflicts('2026-08-03T17:00:00.000Z', [at('2026-08-03T17:00:00.000Z', 'a', 'Chao')]);
    expect(conflictSummary(c, fmt)).toBe('Already booked with Chao Test at 10:00 AM — at the same time.');
  });

  it('reports the gap when it is not an exact clash', () => {
    const c = findConflicts('2026-08-03T17:00:00.000Z', [at('2026-08-03T17:30:00.000Z', 'a', 'Chao')]);
    expect(conflictSummary(c, fmt)).toContain('30 min away');
  });

  it('counts the extras rather than listing them all', () => {
    const c = findConflicts('2026-08-03T17:00:00.000Z', [
      at('2026-08-03T17:00:00.000Z', 'a', 'Chao'),
      at('2026-08-03T17:10:00.000Z', 'b', 'Sam'),
    ]);
    expect(conflictSummary(c, fmt)).toContain('(+1 more)');
  });

  it('copes with an unnamed lead', () => {
    const c = findConflicts('2026-08-03T17:00:00.000Z', [at('2026-08-03T17:00:00.000Z', 'a')]);
    expect(conflictSummary(c, fmt)).toBe('Already booked at 10:00 AM — at the same time.');
  });
});
