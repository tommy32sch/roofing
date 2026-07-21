import { parsePhoneNumber } from 'libphonenumber-js';

/**
 * Human-readable phone number: "6024237756" → "(602) 423-7756".
 * Falls back to the raw string when it isn't a parseable US number, so we never
 * hide a number just because it's oddly formatted.
 */
export function formatPhone(phone: string | null | undefined): string {
  const raw = phone?.trim();
  if (!raw) return '';
  try {
    const parsed = parsePhoneNumber(raw, 'US');
    if (parsed?.isValid()) return parsed.formatNational();
  } catch {
    // fall through to raw
  }
  return raw;
}

export interface AddressParts {
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
}

/**
 * Display address, street first.
 *
 * Skip-trace lists are frequently street-only (no city/state/zip), so anything
 * that renders city/state alone shows nothing at all for most leads — the street
 * is the part a canvasser actually needs. Returns '' when there is no address.
 */
export function formatAddress(lead: AddressParts): string {
  const cityState = [lead.address_city, lead.address_state].filter(Boolean).join(', ');
  return [lead.address_street, cityState].filter(Boolean).join(' · ');
}

/**
 * Maps link for navigating to a lead. Prefers the geocoded coordinates — most
 * skip-trace addresses have no city, so the raw text alone is ambiguous and can
 * route a rep to the same street in the wrong town. Falls back to the address.
 * Returns null when there's nothing to navigate to.
 */
export function mapsUrl(
  lead: AddressParts & { latitude?: number | string | null; longitude?: number | string | null }
): string | null {
  const base = 'https://www.google.com/maps/search/?api=1&query=';
  if (lead.latitude != null && lead.longitude != null) {
    return `${base}${encodeURIComponent(`${lead.latitude},${lead.longitude}`)}`;
  }
  const q = [lead.address_street, lead.address_city, lead.address_state, lead.address_zip]
    .filter(Boolean)
    .join(', ');
  return q ? `${base}${encodeURIComponent(q)}` : null;
}

/** Short address for tight spaces (table cells, list rows): street only when present. */
export function formatAddressShort(lead: AddressParts): string {
  return (
    lead.address_street ||
    [lead.address_city, lead.address_state].filter(Boolean).join(', ') ||
    ''
  );
}
