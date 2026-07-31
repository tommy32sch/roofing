/**
 * Appointment outcomes — did the visit actually happen?
 *
 * A booking is a promise; an outcome is what the promise was worth. Without
 * this, a setter who books ten appointments that nobody attends looks identical
 * to one who books ten that all convert, and the reminder feature has no way to
 * show whether it reduced anything.
 *
 * Pure, so the rate arithmetic and the "is this stale" rules are testable
 * without a database or a clock.
 */

export const APPOINTMENT_OUTCOMES = [
  'scheduled',
  'completed',
  'no_show',
  'cancelled',
] as const;

export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number];

export const APPOINTMENT_OUTCOME_VALUES = new Set<string>(APPOINTMENT_OUTCOMES);

export function isAppointmentOutcome(value: unknown): value is AppointmentOutcome {
  return typeof value === 'string' && APPOINTMENT_OUTCOME_VALUES.has(value);
}

export const APPOINTMENT_OUTCOME_OPTIONS: { value: AppointmentOutcome; label: string }[] = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'no_show', label: 'No-show' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function appointmentOutcomeLabel(outcome: string): string {
  return APPOINTMENT_OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome;
}

/** An outcome has been decided — the appointment is no longer pending a result. */
export function isSettledOutcome(outcome: string): boolean {
  return outcome === 'completed' || outcome === 'no_show' || outcome === 'cancelled';
}

/**
 * A past appointment nobody has judged yet.
 *
 * These are the gap in the data: they are neither a show nor a no-show, and
 * counting them as either would flatter or punish a rep for admin they simply
 * have not done. Surfacing them is what keeps the rate honest.
 */
export function isAwaitingOutcome(
  appointment: { scheduled_at: string; outcome: string },
  nowIso: string = new Date().toISOString()
): boolean {
  if (appointment.outcome !== 'scheduled') return false;
  const at = Date.parse(appointment.scheduled_at);
  const now = Date.parse(nowIso);
  if (Number.isNaN(at) || Number.isNaN(now)) return false;
  return at < now;
}

export interface OutcomeTotals {
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  /** Still in the future — not yet judgeable. */
  upcoming: number;
  /** In the past with no outcome recorded. */
  awaiting: number;
  /** completed / (completed + noShow). Null when nothing has been decided. */
  showRate: number | null;
  /** noShow / (completed + noShow). Null when nothing has been decided. */
  noShowRate: number | null;
}

/**
 * Aggregate outcomes into the rates a manager reads.
 *
 * Cancellations are deliberately EXCLUDED from the show-rate denominator. A
 * homeowner who calls ahead to cancel is a different event from one who leaves
 * a closer on the doorstep, and folding them together would let a rep improve
 * their no-show rate by cancelling appointments they expected to lose.
 *
 * Both rates return null rather than 0 when nothing has been decided, because
 * "no data" and "everybody no-showed" must not render the same.
 */
export function summariseOutcomes(
  appointments: { scheduled_at: string; outcome: string }[],
  nowIso: string = new Date().toISOString()
): OutcomeTotals {
  const totals: OutcomeTotals = {
    total: appointments.length,
    completed: 0,
    noShow: 0,
    cancelled: 0,
    upcoming: 0,
    awaiting: 0,
    showRate: null,
    noShowRate: null,
  };

  const now = Date.parse(nowIso);
  for (const appointment of appointments) {
    switch (appointment.outcome) {
      case 'completed':
        totals.completed += 1;
        break;
      case 'no_show':
        totals.noShow += 1;
        break;
      case 'cancelled':
        totals.cancelled += 1;
        break;
      default: {
        const at = Date.parse(appointment.scheduled_at);
        if (!Number.isNaN(at) && at < now) totals.awaiting += 1;
        else totals.upcoming += 1;
      }
    }
  }

  const decided = totals.completed + totals.noShow;
  if (decided > 0) {
    totals.showRate = totals.completed / decided;
    totals.noShowRate = totals.noShow / decided;
  }

  return totals;
}

/**
 * Whether a user may record this outcome.
 *
 * Reps record outcomes for their own work — they are the ones standing at the
 * door — but only an admin may overwrite an outcome someone else already set,
 * so a disappointing result cannot be quietly rewritten.
 */
export function canRecordOutcome(input: {
  role: string;
  userId: string;
  appointmentCreatedBy: string | null;
  appointmentAssignedTo: string | null;
  existingOutcomeBy: string | null;
}): boolean {
  if (input.role === 'admin') return true;
  const isTheirs =
    input.appointmentCreatedBy === input.userId ||
    input.appointmentAssignedTo === input.userId;
  if (!isTheirs) return false;
  // Unset, or previously set by themselves.
  return !input.existingOutcomeBy || input.existingOutcomeBy === input.userId;
}

/**
 * Whether a user may cancel or reschedule this appointment.
 *
 * Same notion of ownership as canRecordOutcome — admin, the rep who booked it,
 * or a rep the lead is assigned to — but deliberately WITHOUT the
 * existingOutcomeBy rule. That rule protects a recorded judgement from being
 * rewritten; moving your own booking to another time is not that, and a rep who
 * marked their own visit "no show" must still be able to rebook it.
 *
 * This exists because cancelling had no ownership test at all, which made the
 * outcome protection hollow: a rep refused permission to overwrite a
 * colleague's outcome could delete the whole appointment instead, taking the
 * outcome and its reporting contribution with it.
 */
export function canModifyAppointment(input: {
  role: string;
  userId: string;
  appointmentCreatedBy: string | null;
  leadAssignedSetterId: string | null;
  leadAssignedCloserId: string | null;
}): boolean {
  if (input.role === 'admin') return true;
  // Guard the null===null case: an unassigned lead must not match a caller
  // whose id is somehow absent.
  if (!input.userId) return false;
  return (
    input.appointmentCreatedBy === input.userId ||
    input.leadAssignedSetterId === input.userId ||
    input.leadAssignedCloserId === input.userId
  );
}
