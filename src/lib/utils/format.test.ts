import { describe, it, expect } from 'vitest';
import { formatPhone, formatAddress, formatAddressShort } from './format';

describe('formatPhone', () => {
  it('formats a bare 10-digit US number', () => {
    expect(formatPhone('6024237756')).toBe('(602) 423-7756');
  });

  it('formats an E.164 number', () => {
    expect(formatPhone('+16024237756')).toBe('(602) 423-7756');
  });

  it('returns the raw value when it cannot be parsed', () => {
    expect(formatPhone('call the office')).toBe('call the office');
    expect(formatPhone('123')).toBe('123');
  });

  it('returns empty string for missing input', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
    expect(formatPhone('  ')).toBe('');
  });
});

describe('formatAddress', () => {
  it('leads with the street', () => {
    expect(formatAddress({ address_street: '1039 N 35th St', address_city: 'Phoenix', address_state: 'AZ' }))
      .toBe('1039 N 35th St · Phoenix, AZ');
  });

  it('shows the street alone when city/state are missing (street-only lists)', () => {
    expect(formatAddress({ address_street: '1039 N 35th St' })).toBe('1039 N 35th St');
  });

  it('falls back to city/state when there is no street', () => {
    expect(formatAddress({ address_city: 'Phoenix', address_state: 'AZ' })).toBe('Phoenix, AZ');
  });

  it('returns empty string when there is no address at all', () => {
    expect(formatAddress({})).toBe('');
  });
});

describe('formatAddressShort', () => {
  it('prefers the street', () => {
    expect(formatAddressShort({ address_street: '1039 N 35th St', address_city: 'Phoenix' })).toBe('1039 N 35th St');
  });

  it('falls back to city/state, then empty', () => {
    expect(formatAddressShort({ address_city: 'Phoenix', address_state: 'AZ' })).toBe('Phoenix, AZ');
    expect(formatAddressShort({})).toBe('');
  });
});
