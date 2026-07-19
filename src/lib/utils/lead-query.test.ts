import { describe, it, expect } from 'vitest';
import {
  sanitizeSearch,
  safeSortColumn,
  buildLeadSearchFilter,
  LEAD_SORT_COLUMNS,
  directionRegex,
  sanitizeStreetNumber,
  STREET_DIRECTIONS,
  streetName,
} from './lead-query';

describe('sanitizeSearch', () => {
  it('strips PostgREST filter grammar characters', () => {
    expect(sanitizeSearch('a,b(c)d')).toBe('a b c d');
    expect(sanitizeSearch('50%')).toBe('50');
    expect(sanitizeSearch('a"b\\c:d')).toBe('a b c d');
  });

  it('keeps a real business name usable (the O\'Brien case)', () => {
    // the comma — not the apostrophe — was what broke the raw filter
    expect(sanitizeSearch("O'Brien, Inc.")).toBe("O'Brien Inc.");
  });

  it('collapses whitespace and trims', () => {
    expect(sanitizeSearch('  hello   world  ')).toBe('hello world');
  });
});

describe('safeSortColumn', () => {
  it('returns whitelisted columns unchanged', () => {
    for (const col of LEAD_SORT_COLUMNS) {
      expect(safeSortColumn(col)).toBe(col);
    }
  });

  it('falls back to created_at for unknown, empty, or null input', () => {
    expect(safeSortColumn('bogus')).toBe('created_at');
    expect(safeSortColumn('deal_value; drop table leads')).toBe('created_at');
    expect(safeSortColumn('')).toBe('created_at');
    expect(safeSortColumn(null)).toBe('created_at');
    expect(safeSortColumn(undefined)).toBe('created_at');
  });
});

describe('buildLeadSearchFilter', () => {
  it('returns null when there is nothing to search', () => {
    expect(buildLeadSearchFilter(null)).toBeNull();
    expect(buildLeadSearchFilter('')).toBeNull();
    expect(buildLeadSearchFilter('  ')).toBeNull();
    expect(buildLeadSearchFilter(',,,()')).toBeNull(); // sanitizes to empty
  });

  it('produces exactly one ILIKE clause per searchable column', () => {
    const filter = buildLeadSearchFilter('smith')!;
    expect(filter.split(',')).toHaveLength(6);
    expect(filter).toContain('first_name.ilike.%smith%');
    expect(filter).toContain('address_city.ilike.%smith%');
  });

  it('cannot be used to inject extra predicates (term stays inside one ILIKE value)', () => {
    // Without sanitizing, "x,status.eq.sold" would add a 7th OR predicate.
    // After sanitizing the comma is gone, so it collapses into the ILIKE value
    // and every comma-separated part is still a well-formed ilike clause.
    const parts = buildLeadSearchFilter('x,status.eq.sold')!.split(',');
    expect(parts).toHaveLength(6);
    expect(parts.every((p) => /^[a-z_]+\.ilike\.%.*%$/.test(p))).toBe(true);
  });
});

describe('directionRegex', () => {
  it('matches a direction as a whole word (abbrev or spelled out)', () => {
    expect(directionRegex('E')).toBe('\\y(E|East)\\y');
    expect(directionRegex('nw')).toBe('\\y(NW|Northwest)\\y');
  });

  it('returns null for unknown / empty input (untrusted input never reaches the regex)', () => {
    expect(directionRegex('X')).toBeNull();
    expect(directionRegex('')).toBeNull();
    expect(directionRegex(null)).toBeNull();
    expect(directionRegex('.*')).toBeNull();
  });

  it('covers all eight dropdown directions', () => {
    for (const d of STREET_DIRECTIONS) {
      expect(directionRegex(d)).not.toBeNull();
    }
    expect(STREET_DIRECTIONS).toEqual(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW']);
  });
});

describe('sanitizeStreetNumber', () => {
  it('keeps only digits', () => {
    expect(sanitizeStreetNumber('4604')).toBe('4604');
    expect(sanitizeStreetNumber('46 E')).toBe('46');
    expect(sanitizeStreetNumber("12'; drop--")).toBe('12');
  });

  it('returns empty string for null/undefined/no digits', () => {
    expect(sanitizeStreetNumber(null)).toBe('');
    expect(sanitizeStreetNumber(undefined)).toBe('');
    expect(sanitizeStreetNumber('Main')).toBe('');
  });
});

describe('streetName', () => {
  it('drops the leading house number so houses group by street', () => {
    expect(streetName('1039 N 35th St')).toBe('N 35th St');
    expect(streetName('1101 N 35th St')).toBe('N 35th St');
    expect(streetName('4604 E Crescent Ave')).toBe('E Crescent Ave');
    expect(streetName('123 main st')).toBe('main st');
  });

  it('keeps addresses that have no leading number', () => {
    expect(streetName('Main St')).toBe('Main St');
  });

  it('handles empty / null input', () => {
    expect(streetName('')).toBe('');
    expect(streetName(null)).toBe('');
    expect(streetName(undefined)).toBe('');
  });
});
