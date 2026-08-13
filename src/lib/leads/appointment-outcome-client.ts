import type { AppointmentOutcome, LeadAppointment } from '@/types';

/**
 * The browser boundary for appointment result changes.
 *
 * Today and Lead Detail both use this function so cancellation can never drift
 * back to DELETE on one screen while the other preserves the booking.
 */
export async function saveAppointmentOutcome(input: {
  leadId: string;
  appointmentId: string;
  outcome: AppointmentOutcome;
}): Promise<LeadAppointment> {
  const response = await fetch(
    `/api/admin/leads/${input.leadId}/appointments/${input.appointmentId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: input.outcome }),
    }
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success || !result.appointment) {
    throw new Error(result?.error || 'Could not record the appointment result');
  }
  return result.appointment as LeadAppointment;
}
