import { buildIcs } from './ics';

/**
 * Builds the homeowner's appointment confirmation.
 *
 * Pure — no I/O — so the copy, the time rendering and the invite can be tested
 * without touching Resend or the database.
 *
 * The .ics carries the time in UTC and each calendar client renders it in the
 * recipient's own zone, so only the human-readable body needs an explicit zone.
 * It's spelled out in the text ("2:30 PM MST") so nobody has to guess.
 */

export interface AppointmentEmailInput {
  lead: {
    first_name?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
    address_zip?: string | null;
  };
  appointment: {
    id: string;
    scheduled_at: string;
    appointment_type: 'inspection' | 'adjuster';
    notes?: string | null;
  };
  companyName: string;
  /** IANA zone used for the human-readable time. */
  timeZone: string;
  /** Shown as the reply-to / contact line when set. */
  replyTo?: string | null;
}

export interface BuiltAppointmentEmail {
  subject: string;
  html: string;
  text: string;
  ics: string;
  icsFilename: string;
}

function formatWhen(iso: string, timeZone: string): { date: string; time: string } {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone,
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(d);
  return { date, time };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildAppointmentEmail(input: AppointmentEmailInput): BuiltAppointmentEmail {
  const { lead, appointment, companyName, timeZone } = input;
  const kind = appointment.appointment_type === 'adjuster' ? 'adjuster visit' : 'roof inspection';
  const kindTitle = appointment.appointment_type === 'adjuster' ? 'Adjuster Visit' : 'Roof Inspection';
  const { date, time } = formatWhen(appointment.scheduled_at, timeZone);

  const address = [lead.address_street, [lead.address_city, lead.address_state].filter(Boolean).join(', '), lead.address_zip]
    .filter(Boolean)
    .join(', ');
  const greeting = lead.first_name?.trim() ? `Hi ${lead.first_name.trim()},` : 'Hello,';

  const subject = `${kindTitle} confirmed — ${date} at ${time}`;

  const textLines = [
    greeting,
    '',
    `Your ${kind} with ${companyName} is confirmed.`,
    '',
    `When: ${date} at ${time}`,
  ];
  if (address) textLines.push(`Where: ${address}`);
  if (appointment.notes?.trim()) textLines.push('', `Notes: ${appointment.notes.trim()}`);
  textLines.push(
    '',
    'A calendar invite is attached so you can add it to your calendar.',
    '',
    `If you need to reschedule, just reply to this email.`,
    '',
    `— ${companyName}`
  );
  const text = textLines.join('\n');

  const html = `<!-- appointment confirmation -->
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p>${escapeHtml(greeting)}</p>
  <p>Your ${escapeHtml(kind)} with <strong>${escapeHtml(companyName)}</strong> is confirmed.</p>
  <table cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">
    <tr><td style="padding:4px 12px 4px 0;color:#666">When</td><td style="padding:4px 0"><strong>${escapeHtml(date)}</strong> at <strong>${escapeHtml(time)}</strong></td></tr>
    ${address ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Where</td><td style="padding:4px 0">${escapeHtml(address)}</td></tr>` : ''}
    ${appointment.notes?.trim() ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Notes</td><td style="padding:4px 0">${escapeHtml(appointment.notes.trim())}</td></tr>` : ''}
  </table>
  <p style="color:#666;font-size:13px">A calendar invite is attached so you can add it to your calendar.</p>
  <p style="color:#666;font-size:13px">If you need to reschedule, just reply to this email.</p>
  <p>— ${escapeHtml(companyName)}</p>
</div>`;

  const ics = buildIcs({
    uid: `appointment-${appointment.id}@roof-leads`,
    start: new Date(appointment.scheduled_at),
    title: `${kindTitle} — ${companyName}`,
    description: appointment.notes?.trim() || `${kindTitle} with ${companyName}`,
    location: address || null,
    organizerName: companyName,
    organizerEmail: input.replyTo || null,
  });

  return { subject, html, text, ics, icsFilename: 'appointment.ics' };
}
