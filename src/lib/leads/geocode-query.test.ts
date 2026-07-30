import { describe, it, expect } from 'vitest';
import { buildGeocodeQuery, isGeocodable } from './geocode-query';

const AZ = { city: 'Phoenix', state: 'AZ' };
const NONE = { city: null, state: null };

const lead = (over: Partial<Parameters<typeof buildGeocodeQuery>[0]> = {}) => ({
  address_street: '5719 E Flowing Spg',
  address_city: null,
  address_state: null,
  address_zip: null,
  ...over,
});

describe('buildGeocodeQuery', () => {
  /**
   * The reported bug. These leads carry a ZIP but no city, and the market's
   * default city is Phoenix — while ZIP 85132 is Pinal County. Sending both made
   * Nominatim return nothing for all 301 leads, verified live against the API.
   */
  it('does NOT substitute a default city over the lead\'s own ZIP', () => {
    const q = buildGeocodeQuery(lead({ address_zip: '85132-7916' }), AZ);
    expect(q).toEqual({
      street: '5719 E Flowing Spg',
      city: null,
      state: 'AZ',
      zip: '85132-7916',
    });
  });

  it('uses the default city only when there is no ZIP either', () => {
    const q = buildGeocodeQuery(lead(), AZ);
    expect(q).toEqual({ street: '5719 E Flowing Spg', city: 'Phoenix', state: 'AZ', zip: null });
  });

  // The lead's own city is the most specific signal and beats both.
  it('prefers the lead\'s own city over the default, and keeps the ZIP', () => {
    const q = buildGeocodeQuery(
      lead({ address_city: 'Casa Grande', address_zip: '85132' }),
      AZ
    );
    expect(q).toMatchObject({ city: 'Casa Grande', zip: '85132' });
  });

  it('prefers the lead\'s own state over the default', () => {
    const q = buildGeocodeQuery(lead({ address_state: 'MN', address_zip: '55401' }), AZ);
    expect(q?.state).toBe('MN');
  });

  // State never contradicts a ZIP, and it stops a same-named street in another
  // state from matching, so it is always carried through.
  it('keeps the region state even when sending only a ZIP', () => {
    const q = buildGeocodeQuery(lead({ address_zip: '85132' }), AZ);
    expect(q?.state).toBe('AZ');
    expect(q?.city).toBeNull();
  });

  it('refuses a lead with no street', () => {
    expect(buildGeocodeQuery(lead({ address_street: null }), AZ)).toBeNull();
    expect(buildGeocodeQuery(lead({ address_street: '   ' }), AZ)).toBeNull();
  });

  // A bare street with no region would match the same street name elsewhere in
  // the country. A wrong pin looks correct, so refusing is safer.
  it('refuses a bare street when no region is available', () => {
    expect(buildGeocodeQuery(lead(), NONE)).toBeNull();
  });

  it('still geocodes a bare street when the lead has its own city', () => {
    const q = buildGeocodeQuery(lead({ address_city: 'Mesa' }), NONE);
    expect(q).toMatchObject({ city: 'Mesa', zip: null });
  });

  it('still geocodes when the lead has only a ZIP and no region at all', () => {
    const q = buildGeocodeQuery(lead({ address_zip: '85132' }), NONE);
    expect(q).toMatchObject({ city: null, state: null, zip: '85132' });
  });

  it('treats blank strings as absent rather than as values', () => {
    const q = buildGeocodeQuery(
      lead({ address_city: '  ', address_state: '', address_zip: '  ' }),
      AZ
    );
    expect(q).toEqual({ street: '5719 E Flowing Spg', city: 'Phoenix', state: 'AZ', zip: null });
  });

  it('trims the street', () => {
    expect(buildGeocodeQuery(lead({ address_street: '  12 Oak St  ' }), AZ)?.street).toBe('12 Oak St');
  });

  // ZIP+4 is what the imports actually contain; Nominatim accepts it, so it is
  // passed through untouched rather than being truncated on a guess.
  it('passes ZIP+4 through unchanged', () => {
    expect(buildGeocodeQuery(lead({ address_zip: '85132-8063' }), AZ)?.zip).toBe('85132-8063');
  });
});

describe('isGeocodable', () => {
  it('matches whether a query could be built', () => {
    expect(isGeocodable(lead({ address_zip: '85132' }), NONE)).toBe(true);
    expect(isGeocodable(lead(), AZ)).toBe(true);
    expect(isGeocodable(lead(), NONE)).toBe(false);
    expect(isGeocodable(lead({ address_street: null }), AZ)).toBe(false);
  });
});
