/**
 * Estimated roof replacement value.
 *
 * Roofing is priced per "square" = 100 sq ft of *roof surface* (not living area).
 * This module is a pure calculation with no DB/server imports, so it is safe to
 * import from client components as well as API routes.
 *
 * The estimate is intentionally a rough, pre-inspection figure used to prioritize
 * leads and (in a later roadmap track) assign by total dollar volume. It is NOT a
 * quote. The actual contract amount lives in `deal_value`, entered by a closer.
 */

import type { RoofType } from '@/types';

/** Default base price per square (asphalt shingle) when none is configured. */
export const DEFAULT_PRICE_PER_SQUARE = 400;

/**
 * Gross-up from building footprint to roof surface area. Accounts for roof slope
 * plus eaves/overhangs and typical hip/gable complexity. ~1.3 is a common
 * rule-of-thumb for a medium-pitch residential roof.
 */
const PITCH_MULTIPLIER = 1.3;

/** Extra material to cover cuts and waste (~10%). */
const WASTE_FACTOR = 0.1;

/**
 * Material cost relative to asphalt shingle (= 1.0). Rough installed-cost ratios;
 * the admin tunes the absolute level via the asphalt base price in Settings.
 */
const MATERIAL_MULTIPLIER: Record<RoofType, number> = {
  asphalt_shingle: 1.0,
  flat: 1.5,
  wood_shake: 2.0,
  metal: 2.75,
  tile: 3.1,
  slate: 4.5,
  other: 1.0,
  unknown: 1.0,
};

export interface RoofValueInputs {
  sqft: number | null;
  stories: number | null;
  roof_type: RoofType | string | null;
}

export interface RoofValueConfig {
  /** Admin-configured base price per square for asphalt; null/undefined → default. */
  basePricePerSquare?: number | null;
}

export interface RoofValueEstimate {
  /** Estimated replacement value in dollars, rounded to the nearest $100. */
  value: number;
  /** Roofing squares (100 sq ft each), including waste, rounded to 1 decimal. */
  squares: number;
  /** Effective price per square after the material multiplier. */
  pricePerSquare: number;
}

/**
 * Estimate the roof replacement value from property data.
 * Returns `null` when there isn't enough data (no positive sqft) to estimate.
 */
export function estimateRoofValue(
  inputs: RoofValueInputs,
  config: RoofValueConfig = {}
): RoofValueEstimate | null {
  const sqft = inputs.sqft;
  if (sqft == null || !(sqft > 0)) return null;

  const stories = inputs.stories && inputs.stories > 0 ? inputs.stories : 1;
  const footprint = sqft / stories;

  const roofArea = footprint * PITCH_MULTIPLIER;
  const squares = (roofArea / 100) * (1 + WASTE_FACTOR);

  const base =
    config.basePricePerSquare && config.basePricePerSquare > 0
      ? config.basePricePerSquare
      : DEFAULT_PRICE_PER_SQUARE;

  const materialKey = (inputs.roof_type as RoofType) || 'unknown';
  const multiplier = MATERIAL_MULTIPLIER[materialKey] ?? MATERIAL_MULTIPLIER.unknown;
  const pricePerSquare = base * multiplier;

  const rawValue = squares * pricePerSquare;
  const value = Math.round(rawValue / 100) * 100;

  return {
    value,
    squares: Math.round(squares * 10) / 10,
    pricePerSquare: Math.round(pricePerSquare * 100) / 100,
  };
}
