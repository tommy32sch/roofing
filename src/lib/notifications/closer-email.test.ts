import { describe, it, expect } from 'vitest';
import { buildCloserEmail } from './closer-email';

const base = {
  lead: {
    id: 'lead-1',
    first_name: 'Flor',
    last_name: 'Erives',
    phone: '(602) 423-7756',
    address_street: '3445 E Palm Ln',
    address_city: 'Phoenix',
    address_state: 'AZ',
    address_zip: '85008',
    is_dnc: false,
  },
  appointment: {
    id: 'appt-1',
    scheduled_at: '2026-08-05T21:30:00.000Z', // 2:30 PM Phoenix
    appointment_type: 'inspection' as const,
    notes: null,
  },
  companyName: 'Tacheny',
  timeZone: 'America/Phoenix',
  appUrl: 'https://roofing-ebon.vercel.app',
};

describe('buildCloserEmail', () => {
  it('leads with the lead name and time in the subject', () => {
    const built = buildCloserEmail(base);
    expect(built.subject).toBe('Inspection: Flor Erives — Wed, Aug 5 at 2:30 PM MST');
  });

  it('gives the closer the operational details', () => {
    const built = buildCloserEmail(base);
    expect(built.text).toContain('Homeowner: Flor Erives');
    expect(built.text).toContain('Address: 3445 E Palm Ln, Phoenix, AZ, 85008');
    expect(built.text).toContain('Phone: (602) 423-7756');
  });

  it('says knock-only for a DNC lead instead of showing a number', () => {
    const built = buildCloserEmail({ ...base, lead: { ...base.lead, is_dnc: true, phone: null } });
    expect(built.text).toContain('Phone: Do not call — knock only');
    expect(built.text).not.toContain('No number on file');
  });

  it('never prints a stored number for a DNC lead even if one somehow exists', () => {
    const built = buildCloserEmail({ ...base, lead: { ...base.lead, is_dnc: true } });
    expect(built.text).not.toContain('602');
    expect(built.html).not.toContain('602');
  });

  it('falls back gracefully when there is no number', () => {
    const built = buildCloserEmail({ ...base, lead: { ...base.lead, phone: null } });
    expect(built.text).toContain('Phone: No number on file');
  });

  it('includes setter notes and who booked it when present', () => {
    const built = buildCloserEmail({
      ...base,
      appointment: { ...base.appointment, notes: 'Back slope hail damage' },
      bookedBy: 'Setter Sam',
    });
    expect(built.text).toContain('Setter notes: Back slope hail damage');
    expect(built.text).toContain('Booked by: Setter Sam');

    const bare = buildCloserEmail(base);
    expect(bare.text).not.toContain('Setter notes:');
    expect(bare.text).not.toContain('Booked by:');
  });

  it('deep-links back to the lead, and omits the link without an app URL', () => {
    expect(buildCloserEmail(base).text).toContain('https://roofing-ebon.vercel.app/admin/leads/lead-1');
    const noUrl = buildCloserEmail({ ...base, appUrl: null });
    expect(noUrl.text).not.toContain('Open lead:');
    expect(noUrl.html).not.toContain('<a href');
  });

  it('attaches an invite with its own uid so it does not collide with the homeowner copy', () => {
    const built = buildCloserEmail(base);
    expect(built.ics).toContain('UID:appointment-appt-1-closer@roof-leads');
    expect(built.ics).toContain('DTSTART:20260805T213000Z');
  });

  it('escapes HTML in lead-controlled values', () => {
    const built = buildCloserEmail({
      ...base,
      lead: { ...base.lead, last_name: '<img src=x onerror=alert(1)>' },
    });
    expect(built.html).not.toContain('<img');
    expect(built.html).toContain('&lt;img');
  });

  it('labels an adjuster visit distinctly', () => {
    const built = buildCloserEmail({
      ...base,
      appointment: { ...base.appointment, appointment_type: 'adjuster' },
    });
    expect(built.subject).toContain('Adjuster visit:');
  });
});
