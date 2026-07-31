import { db } from '@/lib/supabase/server';
import { buildGeocodeQuery } from '@/lib/leads/geocode-query';
import { geocodeAddressCensus } from './geocode-census';
import { classifyNominatimPrecision, shouldSeekBetterPrecision, preferMorePrecise, type GeocodePrecision } from './geocode-precision';
import { geocodeAddressCass } from './geocode-cass';

/**
 * Free geocoding via OSM Nominatim.
 *
 * Usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * max 1 request/second and a descriptive User-Agent is required. Single-lead
 * geocoding on create is well within this; bulk work must go through
 * scripts/geocode-leads.ts, which throttles itself.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'RoofLeadsCRM/1.0 (lead address mapping)';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /**
   * How specific the answer is. 'street' means the geocoder found the road but
   * not the house, which is why distinct addresses used to land on identical
   * coordinates.
   */
  precision?: GeocodePrecision;
}

export async function geocodeAddress(
  street: string,
  city: string | null,
  state: string | null,
  zip: string | null
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    street,
    country: 'us',
    format: 'jsonv2',
    limit: '1',
  });
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (zip) params.set('postalcode', zip);

  try {
    const response = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;

    const results = await response.json();
    const first = results?.[0];
    if (!first?.lat || !first?.lon) return null;

    const latitude = parseFloat(first.lat);
    const longitude = parseFloat(first.lon);
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;

    return { latitude, longitude, precision: classifyNominatimPrecision(first) };
  } catch {
    return null;
  }
}

/**
 * Nominatim first, then the US Census geocoder.
 *
 * OSM is volunteer-mapped and whole streets can be missing — 27 leads in one
 * ZIP sat unmapped because it had no house numbers on two streets, all of which
 * Census resolved. Census is free, keyless and US-only, and agreed with
 * Nominatim to four decimal places on an address both could place, so mixing
 * the two does not shift existing pins.
 *
 * Only attempted when there is a street. The market-centre callers pass an
 * empty street to geocode a city, which Census cannot do and Nominatim can.
 */
/**
 * The commercial geocoder's key, or null when none is configured.
 *
 * Read from settings rather than the environment so it can be rotated without a
 * redeploy, matching how the Regrid key works. A missing key is the normal case
 * and must stay silent — the tier is optional.
 */
async function getCassKey(): Promise<string | null> {
  try {
    const { data } = await db()
      .from('app_settings')
      .select('geocode_api_key')
      .eq('id', 'default')
      .single();
    const key = (data as { geocode_api_key?: string | null } | null)?.geocode_api_key;
    return key?.trim() || null;
  } catch {
    return null;
  }
}

export async function geocodeAddressWithFallback(query: {
  street: string;
  city: string | null;
  state: string | null;
  zip: string | null;
}): Promise<GeocodeResult | null> {
  const hasStreet = !!query.street?.trim();

  // Parcel data first when it is configured. It is the most accurate source —
  // the building rather than an address node on the street line — and it has no
  // 1-request-per-second courtesy limit, so it is also by far the fastest. The
  // free tiers remain the fallback, which keeps the app fully functional with no
  // key and lets it degrade rather than fail if the provider is down.
  let best: { value: GeocodeResult; precision: GeocodePrecision } | null = null;
  if (hasStreet) {
    const key = await getCassKey();
    if (key) {
      const cass = await geocodeAddressCass(query, key);
      if (cass) {
        best = {
          value: { latitude: cass.latitude, longitude: cass.longitude, precision: cass.precision },
          precision: cass.precision,
        };
        if (cass.precision === 'rooftop') return best.value;
      }
    }
  }

  const primary = await geocodeAddress(query.street, query.city, query.state, query.zip);
  if (primary) {
    best = preferMorePrecise(best, { value: primary, precision: primary.precision ?? 'area' });
    if (best?.precision === 'rooftop') return best.value;
  }

  // Census: free, US-only, and holds addresses OSM lacks entirely.
  if (hasStreet && (!best || shouldSeekBetterPrecision(best.precision))) {
    const census = await geocodeAddressCensus(query);
    if (census) {
      best = preferMorePrecise(best, {
        value: { latitude: census.latitude, longitude: census.longitude, precision: 'house' },
        precision: 'house',
      });
    }
  }

  return best?.value ?? null;
}


/**
 * Read the default geocoding region (city/state) used to fill in leads that
 * lack their own city/state — the normal case, since street-only imports carry
 * no city at all.
 *
 * The lead's own MARKET wins when it has one. app_settings holds a single
 * app-wide region, which was fine with one office but silently resolves a
 * street-only Minnesota address into Arizona once a second office exists. The
 * app-wide value remains the fallback for leads with no market yet.
 */
export async function getGeoDefaults(
  marketId?: number | null
): Promise<{ city: string | null; state: string | null }> {
  const supabase = db();

  if (marketId != null) {
    const { data: market } = await supabase
      .from('markets')
      .select('default_geo_city, default_geo_state')
      .eq('id', marketId)
      .single();
    const city = market?.default_geo_city?.trim() || null;
    const state = market?.default_geo_state?.trim() || null;
    // Only take the market's region if it actually declares one; a market with
    // blank defaults should still fall through to the app-wide setting.
    if (city || state) return { city, state };
  }

  const { data } = await supabase
    .from('app_settings')
    .select('default_geo_city, default_geo_state')
    .eq('id', 'default')
    .single();
  return {
    city: data?.default_geo_city?.trim() || null,
    state: data?.default_geo_state?.trim() || null,
  };
}

/**
 * Geocode a lead and store coordinates — but only if it still has none, so a
 * concurrent Regrid enrichment (which also sets coords) is never overwritten.
 */
export async function geocodeLeadIfNeeded(
  leadId: string,
  lead: {
    address_street: string | null;
    address_city: string | null;
    address_state: string | null;
    address_zip: string | null;
    /** Office, when known — its region beats the app-wide default. */
    market_id?: number | null;
  }
): Promise<boolean> {
  if (!lead.address_street?.trim()) return false;

  // The default region rescues a bare street, but it must never be layered on
  // top of a ZIP the lead already has — Nominatim ANDs its fields, and a
  // guessed city that disagrees with the ZIP matches nothing. buildGeocodeQuery
  // owns that precedence, and returns null when the lead is not geocodable.
  const defaults = await getGeoDefaults(lead.market_id);
  const query = buildGeocodeQuery(lead, defaults);
  if (!query) return false;

  const result = await geocodeAddressWithFallback(query);
  if (!result) return false;

  const supabase = db();
  const { error } = await supabase
    .from('leads')
    .update({ latitude: result.latitude, longitude: result.longitude })
    .eq('id', leadId)
    .is('latitude', null);

  return !error;
}
