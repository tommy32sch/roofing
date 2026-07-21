import { describe, it, expect } from 'vitest';
import { normalizeStreet, addressConflicts } from './dedupe';

describe('normalizeStreet', () => {
  it('treats spelled-out and abbreviated forms as the same address', () => {
    const key = normalizeStreet('1039 N 35th St');
    expect(normalizeStreet('1039 North 35th Street')).toBe(key);
    expect(normalizeStreet('1039 n. 35th st.')).toBe(key);
    expect(normalizeStreet('  1039   N   35TH   ST  ')).toBe(key);
  });

  it('normalizes common street types and directionals', () => {
    expect(normalizeStreet('42 SW Camelback Boulevard')).toBe(
      normalizeStreet('42 Southwest Camelback Blvd')
    );
    expect(normalizeStreet('7 E Palm Avenue')).toBe(normalizeStreet('7 East Palm Ave'));
    expect(normalizeStreet('9 Sunset Drive')).toBe(normalizeStreet('9 Sunset Dr'));
  });

  it('collapses unit designators so Apt/Unit/# match', () => {
    const key = normalizeStreet('500 W Main St Apt 4');
    expect(normalizeStreet('500 W Main St Unit 4')).toBe(key);
    expect(normalizeStreet('500 W Main St #4')).toBe(key);
    expect(normalizeStreet('500 W Main St apt #4')).toBe(key);
  });

  it('keeps genuinely different addresses distinct', () => {
    expect(normalizeStreet('1039 N 35th St')).not.toBe(normalizeStreet('1040 N 35th St'));
    expect(normalizeStreet('1039 N 35th St')).not.toBe(normalizeStreet('1039 S 35th St'));
    expect(normalizeStreet('1039 N 35th St')).not.toBe(normalizeStreet('1039 N 35th Ave'));
    // different unit at the same building is a different lead
    expect(normalizeStreet('500 W Main St Apt 4')).not.toBe(normalizeStreet('500 W Main St Apt 5'));
  });

  it('returns null for empty or unusable input', () => {
    expect(normalizeStreet(null)).toBeNull();
    expect(normalizeStreet(undefined)).toBeNull();
    expect(normalizeStreet('')).toBeNull();
    expect(normalizeStreet('   ')).toBeNull();
    expect(normalizeStreet('...')).toBeNull();
  });
});

describe('addressConflicts', () => {
  it('blocks a match when zips explicitly differ', () => {
    expect(addressConflicts({ zip: '85008' }, { zip: '85201' })).toBe(true);
  });

  it('blocks a match when cities explicitly differ', () => {
    expect(addressConflicts({ city: 'Phoenix' }, { city: 'Mesa' })).toBe(true);
  });

  it('allows a match when either side lacks city/zip (street-only lists)', () => {
    expect(addressConflicts({}, { city: 'Phoenix', zip: '85008' })).toBe(false);
    expect(addressConflicts({ city: null, zip: null }, { city: 'Mesa' })).toBe(false);
  });

  it('allows a match when city/zip agree (case/space insensitive)', () => {
    expect(addressConflicts({ city: 'Phoenix', zip: '85008' }, { city: ' phoenix ', zip: '85008' })).toBe(false);
  });
});
