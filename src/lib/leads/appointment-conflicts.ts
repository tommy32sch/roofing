/**
 * Double-booking detection for appointments.
 *
 * Appointments store a start time and nothing else — there is no duration
 * column — so "already booked at 10am" has to be defined. A roof inspection or
 * an adjuster meeting realistically occupies about an hour including travel, so
 * a booking is treated as holding a slot that long, and anything starting inside
 * another's slot is a clash.
 *
 * Scoped to the MARKET, not the whole company: Arizona and Minnesota are
 * different crews in different timezones, so a 10am in Phoenix and a 10am in
 * Minneapolis are neither the same instant nor the same person's day. Once leads
 * are actually assigned to reps, narrowing this further to the assigned rep is
 * the natural next step — the same function does it, given a narrower list.
 */

/** How long a booking is assumed to occupy, in minutes. */
export const APPOINTMENT_SLOT_MINUTES = 60;

export interface ExistingAppointment {
  id: string;
  scheduled_at: string;
  appointment_type?: string | null;
  leads?: { first_name?: string | null; last_name?: string | null } | null;
}

export interface AppointmentConflict {
  id: string;
  scheduled_at: string;
  appointment_type: string | null;
  leadName: string | null;
  /** Whole minutes between the proposed time and this booking. 0 = same time. */
  minutesApart: number;
}

/**
 * Bookings that clash with a proposed time.
 *
 * @param excludeId the appointment being rescheduled — it must not clash with
 *   itself, which would make every reschedule look like a double-booking.
 */
export function findConflicts(
  proposedIso: string,
  existing: ExistingAppointment[],
  options: { excludeId?: string | null; slotMinutes?: number } = {}
): AppointmentConflict[] {
  const proposed = Date.parse(proposedIso);
  if (Number.isNaN(proposed)) return [];

  const slotMs = (options.slotMinutes ?? APPOINTMENT_SLOT_MINUTES) * 60_000;
  const conflicts: AppointmentConflict[] = [];

  for (const appt of existing) {
    if (options.excludeId && appt.id === options.excludeId) continue;
    const at = Date.parse(appt.scheduled_at);
    if (Number.isNaN(at)) continue;

    const gap = Math.abs(at - proposed);
    // A slot-length gap is back-to-back, not overlapping — 10:00 and 11:00 are
    // both bookable. Strictly inside the slot is the clash.
    if (gap >= slotMs) continue;

    const name = [appt.leads?.first_name, appt.leads?.last_name].filter(Boolean).join(' ').trim();
    conflicts.push({
      id: appt.id,
      scheduled_at: appt.scheduled_at,
      appointment_type: appt.appointment_type ?? null,
      leadName: name || null,
      minutesApart: Math.round(gap / 60_000),
    });
  }

  // Closest first: the most alarming clash should lead the warning.
  return conflicts.sort((a, b) => a.minutesApart - b.minutesApart);
}

/**
 * The window to search for potential clashes, as ISO instants.
 *
 * A slot either side of the proposal is the smallest range that can contain
 * every conflict, so the query stays cheap.
 */
export function conflictWindow(
  proposedIso: string,
  slotMinutes: number = APPOINTMENT_SLOT_MINUTES
): { start: string; end: string } | null {
  const proposed = Date.parse(proposedIso);
  if (Number.isNaN(proposed)) return null;
  const slotMs = slotMinutes * 60_000;
  return {
    start: new Date(proposed - slotMs).toISOString(),
    end: new Date(proposed + slotMs).toISOString(),
  };
}

/**
 * One-line summary for the warning.
 *
 * Names the person where possible — "already booked with Chao Wang" is far more
 * useful for deciding whether to override than "a conflict exists".
 */
export function conflictSummary(conflicts: AppointmentConflict[], formatTime: (iso: string) => string): string {
  if (conflicts.length === 0) return '';
  const [first] = conflicts;
  const who = first.leadName ? ` with ${first.leadName}` : '';
  const others = conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : '';
  const when = first.minutesApart === 0 ? 'at the same time' : `${first.minutesApart} min away`;
  return `Already booked${who} at ${formatTime(first.scheduled_at)} — ${when}${others}.`;
}
