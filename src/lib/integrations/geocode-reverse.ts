/**
 * Turning a map point into an address.
 *
 * The opposite direction from the rest of the geocoding code, which takes an
 * address and finds a point. Here the point is the certain part — a rep is
 * standing at the door — and the address is the guess, which is why the result
 * is always shown for confirmation rather than saved silently.
 *
 * Two providers, same order of preference as forward geocoding: Geocodio when a
 * key is configured, because it is parcel-backed and returns the actual street
 * number; Nominatim otherwise, which is free and keyless but often answers with
 * the nearest road rather than the house.
 */

export interface ReverseAddress {
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  /** Which provider answered, for the "we guessed this" hint in the UI. */
  source: 'geocodio' | 'nominatim';
  /** True when the provider gave a house number, not just a street. */
  precise: boolean;
}

/** Pull an address out of a Geocodio reverse response. */
export function parseGeocodioReverse(payload: unknown): ReverseAddress | null {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const top = results[0] as {
    address_components?: Record<string, unknown>;
    accuracy_type?: unknown;
  };
  const c = top?.address_components;
  if (!c || typeof c !== 'object') return null;

  const number = typeof c.number === 'string' ? c.number : '';
  const predir = typeof c.predirectional === 'string' ? c.predirectional : '';
  const street = typeof c.street === 'string' ? c.street : '';
  const suffix = typeof c.suffix === 'string' ? c.suffix : '';
  const line = [number, predir, street, suffix].filter(Boolean).join(' ').trim();

  if (!line) return null;
  return {
    address_street: line,
    address_city: typeof c.city === 'string' ? c.city : null,
    address_state: typeof c.state === 'string' ? c.state : null,
    address_zip: typeof c.zip === 'string' ? c.zip : null,
    source: 'geocodio',
    precise: !!number,
  };
}

/** Pull an address out of a Nominatim reverse response. */
export function parseNominatimReverse(payload: unknown): ReverseAddress | null {
  const a = (payload as { address?: Record<string, unknown> })?.address;
  if (!a || typeof a !== 'object') return null;

  const number = typeof a.house_number === 'string' ? a.house_number : '';
  const road = typeof a.road === 'string' ? a.road : '';
  if (!road) return null;

  const city =
    (typeof a.city === 'string' && a.city) ||
    (typeof a.town === 'string' && a.town) ||
    (typeof a.village === 'string' && a.village) ||
    (typeof a.hamlet === 'string' && a.hamlet) ||
    null;

  return {
    address_street: [number, road].filter(Boolean).join(' ').trim(),
    address_city: city,
    // Nominatim returns full state names; the app stores codes elsewhere, but a
    // rep can correct it and a wrong-format state is better than a blank one.
    address_state: typeof a.state === 'string' ? a.state : null,
    address_zip: typeof a.postcode === 'string' ? a.postcode : null,
    source: 'nominatim',
    precise: !!number,
  };
}

/**
 * Resolve a map point to an address, best provider first.
 *
 * Never throws: the caller is a rep standing at a door, and a provider being
 * down should leave them typing the address by hand rather than blocking the
 * lead entirely.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  apiKey: string | null
): Promise<ReverseAddress | null> {
  if (apiKey) {
    try {
      const res = await fetch(
        `https://api.geocod.io/v1.7/reverse?q=${latitude},${longitude}&api_key=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const parsed = parseGeocodioReverse(await res.json());
        // Only settle for the parcel provider when it actually knew the house.
        // A street-only answer is no better than Nominatim's, so it is worth
        // asking the free one before showing the rep a guess.
        if (parsed?.precise) return parsed;
        if (parsed) {
          const fallback = await reverseNominatim(latitude, longitude);
          return fallback?.precise ? fallback : parsed;
        }
      }
    } catch {
      // Fall through to the keyless provider.
    }
  }
  return reverseNominatim(latitude, longitude);
}

async function reverseNominatim(latitude: number, longitude: number): Promise<ReverseAddress | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&addressdetails=1`,
      {
        headers: { 'User-Agent': 'roof-leads/1.0 (lead canvassing app)' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;
    return parseNominatimReverse(await res.json());
  } catch {
    return null;
  }
}
