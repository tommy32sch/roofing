import type { UserRole } from '@/types';

/**
 * Pure logic behind the Today screen.
 *
 * Kept free of React, the DOM and the database so the parts that are easy to get
 * subtly wrong — the day boundary across two timezones, and overdue vs due-today
 * — are unit-testable.
 */

/** Whose work the screen shows. */
export type TodayScope = 'mine' | 'all';

/**
 * Which scope a role should land on.
 *
 * Reps get their own book, because the whole point of the screen is "my day".
 * Admins get the team, because they are usually looking at coverage rather than
 * working leads themselves — and an admin typically has nothing assigned.
 */
export function defaultScope(role: UserRole): TodayScope {
  return role === 'admin' ? 'all' : 'mine';
}

export interface DayBounds {
  /** Local midnight, as an instant. */
  start: string;
  /** Next local midnight, as an instant. Exclusive upper bound. */
  end: string;
  /** The local calendar date, "YYYY-MM-DD". */
  date: string;
}

/**
 * The caller's local day, expressed both as instants and as a calendar date.
 *
 * Computed from the DEVICE clock rather than on the server. "Today" genuinely
 * differs between the Arizona office (MST, no DST) and the Minnesota one
 * (CST/CDT): a server working in UTC would start showing a Phoenix rep
 * tomorrow's appointments from 5pm local onward. The device is the only thing
 * that reliably knows what day it is where the rep is standing.
 *
 * Two representations because the columns differ: lead_appointments.scheduled_at
 * is a TIMESTAMPTZ and needs instants, while leads.follow_up_date is a plain
 * DATE and needs a calendar date.
 */
export function localDayBounds(now: Date): DayBounds {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Day + 1 via setDate handles month/year rollover and DST-shifted days, which
  // "+ 86400000" does not — a spring-forward day is only 23 hours long.
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
  };
}

export type FollowUpUrgency = 'overdue' | 'today' | 'upcoming';

/**
 * Where a follow-up sits relative to the rep's today.
 *
 * Compares "YYYY-MM-DD" strings directly. Both sides are already calendar dates,
 * and lexicographic order matches chronological order for this format — so this
 * deliberately never constructs a Date. `new Date('2026-07-24')` parses as UTC
 * midnight, which lands on the previous day for anyone in the Americas and would
 * mark today's follow-ups overdue.
 */
export function followUpUrgency(followUpDate: string, today: string): FollowUpUrgency {
  if (followUpDate < today) return 'overdue';
  if (followUpDate === today) return 'today';
  return 'upcoming';
}

/** Sort key so overdue floats above today, oldest promise first within each. */
export function compareFollowUps(
  a: { follow_up_date: string | null },
  b: { follow_up_date: string | null }
): number {
  // Nulls shouldn't reach here (the query requires the column) but must not
  // throw if they do.
  if (!a.follow_up_date) return 1;
  if (!b.follow_up_date) return -1;
  return a.follow_up_date < b.follow_up_date ? -1 : a.follow_up_date > b.follow_up_date ? 1 : 0;
}

/**
 * Validate the day window a client sent.
 *
 * The client supplies the boundary, so the server must not trust it blindly: a
 * malformed or absurd range would quietly turn "today" into "everything".
 */
export function isValidDayWindow(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return false;
  // One local day is 23–25h depending on DST. Anything past 48h is not a day.
  return e - s <= 48 * 60 * 60 * 1000;
}

/** Validate the "YYYY-MM-DD" calendar date a client sent. */
export function isValidDateString(date: string | null): date is string {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date);
}
