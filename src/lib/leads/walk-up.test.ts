import { describe, it, expect } from 'vitest';
import {
  metersBetween,
  findNearbyLeads,
  isPlausibleCoordinate,
  validateWalkUp,
  walkUpDisplayName,
  walkUpNameColumns,
  NEARBY_RADIUS_M,
} from './walk-up';

// A real Phoenix address used elsewhere in the geocoding tests.
const HOUSE = { latitude: 33.467715, longitude: -112.008372 };

describe('metersBetween', () => {
  it('is zero for the same point', () => {
    expect(metersBetween(HOUSE, HOUSE)).toBe(0);
  });

  /**
   * One degree of latitude is ~111km everywhere, which is the easiest
   * independent check that the haversine is not off by a factor.
   */
  it('measures a degree of latitude at about 111km', () => {
    const d = metersBetween({ latitude: 33, longitude: -112 }, { latitude: 34, longitude: -112 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  // Roughly a house-width apart, the scale this is actually used at.
  it('measures a small offset in metres', () => {
    const d = metersBetween(HOUSE, { latitude: 33.467715, longitude: -112.008172 });
    expect(d).toBeGreaterThan(15);
    expect(d).toBeLessThan(20);
  });

  it('is symmetric', () => {
    const a = { latitude: 33.4, longitude: -112.0 };
    const b = { latitude: 33.5, longitude: -111.9 };
    expect(metersBetween(a, b)).toBeCloseTo(metersBetween(b, a), 6);
  });
});

describe('findNearbyLeads', () => {
  const candidates = [
    { id: 'same', ...HOUSE, address_street: '3401 E Coronado Rd' },
    { id: 'next-door', latitude: 33.467715, longitude: -112.008172, address_street: '3405 E Coronado Rd' },
    { id: 'far', latitude: 33.5, longitude: -112.1, address_street: 'Miles away' },
  ];

  it('finds the house already at that point', () => {
    const hits = findNearbyLeads(candidates, HOUSE);
    expect(hits[0].id).toBe('same');
    expect(hits[0].distanceM).toBe(0);
  });

  it('orders by distance, nearest first', () => {
    const hits = findNearbyLeads(candidates, HOUSE);
    expect(hits.map(h => h.id)).toEqual(['same', 'next-door']);
  });

  it('excludes anything outside the radius', () => {
    expect(findNearbyLeads(candidates, HOUSE).some(h => h.id === 'far')).toBe(false);
  });

  it('respects a custom radius', () => {
    expect(findNearbyLeads(candidates, HOUSE, 5).map(h => h.id)).toEqual(['same']);
  });

  // A lead that was never geocoded has no point to compare against.
  it('ignores candidates without usable coordinates', () => {
    const bad = [
      { id: 'nan', latitude: NaN, longitude: NaN },
      { id: 'ok', ...HOUSE },
    ];
    expect(findNearbyLeads(bad, HOUSE).map(h => h.id)).toEqual(['ok']);
  });

  it('is empty when nothing is close', () => {
    expect(findNearbyLeads([candidates[2]], HOUSE)).toEqual([]);
  });

  it('defaults to a house-scale radius', () => {
    expect(NEARBY_RADIUS_M).toBeGreaterThan(10);
    expect(NEARBY_RADIUS_M).toBeLessThan(100);
  });
});

describe('isPlausibleCoordinate', () => {
  it('accepts a real point', () => {
    expect(isPlausibleCoordinate(33.46, -112.0)).toBe(true);
  });

  // What a failed geocode returns — never where someone is standing.
  it('rejects null island', () => {
    expect(isPlausibleCoordinate(0, 0)).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(isPlausibleCoordinate(91, 0)).toBe(false);
    expect(isPlausibleCoordinate(0, 181)).toBe(false);
  });

  it('rejects anything that is not a finite number', () => {
    expect(isPlausibleCoordinate('33.4', -112)).toBe(false);
    expect(isPlausibleCoordinate(NaN, -112)).toBe(false);
    expect(isPlausibleCoordinate(null, undefined)).toBe(false);
  });
});

describe('validateWalkUp', () => {
  it('accepts an address with no name — the common walk-up', () => {
    expect(validateWalkUp({ ...HOUSE, address_street: '3401 E Coronado Rd' })).toEqual({ ok: true });
  });

  it('accepts a name with no address', () => {
    expect(validateWalkUp({ ...HOUSE, last_name: 'Smith' })).toEqual({ ok: true });
  });

  /**
   * Coordinates alone produce a dot the next rep cannot act on — no door
   * number, no way to tell which house it was.
   */
  it('refuses a bare pin with nothing identifying it', () => {
    const r = validateWalkUp({ ...HOUSE });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/address or a name/);
  });

  it('treats whitespace as absent', () => {
    expect(validateWalkUp({ ...HOUSE, address_street: '   ', first_name: ' ' }).ok).toBe(false);
  });

  it('refuses an impossible location', () => {
    const r = validateWalkUp({ latitude: 0, longitude: 0, address_street: '1 Main' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/map location/);
  });
});

describe('walkUpDisplayName', () => {
  it('prefers the name', () => {
    expect(walkUpDisplayName({ first_name: 'Jane', last_name: 'Smith' })).toBe('Jane Smith');
  });

  it('falls back to the street for an address-only lead', () => {
    expect(walkUpDisplayName({ address_street: '3401 E Coronado Rd' })).toBe('3401 E Coronado Rd');
  });

  it('has a last resort', () => {
    expect(walkUpDisplayName({})).toBe('Unknown occupant');
  });
});

describe('walkUpNameColumns', () => {
  it('splits a supplied name', () => {
    expect(walkUpNameColumns({ ...HOUSE, first_name: 'Jane', last_name: 'Smith' }))
      .toEqual({ first_name: 'Jane', last_name: 'Smith' });
  });

  it('keeps a half-supplied name', () => {
    expect(walkUpNameColumns({ ...HOUSE, last_name: 'Smith' }))
      .toEqual({ first_name: '', last_name: 'Smith' });
  });

  /**
   * The address goes in first_name rather than a literal "Unknown" so the leads
   * list stays scannable: a column of street addresses tells a rep which door,
   * a column of "Unknown" tells them nothing.
   */
  it('uses the street when there is no name at all', () => {
    expect(walkUpNameColumns({ ...HOUSE, address_street: '3401 E Coronado Rd' }))
      .toEqual({ first_name: '3401 E Coronado Rd', last_name: '' });
  });

  it('never returns null, since the columns are NOT NULL', () => {
    const r = walkUpNameColumns({ ...HOUSE });
    expect(typeof r.first_name).toBe('string');
    expect(typeof r.last_name).toBe('string');
    expect(r.first_name.length).toBeGreaterThan(0);
  });
});
