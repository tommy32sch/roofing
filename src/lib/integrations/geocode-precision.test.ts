import { describe, it, expect } from 'vitest';
import {
  classifyNominatimPrecision,
  shouldSeekBetterPrecision,
  preferMorePrecise,
} from './geocode-precision';

describe('classifyNominatimPrecision', () => {
  // Both shapes captured from live Nominatim responses for addresses on the
  // same street — one it knew the house for, one it only knew the road for.
  // A real OSM building footprint is as good as a parcel point — measured
  // within ~1.5m of Geocodio's rooftop for 3402 E Coronado Rd.
  it('treats an OSM building footprint as rooftop', () => {
    expect(classifyNominatimPrecision({ category: 'building', type: 'yes' })).toBe('rooftop');
    expect(classifyNominatimPrecision({ addresstype: 'building' })).toBe('rooftop');
  });

  /**
   * An OSM address NODE ranks below a parcel match. Nominatim labels these
   * `place`/`house`, but many are TIGER imports sitting on the street
   * centreline: 3401 E Coronado Rd came back as type=house yet was ~15m from
   * the actual roof, which is exactly what "not on the house" looks like.
   */
  it('treats an OSM address node as house, below rooftop', () => {
    expect(
      classifyNominatimPrecision({ category: 'place', type: 'house', addresstype: 'place' })
    ).toBe('house');
  });

  // The stacking culprit: eight distinct houses all received this.
  it('recognises a road centroid as street-level', () => {
    expect(
      classifyNominatimPrecision({ category: 'highway', type: 'residential', addresstype: 'road' })
    ).toBe('street');
  });

  it('treats a city or postcode hit as area-level', () => {
    expect(classifyNominatimPrecision({ category: 'place', type: 'city', addresstype: 'city' })).toBe('area');
    expect(classifyNominatimPrecision({ category: 'boundary', type: 'postal_code' })).toBe('area');
  });

  // An unrecognised shape must never be mistaken for a precise answer — the
  // whole point of this is deciding whether the pin can be trusted.
  it('defaults to area for anything unrecognised or missing', () => {
    expect(classifyNominatimPrecision(null)).toBe('area');
    expect(classifyNominatimPrecision(undefined)).toBe('area');
    expect(classifyNominatimPrecision({})).toBe('area');
    expect(classifyNominatimPrecision({ category: 42, type: null })).toBe('area');
  });
});

describe('shouldSeekBetterPrecision', () => {
  it('does not re-query a rooftop hit', () => {
    expect(shouldSeekBetterPrecision('rooftop')).toBe(false);
  });

  // An address node is worth a second opinion; a parcel source may put it on
  // the actual building rather than the street line.
  it('seeks a better answer for house, street and area hits', () => {
    expect(shouldSeekBetterPrecision('house')).toBe(true);
    expect(shouldSeekBetterPrecision('street')).toBe(true);
    expect(shouldSeekBetterPrecision('area')).toBe(true);
  });
});

describe('preferMorePrecise', () => {
  const roof = { value: 'R', precision: 'rooftop' as const };
  const house = { value: 'H', precision: 'house' as const };
  const street = { value: 'S', precision: 'street' as const };
  const area = { value: 'A', precision: 'area' as const };

  // The case this exists for.
  it('upgrades a street-level primary to a house-level fallback', () => {
    expect(preferMorePrecise(street, house)).toBe(house);
  });

  // A fallback that is no more precise is just a different guess; swapping
  // would move pins for no reason.
  it('keeps the primary when the fallback is no better', () => {
    expect(preferMorePrecise(house, street)).toBe(house);
    expect(preferMorePrecise(street, street)).toBe(street);
    expect(preferMorePrecise(street, area)).toBe(street);
  });

  it('uses whichever exists when one is missing', () => {
    expect(preferMorePrecise(null, house)).toBe(house);
    expect(preferMorePrecise(street, null)).toBe(street);
    expect(preferMorePrecise(null, null)).toBeNull();
  });

  it('upgrades area to street', () => {
    expect(preferMorePrecise(area, street)).toBe(street);
  });

  // The Coronado case: a parcel rooftop beats an OSM address node.
  it('upgrades an address node to a parcel rooftop', () => {
    expect(preferMorePrecise(house, roof)).toBe(roof);
    expect(preferMorePrecise(roof, house)).toBe(roof);
  });
});
