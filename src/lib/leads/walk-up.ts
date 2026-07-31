/**
 * Adding a house from the map.
 *
 * A rep knocking a door that is not in the list has nowhere to put it. This
 * covers dropping a pin where they are standing, turning that point into an
 * address, and creating the lead together with the knock that prompted it.
 *
 * Two things make it different from the normal create form:
 *
 * The name is optional. Nobody answered, or they would not give one, and the
 * house still needs to exist so the next rep does not knock it again. An
 * address-only lead is the common case, not the edge case.
 *
 * Coordinates come first and the address is derived. Everywhere else in the app
 * an address is geocoded into a point; here the point is known exactly — the rep
 * is standing there — and the address is the uncertain part, which is why it has
 * to be confirmable before saving.
 */

/** How close another lead has to be before it is probably the same house. */
export const NEARBY_RADIUS_M = 30;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than a flat approximation: the error of treating degrees as
 * a plane grows with latitude, and this is used to decide "is this the same
 * house", where tens of metres is the whole question.
 */
export function metersBetween(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface NearbyCandidate extends LatLng {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  address_street?: string | null;
  status?: string | null;
}

export interface NearbyHit extends NearbyCandidate {
  distanceM: number;
}

/**
 * Existing leads close enough to be the same house, nearest first.
 *
 * A warning rather than a block. Two units of a duplex genuinely are separate
 * doors a few metres apart, and refusing to create the second one would be
 * worse than asking.
 */
export function findNearbyLeads(
  candidates: NearbyCandidate[],
  point: LatLng,
  radiusM: number = NEARBY_RADIUS_M
): NearbyHit[] {
  return candidates
    .filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
    .map((c) => ({ ...c, distanceM: metersBetween(c, point) }))
    .filter((c) => c.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Coordinates that could plausibly be a place on Earth, and not the null island. */
export function isPlausibleCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // 0,0 is what a failed geocode returns, never where someone is knocking.
  if (lat === 0 && lng === 0) return false;
  return true;
}

export interface WalkUpInput {
  latitude: number;
  longitude: number;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  notes?: string | null;
}

export type WalkUpValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Is there enough here to be a lead?
 *
 * A street address OR a name. Coordinates alone produce a pin nobody can act
 * on — the next rep sees a dot with no door number and cannot tell which house
 * it was. One or the other has to identify it.
 */
export function validateWalkUp(input: WalkUpInput): WalkUpValidation {
  if (!isPlausibleCoordinate(input.latitude, input.longitude)) {
    return { ok: false, error: 'A valid map location is required' };
  }
  const hasAddress = !!input.address_street?.trim();
  const hasName = !!(input.first_name?.trim() || input.last_name?.trim());
  if (!hasAddress && !hasName) {
    return { ok: false, error: 'Add a street address or a name so the house can be identified' };
  }
  return { ok: true };
}

/**
 * What to call a lead with no name.
 *
 * The list and the map both need something to print. Falling back to the street
 * keeps an address-only lead readable instead of showing a blank row.
 */
export function walkUpDisplayName(input: {
  first_name?: string | null;
  last_name?: string | null;
  address_street?: string | null;
}): string {
  const name = [input.first_name, input.last_name].map((p) => p?.trim()).filter(Boolean).join(' ');
  if (name) return name;
  const street = input.address_street?.trim();
  if (street) return street;
  return 'Unknown occupant';
}

/**
 * Split a display name into the columns, since first_name and last_name are NOT
 * NULL on the table but a walk-up often has neither.
 *
 * The address goes in first_name rather than a literal like "Unknown" so the
 * leads list stays scannable — a column full of "Unknown" tells a rep nothing,
 * while a column of street addresses tells them exactly which door.
 */
export function walkUpNameColumns(input: WalkUpInput): { first_name: string; last_name: string } {
  const first = input.first_name?.trim();
  const last = input.last_name?.trim();
  if (first || last) {
    return { first_name: first || '', last_name: last || '' };
  }
  return { first_name: input.address_street?.trim() || 'Unknown occupant', last_name: '' };
}
