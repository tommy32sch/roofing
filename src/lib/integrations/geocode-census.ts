/**
 * US Census Geocoder — the fallback when OpenStreetMap has no address point.
 *
 * Nominatim is the primary because it is one request for any country and needs
 * no address parsing. But OSM is volunteer-mapped, and whole streets can be
 * missing: 27 leads in ZIP 85132 sat unmapped because OSM has no house numbers
 * on N Brittlebush Way or E Good Pasture Ln. The Census geocoder resolved every
 * one of them.
 *
 * It is official TIGER address data, free, keyless and US-only, which matches
 * this app exactly. Measured against Nominatim on an address both could place,
 * the two agreed to four decimal places, so mixing them does not shift pins.
 *
 * It is also far more forgiving than Nominatim, which is the point. Nominatim
 * ANDs its structured fields, so a wrong city silently returns nothing; Census
 * takes one string and resolves "24018 N Brittlebush Way, Phoenix, AZ, 85132"
 * to the correct Florence coordinate despite the wrong city. Verified.
 */

export interface CensusGeocodeResult {
  latitude: number;
  longitude: number;
  /** What Census believed it matched — useful when a pin looks wrong. */
  matchedAddress: string;
}

const ENDPOINT = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
// "Current" tracks the newest TIGER vintage, which is what makes recently built
// streets resolvable at all.
const BENCHMARK = 'Public_AR_Current';

/**
 * Compose the single-line address Census expects.
 *
 * Every component is optional except the street; unlike Nominatim, extra parts
 * are hints rather than constraints, so including whatever is known can only
 * help. Blank parts are dropped so the string never contains ", ,".
 */
export function buildCensusAddress(query: {
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const street = query.street?.trim();
  if (!street) return null;
  return [street, query.city?.trim(), query.state?.trim(), query.zip?.trim()]
    .filter((part): part is string => !!part)
    .join(', ');
}

/**
 * Pull coordinates out of a Census response.
 *
 * Split from the fetch so the response shape — coordinates arrive as x/y, not
 * lat/lng, and swapping them puts every pin in the Indian Ocean — is testable
 * without a network call.
 */
export function parseCensusResponse(payload: unknown): CensusGeocodeResult | null {
  const matches = (payload as { result?: { addressMatches?: unknown[] } })?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;

  const first = matches[0] as {
    coordinates?: { x?: unknown; y?: unknown };
    matchedAddress?: unknown;
  };
  // x is longitude, y is latitude.
  const longitude = Number(first?.coordinates?.x);
  const latitude = Number(first?.coordinates?.y);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  // A zero pair means "no match" dressed up as a match.
  if (latitude === 0 && longitude === 0) return null;

  return {
    latitude,
    longitude,
    matchedAddress:
      typeof first.matchedAddress === 'string' ? first.matchedAddress : '',
  };
}

export async function geocodeAddressCensus(query: {
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): Promise<CensusGeocodeResult | null> {
  const address = buildCensusAddress(query);
  if (!address) return null;

  const params = new URLSearchParams({
    address,
    benchmark: BENCHMARK,
    format: 'json',
  });

  try {
    const response = await fetch(`${ENDPOINT}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return parseCensusResponse(await response.json());
  } catch {
    // A fallback that throws would take down the primary path with it.
    return null;
  }
}
