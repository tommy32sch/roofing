import type { GeocodePrecision } from './geocode-precision';

/**
 * Commercial address geocoding — the last tier, and the only one with data
 * independent of OpenStreetMap.
 *
 * OSM and Census TIGER both lack whole blocks of newer housing: 12 leads on two
 * Florence streets were unplaceable by either. Geocodio resolved all 12 as
 * rooftop matches sourced from Pinal County parcel records, on opposite sides of
 * the street exactly as their odd/even ZIP+4 codes predict.
 *
 * Written against a provider-agnostic shape so a different vendor — Smarty, say
 * — becomes a new `callProvider` rather than a rewrite.
 *
 * THE IMPORTANT PART IS THE PRECISION GATE. Geocodio reports `accuracy: 1` for
 * a street centroid and for a range interpolation, not only for a rooftop hit,
 * and returns `accuracy: 0.5` with type `place` — the CITY centre — for an
 * address that does not exist. Measured, all three. Trusting the accuracy score
 * would therefore reintroduce precisely the bug this tier exists to fix: many
 * distinct houses collapsing onto one plausible-looking point. Only
 * accuracy_type is load-bearing.
 */

export interface CassGeocodeResult {
  latitude: number;
  longitude: number;
  precision: GeocodePrecision;
  /** e.g. "rooftop" — kept for diagnosing a pin that looks wrong. */
  accuracyType: string;
  /** Which authority supplied it, e.g. "Pinal". */
  source: string;
}

/**
 * A rooftop or parcel point is the only thing that counts as house-level.
 *
 * `range_interpolation` is a guess along a street segment — better than a
 * centroid, but it is not the building, and treating it as one is how
 * neighbouring houses end up indistinguishable.
 */
const HOUSE_TYPES = new Set(['rooftop', 'point', 'parcel_centroid', 'building_centroid']);
const STREET_TYPES = new Set(['range_interpolation', 'street_center', 'intersection', 'nearest_street']);

export function classifyGeocodioPrecision(accuracyType: unknown): GeocodePrecision {
  const type = typeof accuracyType === 'string' ? accuracyType.toLowerCase() : '';
  // Parcel/building points are the most specific answer available.
  if (HOUSE_TYPES.has(type)) return 'rooftop';
  if (STREET_TYPES.has(type)) return 'street';
  // place / county / state / zip, and anything unrecognised. Defaulting to area
  // keeps an unknown future type from being mistaken for a rooftop hit.
  return 'area';
}

/**
 * Minimum score to consider a result at all.
 *
 * Separate from precision: a low score means the provider is unsure it matched
 * the right address, whatever granularity it returned.
 */
export const MIN_ACCURACY = 0.8;

export function parseGeocodioResponse(payload: unknown): CassGeocodeResult | null {
  const results = (payload as { results?: unknown[] })?.results;
  if (!Array.isArray(results) || results.length === 0) return null;

  const first = results[0] as {
    location?: { lat?: unknown; lng?: unknown };
    accuracy?: unknown;
    accuracy_type?: unknown;
    source?: unknown;
  };

  const latitude = Number(first?.location?.lat);
  const longitude = Number(first?.location?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;

  const accuracy = Number(first?.accuracy);
  if (Number.isFinite(accuracy) && accuracy < MIN_ACCURACY) return null;

  return {
    latitude,
    longitude,
    precision: classifyGeocodioPrecision(first?.accuracy_type),
    accuracyType: typeof first?.accuracy_type === 'string' ? first.accuracy_type : '',
    source: typeof first?.source === 'string' ? first.source : '',
  };
}

/** Compose the single-line query. Street is required; the rest are hints. */
export function buildCassQuery(query: {
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const street = query.street?.trim();
  if (!street) return null;
  const tail = [query.city?.trim(), query.state?.trim(), query.zip?.trim()].filter(Boolean);
  return tail.length ? `${street}, ${tail.join(', ')}` : street;
}

const ENDPOINT = 'https://api.geocod.io/v1.7/geocode';

export async function geocodeAddressCass(
  query: { street: string; city?: string | null; state?: string | null; zip?: string | null },
  apiKey: string
): Promise<CassGeocodeResult | null> {
  const q = buildCassQuery(query);
  if (!q || !apiKey?.trim()) return null;

  const params = new URLSearchParams({ q, api_key: apiKey.trim() });

  try {
    const response = await fetch(`${ENDPOINT}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return parseGeocodioResponse(await response.json());
  } catch {
    // Last tier in the chain — it must never take the earlier ones down.
    return null;
  }
}
