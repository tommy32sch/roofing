import { describe, it, expect } from 'vitest';
import { estimateRoofValue, DEFAULT_PRICE_PER_SQUARE } from './roof-value';

describe('estimateRoofValue', () => {
  it('matches the documented worked example (2000 sqft / 1 story / asphalt @ default)', () => {
    const r = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'asphalt_shingle' });
    expect(r).not.toBeNull();
    expect(r!.value).toBe(11400);
    expect(r!.squares).toBe(28.6);
    expect(r!.pricePerSquare).toBe(DEFAULT_PRICE_PER_SQUARE);
  });

  it('returns null when there is no usable square footage', () => {
    expect(estimateRoofValue({ sqft: null, stories: 1, roof_type: 'asphalt_shingle' })).toBeNull();
    expect(estimateRoofValue({ sqft: 0, stories: 1, roof_type: 'asphalt_shingle' })).toBeNull();
    expect(estimateRoofValue({ sqft: -500, stories: 1, roof_type: 'metal' })).toBeNull();
  });

  it('treats missing/zero stories as a single story', () => {
    const a = estimateRoofValue({ sqft: 2000, stories: null, roof_type: 'asphalt_shingle' });
    const b = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'asphalt_shingle' });
    expect(a!.value).toBe(b!.value);
  });

  it('halves the footprint (and value) for a 2-story home', () => {
    const one = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'asphalt_shingle' })!;
    const two = estimateRoofValue({ sqft: 2000, stories: 2, roof_type: 'asphalt_shingle' })!;
    expect(two.squares).toBeCloseTo(one.squares / 2, 5);
  });

  it('scales linearly with the configured base price per square', () => {
    const base = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'asphalt_shingle' })!;
    const pricey = estimateRoofValue(
      { sqft: 2000, stories: 1, roof_type: 'asphalt_shingle' },
      { basePricePerSquare: 600 }
    )!;
    expect(pricey.pricePerSquare).toBe(600);
    expect(pricey.squares).toBe(base.squares); // geometry unchanged, only price scales
    expect(pricey.value).toBe(17200);
  });

  it('applies material multipliers (metal costs more than asphalt)', () => {
    const asphalt = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'asphalt_shingle' })!;
    const metal = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'metal' })!;
    expect(metal.pricePerSquare).toBeGreaterThan(asphalt.pricePerSquare);
    expect(metal.value).toBeGreaterThan(asphalt.value);
  });

  it('falls back to the unknown multiplier for an unrecognized roof type', () => {
    const unknown = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'straw' })!;
    const asphalt = estimateRoofValue({ sqft: 2000, stories: 1, roof_type: 'unknown' })!;
    expect(unknown.value).toBe(asphalt.value);
  });

  it('rounds the value to the nearest $100', () => {
    const r = estimateRoofValue({ sqft: 1873, stories: 1, roof_type: 'asphalt_shingle' })!;
    expect(r.value % 100).toBe(0);
  });
});
