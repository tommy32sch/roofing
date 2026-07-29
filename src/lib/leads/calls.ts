import type { LeadStatus } from '@/types';

/** Cold-call results in the exact order shown to a rep. */
export const COLD_CALL_DISPOSITIONS = [
  { value: 'left_voicemail', label: 'Left Voicemail', hint: 'No live contact' },
  { value: 'call_back', label: 'Call Back', hint: 'Follow up by phone later' },
  { value: 'appointment_set', label: 'Appointment Set', hint: 'Schedule the appointment details next' },
  { value: 'wrong_number', label: 'Wrong Number', hint: 'The number does not reach this lead' },
  { value: 'do_not_call', label: 'Do Not Call', hint: 'The recipient asked not to be called again' },
  { value: 'not_interested', label: 'Not Interested', hint: 'The recipient declined' },
] as const;

export type ColdCallDisposition = (typeof COLD_CALL_DISPOSITIONS)[number]['value'];

export const COLD_CALL_DISPOSITION_VALUES = new Set<string>(
  COLD_CALL_DISPOSITIONS.map((disposition) => disposition.value)
);

export function callLabel(value: string): string {
  return COLD_CALL_DISPOSITIONS.find((disposition) => disposition.value === value)?.label ?? value;
}

/**
 * A result may prove contact, but it cannot skip a required product workflow.
 *
 * In particular, "Appointment Set" advances only to Contacted. The appointment
 * date/time form is the sole path to appointment_set, so the calendar can never
 * contain a status-only phantom appointment.
 */
export function statusForCallDisposition(
  disposition: ColdCallDisposition
): LeadStatus | null {
  switch (disposition) {
    case 'call_back':
    case 'appointment_set':
    case 'do_not_call':
    case 'not_interested':
      return 'contacted';
    case 'left_voicemail':
    case 'wrong_number':
      return null;
  }
}
