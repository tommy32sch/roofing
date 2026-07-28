/**
 * Fixed territory palette shared by the API and map UI.
 *
 * Keeping this finite prevents arbitrary style values from being persisted and
 * guarantees every stored color is one the UI knows how to render.
 */
export const TERRITORY_COLORS = [
  '#2563eb',
  '#4f46e5',
  '#7c3aed',
  '#9333ea',
  '#0891b2',
  '#0d9488',
  '#059669',
  '#475569',
] as const;

export const DEFAULT_TERRITORY_COLOR = TERRITORY_COLORS[0];
export const TERRITORY_MAX_VERTICES = 500;
export const TERRITORY_NAME_MAX_LENGTH = 80;

export type TerritoryColor = (typeof TERRITORY_COLORS)[number];
