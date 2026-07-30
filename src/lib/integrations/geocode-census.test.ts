import { describe, it, expect } from 'vitest';
import { buildCensusAddress, parseCensusResponse } from './geocode-census';

describe('buildCensusAddress', () => {
  it('joins every part it is given', () => {
    expect(
      buildCensusAddress({ street: '24018 N Brittlebush Way', city: 'Florence', state: 'AZ', zip: '85132' })
    ).toBe('24018 N Brittlebush Way, Florence, AZ, 85132');
  });

  // The common shape for these imports: a street and a ZIP, no city.
  it('drops absent parts rather than leaving empty gaps', () => {
    expect(buildCensusAddress({ street: '24018 N Brittlebush Way', state: 'AZ', zip: '85132' }))
      .toBe('24018 N Brittlebush Way, AZ, 85132');
    expect(buildCensusAddress({ street: '5726 E Good Pasture Ln', zip: '85132-7963' }))
      .toBe('5726 E Good Pasture Ln, 85132-7963');
  });

  it('treats blank parts as absent', () => {
    expect(buildCensusAddress({ street: '12 Oak St', city: '  ', state: '', zip: null }))
      .toBe('12 Oak St');
  });

  it('trims the street and requires one', () => {
    expect(buildCensusAddress({ street: '  12 Oak St  ' })).toBe('12 Oak St');
    expect(buildCensusAddress({ street: '' })).toBeNull();
    expect(buildCensusAddress({ street: '   ' })).toBeNull();
  });
});

describe('parseCensusResponse', () => {
  const ok = {
    result: {
      addressMatches: [
        {
          coordinates: { x: -111.502417626337, y: 33.097273901955 },
          matchedAddress: '24018 N BRITTLE BUSH WAY, FLORENCE, AZ, 85132',
        },
      ],
    },
  };

  // Census returns x/y, not lat/lng. Swapping them puts every Arizona pin in
  // the Indian Ocean, and nothing downstream would notice.
  it('reads y as latitude and x as longitude', () => {
    const out = parseCensusResponse(ok);
    expect(out).toEqual({
      latitude: 33.097273901955,
      longitude: -111.502417626337,
      matchedAddress: '24018 N BRITTLE BUSH WAY, FLORENCE, AZ, 85132',
    });
  });

  it('returns null when nothing matched', () => {
    expect(parseCensusResponse({ result: { addressMatches: [] } })).toBeNull();
  });

  it('survives a malformed or unexpected payload', () => {
    for (const bad of [null, undefined, {}, { result: {} }, { result: { addressMatches: 'nope' } }, 'text']) {
      expect(parseCensusResponse(bad)).toBeNull();
    }
  });

  it('rejects a match with unusable coordinates', () => {
    expect(parseCensusResponse({ result: { addressMatches: [{ coordinates: {} }] } })).toBeNull();
    expect(
      parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: 'a', y: 'b' } }] } })
    ).toBeNull();
  });

  // Null Island: a 0,0 pair is "no match" wearing a match's clothes, and it
  // would render as a pin off the coast of Africa.
  it('rejects 0,0', () => {
    expect(parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: 0, y: 0 } }] } })).toBeNull();
  });

  it('copes with a missing matchedAddress', () => {
    const out = parseCensusResponse({ result: { addressMatches: [{ coordinates: { x: -111.5, y: 33.1 } }] } });
    expect(out).toMatchObject({ latitude: 33.1, longitude: -111.5, matchedAddress: '' });
  });

  it('takes the first match when several are returned', () => {
    const out = parseCensusResponse({
      result: {
        addressMatches: [
          { coordinates: { x: -111.5, y: 33.1 }, matchedAddress: 'first' },
          { coordinates: { x: -99, y: 44 }, matchedAddress: 'second' },
        ],
      },
    });
    expect(out?.matchedAddress).toBe('first');
  });
});
