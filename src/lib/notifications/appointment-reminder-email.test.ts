import { describe, it, expect } from 'vitest';
import { buildReminderEmail, type ReminderEmailInput } from './appointment-reminder-email';

const base: ReminderEmailInput = {
  recipientType: 'rep',
  kind: 'day_before',
  lead: {
    first_name: 'Chao',
    last_name: 'Wang',
    address_street: '3880 E Monte Vista Rd',
    address_city: 'Phoenix',
    address_state: 'AZ',
  },
  appointment: {
    scheduled_at: '2026-07-30T17:00:00Z', // 10:00 MST
    appointment_type: 'inspection',
    notes: null,
  },
  companyName: 'Tacheny',
  timeZone: 'America/Phoenix',
};

describe('buildReminderEmail — rep', () => {
  it('leads with when and who', () => {
    const out = buildReminderEmail(base);
    expect(out.subject).toContain('Tomorrow');
    expect(out.subject).toContain('Chao Wang');
    expect(out.text).toContain('10:00');
    expect(out.text).toContain('3880 E Monte Vista Rd');
  });

  it('says today for the morning-of reminder', () => {
    const out = buildReminderEmail({ ...base, kind: 'morning_of' });
    expect(out.subject).toContain('Today');
    expect(out.text).toContain('today');
  });

  it('includes notes only when there are some', () => {
    expect(buildReminderEmail(base).text).not.toContain('Notes:');
    const withNotes = buildReminderEmail({
      ...base,
      appointment: { ...base.appointment, notes: 'Gate code 1234' },
    });
    expect(withNotes.text).toContain('Gate code 1234');
  });

  it('names an adjuster visit correctly', () => {
    const out = buildReminderEmail({
      ...base,
      appointment: { ...base.appointment, appointment_type: 'adjuster' },
    });
    expect(out.subject).toContain('adjuster visit');
  });

  it('degrades gracefully with no name or address', () => {
    const out = buildReminderEmail({ ...base, lead: {} });
    expect(out.subject).not.toContain('undefined');
    expect(out.text).toContain('a lead');
    expect(out.text).not.toContain('Address:');
  });
});

describe('buildReminderEmail — homeowner', () => {
  const homeowner: ReminderEmailInput = { ...base, recipientType: 'homeowner' };

  it('greets by first name and states the time', () => {
    const out = buildReminderEmail(homeowner);
    expect(out.text).toContain('Hi Chao,');
    expect(out.subject).toContain('tomorrow');
    expect(out.text).toContain('10:00');
    expect(out.text).toContain('Tacheny');
  });

  it('falls back to a plain greeting without a first name', () => {
    const out = buildReminderEmail({ ...homeowner, lead: { ...homeowner.lead, first_name: null } });
    expect(out.text).toContain('Hi,');
    expect(out.text).not.toContain('null');
  });

  // This mail leaves the building — internal vocabulary must not ride along.
  it('carries no internal language', () => {
    const out = buildReminderEmail({
      ...homeowner,
      appointment: { ...homeowner.appointment, notes: 'Owner is a tough close, push hard' },
    });
    const body = `${out.subject} ${out.text} ${out.html}`.toLowerCase();
    for (const leak of ['lead', 'setter', 'closer', 'tough close', 'pipeline', 'status']) {
      expect(body).not.toContain(leak);
    }
  });

  it('offers a way out rather than treating the time as fixed', () => {
    expect(buildReminderEmail(homeowner).text).toContain('reply to this email');
  });
});

describe('buildReminderEmail — shared behaviour', () => {
  it('renders the time in the market zone, not UTC', () => {
    const az = buildReminderEmail(base);
    const mn = buildReminderEmail({ ...base, timeZone: 'America/Chicago' });
    expect(az.text).toContain('10:00');
    expect(mn.text).toContain('12:00');
    expect(az.text).not.toBe(mn.text);
  });

  it('escapes HTML so a name or note cannot inject markup', () => {
    const out = buildReminderEmail({
      ...base,
      lead: { ...base.lead, first_name: '<script>alert(1)</script>' },
      appointment: { ...base.appointment, notes: '<img src=x onerror=alert(1)>' },
    });
    expect(out.html).not.toContain('<script>');
    expect(out.html).not.toContain('<img src=x');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('survives an unknown timezone instead of throwing', () => {
    const out = buildReminderEmail({ ...base, timeZone: 'Mars/Olympus' });
    expect(out.text).not.toBe('');
    expect(out.text).not.toContain('Invalid Date');
  });

  it('always produces both a text and an html part', () => {
    for (const recipientType of ['rep', 'homeowner'] as const) {
      const out = buildReminderEmail({ ...base, recipientType });
      expect(out.text.length).toBeGreaterThan(20);
      expect(out.html).toContain('<p>');
      expect(out.subject.length).toBeGreaterThan(5);
    }
  });
});
