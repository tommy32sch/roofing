import Papa from 'papaparse';
import { parsePhoneNumber } from 'libphonenumber-js';

// Map common CSV header variations to our field names
const HEADER_MAP: Record<string, string> = {
  'first_name': 'first_name',
  'first name': 'first_name',
  'fname': 'first_name',
  'first': 'first_name',
  'last_name': 'last_name',
  'last name': 'last_name',
  'lname': 'last_name',
  'last': 'last_name',
  'phone': 'phone',
  'phone number': 'phone',
  'phone_number': 'phone',
  'mobile': 'phone',
  'cell': 'phone',
  'email': 'email',
  'email address': 'email',
  'email_address': 'email',
  'address': 'address_street',
  'street': 'address_street',
  'address_street': 'address_street',
  'street address': 'address_street',
  'property address': 'address_street',
  'city': 'address_city',
  'address_city': 'address_city',
  'state': 'address_state',
  'address_state': 'address_state',
  'zip': 'address_zip',
  'zipcode': 'address_zip',
  'zip code': 'address_zip',
  'zip_code': 'address_zip',
  'address_zip': 'address_zip',
  'postal': 'address_zip',
  'postal code': 'address_zip',
  'home_value': 'home_value',
  'home value': 'home_value',
  'property value': 'home_value',
  'est value': 'home_value',
  'estimated value': 'home_value',
  'year_built': 'year_built',
  'year built': 'year_built',
  'yearbuilt': 'year_built',
  'roof_age': 'roof_age',
  'roof age': 'roof_age',
  'roof_type': 'roof_type',
  'roof type': 'roof_type',
  'source': 'source',
  'lead source': 'source',
  'lead_source': 'source',
  'notes': 'notes',
};

interface ParsedLead {
  first_name: string;
  last_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  home_value: number | null;
  year_built: number | null;
  roof_age: number | null;
  roof_type: string | null;
  source_notes: string | null;
}

export interface CSVParseResult {
  leads: ParsedLead[];
  errors: string[];
  skipped: number;
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

export function parseLeadCSV(csvText: string): CSVParseResult {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => {
      const normalized = normalizeHeader(h);
      return HEADER_MAP[normalized] || HEADER_MAP[h.toLowerCase().trim()] || h.toLowerCase().trim().replace(/\s+/g, '_');
    },
  });

  const leads: ParsedLead[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < result.data.length; i++) {
    const row = result.data[i] as Record<string, string>;
    const rowNum = i + 2; // +2 because header is row 1, data starts at row 2

    const firstName = row.first_name?.trim();
    const lastName = row.last_name?.trim();

    if (!firstName || !lastName) {
      errors.push(`Row ${rowNum}: Missing first or last name`);
      skipped++;
      continue;
    }

    // Normalize phone
    let phone: string | null = row.phone?.trim() || null;
    let phone_normalized: string | null = null;
    if (phone) {
      try {
        const parsed = parsePhoneNumber(phone, 'US');
        if (parsed?.isValid()) {
          phone_normalized = parsed.format('E.164');
        }
      } catch {
        // Keep raw phone
      }
    }

    // Parse numeric fields
    const homeValueStr = row.home_value?.replace(/[$,]/g, '').trim();
    const homeValue = homeValueStr ? parseInt(homeValueStr, 10) : null;

    const yearBuiltStr = row.year_built?.trim();
    const yearBuilt = yearBuiltStr ? parseInt(yearBuiltStr, 10) : null;

    const roofAgeStr = row.roof_age?.trim();
    const roofAge = roofAgeStr ? parseInt(roofAgeStr, 10) : null;

    leads.push({
      first_name: firstName,
      last_name: lastName,
      phone,
      phone_normalized,
      email: row.email?.trim()?.toLowerCase() || null,
      address_street: row.address_street?.trim() || null,
      address_city: row.address_city?.trim() || null,
      address_state: row.address_state?.trim() || null,
      address_zip: row.address_zip?.trim() || null,
      home_value: homeValue && !isNaN(homeValue) ? homeValue : null,
      year_built: yearBuilt && !isNaN(yearBuilt) ? yearBuilt : null,
      roof_age: roofAge && !isNaN(roofAge) ? roofAge : null,
      roof_type: row.roof_type?.trim()?.toLowerCase() || null,
      source_notes: row.notes?.trim() || row.source?.trim() || null,
    });
  }

  return { leads, errors, skipped };
}
