import { describe, it, expect } from 'vitest';
import {
  mapFieldName,
  parseNumeric,
  parseDecimal,
  normalizePhone,
  normalizeLeadData,
  parseDncFlag,
} from './normalize';

describe('mapFieldName', () => {
  it('maps common header variants to canonical fields', () => {
    expect(mapFieldName('First Name')).toBe('first_name');
    expect(mapFieldName('Phone 1')).toBe('phone');
    expect(mapFieldName('ZIP Code')).toBe('address_zip');
    expect(mapFieldName('Property Address')).toBe('address_street');
    expect(mapFieldName('Market Value')).toBe('home_value');
  });

  it('is case/underscore/dash/whitespace insensitive', () => {
    expect(mapFieldName('first_name')).toBe('first_name');
    expect(mapFieldName('FIRST-NAME')).toBe('first_name');
    expect(mapFieldName('  first   name  ')).toBe('first_name');
  });

  it('returns null for unknown headers', () => {
    expect(mapFieldName('favorite color')).toBeNull();
  });
});

describe('parseNumeric / parseDecimal', () => {
  it('strips currency symbols and commas', () => {
    expect(parseNumeric('$1,234')).toBe(1234);
    expect(parseNumeric('300,000')).toBe(300000);
    expect(parseDecimal('$1,234.50')).toBe(1234.5);
  });

  it('parseNumeric truncates decimals; parseDecimal keeps them', () => {
    expect(parseNumeric('12.9')).toBe(12);
    expect(parseDecimal('12.5')).toBe(12.5);
  });

  it('returns null for empty / non-numeric input', () => {
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric(null)).toBeNull();
    expect(parseNumeric('abc')).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('formats a valid US number to E.164 while keeping the raw', () => {
    const r = normalizePhone('(650) 253-0000');
    expect(r.phone).toBe('(650) 253-0000');
    expect(r.phone_normalized).toBe('+16502530000');
  });

  it('keeps the raw but returns null normalized for junk input', () => {
    const r = normalizePhone('not a phone');
    expect(r.phone).toBe('not a phone');
    expect(r.phone_normalized).toBeNull();
  });

  it('returns nulls for empty input', () => {
    expect(normalizePhone(null)).toEqual({ phone: null, phone_normalized: null });
    expect(normalizePhone('   ')).toEqual({ phone: null, phone_normalized: null });
  });
});

describe('normalizeLeadData', () => {
  it('returns null when both names are missing', () => {
    expect(normalizeLeadData({ email: 'x@y.com' })).toBeNull();
  });

  it('splits a full name that arrived in a single field (BatchLeads case)', () => {
    const lead = normalizeLeadData({ last_name: 'John Smith', phone: '(650) 253-0000' });
    expect(lead).not.toBeNull();
    expect(lead!.first_name).toBe('John');
    expect(lead!.last_name).toBe('Smith');
  });

  it('fills last name as (unknown) when only a single first name is present', () => {
    const lead = normalizeLeadData({ first_name: 'Cher' });
    expect(lead!.first_name).toBe('Cher');
    expect(lead!.last_name).toBe('(unknown)');
  });

  it('maps and coerces a realistic raw row', () => {
    const lead = normalizeLeadData({
      'First Name': 'Jane',
      'Last Name': 'Doe',
      'Email Address': 'JANE@EXAMPLE.COM',
      'Property Address': '123 Main St',
      'Market Value': '$300,000',
      'Roof Type': 'Asphalt Shingle',
      'ZIP Code': '85001',
    });
    expect(lead).not.toBeNull();
    expect(lead!.email).toBe('jane@example.com'); // lowercased
    expect(lead!.address_street).toBe('123 Main St');
    expect(lead!.home_value).toBe(300000);
    expect(lead!.roof_type).toBe('asphalt shingle'); // lowercased
    expect(lead!.address_zip).toBe('85001');
  });
});

describe('parseDncFlag', () => {
  it('treats affirmative tokens as Do Not Call', () => {
    for (const v of ['yes', 'Y', 'true', 'T', '1', 'x', 'DNC', ' Yes ']) {
      expect(parseDncFlag(v)).toBe(true);
    }
  });

  it('treats negatives / blanks as callable', () => {
    for (const v of ['no', 'n', 'false', '0', '', 'N/A', null, undefined]) {
      expect(parseDncFlag(v)).toBe(false);
    }
  });
});

describe('normalizeLeadData — DNC flag', () => {
  it('flags a lead when the source row marks Do Not Call', () => {
    expect(normalizeLeadData({ first_name: 'A', last_name: 'B', DNC: 'Yes' })!.is_dnc).toBe(true);
    expect(normalizeLeadData({ first_name: 'A', last_name: 'B', 'Do Not Call': 'true' })!.is_dnc).toBe(true);
  });

  it('leaves is_dnc false when absent or negative', () => {
    expect(normalizeLeadData({ first_name: 'A', last_name: 'B' })!.is_dnc).toBe(false);
    expect(normalizeLeadData({ first_name: 'A', last_name: 'B', DNC: 'no' })!.is_dnc).toBe(false);
  });

  it('drops all phone numbers for a DNC lead but keeps other fields', () => {
    const lead = normalizeLeadData({
      first_name: 'A',
      last_name: 'B',
      phone: '(650) 253-0000',
      phone2: '(212) 555-1234',
      phone3: '(415) 555-9876',
      email: 'a@b.com',
      address_street: '123 Main St',
      DNC: 'Yes',
    })!;
    expect(lead.is_dnc).toBe(true);
    expect(lead.phone).toBeNull();
    expect(lead.phone_normalized).toBeNull();
    expect(lead.phone2).toBeNull();
    expect(lead.phone2_normalized).toBeNull();
    expect(lead.phone3).toBeNull();
    expect(lead.phone3_normalized).toBeNull();
    // everything else still imports
    expect(lead.email).toBe('a@b.com');
    expect(lead.address_street).toBe('123 Main St');
  });

  it('keeps phone numbers for a non-DNC lead', () => {
    const lead = normalizeLeadData({
      first_name: 'A',
      last_name: 'B',
      phone: '(650) 253-0000',
    })!;
    expect(lead.is_dnc).toBe(false);
    expect(lead.phone_normalized).toBe('+16502530000');
  });
});
