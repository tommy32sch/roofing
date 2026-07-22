import { describe, it, expect } from 'vitest';
import { buildAppointmentEmail } from './appointment-email';

const base = {
  lead: {
    first_name: 'Flor',
    address_street: '3445 E Palm Ln',
    address_city: 'Phoenix',
    address_state: 'AZ',
    address_zip: '85008',
  },
  appointment: {
    id: 'appt-1',
    scheduled_at: '2026-08-05T21:30:00.000Z', // 2:30 PM in Phoenix (UTC-7)
    appointment_type: 'inspection' as const,
    notes: null,
  },
  companyName: 'Tacheny',
  timeZone: 'America/Phoenix',
};

describe('buildAppointmentEmail', () => {
  it('renders the time in the configured zone with the zone named', () => {
    const built = buildAppointmentEmail(base);
    expect(built.subject).toContain('August 5, 2026');
    expect(built.text).toContain('2:30 PM MST');
    expect(built.html).toContain('2:30 PM MST');
  });

  it('renders the same instant differently in another zone', () => {
    const eastern = buildAppointmentEmail({ ...base, timeZone: 'America/New_York' });
    expect(eastern.text).toContain('5:30 PM EDT');
  });

  it('greets by first name, and falls back politely without one', () => {
    expect(buildAppointmentEmail(base).text).toContain('Hi Flor,');
    const anon = buildAppointmentEmail({ ...base, lead: { ...base.lead, first_name: null } });
    expect(anon.text).toContain('Hello,');
    expect(anon.text).not.toContain('Hi ,');
  });

  it('includes the address when present and omits the row when absent', () => {
    expect(buildAppointmentEmail(base).text).toContain('3445 E Palm Ln, Phoenix, AZ, 85008');
    const noAddr = buildAppointmentEmail({ ...base, lead: { first_name: 'Flor' } });
    expect(noAddr.text).not.toContain('Where:');
    expect(noAddr.html).not.toContain('Where');
  });

  it('distinguishes an adjuster visit from an inspection', () => {
    const adj = buildAppointmentEmail({
      ...base,
      appointment: { ...base.appointment, appointment_type: 'adjuster' },
    });
    expect(adj.subject).toContain('Adjuster Visit');
    expect(adj.text).toContain('adjuster visit');
    expect(buildAppointmentEmail(base).subject).toContain('Roof Inspection');
  });

  it('includes notes only when provided', () => {
    const withNotes = buildAppointmentEmail({
      ...base,
      appointment: { ...base.appointment, notes: '  Bring the drone  ' },
    });
    expect(withNotes.text).toContain('Notes: Bring the drone');
    expect(buildAppointmentEmail(base).text).not.toContain('Notes:');
  });

  it('attaches a valid invite carrying the UTC instant', () => {
    const built = buildAppointmentEmail(base);
    expect(built.icsFilename).toBe('appointment.ics');
    expect(built.ics).toContain('BEGIN:VEVENT');
    expect(built.ics).toContain('DTSTART:20260805T213000Z');
    expect(built.ics).toContain('UID:appointment-appt-1@roof-leads');
    expect(built.ics).toContain('LOCATION:3445 E Palm Ln');
  });

  it('escapes HTML in customer-controlled values', () => {
    const built = buildAppointmentEmail({
      ...base,
      lead: { ...base.lead, first_name: '<script>alert(1)</script>' },
    });
    expect(built.html).not.toContain('<script>');
    expect(built.html).toContain('&lt;script&gt;');
  });
});
