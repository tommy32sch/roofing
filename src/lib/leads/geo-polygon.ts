/**
 * Backwards-compatible import for the map selection flow. Territory geometry
 * owns the implementation now so saved and ephemeral outlines cannot disagree
 * about which leads are inside.
 */
export { pointInPolygon } from '@/lib/territories/geometry';
