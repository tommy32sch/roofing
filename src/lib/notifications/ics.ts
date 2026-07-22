/**
 * Minimal iCalendar (.ics) builder for appointment invites.
 *
 * Attached to the homeowner's confirmation email so the appointment lands on
 * their real calendar (Apple/Google/Outlook all accept a text/calendar
 * attachment). Hand-rolled rather than pulling a dependency: the spec surface
 * we need is one VEVENT, and the fiddly parts — UTC stamps, CRLF line endings,
 * escaping, 75-octet folding — are all covered and unit-tested here.
 */

export interface IcsEvent {
  /** Stable unique id; reuse the appointment id so updates replace, not duplicate. */
  uid: string;
  start: Date;
  /** Defaults to one hour after start. */
  end?: Date;
  title: string;
  description?: string | null;
  location?: string | null;
  organizerName?: string | null;
  organizerEmail?: string | null;
  /** Bumped on each update so calendar clients supersede the previous version. */
  sequence?: number;
  method?: 'REQUEST' | 'CANCEL';
}

/** RFC 5545 date-time in UTC: 20260805T213000Z */
export function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escape per RFC 5545: backslash, semicolon, comma, and newlines. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\n|\r/g, '\\n');
}

/**
 * Fold to 75 octets per line with a leading space on continuations. Folding is
 * byte-based, so multi-byte characters must not be split across a fold.
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  let limit = 75; // first line 75 octets, continuations 74 (+1 for the leading space)
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a UTF-8 sequence: continuation bytes are 0b10xxxxxx
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return out.join('\r\n ');
}

export function buildIcs(event: IcsEvent): string {
  const end = event.end ?? new Date(event.start.getTime() + 60 * 60 * 1000);
  const method = event.method ?? 'REQUEST';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Roof Leads CRM//Appointments//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsDate(new Date(event.start))}`,
    `DTSTART:${toIcsDate(event.start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SEQUENCE:${event.sequence ?? 0}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];

  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  if (event.organizerEmail) {
    const cn = event.organizerName ? `;CN=${escapeIcsText(event.organizerName)}` : '';
    lines.push(`ORGANIZER${cn}:mailto:${event.organizerEmail}`);
  }
  lines.push(`STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR');

  // RFC 5545 requires CRLF line endings
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
