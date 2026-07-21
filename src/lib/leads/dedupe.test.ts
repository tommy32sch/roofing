import { describe, it, expect } from 'vitest';
import { normalizeStreet, addressConflicts, assignDuplicates } from './dedupe';

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

describe('assignDuplicates', () => {
  const rec = (id: string, street: string | null, extra: Record<string, unknown> = {}) => ({
    id, address_street: street, ...extra,
  });

  it('keeps the first record at an address and flags later ones', () => {
    const r = assignDuplicates([
      rec('a', '1039 N 35th St'),
      rec('b', '1039 North 35th Street'),
      rec('c', '1040 N 35th St'),
    ]);
    expect(r.get('a')).toBeNull();
    expect(r.get('b')).toBe('a');
    expect(r.get('c')).toBeNull();
  });

  it('collapses a whole cluster onto one original instead of chaining', () => {
    const r = assignDuplicates([
      rec('a', '5 Palm Ave'),
      rec('b', '5 Palm Avenue'),
      rec('c', '5 palm ave.'),
    ]);
    expect(r.get('b')).toBe('a');
    expect(r.get('c')).toBe('a'); // not 'b'
  });

  it('does not flag different people at different houses who share a phone', () => {
    // the real false positive that phone-based dedup produced
    const r = assignDuplicates([
      rec('olivia', '1715 N 33rd Pl'),
      rec('irving', '1712 N 33rd Pl'),
    ]);
    expect(r.get('olivia')).toBeNull();
    expect(r.get('irving')).toBeNull();
  });

  it('matches on APN even when the street text differs', () => {
    const r = assignDuplicates([
      rec('a', '100 Main St', { apn: '123-45-678' }),
      rec('b', '100 Main Street Rear Unit', { apn: '123-45-678' }),
    ]);
    expect(r.get('b')).toBe('a');
  });

  it('does not match same street in a different city/zip', () => {
    const r = assignDuplicates([
      rec('a', '123 Main St', { address_city: 'Phoenix', address_zip: '85008' }),
      rec('b', '123 Main St', { address_city: 'Mesa', address_zip: '85201' }),
    ]);
    expect(r.get('b')).toBeNull();
  });

  it('ignores records with no address and no APN', () => {
    const r = assignDuplicates([rec('a', null), rec('b', null), rec('c', '   ')]);
    expect(r.get('a')).toBeNull();
    expect(r.get('b')).toBeNull();
    expect(r.get('c')).toBeNull();
  });
});
