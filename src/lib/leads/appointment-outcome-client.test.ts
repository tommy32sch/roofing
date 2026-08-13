import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveAppointmentOutcome } from './appointment-outcome-client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveAppointmentOutcome', () => {
  it('records cancellation by PATCH and returns the canonical appointment', async () => {
    const appointment = { id: 'appointment-1', outcome: 'cancelled' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, appointment }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      saveAppointmentOutcome({
        leadId: 'lead-1',
        appointmentId: 'appointment-1',
        outcome: 'cancelled',
      })
    ).resolves.toEqual(appointment);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/leads/lead-1/appointments/appointment-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ outcome: 'cancelled' }),
      })
    );
  });

  it('surfaces the server error and does not invent success data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ success: false, error: 'You cannot change this outcome' }),
    }));

    await expect(
      saveAppointmentOutcome({
        leadId: 'lead-1',
        appointmentId: 'appointment-1',
        outcome: 'completed',
      })
    ).rejects.toThrow('You cannot change this outcome');
  });

  it('handles a non-JSON failure response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => { throw new Error('not json'); },
    }));

    await expect(
      saveAppointmentOutcome({
        leadId: 'lead-1',
        appointmentId: 'appointment-1',
        outcome: 'no_show',
      })
    ).rejects.toThrow('Could not record the appointment result');
  });
});
