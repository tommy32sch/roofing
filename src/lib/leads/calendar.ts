import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { AppointmentOutcome, AppointmentType, UserRole } from '@/types';
import { APPOINTMENT_SLOT_MINUTES } from './appointment-conflicts';

/**
 * Week/month view maths for the calendar.
 *
 * Kept pure and separate because this is where calendars quietly break: a month
 * grid has to start on the same weekday as the week view, spill into the
 * neighbouring months, and survive DST transitions and month lengths without
 * dropping or duplicating a day.
 */

export type CalendarView = 'week' | 'month';

export type CalendarScope =
  | 'all'
  | 'mine'
  | `setter:${string}`
  | `closer:${string}`;

export type CalendarScopeDecision =
  | { ok: true; scope: CalendarScope }
  | { ok: false; status: 400 | 403; error: string };

export type ScheduleExceptionCode =
  | 'conflict'
  | 'missing_setter'
  | 'missing_closer'
  | 'overdue_outcome';

export interface ScheduleAppointmentFacts {
  id: string;
  appointment_type: AppointmentType;
  scheduled_at: string;
  outcome: AppointmentOutcome;
  market_id: number | null;
  assigned_setter_id: string | null;
  assigned_closer_id: string | null;
}

const DATE_PARAM = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Monday. Matches the existing week view and how a crew's week is planned. */
export const WEEK_STARTS_ON = 1 as const;

/** A local calendar date for URL state. It never shifts through UTC. */
export function calendarDateParam(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function isCalendarDateParam(value: string | null | undefined): value is string {
  const match = value?.match(DATE_PARAM);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const parsed = new Date(year, month, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month &&
    parsed.getDate() === day
  );
}

/**
 * Parse a URL date at local midnight.
 *
 * `new Date('2026-08-14')` is UTC midnight and becomes the prior date in the
 * Americas. Build the local date from its parts so a shared schedule URL opens
 * on the date printed in the URL.
 */
export function calendarDateFromParam(value: string | null | undefined, fallback: Date): Date {
  const fallbackDay = new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  if (!isCalendarDateParam(value)) return fallbackDay;
  const match = value.match(DATE_PARAM)!;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  return new Date(year, month, day);
}

export function calendarViewFromParam(value: string | null | undefined): CalendarView {
  return value === 'month' ? 'month' : 'week';
}

/**
 * Resolve the requested schedule owner before a service-role query runs.
 *
 * Admins can inspect the team, their own assigned leads, or one setter/closer.
 * Reps are fixed to their assignment boundary even if they edit the URL.
 */
export function resolveCalendarScope(
  role: UserRole,
  requested: string | null | undefined
): CalendarScopeDecision {
  const scope = requested || (role === 'admin' ? 'all' : 'mine');
  const isPerson = /^(setter|closer):/.test(scope);

  if (
    scope !== 'all' &&
    scope !== 'mine' &&
    (!isPerson || !UUID.test(scope.slice(scope.indexOf(':') + 1)))
  ) {
    return { ok: false, status: 400, error: 'Invalid calendar scope' };
  }

  if (role !== 'admin' && scope !== 'mine') {
    return { ok: false, status: 403, error: 'Team schedules are limited to admins' };
  }

  return { ok: true, scope: scope as CalendarScope };
}

export function calendarScopeAssignment(
  scope: CalendarScope
): { column: 'assigned_setter_id' | 'assigned_closer_id'; accountId: string } | null {
  if (scope.startsWith('setter:')) {
    return { column: 'assigned_setter_id', accountId: scope.slice('setter:'.length) };
  }
  if (scope.startsWith('closer:')) {
    return { column: 'assigned_closer_id', accountId: scope.slice('closer:'.length) };
  }
  return null;
}

/**
 * Classify schedule exceptions from one visible response.
 *
 * Only unresolved bookings create operational exceptions. An inspection needs
 * both setter and closer ownership; an adjuster visit needs a closer. A clash
 * uses the same market and one-hour slot as the booking guard. Separate offices
 * can use the same wall time without creating a false company-wide conflict.
 */
export function scheduleExceptions(
  appointments: ScheduleAppointmentFacts[],
  nowIso: string
): Record<string, ScheduleExceptionCode[]> {
  const result: Record<string, ScheduleExceptionCode[]> = Object.fromEntries(
    appointments.map((appointment) => [appointment.id, [] as ScheduleExceptionCode[]])
  );
  const now = Date.parse(nowIso);

  for (const appointment of appointments) {
    if (appointment.outcome !== 'scheduled') continue;
    if (appointment.appointment_type === 'inspection' && !appointment.assigned_setter_id) {
      result[appointment.id].push('missing_setter');
    }
    if (!appointment.assigned_closer_id) result[appointment.id].push('missing_closer');

    const scheduledAt = Date.parse(appointment.scheduled_at);
    if (!Number.isNaN(now) && !Number.isNaN(scheduledAt) && scheduledAt < now) {
      result[appointment.id].push('overdue_outcome');
    }
  }

  const slotMs = APPOINTMENT_SLOT_MINUTES * 60_000;
  const unresolved = appointments.filter((appointment) => appointment.outcome === 'scheduled');
  for (let index = 0; index < unresolved.length; index += 1) {
    const left = unresolved[index];
    const leftAt = Date.parse(left.scheduled_at);
    if (Number.isNaN(leftAt)) continue;

    for (let otherIndex = index + 1; otherIndex < unresolved.length; otherIndex += 1) {
      const right = unresolved[otherIndex];
      const rightAt = Date.parse(right.scheduled_at);
      if (Number.isNaN(rightAt) || Math.abs(leftAt - rightAt) >= slotMs) continue;

      if (left.market_id !== right.market_id) continue;

      if (!result[left.id].includes('conflict')) result[left.id].push('conflict');
      if (!result[right.id].includes('conflict')) result[right.id].push('conflict');
    }
  }

  return result;
}

/**
 * Days the grid renders for the given view.
 *
 * The month grid runs from the Monday on or before the 1st to the Sunday on or
 * after the last day, so every row is a full week and the leading/trailing days
 * belong to the neighbouring months. Length varies (28–42) rather than being
 * padded to a fixed six rows — a blank trailing week is dead space.
 */
export function calendarDays(view: CalendarView, anchor: Date): Date[] {
  if (view === 'week') {
    const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }

  const gridStart = startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON });
  const gridEnd = endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON });

  const days: Date[] = [];
  // Step by calendar day rather than adding 24h: a spring-forward day is 23
  // hours long, and millisecond arithmetic would drift a day out over a month.
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  return days;
}

