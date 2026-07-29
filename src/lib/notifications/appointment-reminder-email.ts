import type { ReminderKind } from '@/lib/appointments/reminders';

/**
 * Builds an appointment reminder for either audience.
 *
 * Pure, like the confirmation builder, so copy and time rendering are testable
 * without Resend or a database.
 *
 * Two audiences, one builder, because the FACTS are identical and only the
 * framing differs. The rep needs to know whose door and where; the homeowner
 * needs to know someone is coming and roughly why. Splitting them into separate
 * modules would mean two places to fix a wrong timestamp.
 */

export interface ReminderEmailInput {
  recipientType: 'rep' | 'homeowner';
  kind: ReminderKind;
  lead: {
    first_name?: string | null;
    last_name?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
  };
  appointment: {
    scheduled_at: string;
    appointment_type?: string | null;
    notes?: string | null;
  };
  companyName: string;
  /** IANA zone for the human-readable time. */
  timeZone: string;
}

export interface BuiltReminderEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function formatWhen(iso: string, timeZone: string): { date: string; time: string } {
  const d = new Date(iso);
  const opts = (o: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-US', { ...o, timeZone }).format(d);
    } catch {
      return new Intl.DateTimeFormat('en-US', { ...o, timeZone: 'America/Phoenix' }).format(d);
    }
  };
  return {
    date: opts({ weekday: 'long', month: 'long', day: 'numeric' }),
    time: opts({ hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }),
  };
}

function leadName(lead: ReminderEmailInput['lead']): string {
  return [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
}

function addressLine(lead: ReminderEmailInput['lead']): string {
  const street = lead.address_street?.trim();
  const cityState = [lead.address_city, lead.address_state].filter(Boolean).join(', ');
  return [street, cityState].filter(Boolean).join(' · ');
}

export function buildReminderEmail(input: ReminderEmailInput): BuiltReminderEmail {
  const { recipientType, kind, lead, appointment, companyName, timeZone } = input;
  const { date, time } = formatWhen(appointment.scheduled_at, timeZone);
  const visit = appointment.appointment_type === 'adjuster' ? 'adjuster visit' : 'roof inspection';
  // "Tomorrow" and "today" are what the reader actually needs; the full date is
  // still printed underneath so a reminder read late is never ambiguous.
  const when = kind === 'morning_of' ? 'today' : 'tomorrow';
  const name = leadName(lead);
  const address = addressLine(lead);

  if (recipientType === 'rep') {
    const who = name || 'a lead';
    const subject = `${when === 'today' ? 'Today' : 'Tomorrow'} ${time} — ${visit}${name ? ` with ${name}` : ''}`;
    const text = [
      `You have a ${visit} ${when} at ${time}.`,
      '',
      `Customer: ${who}`,
      address ? `Address:  ${address}` : null,
      `When:     ${date} at ${time}`,
      appointment.notes?.trim() ? `Notes:    ${appointment.notes.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const html = [
      `<p>You have a <strong>${escapeHtml(visit)}</strong> ${when} at <strong>${escapeHtml(time)}</strong>.</p>`,
      '<ul>',
      `<li><strong>Customer:</strong> ${escapeHtml(who)}</li>`,
      address ? `<li><strong>Address:</strong> ${escapeHtml(address)}</li>` : '',
      `<li><strong>When:</strong> ${escapeHtml(date)} at ${escapeHtml(time)}</li>`,
      appointment.notes?.trim()
        ? `<li><strong>Notes:</strong> ${escapeHtml(appointment.notes.trim())}</li>`
        : '',
      '</ul>',
    ].join('');

    return { subject, html, text };
  }

  // Homeowner. No internal language, no lead status, no rep names — this one
  // leaves the building.
  const greeting = lead.first_name?.trim() ? `Hi ${lead.first_name.trim()},` : 'Hi,';
  const subject = `Reminder: your ${visit} is ${when} at ${time}`;
  const text = [
    greeting,
    '',
    `This is a reminder that your ${visit} with ${companyName} is ${when}.`,
    '',
    `When: ${date} at ${time}`,
    address ? `Where: ${address}` : null,
    '',
    'If that no longer works, just reply to this email and we will find another time.',
  ]
    .filter((line) => line !== null)
    .join('\n');

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>This is a reminder that your <strong>${escapeHtml(visit)}</strong> with ${escapeHtml(companyName)} is ${when}.</p>`,
    '<ul>',
    `<li><strong>When:</strong> ${escapeHtml(date)} at ${escapeHtml(time)}</li>`,
    address ? `<li><strong>Where:</strong> ${escapeHtml(address)}</li>` : '',
    '</ul>',
    '<p>If that no longer works, just reply to this email and we will find another time.</p>',
  ].join('');

  return { subject, html, text };
}
