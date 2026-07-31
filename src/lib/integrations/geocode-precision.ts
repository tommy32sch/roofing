/**
 * How precise a geocoder's answer actually is.
 *
 * Nominatim always returns *something* for a known street, but "something" is
 * often the street's midpoint rather than the house. That is why leads stacked
 * on identical coordinates: eight distinct houses on E Flowing Spg all received
 * the road's centroid, and nothing downstream could tell that apart from a real
 * address match.
 *
 * Nominatim labels this itself and we were discarding it. A house answer comes
 * back as category `place`/`building` with type `house`; a street answer comes
 * back as category `highway`, type `residential`, addresstype `road`. Verified
 * against both cases on the same street.
 *
 * Knowing the difference is what lets the caller say "this is only street-level,
 * ask someone else" instead of accepting a pin that looks authoritative.
 */

/**
 * Ranked from most to least specific.
 *
 * 'rooftop' is deliberately ABOVE 'house'. Nominatim labels an OSM address node
 * `category=place, type=house`, but many of those are TIGER imports sitting on
 * the street centreline — measured ~15m from the actual roof on E Coronado Rd,
 * which is what "not on the house" looks like on a map. A county parcel point is
 * the building itself. Where OSM has a real footprint (`category=building`) it
 * agrees with the parcel to within about 1.5m, so only the address-node case is
 * downgraded.
 */
export type GeocodePrecision = 'rooftop' | 'house' | 'street' | 'area';

interface NominatimShape {
  category?: unknown;
  type?: unknown;
  addresstype?: unknown;
}

/**
 * Classify a Nominatim hit.
 *
 * Defaults to 'area' rather than 'house' — an unrecognised shape must not be
 * mistaken for a precise answer, because the whole point is deciding whether to
 * trust it.
 */
export function classifyNominatimPrecision(result: NominatimShape | null | undefined): GeocodePrecision {
  if (!result) return 'area';
  const category = typeof result.category === 'string' ? result.category : '';
  const type = typeof result.type === 'string' ? result.type : '';
  const addresstype = typeof result.addresstype === 'string' ? result.addresstype : '';

  // A real building footprint in OSM is as good as a parcel point.
  if (category === 'building' || addresstype === 'building') return 'rooftop';
  // An address NODE. Usually right, but frequently a TIGER import aligned to the
  // street rather than the roof, so it ranks below a parcel match.
  if (type === 'house' || (category === 'place' && addresstype === 'place')) return 'house';

  // The road itself — a midpoint, not an address.
  if (category === 'highway' || addresstype === 'road') return 'street';

  return 'area';
}

/**
 * Whether a second opinion is worth the extra request.
 *
 * Only street- and area-level answers are worth re-asking about. Re-querying a
 * house-level hit would double every request for no gain.
 */
export function shouldSeekBetterPrecision(precision: GeocodePrecision): boolean {
  return precision !== 'rooftop';
}

/**
 * Choose between the primary answer and a fallback's.
 *
 * A house-level fallback beats a street-level primary, which is the case this
 * exists for. Otherwise the primary stands — a fallback that is no more precise
 * is just a different guess, and swapping to it would move pins for no reason.
 */
export function preferMorePrecise<T>(
  primary: { value: T; precision: GeocodePrecision } | null,
  fallback: { value: T; precision: GeocodePrecision } | null
): { value: T; precision: GeocodePrecision } | null {
  if (!primary) return fallback;
  if (!fallback) return primary;
  const rank: Record<GeocodePrecision, number> = { rooftop: 3, house: 2, street: 1, area: 0 };
  return rank[fallback.precision] > rank[primary.precision] ? fallback : primary;
}
