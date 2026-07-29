/**
 * Which appointment reminders are due, in the market's own local time.
 *
 * The whole feature turns on one daily cron run, because Vercel's Hobby plan
 * permits nothing finer. That constraint shapes the model: rather than "remind
 * me 60 minutes before", a run sends the reminders that belong to TODAY and
 * TOMORROW as the market's calendar sees them. A single 14:00 UTC run is 07:00
 * in Phoenix and 09:00 in Minneapolis, so both offices get their notice at a
 * sane hour without a second schedule.
 *
 * Everything here is pure and takes an explicit `now`, so the awkward cases —
 * a DST boundary, an appointment at midnight, a market on the other side of the
 * date line from UTC — are testable without waiting for a Tuesday in November.
 */

export type ReminderKind = 'day_before' | 'morning_of';

/** Arizona does not observe DST; Minnesota does. Never infer this from a state. */
export const DEFAULT_TIME_ZONE = 'America/Phoenix';

export interface ReminderAppointment {
  id: string;
  scheduled_at: string;
  timeZone?: string | null;
}

/**
 * The market-local calendar day for an instant, as YYYY-MM-DD.
 *
 * en-CA formats as ISO, which makes the result directly comparable as a string
 * and sidesteps hand-rolled UTC-offset arithmetic that DST would break.
 */
export function localDayKey(iso: string, timeZone: string = DEFAULT_TIME_ZONE): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    // An unknown zone must not take the whole cron run down with it.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  }
}

/** Whole days from one YYYY-MM-DD to another. Calendar days, not 24h spans. */
export function dayDifference(fromKey: string, toKey: string): number | null {
  const from = Date.parse(`${fromKey}T00:00:00Z`);
  const to = Date.parse(`${toKey}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

/**
 * The reminder this appointment earns on a run happening at `nowIso`.
 *
 * Same local day and still ahead → the morning-of nudge. Next local day → the
 * day-before notice. An appointment already in the past earns nothing: a
 * reminder for a visit that has been and gone is worse than silence.
 */
export function reminderKindFor(
  appointmentIso: string,
  nowIso: string,
  timeZone: string = DEFAULT_TIME_ZONE
): ReminderKind | null {
  const appointmentMs = Date.parse(appointmentIso);
  const nowMs = Date.parse(nowIso);
  if (Number.isNaN(appointmentMs) || Number.isNaN(nowMs)) return null;
  if (appointmentMs <= nowMs) return null;

  const apptDay = localDayKey(appointmentIso, timeZone);
  const nowDay = localDayKey(nowIso, timeZone);
  if (!apptDay || !nowDay) return null;

  const delta = dayDifference(nowDay, apptDay);
  if (delta === 0) return 'morning_of';
  if (delta === 1) return 'day_before';
  return null;
}

/**
 * Dedupe identity for one reminder.
 *
 * `scheduled_at` is part of the key on purpose. Keying on the appointment alone
 * would mean moving a 10am visit to 2pm looks like a reminder that already went
 * out, and the customer would be told the old time or nothing at all. Including
 * the instant re-arms the reminders whenever the booking actually changes.
 */
export function reminderDedupeKey(input: {
  appointmentId: string;
  scheduledAt: string;
  kind: ReminderKind;
  recipient: string;
}): string {
  return [
    input.appointmentId,
    new Date(input.scheduledAt).toISOString(),
    input.kind,
    input.recipient.trim().toLowerCase(),
  ].join('|');
}

/**
 * The window of appointments a run needs to look at.
 *
 * Bounded so the query stays small: nothing earlier than now, nothing beyond
 * the end of tomorrow in the market's local time — which is at most 48h out
 * once every offset is accounted for.
 */
export function reminderWindow(nowIso: string): { start: string; end: string } | null {
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return null;
  return {
    start: new Date(now).toISOString(),
    end: new Date(now + 48 * 3_600_000).toISOString(),
  };
}

/** Human time for the email body, in the market's own clock. */
export function formatLocalAppointment(
  iso: string,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const zone = (() => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(ms));
      return timeZone;
    } catch {
      return DEFAULT_TIME_ZONE;
    }
  })();
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms));
}

export interface PlannedReminder {
  appointmentId: string;
  scheduledAt: string;
  kind: ReminderKind;
  timeZone: string;
  dedupeKey: string;
}

/**
 * Turn a batch of appointments into the reminders a run should attempt.
 *
 * Recipients are resolved by the caller — this decides only WHETHER an
 * appointment is due and under which label, so the rep and homeowner paths
 * share one set of rules.
 */
export function planReminders(
  appointments: ReminderAppointment[],
  nowIso: string,
  recipientFor: (appointment: ReminderAppointment) => string[]
): PlannedReminder[] {
  const planned: PlannedReminder[] = [];
  for (const appointment of appointments) {
    const timeZone = appointment.timeZone || DEFAULT_TIME_ZONE;
    const kind = reminderKindFor(appointment.scheduled_at, nowIso, timeZone);
    if (!kind) continue;
    for (const recipient of recipientFor(appointment)) {
      if (!recipient?.trim()) continue;
      planned.push({
        appointmentId: appointment.id,
        scheduledAt: appointment.scheduled_at,
        kind,
        timeZone,
        dedupeKey: reminderDedupeKey({
          appointmentId: appointment.id,
          scheduledAt: appointment.scheduled_at,
          kind,
          recipient,
        }),
      });
    }
  }
  return planned;
}
