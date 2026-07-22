import { describe, it, expect } from 'vitest';
import { buildIcs, toIcsDate, escapeIcsText, foldIcsLine } from './ics';

describe('toIcsDate', () => {
  it('formats as UTC basic date-time', () => {
    expect(toIcsDate(new Date('2026-08-05T21:30:00.000Z'))).toBe('20260805T213000Z');
  });

  it('converts a local-offset time to UTC', () => {
    expect(toIcsDate(new Date('2026-08-05T14:30:00-07:00'))).toBe('20260805T213000Z');
  });
});

describe('escapeIcsText', () => {
  it('escapes the reserved characters', () => {
    expect(escapeIcsText('Smith, John; roof')).toBe('Smith\\, John\\; roof');
    expect(escapeIcsText('back\\slash')).toBe('back\\\\slash');
  });

  it('turns newlines into literal \\n', () => {
    expect(escapeIcsText('line1\nline2')).toBe('line1\\nline2');
    expect(escapeIcsText('line1\r\nline2')).toBe('line1\\nline2');
  });
});

describe('foldIcsLine', () => {
  it('leaves short lines alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds long lines with a leading space on continuations', () => {
    const folded = foldIcsLine('SUMMARY:' + 'a'.repeat(200));
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0].length).toBe(75);
    parts.slice(1).forEach((p) => expect(p.startsWith(' ')).toBe(true));
    // unfolding restores the original
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe('SUMMARY:' + 'a'.repeat(200));
  });

  it('never splits a multi-byte character across a fold', () => {
    const folded = foldIcsLine('SUMMARY:' + 'é'.repeat(100)); // 2 bytes each
    for (const part of folded.split('\r\n')) {
      expect(part.includes('�')).toBe(false); // no replacement chars
    }
    const unfolded = folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join('');
    expect(unfolded).toBe('SUMMARY:' + 'é'.repeat(100));
  });
});

describe('buildIcs', () => {
  const base = {
    uid: 'appt-123',
    start: new Date('2026-08-05T21:30:00Z'),
    title: 'Roof Inspection',
  };

  it('produces a valid single-event calendar', () => {
    const ics = buildIcs(base);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('END:VEVENT');
    expect(ics).toContain('UID:appt-123');
    expect(ics).toContain('DTSTART:20260805T213000Z');
    expect(ics).toContain('SUMMARY:Roof Inspection');
    expect(ics).toContain('METHOD:REQUEST');
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('defaults the end to one hour after the start', () => {
    expect(buildIcs(base)).toContain('DTEND:20260805T223000Z');
  });

  it('honours an explicit end time', () => {
    const ics = buildIcs({ ...base, end: new Date('2026-08-05T23:00:00Z') });
    expect(ics).toContain('DTEND:20260805T230000Z');
  });

  it('uses CRLF line endings throughout', () => {
    const ics = buildIcs(base);
    expect(ics.endsWith('\r\n')).toBe(true);
    // every newline is preceded by a carriage return
    expect(/[^\r]\n/.test(ics)).toBe(false);
  });

  it('includes optional fields when provided and omits them otherwise', () => {
    const full = buildIcs({
      ...base,
      description: 'Notes; with, commas',
      location: '3445 E Palm Ln',
      organizerName: 'Tacheny',
      organizerEmail: 'hello@example.com',
    });
    expect(full).toContain('DESCRIPTION:Notes\\; with\\, commas');
    expect(full).toContain('LOCATION:3445 E Palm Ln');
    expect(full).toContain('ORGANIZER;CN=Tacheny:mailto:hello@example.com');

    const bare = buildIcs(base);
    expect(bare).not.toContain('DESCRIPTION:');
    expect(bare).not.toContain('LOCATION:');
    expect(bare).not.toContain('ORGANIZER');
  });

  it('marks a cancellation', () => {
    const ics = buildIcs({ ...base, method: 'CANCEL', sequence: 1 });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('SEQUENCE:1');
  });
});
