import { describe, it, expect } from 'vitest';
import {
  classifyGeocodioPrecision,
  parseGeocodioResponse,
  buildCassQuery,
  MIN_ACCURACY,
} from './geocode-cass';

describe('classifyGeocodioPrecision', () => {
  // Captured from a live response for 5543 E Flowing Spg — the case this tier
  // was added for.
  it('treats a rooftop or parcel hit as the most precise tier', () => {
    for (const t of ['rooftop', 'point', 'parcel_centroid', 'building_centroid']) {
      expect(classifyGeocodioPrecision(t), t).toBe('rooftop');
    }
    expect(classifyGeocodioPrecision('ROOFTOP')).toBe('rooftop');
  });

  /**
   * The trap. Geocodio returns accuracy 1 for BOTH of these, so scoring alone
   * would let them through as precise — and many houses on one street would
   * collapse to one point, which is the exact bug this tier exists to fix.
   * Verified live: "5700 E Flowing Spg" -> range_interpolation, accuracy 1;
   * street-only -> street_center, accuracy 1.
   */
  it('treats interpolation and street centres as street-level, not house', () => {
    expect(classifyGeocodioPrecision('range_interpolation')).toBe('street');
    expect(classifyGeocodioPrecision('street_center')).toBe('street');
    expect(classifyGeocodioPrecision('intersection')).toBe('street');
  });

  // A nonexistent address returns the CITY centre dressed as a match.
  it('treats a place or admin fallback as area-level', () => {
    for (const t of ['place', 'county', 'state', 'zip']) {
      expect(classifyGeocodioPrecision(t), t).toBe('area');
    }
  });

  it('defaults an unknown or missing type to area', () => {
    expect(classifyGeocodioPrecision(undefined)).toBe('area');
    expect(classifyGeocodioPrecision(null)).toBe('area');
    expect(classifyGeocodioPrecision(42)).toBe('area');
    expect(classifyGeocodioPrecision('some_future_type')).toBe('area');
  });
});

describe('parseGeocodioResponse', () => {
  const rooftop = {
    results: [
      {
        location: { lat: 33.091784, lng: -111.506668 },
        accuracy: 1,
        accuracy_type: 'rooftop',
        source: 'Pinal',
      },
    ],
  };

  it('reads a rooftop match', () => {
    expect(parseGeocodioResponse(rooftop)).toEqual({
      latitude: 33.091784,
      longitude: -111.506668,
      precision: 'rooftop',
      accuracyType: 'rooftop',
      source: 'Pinal',
    });
  });

  it('keeps a street-level match but labels it as such', () => {
    const out = parseGeocodioResponse({
      results: [{ location: { lat: 33.09, lng: -111.5 }, accuracy: 1, accuracy_type: 'street_center' }],
    });
    expect(out?.precision).toBe('street');
  });

  // A low score means the provider is unsure it matched the right address at
  // all, whatever granularity it claims.
  it('rejects a result below the accuracy floor', () => {
    expect(
      parseGeocodioResponse({
        results: [{ location: { lat: 33.03, lng: -111.38 }, accuracy: 0.5, accuracy_type: 'place' }],
      })
    ).toBeNull();
  });

  it('accepts exactly at the floor', () => {
    const out = parseGeocodioResponse({
      results: [{ location: { lat: 33.09, lng: -111.5 }, accuracy: MIN_ACCURACY, accuracy_type: 'rooftop' }],
    });
    expect(out?.precision).toBe('rooftop');
  });

  it('returns null when nothing matched', () => {
    expect(parseGeocodioResponse({ results: [] })).toBeNull();
    expect(parseGeocodioResponse({})).toBeNull();
  });

  it('survives a malformed payload', () => {
    for (const bad of [null, undefined, 'text', { results: 'nope' }, { results: [{}] }]) {
      expect(parseGeocodioResponse(bad)).toBeNull();
    }
  });

  it('rejects 0,0', () => {
    expect(
      parseGeocodioResponse({ results: [{ location: { lat: 0, lng: 0 }, accuracy: 1, accuracy_type: 'rooftop' }] })
    ).toBeNull();
  });

  it('takes the first result when several are returned', () => {
    const out = parseGeocodioResponse({
      results: [
        { location: { lat: 33.1, lng: -111.5 }, accuracy: 1, accuracy_type: 'rooftop', source: 'first' },
        { location: { lat: 44, lng: -99 }, accuracy: 1, accuracy_type: 'rooftop', source: 'second' },
      ],
    });
    expect(out?.source).toBe('first');
  });
});

describe('buildCassQuery', () => {
  it('joins the parts it has', () => {
    expect(buildCassQuery({ street: '5543 E Flowing Spg', city: 'Florence', state: 'AZ', zip: '85132' }))
      .toBe('5543 E Flowing Spg, Florence, AZ, 85132');
  });

  it('omits absent parts', () => {
    expect(buildCassQuery({ street: '5543 E Flowing Spg', state: 'AZ', zip: '85132' }))
      .toBe('5543 E Flowing Spg, AZ, 85132');
    expect(buildCassQuery({ street: '5543 E Flowing Spg' })).toBe('5543 E Flowing Spg');
  });

  it('requires a street', () => {
    expect(buildCassQuery({ street: '' })).toBeNull();
    expect(buildCassQuery({ street: '  ' })).toBeNull();
  });
});