/**
 * The fetch window for a view: the whole visible grid, not just the month.
 *
 * The month grid shows days from the neighbouring months, and appointments on
 * those days must be real rather than blank — otherwise the last row of June
 * looks empty in the July view.
 *
 * `end` is exclusive: the API filters `scheduled_at < end`, so it is the start
 * of the day AFTER the last visible one.
 */
export function calendarRange(view: CalendarView, anchor: Date): { start: Date; end: Date } {
  const days = calendarDays(view, anchor);
  return { start: days[0], end: addDays(days[days.length - 1], 1) };
}

/** Move one week or one month, in whichever view is active. */
export function shiftAnchor(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  return view === 'week' ? addDays(anchor, 7 * direction) : addMonths(anchor, direction);
}

/**
 * Normalise the anchor when switching views.
 *
 * Switching week -> month keeps the month the current week sits in; month ->
 * week lands on the week containing the 1st, so the user stays near where they
 * were looking rather than jumping to today.
 */
export function normalizeAnchor(view: CalendarView, anchor: Date): Date {
  return view === 'week'
    ? startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
    : startOfMonth(anchor);
}

/** Heading for the current view: a date span for a week, a month name for a month. */
export function calendarLabel(view: CalendarView, anchor: Date): string {
  if (view === 'month') return format(anchor, 'MMMM yyyy');
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  const end = addDays(start, 6);
  // Don't repeat the month when the week sits inside one.
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  return sameMonth
    ? `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
    : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
}

/** Weekday headings for the month grid, starting on the same day as the grid. */
export function weekdayLabels(): string[] {
  const start = startOfWeek(new Date(2026, 0, 5), { weekStartsOn: WEEK_STARTS_ON }); // a Monday
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'EEE'));
}
