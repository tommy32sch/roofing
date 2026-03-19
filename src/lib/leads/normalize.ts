import { parsePhoneNumber } from 'libphonenumber-js';

// Map common field name variations to our standard field names
// Used by both CSV import and webhook receiver
export const FIELD_MAP: Record<string, string> = {
  // First name
  'first_name': 'first_name',
  'first name': 'first_name',
  'fname': 'first_name',
  'first': 'first_name',
  'owner first name': 'first_name',
  'owner_first_name': 'first_name',
  'homeowner_first': 'first_name',
  'homeowner first': 'first_name',
  'contact first name': 'first_name',
  'firstname': 'first_name',

  // Last name
  'last_name': 'last_name',
  'last name': 'last_name',
  'lname': 'last_name',
  'last': 'last_name',
  'owner last name': 'last_name',
  'owner_last_name': 'last_name',
  'homeowner_last': 'last_name',
  'homeowner last': 'last_name',
  'contact last name': 'last_name',
  'lastname': 'last_name',

  // Phone
  'phone': 'phone',
  'phone number': 'phone',
  'phone_number': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  'telephone': 'phone',
  'contact phone': 'phone',
  'phone1': 'phone',

  // Email
  'email': 'email',
  'email address': 'email',
  'email_address': 'email',
  'contact email': 'email',
  'email1': 'email',

  // Address street
  'address': 'address_street',
  'street': 'address_street',
  'address_street': 'address_street',
  'street address': 'address_street',
  'property address': 'address_street',
  'property_address': 'address_street',
  'property addr': 'address_street',
  'site address': 'address_street',
  'situs address': 'address_street',

  // City
  'city': 'address_city',
  'address_city': 'address_city',
  'property city': 'address_city',

  // State
  'state': 'address_state',
  'address_state': 'address_state',
  'property state': 'address_state',

  // Zip
  'zip': 'address_zip',
  'zipcode': 'address_zip',
  'zip code': 'address_zip',
  'zip_code': 'address_zip',
  'address_zip': 'address_zip',
  'postal': 'address_zip',
  'postal code': 'address_zip',
  'postal_code': 'address_zip',

  // Home value (estimated / market)
  'home_value': 'home_value',
  'home value': 'home_value',
  'property value': 'home_value',
  'est value': 'home_value',
  'estimated value': 'home_value',
  'estimated_value': 'home_value',
  'market value': 'home_value',
  'market_value': 'home_value',
  'avm': 'home_value',

  // Year built
  'year_built': 'year_built',
  'year built': 'year_built',
  'yearbuilt': 'year_built',

  // Roof age
  'roof_age': 'roof_age',
  'roof age': 'roof_age',

  // Roof type
  'roof_type': 'roof_type',
  'roof type': 'roof_type',

  // Phone 2
  'phone2': 'phone2',
  'phone 2': 'phone2',

  // Phone 3
  'phone3': 'phone3',
  'phone 3': 'phone3',

  // Email 2
  'email2': 'email2',
  'email 2': 'email2',

  // Mailing address (absentee owners)
  'mailing address': 'mailing_street',
  'mailing_address': 'mailing_street',
  'mail address': 'mailing_street',
  'mail_address': 'mailing_street',
  'mailing street': 'mailing_street',
  'mailing city': 'mailing_city',
  'mailing_city': 'mailing_city',
  'mail city': 'mailing_city',
  'mail_city': 'mailing_city',
  'mailing state': 'mailing_state',
  'mailing_state': 'mailing_state',
  'mail state': 'mailing_state',
  'mail_state': 'mailing_state',
  'mailing zip': 'mailing_zip',
  'mailing_zip': 'mailing_zip',
  'mail zip': 'mailing_zip',
  'mail_zip': 'mailing_zip',

  // Property details
  'sqft': 'sqft',
  'sq ft': 'sqft',
  'square footage': 'sqft',
  'square_footage': 'sqft',
  'building sqft': 'sqft',
  'building_sqft': 'sqft',
  'lot size': 'lot_size',
  'lot_size': 'lot_size',
  'lotsizearea': 'lot_size',
  'lot size area': 'lot_size',
  'bedrooms': 'bedrooms',
  'beds': 'bedrooms',
  'bathrooms': 'bathrooms',
  'baths': 'bathrooms',
  'stories': 'stories',
  'story': 'stories',

  // Assessed value (separate from home_value / estimated value)
  'assessed value': 'assessed_value',
  'assessed_value': 'assessed_value',

  // Sale history
  'last sale date': 'last_sale_date',
  'last_sale_date': 'last_sale_date',
  'lastsaldate': 'last_sale_date',
  'last sale price': 'last_sale_price',
  'last_sale_price': 'last_sale_price',
  'lastsalprice': 'last_sale_price',

  // Owner type
  'owner type': 'owner_type',
  'owner_type': 'owner_type',
  'owntype': 'owner_type',
  'ownership type': 'owner_type',

  // APN / Parcel number
  'apn': 'apn',
  'parcel number': 'apn',
  'parcel_number': 'apn',
  'parcelnumb': 'apn',
  'assessor parcel number': 'apn',

  // Hail / storm data
  'hail size': 'hail_size_inches',
  'hail_size': 'hail_size_inches',
  'hail size inches': 'hail_size_inches',
  'hail_size_inches': 'hail_size_inches',
  'hail date': 'hail_date',
  'hail_date': 'hail_date',
  'storm date': 'hail_date',
  'storm_date': 'hail_date',
  'storm id': 'storm_id',
  'storm_id': 'storm_id',

  // Coordinates
  'latitude': 'latitude',
  'lat': 'latitude',
  'longitude': 'longitude',
  'lon': 'longitude',
  'lng': 'longitude',

  // Source / notes
  'source': 'source',
  'lead source': 'source',
  'lead_source': 'source',
  'notes': 'notes',
  'source_notes': 'notes',
  'source notes': 'notes',
};

