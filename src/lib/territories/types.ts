/** Coordinates use the same [latitude, longitude] order as Leaflet. */
export type TerritoryPoint = [number, number];
export type TerritoryBoundary = TerritoryPoint[];

export interface TerritoryBounds {
  min_lat: number;
  max_lat: number;
  min_lng: number;
  max_lng: number;
}
