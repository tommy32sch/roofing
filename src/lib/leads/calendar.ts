import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';

/**
 * Week/month view maths for the calendar.
 *
 * Kept pure and separate because this is where calendars quietly break: a month
 * grid has to start on the same weekday as the week view, spill into the
 * neighbouring months, and survive DST transitions and month lengths without
 * dropping or duplicating a day.
 */

export type CalendarView = 'week' | 'month';

/** Monday. Matches the existing week view and how a crew's week is planned. */
export const WEEK_STARTS_ON = 1 as const;

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
