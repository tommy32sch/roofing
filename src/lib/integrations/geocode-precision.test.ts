import { describe, it, expect } from 'vitest';
import {
  classifyNominatimPrecision,
  shouldSeekBetterPrecision,
  preferMorePrecise,
} from './geocode-precision';

describe('classifyNominatimPrecision', () => {
  // Both shapes captured from live Nominatim responses for addresses on the
  // same street — one it knew the house for, one it only knew the road for.
  it('recognises a real address point as house-level', () => {
    expect(
      classifyNominatimPrecision({ category: 'place', type: 'house', addresstype: 'place' })
    ).toBe('house');
    expect(
      classifyNominatimPrecision({ category: 'building', type: 'house', addresstype: 'building' })
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
  it('does not re-query a house-level hit', () => {
    expect(shouldSeekBetterPrecision('house')).toBe(false);
  });

  it('seeks a better answer for street and area hits', () => {
    expect(shouldSeekBetterPrecision('street')).toBe(true);
    expect(shouldSeekBetterPrecision('area')).toBe(true);
  });
});

describe('preferMorePrecise', () => {
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
});
