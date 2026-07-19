/**
 * Helpers for building lead list/search queries safely.
 *
 * All lead queries use the Supabase service-role client, and the search term is
 * interpolated into a PostgREST `.or(...)` filter string. That string is a
 * grammar where `, ( ) : % * " \` are structural — so a raw value like
 * "O'Brien, Inc." would break the filter, and a crafted value could inject
 * extra predicates. Sanitizing the term keeps it a plain ILIKE substring.
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .replace(/[,()%*\\":]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Directional designations → the abbreviation plus its spelled-out word, so a
// filter for "E" matches both "123 E Main St" and "123 East Main St".
const DIRECTION_WORDS: Record<string, string> = {
  N: 'North',
  S: 'South',
  E: 'East',
  W: 'West',
  NE: 'Northeast',
  NW: 'Northwest',
  SE: 'Southeast',
  SW: 'Southwest',
};

/** Directional options for the street filter dropdown, in compass order. */
export const STREET_DIRECTIONS = Object.keys(DIRECTION_WORDS);

/**
 * Build a case-insensitive Postgres regex (for the `imatch` operator) that
 * matches a directional token as a whole word — so "E" hits the direction in
 * "123 E Main St" but not the "e" inside "Crescent". Returns null for anything
 * that isn't a known direction, so untrusted input can never reach the regex.
 */
export function directionRegex(dir: string | null | undefined): string | null {
  if (!dir) return null;
  const d = dir.trim().toUpperCase();
  const word = DIRECTION_WORDS[d];
  if (!word) return null;
  return `\\y(${d}|${word})\\y`;
}

/** Reduce a house-number filter to digits only (safe for a prefix ILIKE). */
export function sanitizeStreetNumber(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Columns a client is allowed to sort the leads list by. */
export const LEAD_SORT_COLUMNS = new Set<string>([
  'created_at',
  'updated_at',
  'first_name',
  'last_name',
  'status',
  'priority',
  'deal_value',
  'estimated_roof_value',
  'follow_up_date',
]);

/** Return a validated sort column, falling back to created_at for anything unknown. */
export function safeSortColumn(sort: string | null | undefined): string {
  return sort && LEAD_SORT_COLUMNS.has(sort) ? sort : 'created_at';
}

/**
 * Build the shared ILIKE search filter across the lead columns the list, export,
 * and street-grouping endpoints all search. Returns null when there's nothing to
 * search so callers can skip applying it.
 */
export function buildLeadSearchFilter(rawSearch: string | null | undefined): string | null {
  if (!rawSearch) return null;
  const term = sanitizeSearch(rawSearch);
  if (!term) return null;
  return [
    `first_name.ilike.%${term}%`,
    `last_name.ilike.%${term}%`,
    `email.ilike.%${term}%`,
    `phone.ilike.%${term}%`,
    `address_street.ilike.%${term}%`,
    `address_city.ilike.%${term}%`,
  ].join(',');
}
