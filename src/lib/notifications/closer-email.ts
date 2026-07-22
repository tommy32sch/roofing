import { buildIcs } from './ics';

/**
 * Builds the internal heads-up sent to the assigned closer when an appointment
 * is booked on one of their leads.
 *
 * Deliberately different from the homeowner's confirmation: this one is
 * operational. The closer needs the address, a number to call, and whatever the
 * setter wrote down — not a friendly confirmation. It carries the same .ics so
 * the appointment lands on their calendar too.
 *
 * Do Not Call leads show "knock only" in place of a number. DNC numbers are
 * never stored, so there is nothing to leak here, but saying so explicitly stops
 * a closer wondering why the phone is blank.
 */

export interface CloserEmailInput {
  lead: {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    phone?: string | null;
    address_street?: string | null;
    address_city?: string | null;
    address_state?: string | null;
    address_zip?: string | null;
    is_dnc?: boolean | null;
  };
  appointment: {
    id: string;
    scheduled_at: string;
    appointment_type: 'inspection' | 'adjuster';
    notes?: string | null;
  };
  companyName: string;
  timeZone: string;
  /** Name of whoever booked it, when known. */
  bookedBy?: string | null;
  /** Base URL of the CRM, for the deep link back to the lead. */
  appUrl?: string | null;
}

export interface BuiltCloserEmail {
  subject: string;
  html: string;
  text: string;
  ics: string;
  icsFilename: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildCloserEmail(input: CloserEmailInput): BuiltCloserEmail {
  const { lead, appointment, companyName, timeZone } = input;
  const d = new Date(appointment.scheduled_at);
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone,
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(d);

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || 'Unknown lead';
  const kindTitle = appointment.appointment_type === 'adjuster' ? 'Adjuster visit' : 'Inspection';
  const address = [lead.address_street, [lead.address_city, lead.address_state].filter(Boolean).join(', '), lead.address_zip]
    .filter(Boolean)
    .join(', ');
  const contact = lead.is_dnc ? 'Do not call — knock only' : lead.phone?.trim() || 'No number on file';
  const leadUrl = input.appUrl ? `${input.appUrl.replace(/\/$/, '')}/admin/leads/${lead.id}` : null;

  const subject = `${kindTitle}: ${name} — ${date} at ${time}`;

  const rows: [string, string][] = [
    ['When', `${date} at ${time}`],
    ['Homeowner', name],
  ];
  if (address) rows.push(['Address', address]);
  rows.push(['Phone', contact]);
  if (appointment.notes?.trim()) rows.push(['Setter notes', appointment.notes.trim()]);
  if (input.bookedBy?.trim()) rows.push(['Booked by', input.bookedBy.trim()]);

  const text = [
    `${kindTitle} booked on a lead assigned to you.`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(leadUrl ? ['', `Open lead: ${leadUrl}`] : []),
    '',
    'Calendar invite attached.',
  ].join('\n');

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
  <p><strong>${escapeHtml(kindTitle)}</strong> booked on a lead assigned to you.</p>
  <table cellpadding="0" cellspacing="0" style="margin:16px 0;border-collapse:collapse">
    ${rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
      )
      .join('\n    ')}
  </table>
  ${leadUrl ? `<p><a href="${escapeHtml(leadUrl)}" style="color:#2563eb">Open lead in ${escapeHtml(companyName)}</a></p>` : ''}
  <p style="color:#666;font-size:13px">Calendar invite attached.</p>
</div>`;

  const ics = buildIcs({
    uid: `appointment-${appointment.id}-closer@roof-leads`,
    start: d,
    title: `${kindTitle} — ${name}`,
    description: [appointment.notes?.trim(), leadUrl].filter(Boolean).join('\n') || `${kindTitle} for ${name}`,
    location: address || null,
    organizerName: companyName,
  });

  return { subject, html, text, ics, icsFilename: 'appointment.ics' };
}