export interface NormalizedLead {
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_normalized: string | null;
  phone2: string | null;
  phone2_normalized: string | null;
  phone3: string | null;
  phone3_normalized: string | null;
  email: string | null;
  email2: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  mailing_street: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  home_value: number | null;
  year_built: number | null;
  sqft: number | null;
  lot_size: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  stories: number | null;
  assessed_value: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
  owner_type: string | null;
  apn: string | null;
  roof_age: number | null;
  roof_type: string | null;
  hail_date: string | null;
  hail_size_inches: number | null;
  storm_id: string | null;
  latitude: number | null;
  longitude: number | null;
  source_notes: string | null;
}

/**
 * Normalize a raw field key to our standard field name.
 */
export function mapFieldName(key: string): string | null {
  const normalized = key.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
  return FIELD_MAP[normalized] || FIELD_MAP[key.toLowerCase().trim()] || null;
}

/**
 * Map raw key-value data (from CSV row or JSON payload) into standard field names.
 */
export function mapRawFields(raw: Record<string, unknown>): Record<string, string> {
  const mapped: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === '') continue;
    const fieldName = mapFieldName(key);
    if (fieldName && !mapped[fieldName]) {
      mapped[fieldName] = String(value);
    }
  }

  return mapped;
}

/**
 * Normalize phone number to E.164 format.
 */
export function normalizePhone(phone: string | null | undefined): { phone: string | null; phone_normalized: string | null } {
  const raw = phone?.trim() || null;
  if (!raw) return { phone: null, phone_normalized: null };

  let normalized: string | null = null;
  try {
    const parsed = parsePhoneNumber(raw, 'US');
    if (parsed?.isValid()) {
      normalized = parsed.format('E.164');
    }
  } catch {
    // Keep raw phone, no normalized version
  }

  return { phone: raw, phone_normalized: normalized };
}

/**
 * Parse a numeric string, stripping currency symbols and commas.
 */
export function parseNumeric(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

/**
 * Normalize a single lead record from raw key-value data.
 * Works with both CSV rows and JSON webhook payloads.
 */
/**
 * Parse a numeric value that may have decimals (e.g., lot size, hail size, bathrooms).
 */
export function parseDecimal(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export function normalizeLeadData(raw: Record<string, unknown>): NormalizedLead | null {
  const mapped = mapRawFields(raw);

  const firstName = mapped.first_name?.trim();
  const lastName = mapped.last_name?.trim();

  if (!firstName || !lastName) return null;

  const { phone, phone_normalized } = normalizePhone(mapped.phone);
  const phone2 = normalizePhone(mapped.phone2);
  const phone3 = normalizePhone(mapped.phone3);

  return {
    first_name: firstName,
    last_name: lastName,
    phone,
    phone_normalized,
    phone2: phone2.phone,
    phone2_normalized: phone2.phone_normalized,
    phone3: phone3.phone,
    phone3_normalized: phone3.phone_normalized,
    email: mapped.email?.trim()?.toLowerCase() || null,
    email2: mapped.email2?.trim()?.toLowerCase() || null,
    address_street: mapped.address_street?.trim() || null,
    address_city: mapped.address_city?.trim() || null,
    address_state: mapped.address_state?.trim() || null,
    address_zip: mapped.address_zip?.trim() || null,
    mailing_street: mapped.mailing_street?.trim() || null,
    mailing_city: mapped.mailing_city?.trim() || null,
    mailing_state: mapped.mailing_state?.trim() || null,
    mailing_zip: mapped.mailing_zip?.trim() || null,
    home_value: parseNumeric(mapped.home_value),
    year_built: parseNumeric(mapped.year_built),
    sqft: parseNumeric(mapped.sqft),
    lot_size: parseDecimal(mapped.lot_size),
    bedrooms: parseNumeric(mapped.bedrooms),
    bathrooms: parseDecimal(mapped.bathrooms),
    stories: parseNumeric(mapped.stories),
    assessed_value: parseNumeric(mapped.assessed_value),
    last_sale_date: mapped.last_sale_date?.trim() || null,
    last_sale_price: parseNumeric(mapped.last_sale_price),
    owner_type: mapped.owner_type?.trim() || null,
    apn: mapped.apn?.trim() || null,
    roof_age: parseNumeric(mapped.roof_age),
    roof_type: mapped.roof_type?.trim()?.toLowerCase() || null,
    hail_date: mapped.hail_date?.trim() || null,
    hail_size_inches: parseDecimal(mapped.hail_size_inches),
    storm_id: mapped.storm_id?.trim() || null,
    latitude: parseDecimal(mapped.latitude),
    longitude: parseDecimal(mapped.longitude),
    source_notes: mapped.notes?.trim() || mapped.source?.trim() || null,
  };
}
