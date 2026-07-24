import { db } from '@/lib/supabase/server';

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

    return { latitude, longitude };
  } catch {
    return null;
  }
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

  // Fall back to the default region when the lead lacks its own city/state, so
  // a bare street resolves within the right area — its own market's region
  // first, so a Minnesota street doesn't land in Arizona.
  const defaults = await getGeoDefaults(lead.market_id);
  const city = lead.address_city?.trim() || defaults.city;
  const state = lead.address_state?.trim() || defaults.state;

  // A street alone (no city/zip, no default region) is not geocodable —
  // Nominatim would match a same-named street elsewhere in the US.
  if (!city && !lead.address_zip?.trim()) return false;

  const result = await geocodeAddress(lead.address_street.trim(), city, state, lead.address_zip);
  if (!result) return false;

  const supabase = db();
  const { error } = await supabase
    .from('leads')
    .update({ latitude: result.latitude, longitude: result.longitude })
    .eq('id', leadId)
    .is('latitude', null);

  return !error;
}
