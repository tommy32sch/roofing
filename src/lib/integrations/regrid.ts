import { db } from '@/lib/supabase/server';

const REGRID_API_BASE = 'https://app.regrid.com/api/v2/parcels';

export interface RegridParcelData {
  owner: string | null;
  owner_type: string | null;
  year_built: number | null;
  sqft: number | null;
  lot_size: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  stories: number | null;
  assessed_value: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  apn: string | null;
  latitude: number | null;
  longitude: number | null;
  roof_type: string | null;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

/**
 * Get the Regrid API key and auto-enrich setting from app_settings.
 */
async function getRegridConfig(): Promise<{ apiKey: string | null; autoEnrich: boolean }> {
  const supabase = db();
  const { data } = await supabase
    .from('app_settings')
    .select('regrid_api_key, auto_enrich_enabled')
    .eq('id', 'default')
    .single();

  return {
    apiKey: data?.regrid_api_key || null,
    autoEnrich: data?.auto_enrich_enabled ?? false,
  };
}

/**
 * Look up a parcel by address using the Regrid API.
 */
export async function lookupParcel(address: string, token: string): Promise<RegridParcelData | null> {
  const url = `${REGRID_API_BASE}/address?query=${encodeURIComponent(address)}&token=${encodeURIComponent(token)}`;

  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    console.error(`Regrid API error: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = await response.json();
  const feature = data?.features?.[0];
  if (!feature) return null;

  const props = feature.properties?.fields || feature.properties || {};
  const geometry = feature.geometry;

  // Extract centroid from geometry
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (geometry?.type === 'Point') {
    longitude = geometry.coordinates?.[0] ?? null;
    latitude = geometry.coordinates?.[1] ?? null;
  } else if (geometry?.coordinates) {
    // For polygons, use the centroid from properties or first coordinate
    latitude = props.lat ? parseFloat(props.lat) : null;
    longitude = props.lon ? parseFloat(props.lon) : null;
  }

  return {
    owner: props.owner || null,
    owner_type: props.owntype || null,
    year_built: props.yearbuilt ? parseInt(props.yearbuilt, 10) : null,
    sqft: props.sqft ? parseInt(props.sqft, 10) : null,
    lot_size: props.ll_gisacre ? parseFloat(props.ll_gisacre) : null,
    bedrooms: props.bedrooms ? parseInt(props.bedrooms, 10) : null,
    bathrooms: props.bathrooms ? parseFloat(props.bathrooms) : null,
    stories: props.stories ? parseInt(props.stories, 10) : null,
    assessed_value: props.parval ? parseInt(props.parval, 10) : null,
    last_sale_date: props.lastsal_date || null,
    last_sale_price: props.lastsal_price ? parseInt(props.lastsal_price, 10) : null,
    apn: props.parcelnumb || null,
    latitude,
    longitude,
    roof_type: props.roof_cover || props.roof_type || null,
    mailing_street: props.mail_address || null,
    mailing_city: props.mail_city || null,
    mailing_state: props.mail_state2 || null,
    mailing_zip: props.mail_zip || null,
  };
}

/**
 * Build a full address string from lead components.
 */
function buildAddress(street: string | null, city: string | null, state: string | null, zip: string | null): string | null {
  const parts = [street, city, state, zip].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : null;
}

/**
 * Enrich a lead with Regrid data. Only fills in fields that are currently null.
 * Returns the enrichment update object, or null if enrichment is not possible/needed.
 */
export async function enrichLead(leadId: string, lead: {
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}): Promise<boolean> {
  const { apiKey, autoEnrich } = await getRegridConfig();
  if (!apiKey || !autoEnrich) return false;

  const address = buildAddress(lead.address_street, lead.address_city, lead.address_state, lead.address_zip);
  if (!address) return false;

  const parcel = await lookupParcel(address, apiKey);
  if (!parcel) return false;

  // Build update object — only fill in fields that add value
  const updates: Record<string, unknown> = {};

  if (parcel.year_built) updates.year_built = parcel.year_built;
  if (parcel.sqft) updates.sqft = parcel.sqft;
  if (parcel.lot_size) updates.lot_size = parcel.lot_size;
  if (parcel.bedrooms) updates.bedrooms = parcel.bedrooms;
  if (parcel.bathrooms) updates.bathrooms = parcel.bathrooms;
  if (parcel.stories) updates.stories = parcel.stories;
  if (parcel.assessed_value) updates.assessed_value = parcel.assessed_value;
  if (parcel.last_sale_date) updates.last_sale_date = parcel.last_sale_date;
  if (parcel.last_sale_price) updates.last_sale_price = parcel.last_sale_price;
  if (parcel.owner_type) updates.owner_type = parcel.owner_type;
  if (parcel.apn) updates.apn = parcel.apn;
  if (parcel.latitude) updates.latitude = parcel.latitude;
  if (parcel.longitude) updates.longitude = parcel.longitude;
  if (parcel.roof_type) updates.roof_type = parcel.roof_type;
  if (parcel.mailing_street) updates.mailing_street = parcel.mailing_street;
  if (parcel.mailing_city) updates.mailing_city = parcel.mailing_city;
  if (parcel.mailing_state) updates.mailing_state = parcel.mailing_state;
  if (parcel.mailing_zip) updates.mailing_zip = parcel.mailing_zip;

  if (Object.keys(updates).length === 0) return false;

  updates.enriched_at = new Date().toISOString();
  updates.enrichment_source = 'regrid';

  const supabase = db();
  const { error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', leadId);

  if (error) {
    console.error(`Failed to enrich lead ${leadId}:`, error.message);
    return false;
  }

  return true;
}

/**
 * Test the Regrid API connection with a sample address.
 */
export async function testRegridConnection(apiKey: string): Promise<{ success: boolean; message: string }> {
  try {
    const result = await lookupParcel('1600 Pennsylvania Ave NW, Washington, DC 20500', apiKey);
    if (result) {
      return { success: true, message: 'Connection successful. Regrid API is working.' };
    }
    return { success: false, message: 'API responded but returned no data for the test address.' };
  } catch (err) {
    return { success: false, message: `Connection failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}
