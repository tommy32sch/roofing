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
  }
): Promise<boolean> {
  if (!lead.address_street?.trim()) return false;

  const result = await geocodeAddress(
    lead.address_street.trim(),
    lead.address_city,
    lead.address_state,
    lead.address_zip
  );
  if (!result) return false;

  const supabase = db();
  const { error } = await supabase
    .from('leads')
    .update({ latitude: result.latitude, longitude: result.longitude })
    .eq('id', leadId)
    .is('latitude', null);

  return !error;
}
