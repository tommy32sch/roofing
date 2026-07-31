import { describe, it, expect } from 'vitest';
import { parseGeocodioReverse, parseNominatimReverse } from './geocode-reverse';

/** Captured live from Geocodio for 33.467715,-112.008372 on 2026-07-31. */
const GEOCODIO_LIVE = {
  results: [
    {
      accuracy_type: 'rooftop',
      address_components: {
        number: '3401',
        predirectional: 'E',
        street: 'Coronado',
        suffix: 'Rd',
        formatted_street: 'E Coronado Rd',
        city: 'Phoenix',
        county: 'Maricopa County',
        state: 'AZ',
        zip: '85008',
        country: 'US',
      },
    },
  ],
};

describe('parseGeocodioReverse', () => {
  it('rebuilds the street line from its components', () => {
    expect(parseGeocodioReverse(GEOCODIO_LIVE)).toEqual({
      address_street: '3401 E Coronado Rd',
      address_city: 'Phoenix',
      address_state: 'AZ',
      address_zip: '85008',
      source: 'geocodio',
      precise: true,
    });
  });

  /**
   * A point in the middle of a road answers with no house number. The address is
   * still useful — the rep can type the number — but the UI has to know it was
   * not precise so it can say so rather than presenting a guess as fact.
   */
  it('marks a result with no house number as imprecise', () => {
    const out = parseGeocodioReverse({
      results: [{ address_components: { street: 'Coronado', suffix: 'Rd', city: 'Phoenix', state: 'AZ' } }],
    });
    expect(out?.address_street).toBe('Coronado Rd');
    expect(out?.precise).toBe(false);
  });

  it('omits missing components rather than leaving gaps', () => {
    const out = parseGeocodioReverse({
      results: [{ address_components: { number: '12', street: 'Main', city: 'Mesa' } }],
    });
    expect(out?.address_street).toBe('12 Main');
    expect(out?.address_state).toBeNull();
    expect(out?.address_zip).toBeNull();
  });

  it('returns null when there is no usable street', () => {
    expect(parseGeocodioReverse({ results: [{ address_components: { city: 'Phoenix' } }] })).toBeNull();
    expect(parseGeocodioReverse({ results: [] })).toBeNull();
  });

  it('survives a malformed payload', () => {
    for (const bad of [null, undefined, 'text', {}, { results: 'nope' }, { results: [null] }]) {
      expect(parseGeocodioReverse(bad)).toBeNull();
    }
  });
});

describe('parseNominatimReverse', () => {
  const live = {
    address: {
      house_number: '3401',
      road: 'East Coronado Road',
      city: 'Phoenix',
      state: 'Arizona',
      postcode: '85008',
    },
  };

  it('reads a house-level result', () => {
    expect(parseNominatimReverse(live)).toEqual({
      address_street: '3401 East Coronado Road',
      address_city: 'Phoenix',
      address_state: 'Arizona',
      address_zip: '85008',
      source: 'nominatim',
      precise: true,
    });
  });

  // Nominatim frequently answers with the road only, which is exactly why it is
  // the fallback rather than the primary.
  it('accepts a road-only result but marks it imprecise', () => {
    const out = parseNominatimReverse({ address: { road: 'East Coronado Road', city: 'Phoenix' } });
    expect(out?.address_street).toBe('East Coronado Road');
    expect(out?.precise).toBe(false);
  });

  it('falls back through town, village and hamlet for the city', () => {
    expect(parseNominatimReverse({ address: { road: 'A', town: 'Gilbert' } })?.address_city).toBe('Gilbert');
    expect(parseNominatimReverse({ address: { road: 'A', village: 'Tortilla Flat' } })?.address_city).toBe('Tortilla Flat');
    expect(parseNominatimReverse({ address: { road: 'A', hamlet: 'Sunflower' } })?.address_city).toBe('Sunflower');
  });

  it('returns null without a road', () => {
    expect(parseNominatimReverse({ address: { city: 'Phoenix' } })).toBeNull();
  });

  it('survives a malformed payload', () => {
    for (const bad of [null, undefined, 'text', {}, { address: 'nope' }]) {
      expect(parseNominatimReverse(bad)).toBeNull();
    }
  });
});
